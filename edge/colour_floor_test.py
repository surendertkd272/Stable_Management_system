"""Urination / manure from the colour picture, on synthetic frames: what it
should and should NOT report. Run: python3 edge/colour_floor_test.py"""
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from colour_floor import ColourFloorWatcher  # noqa: E402

W, H = 352, 288
rng = random.Random(5)
fails = 0


def check(name, ok, detail=""):
    global fails
    if not ok:
        fails += 1
        print(f"FAIL {name} {detail}")


BED = [max(0, min(255, int(150 + rng.gauss(0, 6)))) for _ in range(W * H)]      # shavings


def frame(horse=None, manure=None, wet=None, shadow=None, light=1.0, ir=False):
    f = bytearray(BED)
    def fill(box, fn):
        x0, y0, x1, y1 = (int(box[0] * W), int(box[1] * H), int(box[2] * W), int(box[3] * H))
        for y in range(y0, y1):
            for x in range(x0, x1):
                f[y * W + x] = fn(x, y, f[y * W + x])
    if wet:
        fill(wet, lambda x, y, v: max(0, v - 30))                                      # darker, same texture
    if manure:
        fill(manure, lambda x, y, v: 40 if ((x // 3 + y // 3) % 2) else 110)           # dark balls
    if shadow:
        fill(shadow, lambda x, y, v: max(0, v - 40))
    if horse:
        fill(horse, lambda x, y, v: 70)
    if light != 1.0 or ir:
        f = bytearray(max(0, min(255, int((255 - v * 0.8) if ir else v * light))) for v in f)
    return bytes(f)


def box(b):
    return {"x0": b[0], "y0": b[1], "x1": b[2], "y1": b[3]}


A = (0.10, 0.35, 0.40, 0.85)      # the horse standing on the left
B = (0.60, 0.35, 0.90, 0.85)      # ...then on the right


def run(plan):
    """plan: [(seconds, frame kwargs, horse box or None, still)] at 1 frame/s."""
    cf, t, events = ColourFloorWatcher(W, H), 0.0, []
    for secs, kw, hb, still in plan:
        for _ in range(int(secs)):
            events += cf.feed(frame(**kw), t, box(hb) if hb else None, still)
            t += 1
    return events


PILE = (0.22, 0.78, 0.28, 0.86)            # behind where the horse stood
WET = (0.12, 0.72, 0.36, 0.92)

ev = run([(30, {}, None, False), (400, {"horse": A}, A, True), (120, {"horse": B, "manure": PILE}, B, False)])
check("horse leaves a compact dark pile: excretion", len(ev) == 1 and ev[0]["kind"] == "excretion", ev)
check("... and it knows the horse stood there", ev and ev[0]["horseStoodThere"], ev)

ev = run([(30, {}, None, False), (400, {"horse": A}, A, True), (120, {"horse": B, "wet": WET}, B, False)])
check("horse leaves a wider, smooth darker patch: urination", len(ev) == 1 and ev[0]["kind"] == "urination", ev)

ev = run([(30, {}, None, False), (900, {"horse": A}, A, True)])
check("a horse standing still for 15 min: nothing", ev == [], ev)

SHADOW = (0.40, 0.60, 0.50, 0.85)
ev = run([(30, {}, None, False), (600, {"horse": A, "shadow": SHADOW}, A, True), (120, {"horse": B}, B, False)])
check("the horse's shadow while it stands: nothing (it leaves with the horse)", ev == [], ev)

ev = run([(30, {}, None, False), (60, {"horse": B}, B, False), (400, {"horse": B, "ir": True}, B, False)])
check("the IR lamp switching on: re-learned, nothing counted", ev == [], ev)

ev = run([(30, {}, None, False), (60, {"horse": B}, B, False), (400, {"horse": B, "wet": (0.0, 0.4, 0.55, 1.0)}, B, False)])
check("mucking out / half the floor changing at once: re-learned, nothing counted", ev == [], ev)

ev = run([(30, {}, None, False), (300, {"horse": A}, A, True), (600, {"horse": B, "manure": PILE}, B, False)])
check("a pile is counted once, not every minute", len(ev) == 1, ev)

print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
