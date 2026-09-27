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
    """Pixel reads: a warm head in view unless `absent`; floor scans see a
    warm patch appear once `deposit_at` scans have passed."""
    def __init__(self, absent=False):
        self.absent, self.scans = absent, 0

    def box_max(self, box):
        return None if self.absent else 35.1

    def box_avg(self, box):
        return None if self.absent else 33.0

    def read_pixels(self, pts):
        if len(pts) == 64:                                   # presence grid
            return [26.0] * 64 if self.absent else [26.0] * 40 + [34.0] * 24
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


def make_worker(behaviour="visible", absent=False, window_s=1):
    dev = {"id": "cam-1", "name": "test cam", "kind": "thermal_camera", "host": "x", "calibrated": True,
           "behaviourStream": behaviour,
           "rois": {"eye": {"x0": 4000, "y0": 3000, "x1": 4600, "y1": 3600},
                    "nostril": {"x0": 5000, "y0": 5000, "x1": 5600, "y1": 5700}}}
    got = []
    w = MtrpcCameraWorker(dev, got.extend, window_s=window_s)
    w.cam = FakeCam(absent)
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

print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
