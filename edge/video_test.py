"""Behaviour heuristics on synthetic thermal frames: what each should and
should NOT report. Run: python3 edge/video_test.py"""
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from edge_agent import compute_resp_rate  # noqa: E402
from video_analytics import W, H, FPS, WindowAnalyzer, FloorTracker, box_px, horse_present  # noqa: E402

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

# Floor: one scan every 2 s over a 16x10 grid (160 cells). A deposit lands
# at minute 2 under the horse (masked), the horse steps off 10 s later, and the
# patch then cools exponentially towards the floor with the given half-life.
def floor_run(cells, half_life_min, peak=9.0, total_minutes=40, spill=False, sun=False, body=False, horse_until=130):
    ft, events = FloorTracker(), []
    for k in range(int(total_minutes * 30)):
        t = k * 2.0
        temps = [24 + rng.gauss(0, 0.2) for _ in range(160)]
        if sun:                                            # a sun patch warming over 20 minutes
            for c in range(60, 90):
                temps[c] += min(8.0, 8.0 * t / 1200)
        horse = set()
        if t >= 120:
            age = (t - 120) / 60
            for c in cells:
                if spill:                                  # cold water: never warm, evaporates cooler
                    temps[c] = 24 - min(2.0, age)
                else:
                    temps[c] = 24 + peak * 0.5 ** (age / half_life_min) + rng.gauss(0, 0.2)
            if t < horse_until:
                horse = set(cells) | {c + 1 for c in cells if c + 1 < 160}
        events += ft.scan(temps, now=t, horse_cells=horse, lying_recent=body)
    return events


URINE = [r * 16 + c for r in range(3, 7) for c in range(3, 9)]        # 24 cells, a wide patch
urine = floor_run(URINE, 2.0)
check("wide patch cooling in ~2 min: urination", len(urine) == 1 and urine[0]["kind"] == "urination", urine)
MANURE = [5 * 16 + 10, 5 * 16 + 11, 6 * 16 + 10, 6 * 16 + 11]        # 4 cells, compact
manure = floor_run(MANURE, 15.0)
check("compact patch staying warm (half-life 15 min): excretion", len(manure) == 1 and manure[0]["kind"] == "excretion", manure)
check("half-life measured", manure and 12 <= (manure[0]["half_life_min"] or 0) <= 18, manure)
check("shape agrees for both", urine and manure and urine[0]["shape_agrees"] and manure[0]["shape_agrees"], (urine, manure))
check("empty floor: no events", floor_run([], 2.0) == [])
check("spilled water (never warm): no event", floor_run(URINE, 2.0, spill=True) == [])
check("sun patch warming slowly: no event", floor_run([], 2.0, sun=True) == [])
bp = floor_run([r * 16 + c for r in range(0, 8) for c in range(0, 16)], 3.0)   # 128 cells: where the horse lay
check("body print where the horse lay: rejected, not an event", all(e.get("kind") is None for e in bp) and len(bp) <= 1, bp)
hidden = floor_run(MANURE, 15.0, horse_until=400)                              # horse stands on it for 4.7 min
check("deposit under the horse: found once it steps off", len(hidden) == 1 and hidden[0]["kind"] == "excretion", hidden)

# Presence: an empty stall is not a resting horse.
empty = [26.0 + rng.gauss(0, 0.3) for _ in range(48)]
check("empty stall: not present", horse_present(empty)[0] is False, horse_present(empty))
horse = empty[:]
for i in range(12, 24):
    horse[i] = 33.5 + rng.gauss(0, 0.3)
check("warm body in view: present", horse_present(horse)[0] is True, horse_present(horse))
close = [33.0 + rng.gauss(0, 0.3) for _ in range(48)]      # head fills the frame, no background
check("head filling the frame: present via the eye box", horse_present(close, eye_max_c=35.2)[0] is True)
check("no readings: cannot tell", horse_present([None] * 48)[0] is None)

# ffmpeg errors are logged and shown in the portal: never with the password.
from video_analytics import clean_ffmpeg_error  # noqa: E402
msg = clean_ffmpeg_error("Error opening input file rtsp://admin:Admin%40123@127.0.0.1:61952/media/live/102.\n")
check("camera password never appears in a video error", "Admin" not in msg and "@" not in msg and "61952" not in msg, msg)

print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
