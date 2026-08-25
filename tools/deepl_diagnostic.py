import json
import os
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

WORKER_BASE = os.environ.get("WORKER_BASE", "").rstrip("/")
if not WORKER_BASE:
    raise SystemExit("WORKER_BASE is missing")

# cumulative absolute checkpoints in minutes from workflow start
CHECKPOINTS = [0, 30, 60, 120, 240]
TEST_TEXT = "あ"

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def http_json(url, method="GET", payload=None, timeout=30):
    data = None
    headers = {"User-Agent": "JP-Translator-DeepL-Diagnostic/1.0"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
            elapsed = time.perf_counter() - start
            return {
                "ok": 200 <= resp.status < 300,
                "status": resp.status,
                "elapsed_s": elapsed,
                "body": body.decode("utf-8", errors="replace")[:500],
            }
    except urllib.error.HTTPError as e:
        elapsed = time.perf_counter() - start
        try:
            body = e.read().decode("utf-8", errors="replace")[:500]
        except Exception:
            body = ""
        return {"ok": False, "status": e.code, "elapsed_s": elapsed, "body": body}
    except Exception as e:
        elapsed = time.perf_counter() - start
        return {"ok": False, "status": None, "elapsed_s": elapsed, "body": repr(e)}

def measure():
    health = http_json(f"{WORKER_BASE}/health", timeout=20)

    first = http_json(
        f"{WORKER_BASE}/run/translate",
        method="POST",
        payload={"text": TEST_TEXT, "src": "ja", "tgt": "ko"},
        timeout=30,
    )

    second = http_json(
        f"{WORKER_BASE}/run/translate",
        method="POST",
        payload={"text": TEST_TEXT, "src": "ja", "tgt": "ko"},
        timeout=30,
    )

    return {
        "timestamp_utc": now_iso(),
        "health_ms": round(health["elapsed_s"] * 1000, 1),
        "health_status": health["status"],
        "deepl_first_ms": round(first["elapsed_s"] * 1000, 1),
        "deepl_first_status": first["status"],
        "deepl_second_ms": round(second["elapsed_s"] * 1000, 1),
        "deepl_second_status": second["status"],
        "first_body": first["body"],
        "second_body": second["body"],
    }

def print_table(rows):
    print("\n=== DeepL idle diagnostic summary ===")
    print(f"{'Idle(min)':>9} | {'Worker(ms)':>10} | {'DeepL #1(ms)':>12} | {'DeepL #2(ms)':>12} | {'HTTP':>12}")
    print("-" * 68)
    for r in rows:
        http = f"{r['deepl_first_status']}/{r['deepl_second_status']}"
        print(
            f"{r['idle_min']:>9} | "
            f"{r['health_ms']:>10.1f} | "
            f"{r['deepl_first_ms']:>12.1f} | "
            f"{r['deepl_second_ms']:>12.1f} | "
            f"{http:>12}"
        )

def main():
    start = time.monotonic()
    rows = []

    print("DeepL idle diagnostic started.")
    print("Checkpoints:", CHECKPOINTS)
    print("Worker:", WORKER_BASE)
    print("The runner may be closed locally; this continues on GitHub-hosted infrastructure.")

    for checkpoint in CHECKPOINTS:
        target = start + checkpoint * 60
        remaining = target - time.monotonic()
        if remaining > 0:
            print(f"\nWaiting until {checkpoint} min checkpoint: {remaining/60:.1f} min")
            time.sleep(remaining)

        print(f"\n--- Measuring after ~{checkpoint} min from workflow start ---")
        row = measure()
        row["idle_min"] = checkpoint
        rows.append(row)
        print(json.dumps(row, ensure_ascii=False, indent=2))

    print_table(rows)

    out_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if out_path:
        with open(out_path, "a", encoding="utf-8") as f:
            f.write("## DeepL idle diagnostic\n\n")
            f.write("| Idle (min) | Worker health (ms) | DeepL first (ms) | DeepL second (ms) | HTTP |\n")
            f.write("|---:|---:|---:|---:|---|\n")
            for r in rows:
                f.write(
                    f"| {r['idle_min']} | {r['health_ms']:.1f} | "
                    f"{r['deepl_first_ms']:.1f} | {r['deepl_second_ms']:.1f} | "
                    f"{r['deepl_first_status']}/{r['deepl_second_status']} |\n"
                )
            f.write("\n")
            f.write("Interpretation hint: if Worker health stays fast but DeepL #1 becomes much slower than #2 after a certain idle interval, the delay is likely on the Worker→DeepL first-request path.\n")

if __name__ == "__main__":
    main()
