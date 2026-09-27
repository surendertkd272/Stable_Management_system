"""Copy every reading into a permanent research archive — the live store keeps
only 21 days. Read-only on the store: safe to run beside a running demo.

  python3 tools/archive_readings.py                 once
  python3 tools/archive_readings.py --every 300     every 5 minutes, until stopped

Writes <out>/readings/YYYY-MM-DD.jsonl (one reading per line, by the reading's
own date, UTC) — each reading once, however often it runs. Recorded video
stays where the edge agent keeps it (~/EquiCare-demo/recordings); a manifest
of both is written to <out>/MANIFEST.json.
"""
import argparse
import json
import os
import time
from pathlib import Path

HOME = Path.home() / "EquiCare-demo"


def archive_once(store, out):
    try:
        state = json.loads(Path(store).read_text())
    except (OSError, ValueError) as e:                # the server is mid-write: try next round
        return f"store not readable right now ({e})"
    rdir = out / "readings"
    rdir.mkdir(parents=True, exist_ok=True)
    seen_file = out / ".archived-ids"
    seen = set(seen_file.read_text().split()) if seen_file.exists() else set()
    new = [r for r in state.get("readings", []) if r.get("id") and r["id"] not in seen]
    by_day = {}
    for r in new:
        by_day.setdefault(str(r.get("ts", ""))[:10] or "undated", []).append(r)
    for day, rows in by_day.items():
        with open(rdir / f"{day}.jsonl", "a") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
    if new:
        with open(seen_file, "a") as f:
            f.write("\n".join(r["id"] for r in new) + "\n")
    rec = HOME / "recordings"
    clips = sorted(str(p.relative_to(rec)) for p in rec.rglob("*.mp4")) if rec.exists() else []
    manifest = {
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "readings": {"files": sorted(p.name for p in rdir.glob("*.jsonl")), "total": len(seen) + len(new)},
        "horses": [{"id": h.get("id"), "name": h.get("name"), "stall": h.get("stall")} for h in state.get("entities", {}).get("horses", [])],
        "labels": len(state.get("entities", {}).get("footage_labels", [])),
        "video": {"root": str(rec), "clips": len(clips),
                  "gigabytes": round(sum((rec / c).stat().st_size for c in clips) / 1e9, 2) if clips else 0},
    }
    tmp = out / "MANIFEST.json.tmp"
    tmp.write_text(json.dumps(manifest, indent=1))
    os.replace(tmp, out / "MANIFEST.json")
    return f"{len(new)} new readings archived ({manifest['readings']['total']} total), {len(clips)} video clips"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--store", default=str(HOME / "data" / "state.json"))
    ap.add_argument("--out", default=str(HOME / "research"))
    ap.add_argument("--every", type=int, default=0, help="seconds between runs (0 = once)")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    while True:
        print(f"[archive] {time.strftime('%H:%M:%S')} {archive_once(a.store, out)}", flush=True)
        if not a.every:
            break
        time.sleep(a.every)


if __name__ == "__main__":
    main()
