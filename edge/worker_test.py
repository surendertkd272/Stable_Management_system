"""The camera worker end to end, with a fake camera and synthetic video: which
readings it emits, from which stream, with what flags. Run: python3 edge/worker_test.py"""
import math
import random
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import edge_agent  # noqa: E402
from edge_agent import MtrpcCameraWorker  # noqa: E402
from video_analytics import WindowAnalyzer, W, H  # noqa: E402

edge_agent.STATE_DIR = Path(tempfile.mkdtemp())
rng = random.Random(3)
fails = 0


def check(name, ok, detail=""):
    global fails
    if not ok:
        fails += 1
        print(f"FAIL {name} {detail}")


def eye_window(cols, rows, eye, skin=32.0):
    """Pixel reads with an eye in the middle: a hot point, a warm rim, cooler skin."""
    cc, cr = cols // 2, rows // 2
    return [eye if (c, r) == (cc, cr) else eye - 0.5 if max(abs(c - cc), abs(r - cr)) == 1 else skin
            for r in range(rows) for c in range(cols)]


class FakeCam:
    """Pixel reads: a warm head in view unless `absent`. With eye_in_box
    False the head is elsewhere in the view: the eye box reads the wall, and
    a whole-view scan finds the eye at column 7, row 5 (or a lamp). With
    `coat` the horse faces away: warm coat (33–34.4 °C) fills the view and
    the eye box, and there is no eye anywhere."""
    def __init__(self, absent=False, eye_in_box=True, lamp=False, coat=False):
        self.absent, self.scans, self.eye_in_box, self.lamp, self.coat = absent, 0, eye_in_box, lamp, coat

    def box_grid(self, box):
        if self.absent:
            return [None] * 256, 16, 16
        if self.coat:
            return [33.6 + 0.05 * ((i * 7) % 11) for i in range(256)], 16, 16
        return (eye_window(16, 16, 35.1) if self.eye_in_box else [27.0] * 256), 16, 16

    def box_avg(self, box):
        return None if self.absent else 33.0

    def read_pixels(self, pts):
        if len(pts) == 64:                                   # presence grid
            return [26.0] * 64 if self.absent else [26.0] * 40 + [34.0] * 24
        if len(pts) == 192:                                  # whole-view eye search, 16 x 12
            g = [26.0] * 192
            if self.absent:
                return g
            if self.coat:
                return [33.2 + 0.1 * ((i * 5) % 13) for i in range(192)]
            for r in range(3, 8):
                for c in range(5, 10):
                    g[r * 16 + c] = 32.0                     # the head
            g[5 * 16 + 7] = 55.0 if self.lamp else 36.2      # the eye (or a heat lamp)
            if self.lamp:
                for r in range(3, 8):
                    for c in range(5, 10):
                        g[r * 16 + c] = 26.0
                g[5 * 16 + 7] = 55.0
            return g
        if len(pts) == 49:                                   # close look around a candidate
            return [34.0 + 0.05 * ((i * 3) % 7) for i in range(49)] if self.coat else eye_window(7, 7, 36.7)
        self.scans += 1
        return [24.0 + rng.gauss(0, 0.1) for _ in pts]

    def logout(self):
        pass


class Alive:
    error = None

    def is_alive(self):
        return True

    def stop(self):
        pass


def make_worker(behaviour="visible", absent=False, window_s=1, **cam):
    dev = {"id": "cam-1", "name": "test cam", "kind": "thermal_camera", "host": "x", "calibrated": True,
           "behaviourStream": behaviour,
           "rois": {"eye": {"x0": 4000, "y0": 3000, "x1": 4600, "y1": 3600},
                    "nostril": {"x0": 5000, "y0": 5000, "x1": 5600, "y1": 5700}}}
    got = []
    w = MtrpcCameraWorker(dev, got.extend, window_s=window_s)
    w.cam = FakeCam(absent, **cam)
    w.video, w.vvideo = Alive(), Alive()
    w._start_video = lambda: None
    w._load_posture()
    w.analyzer = WindowAnalyzer(mode="thermal", posture=w.posture if behaviour == "thermal" else None)
    w.vanalyzer = WindowAnalyzer(mode="visible", w=W, h=H)
    return w, got


def feed(an, frames):
    for i, f in enumerate(frames):
        an.feed(f, t=i / 10)


def weave_frames(n=600):
    out = []
    for i in range(n):
        f = bytearray(150 for _ in range(W * H))
        cx = int(88 + 14 * math.sin(2 * math.pi * 0.6 * i / 10))
        for y in range(55, 105):
            for x in range(cx - 30, cx + 30):
                f[y * W + x] = 60
        out.append(bytes(f))
    return out


