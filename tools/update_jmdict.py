#!/usr/bin/env python3
"""Build a compact JP Translator kanji-usage index from EDRDG JMdict + KANJIDIC2.

Output is intentionally small and contains only:
- Japanese on/kun reading stems per kanji (from KANJIDIC2)
- high-priority JMdict words indexed by kanji + the reading actually aligned to that kanji

The browser uses this to show the reading used in the saved word and 2-3 common
words using the same reading. It does NOT ship JMdict gloss text.
"""
from __future__ import annotations

import gzip
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from functools import lru_cache

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "text" / "jmdict_usage.min.json"
JMDICT_URL = "https://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz"
KANJIDIC_URL = "https://ftp.edrdg.org/pub/Nihongo/kanjidic2.xml.gz"
CACHE = ROOT / ".cache" / "jmdict"

KANJI_RE = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")
BAD_MISC_WORDS = (
    "archaism", "obsolete", "obscure", "rare term", "historical term",
    "dated term", "out-dated", "outdated", "vulgar expression or word",
)
BAD_POS_WORDS = (
    "proper noun", "given name", "surname", "place name", "company name",
    "organization name", "product name", "unclassified name",
)

# Initial consonant alternations frequently seen in compounds.
RENDAKU = {
    "か": ("が",), "き": ("ぎ",), "く": ("ぐ",), "け": ("げ",), "こ": ("ご",),
    "さ": ("ざ",), "し": ("じ",), "す": ("ず",), "せ": ("ぜ",), "そ": ("ぞ",),
    "た": ("だ",), "ち": ("ぢ",), "つ": ("づ",), "て": ("で",), "と": ("ど",),
    "は": ("ば", "ぱ"), "ひ": ("び", "ぴ"), "ふ": ("ぶ", "ぷ"), "へ": ("べ", "ぺ"), "ほ": ("ぼ", "ぽ"),
}


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "JP-Translator-JMdict-Updater/1.0"})
    print(f"download: {url}")
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        while True:
            chunk = r.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)


def katakana_to_hiragana(s: str) -> str:
    out = []
    for ch in s:
        code = ord(ch)
        if 0x30A1 <= code <= 0x30F6:
            out.append(chr(code - 0x60))
        else:
            out.append(ch)
    return "".join(out)


def norm_reading(s: str) -> str:
    return katakana_to_hiragana((s or "").strip()).replace(" ", "")


def is_kanji(ch: str) -> bool:
    return bool(KANJI_RE.fullmatch(ch))


def reading_stem(raw: str, rtype: str) -> str:
    r = norm_reading(raw).replace("-", "")
    if rtype == "kun":
        r = r.split(".", 1)[0]
    return r


def candidate_variants(r: str):
    """Yield (surface reading segment, penalty)."""
    if not r:
        return
    seen = set()
    def emit(v, p):
        if v and v not in seen:
            seen.add(v)
            yield (v, p)
    yield from emit(r, 0)
    if r[0] in RENDAKU:
        for first in RENDAKU[r[0]]:
            yield from emit(first + r[1:], 1)
    # Common on-yomi sokuon alternation: はつ→はっ, がく→がっ, etc.
    if len(r) >= 2 and r[-1] in ("つ", "ち", "く"):
        v = r[:-1] + "っ"
        yield from emit(v, 1)
        if v[0] in RENDAKU:
            for first in RENDAKU[v[0]]:
                yield from emit(first + v[1:], 2)


def load_kanjidic(path: Path):
    readings = defaultdict(list)
    creation_date = ""
    with gzip.open(path, "rb") as f:
        for event, elem in ET.iterparse(f, events=("end",)):
            if elem.tag == "date_of_creation" and not creation_date:
                creation_date = (elem.text or "").strip()
            elif elem.tag == "character":
                literal = (elem.findtext("literal") or "").strip()
                if len(literal) == 1:
                    seen = set()
                    for node in elem.findall("./reading_meaning/rmgroup/reading"):
                        typ = node.attrib.get("r_type", "")
                        if typ not in ("ja_on", "ja_kun"):
                            continue
                        kind = "on" if typ == "ja_on" else "kun"
                        stem = reading_stem(node.text or "", kind)
                        if stem and (stem, kind) not in seen:
                            readings[literal].append((stem, kind))
                            seen.add((stem, kind))
                elem.clear()
    # Stable ordering: longer first is useful for alignment; on/kun does not decide correctness.
    for ch in readings:
        readings[ch].sort(key=lambda x: (-len(x[0]), x[1], x[0]))
    return dict(readings), creation_date


def align_word(surface: str, reading: str, readings: dict):
    """Align whole-word reading to individual kanji using KANJIDIC2 candidates.

    Returns a list of dicts for kanji positions, or None for jukujikun/irregular cases.
    This intentionally refuses uncertain special readings instead of inventing per-kanji readings.
    """
    surface = surface.strip()
    reading = norm_reading(reading)
    chars = list(surface)

    @lru_cache(maxsize=None)
    def rec(i: int, j: int):
        if i == len(chars):
            return (0, ()) if j == len(reading) else None
        ch = chars[i]
        if ch == "々" and i > 0 and is_kanji(chars[i-1]):
            base_ch = chars[i-1]
        else:
            base_ch = ch
        if is_kanji(base_ch):
            best = None
            for r, kind in readings.get(base_ch, ()):
                for seg, penalty in candidate_variants(r):
                    if reading.startswith(seg, j):
                        tail = rec(i + 1, j + len(seg))
                        if tail is None:
                            continue
                        score = penalty + tail[0]
                        path = ((i, ch, seg, kind),) + tail[1]
                        cand = (score, path)
                        if best is None or cand[0] < best[0]:
                            best = cand
            return best
        literal = norm_reading(ch)
        if literal and reading.startswith(literal, j):
            tail = rec(i + 1, j + len(literal))
            if tail is not None:
                return tail
        return None

    out = rec(0, 0)
    if out is None:
        return None
    return [
        {"index": i, "char": ch, "reading": seg, "type": kind}
        for i, ch, seg, kind in out[1]
    ]


