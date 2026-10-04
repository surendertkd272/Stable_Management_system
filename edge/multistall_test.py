"""One zoom camera, two stalls, simulated end to end: each horse's readings go
to its own stall, behaviour comes from the wide view and vitals from the
close-ups, and the camera moves as planned. Run: python3 edge/multistall_test.py"""
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402
import edge_agent  # noqa: E402

edge_agent.STATE_DIR = Path(tempfile.mkdtemp())
import multistall  # noqa: E402
from multistall import ZoomCameraHub, StallWorker, rel_box, zone_size, crop_resize  # noqa: E402
from ptz import FakePtz, go  # noqa: E402

multistall.STATE_DIR = edge_agent.STATE_DIR
fails = 0


def check(name, ok, detail=""):
    global fails
    if not ok:
        fails += 1
        print(f"FAIL {name} {detail}")


# ---- helpers ------------------------------------------------------------------ #
check("rel_box inside", rel_box({"x0": 1000, "y0": 2000, "x1": 3000, "y1": 4000}, {"x0": 0, "y0": 0, "x1": 5000, "y1": 10000})
      == {"x0": 2000, "y0": 2000, "x1": 6000, "y1": 4000})
check("rel_box outside", rel_box({"x0": 6000, "y0": 0, "x1": 9000, "y1": 5000}, {"x0": 0, "y0": 0, "x1": 5000, "y1": 10000}) is None)
w, h = zone_size({"x0": 0, "y0": 0, "x1": 5000, "y1": 10000}, 704, 576)
check("zone keeps its shape", abs(w / h - 352 / 576) < 0.05 and abs(w * h - 352 * 288) < 0.1 * 352 * 288, (w, h))
img = np.zeros((4, 8, 3), dtype=np.uint8)
img[:, 4:] = 200
out = np.frombuffer(crop_resize(img.tobytes(), 8, 4, 3, {"x0": 5000, "y0": 0, "x1": 10000, "y1": 10000}, 2, 2), dtype=np.uint8)
check("crop takes the right half", (out == 200).all(), out)
p = FakePtz()
check("go moves each lens", go(p, {"moves": [{"profile": "colour", "preset": "1"}, {"profile": "thermal", "zoom": 0.5}], "settleS": 0},
                               wait=lambda s: None) == ["colour", "thermal"] and p.where["thermal"]["zoom"] == 0.5)

# ---- the scene: stall A left (horse walking about), stall B right (horse still) #
CW, CH = 704, 576
rng = np.random.default_rng(5)
WALL = (170 + rng.integers(-12, 12, size=(CH, CW, 1))).repeat(3, axis=2).astype(np.uint8)
COAT = (50 + rng.integers(-25, 25, size=(CH, CW, 1))).repeat(3, axis=2).astype(np.uint8)
EYE_BOX = {"x0": 4000, "y0": 2500, "x1": 6000, "y1": 3500}


def colour_frame(t):
    f = WALL.copy()
    ax = int(90 + 120 * (0.5 + 0.5 * np.sin(t * 3.0)))           # A paces
    f[200:420, ax:ax + 150] = COAT[200:420, ax:ax + 150]
    f[230:430, 460:620] = COAT[230:430, 460:620]                 # B stands
    return f.tobytes()


class FakeDetector:
    """The horse: the dark part of the picture."""
    def detect_all(self, buf, w, h):
        a = np.frombuffer(buf, dtype=np.uint8).reshape(h, w, 3)[:, :, 1]
        ys, xs = np.nonzero(a < 110)
        if len(xs) < 50:
            return [], []
        return [{"x0": xs.min() / w, "y0": ys.min() / h, "x1": (xs.max() + 1) / w, "y1": (ys.max() + 1) / h, "score": 0.9}], []


class SceneCam:
    """Temperature reads: two warm bodies zoomed out; zoomed in, a head with
    an eye (36.6 °C, rim 36.1) in the middle of the eye box."""
    def __init__(self, hub):
        self.hub = hub
        from mtrpc import grid_points  # noqa
        pts = grid_points(EYE_BOX, 16)
        self.eye = pts[7 * 16 + 7]                                 # a grid point, so the read lands on it

    def read_pixels(self, pts):
        v = self.hub.view or {}
        out = []
        for p in pts:
            if v.get("kind") == "close":
                d = max(abs(p["x"] - self.eye["x"]), abs(p["y"] - self.eye["y"]))
                out.append(36.6 if d < 40 else 36.1 if d < 160 else 32.0 if 1500 < p["y"] < 7500 else 26.0)
            else:
                out.append(33.0 if 2800 < p["y"] < 6000 and (900 < p["x"] < 3400 or 5300 < p["x"] < 7100) else 26.0)
        return out