def run_window(w, prime):
    """_run_once resets the analyzers first, so the frames are fed from a
    thread while it waits out its (1 s) window."""
    t = threading.Thread(target=prime)
    orig = w.analyzer.reset

    def reset_then_prime():
        orig()
        w.vanalyzer.reset()
        prime()
    w.analyzer.reset = reset_then_prime
    w.vanalyzer.reset = lambda: None
    w._run_once()


# 1. Colour behaviour: a weaving horse, head in the thermal view.
w, got = make_worker("visible")
run_window(w, lambda: feed(w.vanalyzer, weave_frames()))
metrics = {r["metric"] for r in got}
act = [r for r in got if r["metric"] == "activity_index"]
check("vitals emitted with the head in view", {"body_temp_c", "nostril_temp_c"} <= metrics, metrics)
temp = [r for r in got if r["metric"] == "body_temp_c"]
bc = [r for r in got if r["metric"] == "breathing_check"]
check("every window says why breathing was (not) measured", len(bc) == 1 and bc[0]["value"] == 0
      and bc[0]["meta"]["nostril"] == "too_little_video" and bc[0]["meta"]["flank"] == "no_flank_region"
      and bc[0]["source"] == "thermal_video", bc)
check("eye in the eye box: its hot spot, full confidence", temp and temp[0]["value"] == 35.1
      and temp[0]["meta"]["method"].startswith("eye box") and temp[0]["confidence"] == 0.95
      and abs(temp[0]["meta"]["readAt"] - time.time()) < 30, temp)
check("activity comes from the colour stream", act and act[0]["source"] == "visible_video", act)
vice = [r for r in got if r["metric"] == "vice_event"]
check("weaving event from the colour stream, flagged prototype, with its window length",
      vice and vice[0]["meta"]["kind"] == "weaving" and vice[0]["meta"]["prototype"] and vice[0]["meta"]["windowMin"] > 0, vice)

# 2. Thermal says nobody's head is there, colour sees nothing: silence.
w, got = make_worker("visible", absent=True)
run_window(w, lambda: feed(w.vanalyzer, [bytes(150 for _ in range(W * H))] * 300))
check("empty stall: nothing reported", got == [], got)

# 3. Head out of the thermal view but the horse moves in the colour view:
#    behaviour yes, vitals no (the eye box would read the wall).
w, got = make_worker("visible", absent=True)
run_window(w, lambda: feed(w.vanalyzer, weave_frames()))
metrics = {r["metric"] for r in got}
check("horse seen only in colour: behaviour reported", "activity_index" in metrics, metrics)
check("horse seen only in colour: no temperature from the wall", "body_temp_c" not in metrics, metrics)
bc = [r for r in got if r["metric"] == "breathing_check"]
check("... breathing: head not in the thermal view", bc and bc[0]["meta"]["nostril"] == "head_out_of_view", bc)

# 4. Posture: a learned model and a lie-down during the window.
w, got = make_worker("visible")
tr = w.posture
t0 = time.time() - 4000
STAND = {"x0": 0.25, "y0": 0.2, "x1": 0.75, "y1": 0.85}
LIE = {"x0": 0.2, "y0": 0.55, "x1": 0.8, "y1": 0.88}
for i in range(3000):
    tr.feed(t0 + i, STAND if i < 1500 or i > 2500 else LIE, 0.1)
tr.drain()
for i in range(120):
    tr.feed(t0 + 3000 + i, LIE, 0.05)
run_window(w, lambda: feed(w.vanalyzer, [bytes(150 for _ in range(W * H))] * 300))
lying = [r for r in got if r["metric"] == "lying_minutes"]
pev = [r for r in got if r["metric"] == "posture_event"]
check("lying minutes reported once the stall's model is learned", lying and lying[0]["value"] > 1.5, lying)
check("lie-down event carries its own time, not the window's", pev and pev[0]["meta"]["kind"] == "lie_down"
      and pev[0]["ts"] != lying[0]["ts"], pev)
check("posture model saved for the next restart", w._posture_path().exists())

# 5. Behaviour on the thermal stream when asked.
w, got = make_worker("thermal")
run_window(w, lambda: feed(w.analyzer, weave_frames()))
act = [r for r in got if r["metric"] == "activity_index"]
check("behaviourStream thermal: activity from the thermal stream", act and act[0]["source"] == "thermal_video", act)