def priority_score(tags):
    vals = []
    for tag in tags:
        t = (tag or "").strip().lower()
        if not t:
            continue
        if t in ("ichi1", "news1", "spec1"):
            vals.append(0)
        elif t in ("gai1",):
            vals.append(1)
        elif t in ("ichi2", "news2", "spec2", "gai2"):
            vals.append(20)
        elif re.fullmatch(r"nf\d\d", t):
            vals.append(int(t[2:]))
    return min(vals) if vals else None


def extract_jmdict_date(path: Path) -> str:
    try:
        with gzip.open(path, "rt", encoding="utf-8", errors="ignore") as f:
            head = "".join(f.readline() for _ in range(120))
        # Classic snapshots normally include a generated date comment.
        m = re.search(r"(?:created|generated)[^\n\r]{0,80}?(20\d\d[-/]\d\d[-/]\d\d)", head, re.I)
        if m:
            return m.group(1).replace("/", "-")
    except Exception:
        pass
    return ""


def is_bad_entry(entry) -> bool:
    texts = []
    for node in entry.findall("./sense/misc") + entry.findall("./sense/pos") + entry.findall("./sense/field"):
        if node.text:
            texts.append(node.text.lower())
    blob = " | ".join(texts)
    return any(x in blob for x in BAD_MISC_WORDS) or any(x in blob for x in BAD_POS_WORDS)


def valid_surface(word: str) -> bool:
    if not word or len(word) > 12 or not any(is_kanji(c) for c in word):
        return False
    # Allow Japanese kana/kanji, iteration mark, prolonged sound mark, middle dot, ASCII letters/digits.
    return all(
        is_kanji(c) or c == "々" or c == "ー" or c == "・" or
        0x3040 <= ord(c) <= 0x30ff or c.isascii() and (c.isalnum() or c in "-+")
        for c in word
    )


def build_examples(path: Path, readings: dict):
    candidates = defaultdict(dict)  # key -> word -> (score, reading)
    count = 0
    with gzip.open(path, "rb") as f:
        for event, elem in ET.iterparse(f, events=("end",)):
            if elem.tag != "entry":
                continue
            count += 1
            if is_bad_entry(elem):
                elem.clear(); continue
            keles = []
            for k in elem.findall("k_ele"):
                keb = (k.findtext("keb") or "").strip()
                if not valid_surface(keb):
                    continue
                pri = [x.text or "" for x in k.findall("ke_pri")]
                keles.append((keb, pri))
            if not keles:
                elem.clear(); continue
            for r in elem.findall("r_ele"):
                reb = norm_reading(r.findtext("reb") or "")
                if not reb:
                    continue
                rpri = [x.text or "" for x in r.findall("re_pri")]
                restrictions = {(x.text or "").strip() for x in r.findall("re_restr") if (x.text or "").strip()}
                for keb, kpri in keles:
                    if restrictions and keb not in restrictions:
                        continue
                    score = priority_score(kpri + rpri)
                    if score is None:
                        continue  # examples are intentionally limited to common/priority vocabulary
                    aligned = align_word(keb, reb, readings)
                    if not aligned:
                        continue
                    for part in aligned:
                        key = f"{part['char']}|{part['reading']}"
                        existing = candidates[key].get(keb)
                        cand_score = score * 100 + len(keb)
                        if existing is None or cand_score < existing[0]:
                            candidates[key][keb] = (cand_score, reb)
            elem.clear()
            if count % 25000 == 0:
                print(f"parsed JMdict entries: {count}")
    examples = {}
    for key, words in candidates.items():
        ranked = sorted(((sc, w, rd) for w, (sc, rd) in words.items()), key=lambda x:(x[0], len(x[1]), x[1]))[:12]
        examples[key] = [[w, rd] for _, w, rd in ranked]
    return examples


def main():
    force = "--download" in sys.argv or not (CACHE / "JMdict_e.gz").exists() or not (CACHE / "kanjidic2.xml.gz").exists()
    jpath = CACHE / "JMdict_e.gz"
    kpath = CACHE / "kanjidic2.xml.gz"
    if force:
        download(JMDICT_URL, jpath)
        download(KANJIDIC_URL, kpath)

    readings, kanjidic_date = load_kanjidic(kpath)
    print(f"KANJIDIC chars: {len(readings)}")
    examples = build_examples(jpath, readings)
    print(f"example keys: {len(examples)}")

    compact_readings = {ch:[[r,t] for r,t in vals] for ch, vals in readings.items()}
    jmdict_date = extract_jmdict_date(jpath)
    generated = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    payload = {
        "_meta": {
            "generated_at": generated,
            "jmdict_date": jmdict_date,
            "kanjidic_date": kanjidic_date,
            "source": "EDRDG JMdict_e + KANJIDIC2",
            "license": "CC BY-SA 4.0 / EDRDG licence; see EDRDG_CREDITS.txt",
        },
        "readings": compact_readings,
        "examples": examples,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
