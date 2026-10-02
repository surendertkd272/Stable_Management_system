"""edge/replay.py: recorded clips are analysed on the recording's own clock,
with the live worker's readings, no temperatures claimed, a stop in the
recording skipped, and the same timestamps on a second run (so the server's
de-duplication stores a night once). Synthetic clips; no detector.
Run: python3 edge/replay_test.py"""
import datetime as dt
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
import replay  # noqa: E402

fails = 0


def check(name, ok, detail=""):
    global fails
    if not ok:
        fails += 1
        print(f"FAIL {name} {detail}")


def clip(path, seconds, moving):
    """A test picture: a bright block that moves (or not) on a grey field."""
    x = "mod(t*80\\,500)" if moving else "100"          # overlay moves per frame (drawbox does not)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=gray:s=704x576:r=25:d={seconds}",
                    "-f", "lavfi", "-i", f"color=white:s=120x120:r=25:d={seconds}",
                    "-filter_complex", f"[0][1]overlay=x={x}:y=200:shortest=1", "-c:v", "mpeg4", "-q:v", "5",
                    str(path)], check=True)


if not shutil.which("ffmpeg"):
    print("SKIP (no ffmpeg)")
    sys.exit(0)

tz = ZoneInfo("Asia/Kolkata")
root = Path(tempfile.mkdtemp())
for kind in ("thermal", "visible"):
    (root / kind).mkdir()
    clip(root / kind / "2026-10-01T21-00-00.mp4", 150, moving=True)      # 21:00:00–21:02:30
    clip(root / kind / "2026-10-01T21-10-00.mp4", 130, moving=False)     # after a stop: 21:10:00–21:12:10

therm = replay.list_clips(root / "thermal", tz)
vis = replay.list_clips(root / "visible", tz)
t0 = dt.datetime(2026, 10, 1, 21, 0, 0, tzinfo=tz).timestamp()
check("clip times from the names, in the recorder's time zone", therm and abs(therm[0][0] - t0) < 0.01, therm[:1])
check("clip ends from their length", abs(therm[0][1] - (t0 + 150)) < 1, therm[:1])

dev = {"id": "cam-test", "name": "test camera", "kind": "thermal_camera", "calibrated": True,
       "rois": {"nostril": {"x0": 4000, "y0": 4000, "x1": 6000, "y1": 6000}}, "floorCalib": {}}
job = (dev, therm, vis, therm[0][0], therm[-1][1], None, None, "test")
out = replay.run_chunk(job)
ts = sorted({r["ts"] for r in out})
utc = lambda h, m, s=0: dt.datetime(2026, 10, 1, h, m, s, tzinfo=tz).astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")  # noqa: E731
check("readings stamped on the recording's clock, a minute apart",
      ts[:2] == [utc(21, 1), utc(21, 2)], ts[:3])
# The minute the footage stops in still ends at its minute mark (21:03, half
# of it recorded), as live; then nothing until the recording starts again.
check("the stop in the recording is skipped, not filled",
      utc(21, 11) in ts and not any(utc(21, 3) < t < utc(21, 10) for t in ts), ts)
metrics = {r["metric"] for r in out}
check("activity and the breathing check, as live", {"activity_index", "inactive_minutes", "breathing_check"} <= metrics, metrics)
check("no temperature is claimed", not ({"body_temp_c", "nostril_temp_c"} & metrics), metrics)
check("no Live-view 10 s breathing rates for a past night", "respiratory_rate_live_bpm" not in metrics, metrics)
eye = [r for r in out if r["metric"] == "eye_check"]
check("each minute's eye check says why", eye and all(r["value"] == 0 and "no temperatures" in r["meta"]["detail"] for r in eye),
      eye[:1])
check("readings say they came from a recording", all(r["meta"].get("fromRecording") for r in out))
act = {r["ts"]: r["value"] for r in out if r["metric"] == "activity_index"}
check("a moving picture is more active than a still one", act.get(utc(21, 1), 0) > act.get(utc(21, 11), 1), act)
colour_only = replay.run_chunk((dev, [], vis, vis[0][0], vis[-1][1], None, None, "colour only"))
check("colour clips without thermal: activity and rest still analysed",
      {"activity_index", "inactive_minutes"} <= {r["metric"] for r in colour_only}, {r["metric"] for r in colour_only})
again = replay.run_chunk(job)
check("the same timestamps on a second run (stored once)", sorted({r["ts"] for r in again}) == ts)

shutil.rmtree(root, ignore_errors=True)
print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