# 6. One camera: the head is in the thermal view but not in the eye box.
w, got = make_worker("visible", eye_in_box=False)
run_window(w, lambda: feed(w.vanalyzer, [bytes(150 for _ in range(W * H))] * 300))
temp = [r for r in got if r["metric"] == "body_temp_c"]
ec = [r for r in got if r["metric"] == "eye_check"]
check("eye found elsewhere: the eye check says so and where (for the Live view)",
      ec and ec[0]["value"] == 1 and "anywhere in view" in ec[0]["meta"]["detail"]
      and 0 <= ec[0]["meta"]["where"]["x"] <= 10000 and 0 <= ec[0]["meta"]["where"]["y"] <= 10000, ec)
check("... the temperature reading carries the same place", temp and temp[0]["meta"].get("where") == ec[0]["meta"]["where"], temp)
check("eye box missed: temperature from the head found elsewhere in view",
      temp and abs(temp[0]["value"] - 36.7) < 0.01 and "anywhere in view" in temp[0]["meta"]["method"], temp)
check("... reported with lower confidence than a boxed eye", temp and temp[0]["confidence"] < 0.95, temp)
check("... and no nostril temperature: the nostril box is not on the nostril either",
      not [r for r in got if r["metric"] == "nostril_temp_c"], got)
bc = [r for r in got if r["metric"] == "breathing_check"]
check("... breathing: head in view but not where the boxes were drawn", bc and bc[0]["meta"]["nostril"] == "head_off_boxes", bc)
w, got = make_worker("visible", coat=True)
run_window(w, lambda: feed(w.vanalyzer, weave_frames()))
metrics = {r["metric"] for r in got}
check("horse facing away (warm coat, no eye): no body temperature from the coat", "body_temp_c" not in metrics, metrics)
ec = [r for r in got if r["metric"] == "eye_check"]
check("... and the eye check says why, with no place", ec and ec[0]["value"] == 0 and ec[0]["meta"]["detail"] and "where" not in ec[0]["meta"], ec)
check("... no nostril temperature either", "nostril_temp_c" not in metrics, metrics)
check("... behaviour still reported", "activity_index" in metrics, metrics)
w, got = make_worker("visible", eye_in_box=False, lamp=True)
run_window(w, lambda: feed(w.vanalyzer, [bytes(150 for _ in range(W * H))] * 300))
check("a heat lamp in view is not taken for an eye", not [r for r in got if r["metric"] == "body_temp_c"], got)

# 7. Colour-picture floor events are emitted, flagged as colour only.
w, got = make_worker("visible")
w.cfloor_events = [{"kind": "excretion", "start": time.time() - 120, "confidence": 0.45, "tier": "colour only",
                    "area": 0.01, "darkening": 40.0, "texture": 1.8, "horseStoodThere": True}]
run_window(w, lambda: feed(w.vanalyzer, [bytes(150 for _ in range(W * H))] * 300))
ex = [r for r in got if r["metric"] == "excretion_event"]
check("manure seen in the colour picture: an excretion event from visible_video",
      ex and ex[0]["source"] == "visible_video" and ex[0]["meta"]["tier"] == "colour only", ex)
w, got = make_worker("visible")
t0 = time.time() - 120
w.cfloor_events = [dict(kind=k, start=t0 + dt_, confidence=0.5, tier="colour only", area=0.01, darkening=20.0, texture=2.0,
                        horseStoodThere=True) for k, dt_ in (("excretion", 0), ("urination", 4), ("excretion", 4))]
run_window(w, lambda: feed(w.vanalyzer, [bytes(150 for _ in range(W * H))] * 300))
check("three patches within seconds: the bedding moved, no events",
      not [r for r in got if r["metric"] in ("excretion_event", "urination_event")],
      [r["metric"] for r in got if r["metric"].endswith("_event")])

# 8. The flank region follows the horse's box.
from behaviour import flank_from_box, pick_hotspot  # noqa: E402
fb = flank_from_box({"x0": 0.2, "y0": 0.3, "x1": 0.8, "y1": 0.9}, 352, 288)
check("flank region sits on the barrel: upper middle of the box (its middle is under the belly)", fb == (144, 112, 207, 164), fb)
w, _ = make_worker("visible")
drawn = {"flank": {"x0": 1000, "y0": 1000, "x1": 2000, "y1": 2000}}
w.auto_flank, w.flank_followed = None, False
check("no horse seen standing still: the flank box drawn at calibration",
      w.flank_bounds(drawn) == (35, 29, 70, 58) and not w.flank_followed, w.flank_bounds(drawn))
w.auto_flank = fb
check("horse standing still elsewhere in the stall: its own flank, not the drawn box",
      w.flank_bounds(drawn) == fb and w.flank_followed)
w.auto_flank = None
check("nothing drawn, no horse seen: no flank", w.flank_bounds({}) is None)


