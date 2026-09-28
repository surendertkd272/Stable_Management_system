"""Recording storage cap: the oldest clips go first; a clip being written is
never deleted. Run: python3 edge/recorder_test.py"""
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from recorder import enforce_cap, folder_size, record_cmd, stream_path  # noqa: E402

fails = 0


def check(name, ok, detail=""):
    global fails
    if not ok:
        fails += 1
        print(f"FAIL {name} {detail}")


with tempfile.TemporaryDirectory() as root:
    now = time.time()
    made = []
    for i in range(6):                                   # 6 clips of 1 MB, one per hour, oldest first
        p = Path(root, "cam1", "thermal" if i % 2 else "visible", f"2026-09-26T{10 + i:02d}-00-00.mp4")
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"\0" * 1_000_000)
        t = now - (6 - i) * 3600
        os.utime(p, (t, t))
        made.append(p)
    live = Path(root, "cam1", "thermal", "2026-09-26T16-00-00.mp4")    # being recorded right now
    live.write_bytes(b"\0" * 3_000_000)
    check("size counted", folder_size(root) == 9_000_000, folder_size(root))
    gone = enforce_cap(root, 5_000_000)
    check("oldest deleted first", [Path(g).name for g in gone] == [m.name for m in made[:4]], gone)
    check("under the cap afterwards", folder_size(root) <= 5_000_000, folder_size(root))
    check("the clip being written survives", live.exists())
    check("nothing to do when under the cap", enforce_cap(root, 50_000_000) == [])
    # Even over the cap, a live clip is not deleted.
    check("live clip spared even when it alone is over the cap", enforce_cap(root, 1) and live.exists())

# Which stream is recorded, and how it is tagged.
check("colour: the sub-stream by default", stream_path({}, "visible") == "/media/live/102")
check("colour: full HD when the camera is set to it", stream_path({"colourStream": "main"}, "visible") == "/media/live/101")
check("thermal: always the sub-stream", stream_path({"colourStream": "main"}, "thermal") == "/media/live/202")
hevc, h264 = record_cmd("rtsp://x", "/tmp/o", 600, "hevc"), record_cmd("rtsp://x", "/tmp/o", 600, "h264")
check("HEVC is tagged hvc1 (Safari plays it)", "hvc1" in hevc, hevc)
check("H.264 is not tagged hvc1 (ffmpeg would refuse)", "hvc1" not in h264 and "copy" in h264, h264)
check("codec unknown: tagged as the demo unit's HEVC", "hvc1" in record_cmd("rtsp://x", "/tmp/o", 600, None))

print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
