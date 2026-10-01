"""The breathing search: finds breathing wherever the head is in the thermal
view (not only in the nostril box), finds nothing in plain noise, and is
quick enough to run every minute. Run: python3 edge/breath_search_test.py"""
import math
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from video_analytics import W, H, FPS, WindowAnalyzer  # noqa: E402
from edge_agent import compute_resp_rate  # noqa: E402

fails = 0


def check(name, ok, detail=""):
    global fails
    if not ok:
        fails += 1
        print(f"FAIL {name} {detail}")


def frames(seconds, bpm=None, at=(120, 70), seed=1):
    """A warm head (brighter, white-hot) on a cool background; a nostril-sized
    patch at `at` breathing at `bpm` (a small brightness swing); sensor noise."""
    rnd = random.Random(seed)
    hx, hy = at
    for k in range(int(seconds * FPS)):
        t = k / FPS
        breath = 6 * math.sin(2 * math.pi * (bpm / 60) * t) if bpm else 0
        f = bytearray(W * H)
        for y in range(H):
            for x in range(W):
                v = 60
                if abs(x - hx) < 30 and abs(y - hy) < 30:
                    v = 150                                   # the head
                    if abs(x - hx) < 6 and abs(y - hy) < 6:
                        v += breath                           # the nostril
                f[y * W + x] = max(0, min(255, int(v + rnd.gauss(0, 2))))
        yield bytes(f)


def run(seconds, **kw):
    a = WindowAnalyzer(mode="thermal")
    for fr in frames(seconds, **kw):
        a.feed(fr)
    t0 = time.time()
    s = a.summary(compute_resp_rate)
    return s, time.time() - t0


s, took = run(60, bpm=12, at=(120, 70))
bs = s.get("breathing_search") or {}
check("breathing found away from the boxes", bs.get("bpm") is not None, s.get("breathing_search"))
check("... at the right rate (12/min)", bs.get("bpm") is not None and abs(bs["bpm"] - 12) <= 1.5, bs.get("bpm"))
b = bs.get("box") or {}
cx, cy = (b.get("x0", 0) + b.get("x1", 0)) / 2 * W / 10000, (b.get("y0", 0) + b.get("y1", 0)) / 2 * H / 10000
check("... and in the right place", abs(cx - 120) <= 12 and abs(cy - 70) <= 12, (cx, cy, b))
check("... quick enough to run every minute", took < 5, f"{took:.1f} s")

s, _ = run(60, bpm=None, at=(60, 80))
check("plain noise: no breathing found", not (s.get("breathing_search") or {}).get("bpm"), s.get("breathing_search"))

s, _ = run(20, bpm=12)
check("under 30 s of video: no search", s.get("breathing_search") is None, s.get("breathing_search"))

# The Live view's breathing every 10 s: the last 35 s, across the minute's
# reset (the window's own summary then has too little to go on).
a = WindowAnalyzer(mode="thermal")
nb = (114, 64, 126, 76)                                       # the breathing patch at (120, 70)
for k, fr in enumerate(frames(40, bpm=12, at=(120, 70), seed=3)):
    if k == 20 * FPS:
        a.reset()                                             # a new minute starts
    a.feed(fr, nb, t=k / FPS)
rec = a.breathing_recent(compute_resp_rate)
check("rolling breathing found across the minute boundary", (rec["nostril"] or {}).get("bpm") is not None, rec)
check("... at the right rate (12/min)", abs(((rec["nostril"] or {}).get("bpm") or 0) - 12) <= 1.5, rec["nostril"])
check("... though the new minute alone has too little", not (a.summary(compute_resp_rate).get("breathing") or {}).get("bpm"))
check("no flank watched: no flank rate", rec["flank"] is None, rec["flank"])

print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