# The Live view's breathing: sent every 10 s when a rate is found, labelled
# as the last 35 s, a diagnostic beside the minute's record.
w, got = make_worker("visible")
w._head_in_view = True
w.analyzer.breathing_recent = lambda f, seconds=35: {"nostril": {"bpm": 11.6, "strength": 0.8, "seconds": 33.0, "regularity": 0.7}, "flank": None}
w.vanalyzer.breathing_recent = lambda f, seconds=35: {"nostril": None, "flank": None}
w._live_breathing(w.dev["rois"])
lv = [r for r in got if r["metric"] == "respiratory_rate_live_bpm"]
check("a rolling rate is sent at once, from the nostril, with its box",
      len(lv) == 1 and lv[0]["value"] == 11.6 and lv[0]["meta"]["rolling"] and "last 35 s" in lv[0]["meta"]["method"]
      and lv[0]["meta"]["box"] == w.dev["rois"]["nostril"], lv)
got.clear()
w.analyzer.breathing_recent = lambda f, seconds=35: {"nostril": {"bpm": None, "reason": "head moving"}, "flank": None}
w._live_breathing(w.dev["rois"])
check("no rate in the last 35 s: nothing sent (the minute's check says why)", not got, got)


# The stall's round opening taken for a horse (1 Oct): a box over most of the
# picture with the real horse inside it. The horse is the inner box; the
# opening, once seen, is ignored even when the horse is missed.
from detector import pick_horse  # noqa: E402
opening = {"x0": 0.10, "y0": 0.05, "x1": 0.90, "y1": 1.0, "score": 0.78}
horse = {"x0": 0.21, "y0": 0.12, "x1": 0.55, "y1": 0.50, "score": 0.69}
scene = []
check("the horse, not the opening round it", pick_horse([dict(opening), dict(horse)], scene) == horse)
check("... and the opening alone, later, is not a horse", pick_horse([dict(opening, score=0.8)], scene) is None, scene)
close = {"x0": 0.0, "y0": 0.1, "x1": 0.95, "y1": 1.0, "score": 0.9}
check("a horse filling a close camera's view is still a horse", pick_horse([close], []) == close)
check("no boxes: no horse", pick_horse([], []) is None)


# People at the stall are not the horse moving (2 Oct: a person at the rail
# made the whole-picture activity read high while the horse ate quietly).
def block_frames(x_of, n=300):
    out = []
    for i in range(n):
        f = bytearray([90] * (W * H))
        x = x_of(i)
        for y in range(40, 80):
            f[y * W + x: y * W + x + 25] = bytes([230]) * 25
        f[0:W] = bytes([10]) * W                               # some contrast, as a real picture has
        out.append(bytes(f))
    return out


walker = block_frames(lambda i: 10 + (i * 3) % 60)            # someone moving about on the left
person, horse_area = (0, 30, 95, 90), (110, 20, 170, 120)
a1 = WindowAnalyzer(mode="visible", w=W, h=H)
for i, fr in enumerate(walker):
    a1.feed(fr, t=i / 10)
a2 = WindowAnalyzer(mode="visible", w=W, h=H)
for i, fr in enumerate(walker):
    a2.feed(fr, t=i / 10, focus=horse_area, ignore=(person,))
act1, act2 = a1.summary(lambda *x, **k: None)["activity"], a2.summary(lambda *x, **k: None)["activity"]
check("someone moving about: the whole picture reads activity", act1 > 0.2, act1)
check("... the horse alone (its box, people left out) reads none", act2 < 0.02, act2)
a3 = WindowAnalyzer(mode="visible", w=W, h=H)
for i, fr in enumerate(block_frames(lambda i: 115 + (i * 3) % 40)):
    a3.feed(fr, t=i / 10, focus=horse_area, ignore=(person,))
check("the horse moving in its own box still counts", a3.summary(lambda *x, **k: None)["activity"] > 0.2)

w, got = make_worker("visible")
w.detector = object()                                         # a detector is running (it is not called here)
# people_s is zeroed as the window opens: count 25 s of people during it.
run_window(w, lambda: (feed(w.vanalyzer, weave_frames()),
                       threading.Timer(0.3, lambda: setattr(w, "people_s", 25)).start()))
pv = [r for r in got if r["metric"] == "people_in_view_s"]
check("each minute says how long people were at the stall", pv and pv[0]["value"] == 25, pv)
check("no stall vice is judged while people are there", not [r for r in got if r["metric"] == "vice_event"],
      [r["meta"].get("kind") for r in got if r["metric"] == "vice_event"])