DEV = {"id": "zoom-1", "name": "Zoom camera", "kind": "thermal_camera", "host": "x", "protocol": "mtrpc",
       "ptz": {"protocol": "fake"}, "schedule": {"closeEveryMin": 2},
       "stallHorses": {"A": {"id": "a-horse", "name": "Arjun"}, "B": {"id": "b-horse", "name": "Bijli"}},
       "views": [
           {"id": "wide", "kind": "wide", "position": {"moves": [{"profile": "colour", "preset": "wide"}], "settleS": 0},
            "zones": [{"stall": "A", "colour": {"x0": 0, "y0": 0, "x1": 5000, "y1": 10000}, "thermal": {"x0": 0, "y0": 0, "x1": 5000, "y1": 10000},
                       "rois": {"hay": {"x0": 500, "y0": 6000, "x1": 2000, "y1": 8000}}},
                      {"stall": "B", "colour": {"x0": 5000, "y0": 0, "x1": 10000, "y1": 10000}, "thermal": {"x0": 5000, "y0": 0, "x1": 10000, "y1": 10000}}]},
           {"id": "close:A", "kind": "close", "stall": "A", "position": {"moves": [{"profile": "colour", "preset": "A"}], "settleS": 0},
            "rois": {"eye": EYE_BOX, "nostril": {"x0": 4500, "y0": 7000, "x1": 5500, "y1": 8000}}},
           {"id": "close:B", "kind": "close", "stall": "B", "position": {"moves": [{"profile": "colour", "preset": "B"}], "settleS": 0},
            "rois": {"eye": EYE_BOX, "nostril": {"x0": 4500, "y0": 7000, "x1": 5500, "y1": 8000}}}]}

got = []
hub = ZoomCameraHub(DEV, got.extend, window_s=13)          # the activity measure needs 10 s+ of video
hub.cam, hub.ptz, hub.detector, hub.detector_note = SceneCam(hub), FakePtz(), FakeDetector(), None
hub.video = hub.vvideo = multistall._Fed()


def start():
    for z in hub.zones():
        if z["stall"] not in hub.workers:
            wk = StallWorker(hub, z, hub.sink, hub.window_s)
            wk.connect()
            hub.workers[z["stall"]] = wk


hub._start = start
running = threading.Event()
running.set()


def feeder():
    th = (np.full((288, 352), 120, dtype=np.uint8) + rng.integers(0, 3, size=(288, 352)).astype(np.uint8))
    last_det = 0
    while running.is_set():
        t = time.time()
        hub.on_colour(colour_frame(t), t)
        hub.on_thermal(th.tobytes(), t)
        if t - last_det >= 0.2:
            hub.detect_once()
            last_det = t
        time.sleep(0.1)


threading.Thread(target=feeder, daemon=True).start()
minutes = []
for m in range(4):
    before = len(got)
    hub._run_once()
    minutes.append((hub.view["id"], got[before:]))
running.clear()

views = [v for v, _ in minutes]
check("plan: wide, close A, wide, close B", views == ["wide", "close:A", "wide", "close:B"], views)
check("camera moved for each change of view", [m[2] for m in hub.ptz.moves] == ["wide", "A", "wide", "B"], hub.ptz.moves)

for i, (view, rs) in enumerate(minutes):
    stalls = {r["stallId"] for r in rs}
    metrics = {r["metric"] for r in rs}
    if view == "wide":
        check(f"min {i}: both stalls reported", stalls == {"A", "B"}, stalls)
        check(f"min {i}: no vitals from the wide view", not metrics & {"body_temp_c", "eye_check", "nostril_temp_c"}, metrics)
        act = {r["stallId"]: r["value"] for r in rs if r["metric"] == "activity_index"}
        check(f"min {i}: activity for each horse", set(act) == {"A", "B"}, act)
        if len(act) == 2:
            check(f"min {i}: the pacing horse (A) is the busier", act["A"] > act["B"], act)
        check(f"min {i}: readings say which view", all(r["meta"].get("view") == "wide" for r in rs))
    else:
        stall = view.split(":")[1]
        check(f"min {i}: only the zoomed-in horse reported", stalls == {stall}, stalls)
        temps = [r["value"] for r in rs if r["metric"] == "body_temp_c"]
        check(f"min {i}: eye temperature from the close-up", temps and abs(temps[0] - 36.6) < 0.05, temps)
        check(f"min {i}: no behaviour from a close-up", not metrics & {"activity_index", "time_budget", "inactive_minutes", "vice_event"}, metrics)

# A failing zoom keeps the wide view and still measures behaviour.
hub.ptz.fail = True
hub.minute, before = 3, len(got)                             # the next minute is a close-up
running.set()
threading.Thread(target=feeder, daemon=True).start()
hub._run_once()
running.clear()
rs = got[before:]
check("zoom failure: wide view kept", hub.view["id"] == "wide", hub.view["id"])
check("zoom failure: behaviour still measured", {r["stallId"] for r in rs if r["metric"] == "activity_index"} == {"A", "B"})

# Each stall keeps its own posture model file.
paths = {str(w._posture_path().name) for w in hub.workers.values()}
check("posture model per stall", paths == {"posture-zoom-1-A-visible.json", "posture-zoom-1-B-visible.json"}, paths)

print("multistall: all ok" if not fails else f"multistall: {fails} failed")
sys.exit(1 if fails else 0)
