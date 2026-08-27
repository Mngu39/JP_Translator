import json, os, time, urllib.request, urllib.error
from datetime import datetime, timezone

URL = os.environ["FURIGANA_URL"]
TEXT = "今日は少し眠いけれど、まだやることがあります。"

def call():
    payload = json.dumps({"text": TEXT, "perChar": False}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        URL, data=payload, method="POST",
        headers={"Content-Type":"application/json","User-Agent":"JP-Translator-Coldstart-Retest/1.0"}
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode("utf-8", errors="replace")
            ms = (time.perf_counter()-t0)*1000
            return {"http": r.status, "ms": round(ms,1), "body": body[:300]}
    except urllib.error.HTTPError as e:
        ms = (time.perf_counter()-t0)*1000
        return {"http": e.code, "ms": round(ms,1), "body": e.read().decode("utf-8", errors="replace")[:300]}
    except Exception as e:
        ms = (time.perf_counter()-t0)*1000
        return {"http": None, "ms": round(ms,1), "body": repr(e)}

def main():
    print("Cloud Run cold-start retest")
    print("URL:", URL)
    print("IMPORTANT: run this only after leaving the service unused long enough to scale to zero.")
    first = call()
    if first["http"] != 200:
        raise SystemExit(f"First request failed: {first}")
    second = call()
    if second["http"] != 200:
        raise SystemExit(f"Second request failed: {second}")
    out = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "first_ms": first["ms"],
        "second_ms": second["ms"],
        "difference_ms": round(first["ms"]-second["ms"],1),
        "http": f'{first["http"]}/{second["http"]}'
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary,"a",encoding="utf-8") as f:
            f.write("## Cloud Run cold-start retest\n\n")
            f.write("| First request | Immediate second | Difference | HTTP |\n")
            f.write("|---:|---:|---:|---|\n")
            f.write(f'| {out["first_ms"]:.1f} ms | {out["second_ms"]:.1f} ms | {out["difference_ms"]:.1f} ms | {out["http"]} |\n')
            f.write("\nRun only after enough idle time for scale-to-zero.\n")

if __name__ == "__main__":
    main()