act = [r for r in got if r["metric"] == "activity_index"]
check("activity says it is the horse's own, with the people seconds", act and "the horse only" in act[0]["meta"]["method"]
      and act[0]["meta"]["peopleS"] == 25, act[:1])


class JitterDetector:
    """A horse standing still; its box jitters by about a pixel, as a real detector's does."""
    def __init__(self):
        self.k, self.at = 0, (0.30, 0.20, 0.70, 0.80)

    def detect(self, frame, w, h):
        self.k += 1
        j = 0.003 * ((self.k * 7) % 3 - 1)
        x0, y0, x1, y1 = self.at
        return [{"x0": x0 + j, "y0": y0 - j, "x1": x1 + j, "y1": y1, "score": 0.9}]


w, _ = make_worker("visible")
w.detector, st, regions = JitterDetector(), {"last": None, "history": []}, []
for k in range(40):
    w.last_visible = (bytes(W * H), 1000.0 + k)
    w._detect_step(st)
    regions.append(w.auto_flank)
held = [r for r in regions if r is not None]
check("a horse standing still: its flank found once it has stood 20 s", regions[18] is None and held, regions[15:25])
check("... and held steady while the box jitters (any change restarts the breathing count)", len(set(held)) == 1, set(held))
w.detector.at = (0.05, 0.20, 0.35, 0.80)                    # walks to the other side of the stall
w.last_visible = (bytes(W * H), 2000.0)
w._detect_step(st)
check("the horse moves away: the old flank is dropped, not watched on an empty floor", w.auto_flank is None, w.auto_flank)
edge = [26.0] * 192
edge[0] = 36.0
check("a hot point on the frame edge is not an eye (partly out of view)", pick_hotspot(edge, 16, 12) is None)

# 9. Box walking only when laps continue into a second window, and never
#    while the horse fills the colour view (turning round looks like laps).
def walk_windows(n, widths=()):
    w, got = make_worker("visible")
    walk = {"frames": 600, "seconds": 60, "activity": 0.6, "inactive_min": 0.0,
            "box_walk": {"hz": 0.1, "strength": 0.8, "span": 0.5, "laps": 6.0, "detected": True}}

    def summary(_):
        w.box_widths = list(widths)
        return dict(walk)
    w.vanalyzer.summary = summary
    per = []
    for _ in range(n):
        got.clear()
        w._run_once()
        per.append([r for r in got if r["metric"] == "vice_event"])
    return per


per = walk_windows(3)
check("box walking: one window of laps is held back", per[0] == [], per[0])
check("... reported when the next window has laps too, covering both minutes",
      len(per[1]) == 1 and per[1][0]["meta"]["kind"] == "box_walking" and per[1][0]["meta"]["windowMin"] == 2.0, per[1])
check("... then each further window counts its own minute", len(per[2]) == 1 and per[2][0]["meta"]["windowMin"] == 1.0, per[2])
per = walk_windows(3, widths=[0.8] * 10)
check("box walking not judged while the horse fills the view", per == [[], [], []], per)

# 10. The reasons themselves.
from edge_agent import breathing_why, BREATHING_WHY  # noqa: E402
ok_rate = {"bpm": 14.0}
still_short = {"bpm": None, "reason": "head moving — no 30 s still stretch"}
flat = {"bpm": None, "reason": "no clear breathing rhythm"}
odd = {"bpm": None, "reason": "rate and breath count disagree"}
check("nostril rate found: measured", breathing_why(True, True, True, True, ok_rate, True, None)[0] == "measured")
check("head moving", breathing_why(True, True, True, True, still_short, True, None)[0] == "head_moving")
check("no rhythm", breathing_why(True, True, True, True, flat, True, None)[0] == "no_rhythm")
check("count disagrees", breathing_why(True, True, True, True, odd, True, None)[0] == "count_disagrees")
check("head off the boxes wins over what the box saw", breathing_why(True, True, True, False, still_short, True, None)[0] == "head_off_boxes")
check("no thermal video", breathing_why(False, True, True, True, None, True, None)[0] == "no_thermal_video")
check("flank measured / flank head moving", breathing_why(True, True, True, True, None, True, ok_rate)[1] == "measured"
      and breathing_why(True, True, True, True, None, True, still_short)[1] == "head_moving")
check("no colour video: flank says so", breathing_why(True, True, True, True, None, False, None)[1] == "no_colour_video")
check("every reason has words", all(k in BREATHING_WHY for k in ("measured", "no_thermal_video", "head_out_of_view", "head_off_boxes",
      "head_moving", "no_rhythm", "count_disagrees", "too_little_video", "no_colour_video", "no_flank_region")))

print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
