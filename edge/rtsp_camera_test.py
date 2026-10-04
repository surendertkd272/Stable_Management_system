"""A camera the stable already owns (RtspCameraWorker): the colour measures
from its picture, nothing from a thermal sensor it does not have; its stream
paths; recording only its colour picture. Run: python3 edge/rtsp_camera_test.py"""
import math
import sys
import tempfile
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import edge_agent  # noqa: E402
from edge_agent import RtspCameraWorker, camera_worker_for  # noqa: E402
from recorder import stream_path, streams_of  # noqa: E402
from video_analytics import WindowAnalyzer, W, H  # noqa: E402

edge_agent.STATE_DIR = Path(tempfile.mkdtemp())
fails = 0


def check(name, ok, detail=""):
    global fails
    if not ok:
        fails += 1
        print(f"FAIL {name} {detail}")


class Alive:
    error = None
    frames = 10

    def is_alive(self):
        return True

    def stop(self):
        pass


DEV = {"id": "cctv-1", "name": "Stall 4 CCTV", "kind": "ip_camera", "protocol": "rtsp", "host": "192.168.1.64",
       "username": "admin", "password": "x", "rtspPort": 554,
       "rtspPath": "/Streaming/Channels/102", "rtspPathMain": "/Streaming/Channels/101", "rois": None}


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


def worker(dev=DEV):
    got = []
    w = RtspCameraWorker(dict(dev), got.extend, window_s=1)
    w.vvideo = Alive()
    w._start_video = lambda: None
    w._load_posture()
    w.vanalyzer = WindowAnalyzer(mode="visible", w=W, h=H)
    w.connect = lambda: setattr(w, "cam", edge_agent._NoThermal())
    w.cam = None
    return w, got


def run_window(w, frames):
    orig = w.vanalyzer.reset

    def reset_then_feed():
        orig()
        for i, f in enumerate(frames):
            w.vanalyzer.feed(f, t=i / 10)
    w.vanalyzer.reset = reset_then_feed
    w._run_once()


# 1. which worker, which streams
check("an ip_camera gets the colour-only worker", isinstance(camera_worker_for(dict(DEV), lambda r: None, 60), RtspCameraWorker))
w, got = worker()
check("analyses the sub stream, stills from the main", w._colour_path() == "/Streaming/Channels/102" and w._hd_path() == "/Streaming/Channels/101")
check("behaviour from the colour picture", w.behaviour_stream() == "visible")

# 2. no boxes needed; a weaving horse: behaviour measured, no temperatures, no thermal diagnostics
run_window(w, weave_frames())
metrics = {r["metric"] for r in got}
check("activity and weaving from the colour picture", {"activity_index", "vice_event"} <= metrics, metrics)
check("nothing from a thermal sensor it does not have", not metrics & {"body_temp_c", "nostril_temp_c", "eye_check"}, metrics)
act = [r for r in got if r["metric"] == "activity_index"]
check("source visible_video", act and act[0]["source"] == "visible_video", act)
bc = [r for r in got if r["metric"] == "breathing_check"]
check("breathing: the flank is the only way, said so", bc and bc[0]["meta"]["nostril"] is None
      and bc[0]["meta"]["flank"] == "no_flank_region" and bc[0]["source"] == "visible_video", bc)
check("no warnings about a thermal video", not any("thermal" in x for x in w.warnings()), w.warnings())

# 3. an empty stall, with the detector loaded: nothing reported
w, got = worker()
w.detector = object()
run_window(w, [bytes(150 for _ in range(W * H))] * 300)
check("empty stall (detector on, no horse, no movement): silence", got == [], [r["metric"] for r in got])

# 4. no stream address yet: a clear error
w2 = RtspCameraWorker({**DEV, "rtspPath": None}, lambda r: None, window_s=1)
try:
    w2.connect()
    check("no stream: refused", False)
except RuntimeError as e:
    check("no stream: says what to do", "Hardware page" in str(e), str(e))

# 5. recording: the colour picture only, from the chosen stream
check("records the colour picture only", streams_of(DEV) == ["visible"] and streams_of({"kind": "thermal_camera"}) == ["thermal", "visible"])
check("records the sub stream by default", stream_path(DEV, "visible") == "/Streaming/Channels/102")
check("or the main stream when chosen", stream_path({**DEV, "colourStream": "main"}, "visible") == "/Streaming/Channels/101")

print("rtsp_camera_test:", "OK" if not fails else f"{fails} failed")
sys.exit(1 if fails else 0)
