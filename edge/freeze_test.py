"""The thermal camera recalibrating itself (video_analytics.FreezeWatch): the
picture repeats for ~1.5 s, then jumps. Repeats are left out, each
recalibration is a break no breathing stretch spans, and pixel temperatures
wait it out. Run: python3 edge/freeze_test.py"""
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from edge_agent import compute_resp_rate  # noqa: E402
from video_analytics import W, H, FPS, FreezeWatch, WindowAnalyzer, box_px  # noqa: E402

rng = random.Random(11)
fails = 0


def check(name, ok, detail=""):
    global fails
    if not ok:
        fails += 1
        print(f"FAIL {name} {detail}")


NOISE = [bytes(max(0, min(255, int(60 + rng.gauss(0, 1.5)))) for _ in range(W * H)) for _ in range(8)]
NB = box_px({"x0": 5000, "y0": 5000, "x1": 5600, "y1": 5700})


def frame(i, d=0.0, ghost=0.0):
    """Noisy stall, a warm head, a nostril patch at +d; `ghost` darkens the
    head after a recalibration (the 13 mm unit's re-based picture)."""
    f = bytearray(NOISE[i % len(NOISE)])
    for y in range(46, 106):
        for x in range(65, 125):
            f[y * W + x] = int(170 - ghost)
    x0, y0, x1, y1 = NB
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            f[y * W + x] = max(0, min(255, int(150 - ghost + d)))
    return bytes(f)


breath = lambda i: 8 * math.sin(2 * math.pi * 15 / 60 * i / FPS) + rng.gauss(0, 1)

# 1. The watcher: a live picture never repeats; 15 repeats then a jump is one recalibration.
fw = FreezeWatch()
out = [fw.feed(frame(i), t=i / FPS) for i in range(100)]
check("a live picture: no repeats, no recalibration", not any(r or c for r, c in out) and fw.count == 0, fw.count)
stuck = frame(100)
out = [fw.feed(stuck, t=(100 + k) / FPS) for k in range(15)]
check("the frozen picture: every repeat skipped", all(r for r, _ in out[1:]), out)
check("recalibrating while frozen", fw.busy(11.0))
r, c = fw.feed(frame(200, ghost=40), t=11.6)
check("first live frame after it: recalibrated", (r, c) == (False, True) and fw.count == 1, (r, c, fw.count))
check("temperatures wait a second after", fw.busy(12.0) and not fw.busy(12.8))
fw.feed(frame(201), t=11.7)
for k in range(4):
    fw.feed(frame(202), t=11.8 + k / FPS)                  # a 0.4 s stall: skipped, not a recalibration
fw.feed(frame(203), t=12.5)
check("a short stall is not a recalibration", fw.count == 1, fw.count)

# 2. Breathing: 45 s, a recalibration (picture re-based darker), 25 s more.
a = WindowAnalyzer()
for i in range(45 * FPS):
    a.feed(frame(i, breath(i)), NB, t=i / FPS)
stuck = frame(450, breath(450))
for k in range(15):
    a.feed(stuck, NB, t=45 + k / FPS)
for i in range(460, 460 + 25 * FPS):
    a.feed(frame(i, breath(i), ghost=35), NB, t=i / FPS)
s = a.summary(compute_resp_rate)
check("one recalibration this window, 1.4 s frozen", s.get("recalibrations") == 1 and 1.0 <= s.get("frozen_s", 0) <= 1.6, s)
check("the repeated frames are left out (the first frozen frame is still new)", s["frames"] == 70 * FPS + 1, s["frames"])
br = s.get("breathing") or {}
check("breathing still found — from a stretch that does not span the recalibration",
      br.get("bpm") and abs(br["bpm"] - 15) < 1.5 and br["seconds"] <= 45, br)
rec = a.breathing_recent(compute_resp_rate)
check("the Live view's last 35 s: only since the recalibration (25 s — too short to judge)", rec["nostril"] is None, rec)

# 3. The colour picture has no recalibration to watch for.
check("colour analysis: no freeze watch", WindowAnalyzer(mode="visible").freeze is None)

print("freeze_test:", "OK" if not fails else f"{fails} failed")
sys.exit(1 if fails else 0)
