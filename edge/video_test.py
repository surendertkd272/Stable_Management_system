"""Behaviour heuristics on synthetic thermal frames: what each should and
should NOT report. Run: python3 edge/video_test.py"""
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from edge_agent import compute_resp_rate  # noqa: E402
from video_analytics import W, H, FPS, WindowAnalyzer, FloorWatcher, box_px  # noqa: E402

rng = random.Random(7)
fails = 0


def check(name, ok, detail=""):
    global fails
    if not ok:
        fails += 1
        print(f"FAIL {name} {detail}")


NOISE = [bytes(max(0, min(255, int(60 + rng.gauss(0, 1.5)))) for _ in range(W * H)) for _ in range(8)]


def frame(blob_x=None, blob_y=H // 2, blob_r=14, gain=1.0, offset=0.0, nostril=None, k=[0]):
    """A warm blob (the horse) on a cooler stall with sensor noise; `gain` and
    `offset` imitate the palette's auto-range; `nostril` sets a patch."""
    k[0] += 1
    f = bytearray(NOISE[k[0] % len(NOISE)])
    if blob_x is not None:
        for y in range(max(0, int(blob_y - blob_r)), min(H, int(blob_y + blob_r) + 1)):
            half = math.sqrt(max(0, blob_r ** 2 - (y - blob_y) ** 2))
            for x in range(max(0, int(blob_x - half)), min(W, int(blob_x + half) + 1)):
                f[y * W + x] = 170
    if nostril:
        x0, y0, x1, y1, d = nostril
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                f[y * W + x] = max(0, min(255, int(150 + d)))
    if gain != 1.0 or offset:
        f = bytearray(max(0, min(255, int(v * gain + offset))) for v in f)
    return bytes(f)


def run(n, make, nostril_bounds=None):
    a = WindowAnalyzer()
    for i in range(n):
        a.feed(make(i), nostril_bounds)
    return a.summary(compute_resp_rate)


N = FPS * 60   # one minute

still = run(N, lambda i: frame(blob_x=80))
check("still horse: activity ~0", still["activity"] < 0.05, still)
check("still horse: whole minute inactive", abs(still["inactive_min"] - 1.0) < 0.1, still)
check("still horse: no weaving", not still.get("weave", {}).get("detected"), still)

agc = run(N, lambda i: frame(blob_x=80, gain=1 + 0.15 * math.sin(i / 20), offset=10 * math.sin(i / 33)))
check("auto-range drift is not movement", agc["activity"] < 0.1 and agc["inactive_min"] > 0.8, agc)

walk = run(N, lambda i: frame(blob_x=30 + 55 * (1 + math.sin(i / 97)) + 10 * math.sin(i / 23), blob_y=50 + 25 * math.sin(i / 71)))
check("moving horse: activity high", walk["activity"] > 0.3, walk)
check("moving horse: not inactive", walk["inactive_min"] < 0.2, walk)
check("wandering is not weaving", not walk.get("weave", {}).get("detected"), walk.get("weave"))

weave = run(N, lambda i: frame(blob_x=80 + 30 * math.sin(2 * math.pi * 0.5 * i / FPS)))
check("side-to-side sway at 0.5 Hz: weaving", weave.get("weave", {}).get("detected"), weave.get("weave"))
check("weaving frequency ~0.5 Hz", abs((weave["weave"]["hz"] or 0) - 0.5) < 0.1, weave.get("weave"))

nb = box_px({"x0": 5000, "y0": 5000, "x1": 5600, "y1": 5700})
breath = run(N, lambda i: frame(blob_x=95, blob_y=76, blob_r=30,
                                nostril=(*nb, 8 * math.sin(2 * math.pi * 15 / 60 * i / FPS) + rng.gauss(0, 1))), nb)
check("breathing 15 bpm found in the nostril box", breath.get("breathing", {}).get("bpm") and abs(breath["breathing"]["bpm"] - 15) < 1.5, breath.get("breathing"))
flat = run(N, lambda i: frame(blob_x=95, blob_y=76, blob_r=30, nostril=(*nb, rng.gauss(0, 1))), nb)
check("no breathing signal: no rate invented", flat.get("breathing", {}).get("bpm") is None, flat.get("breathing"))

# Floor: one scan every 5 s over a 12x8 grid.
def floor_run(patch_cells, warm_minutes, total_minutes=15):
    fw, events, t = FloorWatcher(), [], 0.0
    for k in range(int(total_minutes * 12)):
        t = k * 5.0
        temps = [26 + rng.gauss(0, 0.2) for _ in range(96)]
        if 2 <= t / 60 < 2 + warm_minutes:
            cool = (t / 60 - 2) / warm_minutes            # cools towards the floor
            for c in patch_cells:
                temps[c] = 36 - 8 * cool
        e = fw.scan(temps, now=t)
        if e:
            events.append(e)
    return events

urine = floor_run(list(range(0, 24)), 3)                 # wide patch, cools in ~3 min
check("wide patch cooling fast: urination", len(urine) == 1 and urine[0]["kind"] == "urination", urine)
manure = floor_run([40, 41, 52], 11)                     # compact, warm ~10 min
check("compact patch staying warm: excretion", len(manure) == 1 and manure[0]["kind"] == "excretion", manure)
check("shape agrees for both", urine and manure and urine[0]["shape_agrees"] and manure[0]["shape_agrees"])
nothing = floor_run([], 0)
check("empty floor: no events", nothing == [], nothing)

print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
