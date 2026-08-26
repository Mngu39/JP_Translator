import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

WORKER_BASE = os.environ.get("WORKER_BASE", "").rstrip("/")
APP_TOKEN = os.environ.get("APP_TOKEN", "")
TEST_TEXT = "あ"

# IMPORTANT:
# These are REAL idle periods *between* DeepL measurements.
# Total wait = 240 + 60 + 30 = 330 min (5.5 h), under GitHub's 6 h/job limit.
IDLE_INTERVALS_MIN = [240, 60, 30]

def utc_now():
    return datetime.now(timezone.utc).isoformat()

def fail(msg):
    print(f"\nFATAL: {msg}", file=sys.stderr, flush=True)
    raise SystemExit(1)

def request(url, method="GET", payload=None, timeout=30, auth=False):
    headers = {
        "User-Agent": "JP-Translator-DeepL-Diagnostic/2.0",
        "Accept": "application/json",
    }
    if auth:
        headers["x-app-token"] = APP_TOKEN
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            ms = (time.perf_counter() - t0) * 1000
            return resp.status, ms, raw.decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        ms = (time.perf_counter() - t0) * 1000
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            body = ""
        return e.code, ms, body
    except Exception as e:
        ms = (time.perf_counter() - t0) * 1000
        return None, ms, repr(e)

def health():
    status, ms, body = request(f"{WORKER_BASE}/health", timeout=20)
    if status != 200:
        fail(f"/health failed: HTTP {status}, {ms:.1f} ms, body={body[:300]!r}")
    try:
        parsed = json.loads(body)
    except Exception:
        parsed = {}
    if parsed.get("ok") is not True:
        fail(f"/health returned unexpected body: {body[:300]!r}")
    return ms

def translate():
    status, ms, body = request(
        f"{WORKER_BASE}/run/translate",
        method="POST",
        payload={"text": TEST_TEXT, "src": "ja", "tgt": "ko"},
        timeout=30,
        auth=True,
    )
    if status != 200:
        fail(
            f"DeepL route failed: HTTP {status}, {ms:.1f} ms, "
            f"body={body[:500]!r}. Long idle test aborted immediately."
        )
    try:
        parsed = json.loads(body)
    except Exception:
        fail(f"DeepL route returned non-JSON body: {body[:500]!r}")
    out = parsed.get("translation") or parsed.get("text") or parsed.get("result")
    if not isinstance(out, str) or not out.strip():
        fail(f"DeepL route returned HTTP 200 but no translation: {body[:500]!r}")
    return ms, out.strip()

def measure(label, actual_idle_s=None):
    worker_ms = health()
    first_ms, first_text = translate()
    second_ms, second_text = translate()

    if first_text != second_text:
        fail(f"Two immediate translations disagree: {first_text!r} vs {second_text!r}")

    row = {
        "label": label,
        "actual_idle_min": None if actual_idle_s is None else round(actual_idle_s / 60, 2),
        "timestamp_utc": utc_now(),
        "worker_health_ms": round(worker_ms, 1),
        "deepl_first_ms": round(first_ms, 1),
        "deepl_second_ms": round(second_ms, 1),
        "translation": first_text,
        "http": "200/200",
    }
    print(json.dumps(row, ensure_ascii=False, indent=2), flush=True)
    return row

def sleep_idle(minutes):
    # No network requests are made here. Console heartbeat only.
    total = minutes * 60
    started = time.monotonic()
    deadline = started + total
    print(f"\nIdling for {minutes} minutes. No Worker/DeepL requests will be sent.", flush=True)

    heartbeat = 15 * 60
    next_heartbeat = min(started + heartbeat, deadline)

    while True:
        now = time.monotonic()
        if now >= deadline:
            break
        sleep_for = min(deadline - now, max(1, next_heartbeat - now))
        time.sleep(sleep_for)
        now = time.monotonic()
        if now >= next_heartbeat and now < deadline:
            elapsed = (now - started) / 60
            remain = (deadline - now) / 60
            print(f"  idle heartbeat: elapsed {elapsed:.1f} min, remaining {remain:.1f} min", flush=True)
            next_heartbeat += heartbeat

    return time.monotonic() - started

def classify(row):
    h = row["worker_health_ms"]
    f = row["deepl_first_ms"]
    s = row["deepl_second_ms"]

    if h >= 1500:
        return "Worker/Cloudflare path also slow"
    if f >= 1500 and f >= s * 3:
        return "First DeepL request cold/slow; immediate second request warm"
    if f >= 1500 and s >= 1500:
        return "Both DeepL requests slow; not a simple first-request warm-up pattern"
    return "No large first-request delay reproduced"

def write_summary(rows):
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    lines = [
        "## DeepL idle diagnostic",
        "",
        "**All translation measurements below were authenticated and returned HTTP 200.**",
        "",
        "| Test | Actual idle since previous DeepL request (min) | Worker health (ms) | DeepL first (ms) | DeepL second (ms) | Interpretation |",
        "|---|---:|---:|---:|---:|---|",
    ]
    for r in rows:
        idle = "0" if r["actual_idle_min"] is None else f'{r["actual_idle_min"]:.2f}'
        lines.append(
            f'| {r["label"]} | {idle} | {r["worker_health_ms"]:.1f} | '
            f'{r["deepl_first_ms"]:.1f} | {r["deepl_second_ms"]:.1f} | {classify(r)} |'
        )
    lines += [
        "",
        "The idle value is measured from the end of the previous DeepL measurement to the next measurement. "
        "It is **not** an absolute workflow checkpoint.",
    ]
    text = "\n".join(lines) + "\n"
    print("\n=== FINAL SUMMARY ===\n")
    print(text, flush=True)
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as f:
            f.write(text)

def preflight():
    if not WORKER_BASE:
        fail("WORKER_BASE is missing")
    if not APP_TOKEN:
        fail(
            "GitHub secret DIAG_APP_TOKEN is missing. "
            "Add repository secret DIAG_APP_TOKEN, then rerun."
        )

    print("Preflight: validating Worker and authenticated DeepL route.", flush=True)
    worker_ms = health()
    first_ms, text1 = translate()
    second_ms, text2 = translate()
    if text1 != text2:
        fail("Immediate translations differ unexpectedly")
    print(
        f"PRECHECK PASSED: /health={worker_ms:.1f} ms, "
        f"DeepL #1={first_ms:.1f} ms, #2={second_ms:.1f} ms, "
        f"translation={text1!r}",
        flush=True,
    )
    print("Long diagnostic may now safely start.", flush=True)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--preflight", action="store_true")
    args = parser.parse_args()

    if args.preflight:
        preflight()
        return

    if not WORKER_BASE or not APP_TOKEN:
        fail("Required environment is missing; preflight should have stopped this run.")

    print("DeepL idle diagnostic v2 started.", flush=True)
    print(f"Worker: {WORKER_BASE}", flush=True)
    print(f"Real idle intervals: {IDLE_INTERVALS_MIN} minutes", flush=True)
    print(f"Total planned idle: {sum(IDLE_INTERVALS_MIN)} minutes", flush=True)

    rows = []

    # A baseline measurement warms the path. From this point onward, every sleep interval
    # is a genuine no-request idle interval.
    print("\n--- Baseline measurement ---", flush=True)
    rows.append(measure("baseline", None))

    for minutes in IDLE_INTERVALS_MIN:
        actual_idle_s = sleep_idle(minutes)
        print(f"\n--- Measurement after actual {actual_idle_s/60:.2f} min idle ---", flush=True)
        rows.append(measure(f"after {minutes}m idle", actual_idle_s))

    write_summary(rows)

if __name__ == "__main__":
    main()
