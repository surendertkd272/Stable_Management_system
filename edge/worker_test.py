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


class FakeCam:
    """Pixel reads: a warm head in view unless `absent`. With eye_in_box
    False the head is elsewhere in the view: the eye box reads the wall, and
    a whole-view scan finds the eye at column 7, row 5 (or a lamp)."""
    def __init__(self, absent=False, eye_in_box=True, lamp=False):
        self.absent, self.scans, self.eye_in_box, self.lamp = absent, 0, eye_in_box, lamp

    def box_max(self, box):
        return None if self.absent else (35.1 if self.eye_in_box else 27.0)

    def box_avg(self, box):
        return None if self.absent else 33.0

    def read_pixels(self, pts):
        if len(pts) == 64:                                   # presence grid
            return [26.0] * 64 if self.absent else [26.0] * 40 + [34.0] * 24
        if len(pts) == 192:                                  # whole-view eye search, 16 x 12
            g = [26.0] * 192
            if self.absent:
                return g
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
        if len(pts) == 49:                                   # fine look around the best cell
            return [35.0] * 48 + [36.7]
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
check("vitals emitted with the head in view", "body_temp_c" in metrics, metrics)
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
check("eye box missed: temperature from the head found elsewhere in view",
      temp and abs(temp[0]["value"] - 36.7) < 0.01 and "anywhere in view" in temp[0]["meta"]["method"], temp)
check("... reported with lower confidence than a boxed eye", temp and temp[0]["confidence"] < 0.95, temp)
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

# 8. The flank region follows the horse's box.
from behaviour import flank_from_box, pick_hotspot  # noqa: E402
fb = flank_from_box({"x0": 0.2, "y0": 0.3, "x1": 0.8, "y1": 0.9}, 352, 288)
check("flank region sits in the middle of the body", fb == (144, 146, 207, 198), fb)
edge = [26.0] * 192
edge[0] = 36.0
check("a hot point on the frame edge is not an eye (partly out of view)", pick_hotspot(edge, 16, 12) is None)

print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
