"""The new behaviour pieces on synthetic video: what each should and should NOT
report. Run: python3 edge/behaviour_test.py"""
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from edge_agent import compute_resp_rate  # noqa: E402
from behaviour import PostureTracker, breath_analysis, bad_samples, warm_blob_box  # noqa: E402
from video_analytics import W, H, FPS, WindowAnalyzer, MotionMeter  # noqa: E402

rng = random.Random(11)
fails = 0


def check(name, ok, detail=""):
    global fails
    if not ok:
        fails += 1
        print(f"FAIL {name} {detail}")


# ---- colour video: a textured horse (darker than the wall) ----------------- #
WALL = [bytes(max(0, min(255, int(150 + 20 * math.sin(x / 7) + rng.gauss(0, 2)))) for x in range(W * H)) for _ in range(6)]
COAT = [int(60 + 25 * math.sin(i / 3) * math.cos(i / 5)) for i in range(W * H)]


def colour_frame(cx, cy=80, rw=34, rh=26, k=[0], bright=1.0, head_dy=0.0, ir=False):
    k[0] += 1
    f = bytearray(WALL[k[0] % len(WALL)])
    for y in range(int(cy - rh), int(cy + rh)):
        for x in range(int(cx - rw), int(cx + rw)):
            if 0 <= x < W and 0 <= y < H:
                f[y * W + x] = COAT[(y - int(cy)) * W + (x - int(cx)) + W * H // 2] if False else 60
    # head: a smaller block above one end of the body, can nod
    hy = int(cy - rh - 10 + head_dy)
    for y in range(hy, hy + 14):
        for x in range(int(cx + rw - 12), int(cx + rw + 4)):
            if 0 <= x < W and 0 <= y < H:
                f[y * W + x] = 50
    if bright != 1.0:
        f = bytearray(max(0, min(255, int(v * bright))) for v in f)
    if ir:                              # under the IR lamp the coat shines and the wall goes dark
        f = bytearray(max(0, min(255, int(255 - v * 0.8))) for v in f)
    return bytes(f)


def run(n, make, mode="visible", **feed):
    a = WindowAnalyzer(mode=mode)
    for i in range(n):
        a.feed(make(i), t=i / FPS, **feed)
    return a.summary(compute_resp_rate)


N = FPS * 60
weave = run(N, lambda i: colour_frame(88 + 14 * math.sin(2 * math.pi * 0.6 * i / FPS)))
check("colour: regular sway at 0.6 Hz is weaving", (weave.get("weave") or {}).get("detected"), weave.get("weave"))
check("colour: weaving frequency ~0.6 Hz", abs(((weave.get("weave") or {}).get("hz") or 0) - 0.6) < 0.1, weave.get("weave"))

# Irregular sway: period jumps between 1 s and 4 s.
phase, jerky = 0.0, []
for i in range(N):
    if i % 40 == 0:
        per = rng.choice([1.0, 4.0, 1.5, 3.0])
    phase += 2 * math.pi / (per * FPS)
    jerky.append(88 + 14 * math.sin(phase))
irr = run(N, lambda i: colour_frame(jerky[i]))
check("colour: irregular swaying is not weaving", not (irr.get("weave") or {}).get("detected"), irr.get("weave"))

still = run(N, lambda i: colour_frame(88))
check("colour: still horse — activity ~0, whole minute inactive", still["activity"] < 0.05 and still["inactive_min"] > 0.9, still)
check("colour: still horse — no weaving, no head tossing",
      not (still.get("weave") or {}).get("detected") and not (still.get("head_toss") or {}).get("detected"))

# Dusk: the picture dims evenly — the per-frame normalisation already ignores it.
dim = run(N, lambda i: colour_frame(88, bright=1.0 if i < 300 else 0.55))
check("colour: even dimming is not activity", dim["activity"] < 0.05, dim)
# Infrared lamp switching on mid-minute: contrast flips across the picture.
ir = run(N, lambda i: colour_frame(88, ir=i >= 300))
check("colour: IR lamp switching is a scene change, not activity", ir["activity"] < 0.05 and ir["scene_changes"] >= 1, ir)

laps = run(N * 2, lambda i: colour_frame(88 + 50 * math.sin(2 * math.pi * i / (FPS * 15))))
check("colour: laps of the box every 15 s: box walking", (laps.get("box_walk") or {}).get("detected"), laps.get("box_walk"))
check("colour: box walking is not head tossing", not (laps.get("head_toss") or {}).get("detected"), laps.get("head_toss"))
turns = run(N, lambda i: colour_frame(88 + 50 * math.sin(2 * math.pi * i / (FPS * 31))))
check("colour: turning round every ~30 s (under 3 laps in the window) is not box walking",
      not (turns.get("box_walk") or {}).get("detected"), turns.get("box_walk"))

nod = run(N, lambda i: colour_frame(88, head_dy=6 * math.sin(2 * math.pi * 1.0 * i / FPS)))
check("colour: regular nodding in place: head tossing", (nod.get("head_toss") or {}).get("detected"), nod.get("head_toss"))
check("colour: nodding is not weaving", not (nod.get("weave") or {}).get("detected"), nod.get("weave"))

# ---- breathing --------------------------------------------------------------- #
fs = FPS


def breath_sig(bpm, seconds=60, amp=5.0, noise=0.7, jumps=(), irregular=False):
    sig, ref, glob, ph = [], [], [], 0.0
    for i in range(int(seconds * fs)):
        rate = bpm * (1 + (0.35 * math.sin(i / 37.0) if irregular else 0))
        ph += 2 * math.pi * rate / 60 / fs
        g = 100 + sum(30 for j in jumps if i >= j)                  # palette step / head movement
        sig.append(amp * math.sin(ph) + rng.gauss(0, noise) + g)
        ref.append(g + rng.gauss(0, 0.3))
        glob.append(g + rng.gauss(0, 0.2))
    return sig, ref, glob


s, r, g = breath_sig(14)
b = breath_analysis([a - c for a, c in zip(s, r)], fs, compute_resp_rate, bad_samples(r, g, fs))
check("breathing 14 bpm: found, counted and regular", b["bpm"] and abs(b["bpm"] - 14) < 1.5 and b["regularity"] > 0.7, b)

s, r, g = breath_sig(14, seconds=70, jumps=(350,))
raw = breath_analysis(s, fs, compute_resp_rate)                                  # no reference, no gating
fixed = breath_analysis([a - c for a, c in zip(s, r)], fs, compute_resp_rate, bad_samples(r, g, fs))
check("palette step: referenced + gated signal still gives 14 bpm", fixed["bpm"] and abs(fixed["bpm"] - 14) < 1.5, (fixed, raw))

s, r, g = breath_sig(72)
pant = breath_analysis([a - c for a, c in zip(s, r)], fs, compute_resp_rate, bad_samples(r, g, fs))
check("panting 72 bpm is reported as fast, not folded to a normal rate",
      pant["bpm"] and abs(pant["bpm"] - 72) < 5 and pant["band"] == "fast", pant)

noise = [rng.gauss(0, 1) for _ in range(600)]
check("pure noise: no rate invented", breath_analysis(noise, fs, compute_resp_rate)["bpm"] is None)

s, r, g = breath_sig(14, jumps=tuple(range(50, 600, 90)))
moving = breath_analysis([a - c for a, c in zip(s, r)], fs, compute_resp_rate, bad_samples(r, g, fs))
check("head moving every 9 s: no 30 s still stretch, no reading", moving["bpm"] is None and "head" in moving["reason"], moving)

s, r, g = breath_sig(16, seconds=90, irregular=True)
irrb = breath_analysis([a - c for a, c in zip(s, r)], fs, compute_resp_rate, bad_samples(r, g, fs))
check("irregular breathing reads less regular than steady breathing",
      irrb["bpm"] is None or (irrb["regularity"] is not None and irrb["regularity"] < b["regularity"]), (irrb, b))

# ---- posture ---------------------------------------------------------------- #
STAND = {"x0": 0.25, "y0": 0.20, "x1": 0.75, "y1": 0.85}          # h 0.65, w/h 0.77
LIE = {"x0": 0.20, "y0": 0.55, "x1": 0.80, "y1": 0.88}            # h 0.33, w/h 1.8
FLAT = {"x0": 0.12, "y0": 0.66, "x1": 0.88, "y1": 0.90}           # h 0.24, w/h 3.2


def jit(b):
    return {k: v + rng.gauss(0, 0.005) for k, v in b.items()}


def posture_run(plan, tracker=None, dt=1.0):
    """plan: [(seconds, box or None, motion)] -> (tracker, events, totals)."""
    tr = tracker or PostureTracker()
    t, events, tot = 0.0, [], {"lying_s": 0.0, "lateral_s": 0.0}
    for secs, box, motion in plan:
        for _ in range(int(secs / dt)):
            tr.feed(t, jit(box) if box else None, motion)
            t += dt
            if int(t) % 60 == 0:
                acc = tr.drain()
                events += acc["events"]
                tot["lying_s"] += acc["lying_s"]
                tot["lateral_s"] += acc["lateral_s"]
    acc = tr.drain()
    events += acc["events"]
    tot["lying_s"] += acc["lying_s"]
    tot["lateral_s"] += acc["lateral_s"]
    return tr, events, tot


only_standing, ev, _ = posture_run([(3600, STAND, 0.1)])
check("standing only: no model yet (learning), no events", only_standing.model is None and ev == [], (only_standing.model, ev))

night = [(3000, STAND, 0.1), (900, LIE, 0.05), (1800, STAND, 0.1), (1200, LIE, 0.05), (600, STAND, 0.1)]
tr, ev, tot = posture_run(night)
kinds = [e["kind"] for e in ev]
check("learns this stall's standing and lying heights", tr.model is not None, tr.model)
lie_ev = [e for e in ev if e["kind"] == "lie_down"]
check("second night half: lie-down and get-up events found",
      kinds.count("lie_down") >= 1 and kinds.count("get_up") >= 1, kinds)
check("lie-down timed within 10 s of the truth",
      any(abs(e["t"] - 5700) <= 10 for e in lie_ev), [e["t"] for e in lie_ev])

tr2, ev2, tot2 = posture_run([(900, LIE, 0.05), (600, STAND, 0.1)], tracker=tr)
check("lying minutes counted once the model is known", 780 <= tot2["lying_s"] <= 930, tot2)
check("chest lying is not called flat on the side", tot2["lateral_s"] < 60, tot2)

tr3, ev3, tot3 = posture_run([(600, LIE, 0.05), (600, FLAT, 0.02), (300, STAND, 0.1)], tracker=tr)
check("longer, lower box while lying: possible flat on side", tot3["lateral_s"] >= 400, tot3)

tr4, ev4, tot4 = posture_run([(300, LIE, 0.05), (600, None, 0.0), (300, STAND, 0.1)], tracker=tr)
check("detector loses a lying horse (flat on its side): counted as possible lateral", tot4["lateral_s"] >= 450, tot4)

roll = [(120, LIE, 0.05)] + [(3, LIE, 0.8), (3, STAND, 0.8)] * 5 + [(120, LIE, 0.05), (300, STAND, 0.1)]
_, ev5, _ = posture_run(roll, tracker=tr)
check("burst of movement with the box height swinging while down: possible roll",
      any(e["kind"] == "possible_roll" for e in ev5), [e["kind"] for e in ev5])

cast = [(300, LIE, 0.05)] + [(8, LIE, 0.7), (120, LIE, 0.05)] * 6 + [(300, LIE, 0.05)]
_, ev6, _ = posture_run(cast, tracker=tr)
check("down 10+ min with repeated struggling and no getting up: possible cast",
      any(e["kind"] == "possible_cast" for e in ev6), [e["kind"] for e in ev6])
_, ev7, _ = posture_run([(1800, LIE, 0.05), (300, STAND, 0.1)], tracker=tr)
check("a long quiet lie is not a cast", not any(e["kind"] == "possible_cast" for e in ev7), ev7)

st = tr.to_state()
check("posture model survives a restart", PostureTracker(st).model == tr.model)

# ---- warm body box (thermal) --------------------------------------------------- #
frame = bytearray(60 for _ in range(W * H))
for y in range(40, 110):
    for x in range(30, 150):
        frame[y * W + x] = 170
b = warm_blob_box(bytes(frame), W, H)
check("warm body box found", b and abs(b["x0"] - 30 / W) < 0.03 and abs(b["y1"] - 110 / H) < 0.03 and b["edges"] == 0, b)
check("flat frame: no body box", warm_blob_box(bytes(W * H), W, H) is None)

# ---- where the horse is (for the floor detector) ------------------------------ #
mm = MotionMeter()
for i in range(30):
    f = bytearray(WALL[i % len(WALL)])
    for y in range(100, 130):
        for x in range(20 + i, 50 + i):
            f[y * W + x] = 40
    mm.feed(bytes(f))
cells = mm.moving_cells((0, 90, W - 1, H - 1), 16, 5, 10)
check("moving cells mark where the horse is, not the whole floor", 0 < len(cells) < 40, cells)

# ---- is the hottest point an eye? ---------------------------------------------- #
from behaviour import eye_spot  # noqa: E402


def grid(cols, rows, f):
    return [f(c, r) for r in range(rows) for c in range(cols)]


def eye_at(cc, cr, skin=32.0, eye=34.8, rim=33.6):
    return lambda c, r: eye if (c, r) == (cc, cr) else rim if max(abs(c - cc), abs(r - cr)) == 1 else skin


v, why = eye_spot(grid(7, 7, eye_at(3, 3)), 7, 7)
check("a small hot spot with cooler skin round it is an eye", v == 34.8, why)
v, why = eye_spot(grid(16, 16, eye_at(9, 7, eye=35.1, rim=34.6)), 16, 16)
check("... in the eye box too", v == 35.1, why)
coat = grid(7, 7, lambda c, r: 34.0 + 0.1 * math.sin(c) - 0.05 * r)
v, why = eye_spot(coat, 7, 7)
check("coat of a horse facing away (33–34 °C all over) is not an eye", v is None and "runs on" in why, why)
fold = grid(7, 7, lambda c, r: 34.2 if r == 3 else 32.5)
v, why = eye_spot(fold, 7, 7)
check("a warm skin fold (a line through the window) is not an eye", v is None, why)
flat = grid(7, 7, lambda c, r: 34.0 if (c, r) == (3, 3) else 33.2 if max(abs(c - 3), abs(r - 3)) == 1 else 33.5)
v, why = eye_spot(flat, 7, 7)
check("a hot point without cooler skin round it is not an eye", v is None and "cooler" in why, why)
blob = grid(16, 16, lambda c, r: 34.3 if 3 <= c <= 11 and 3 <= r <= 11 else 31.0)
v, why = eye_spot(blob, 16, 16)
check("a broad warm patch inside the eye box is not an eye", v is None and "broad" in why, why)
v, why = eye_spot(grid(7, 7, eye_at(3, 3, eye=55.0, rim=40.0)), 7, 7)
check("a heat lamp is not an eye", v is None, why)
v, why = eye_spot(grid(7, 7, lambda c, r: 27.0), 7, 7)
check("the wall is not an eye", v is None and "eye-warm" in why, why)

print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
