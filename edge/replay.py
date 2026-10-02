"""Analyse recorded footage the way the live edge agent would have.

For a camera recorded with nothing analysing it — the Windows laptop left at
the stable with tools/windows-recorder, say — this feeds the recorded thermal
and colour clips through the live camera worker (MtrpcCameraWorker), minute by
minute on the recording's own clock, and sends the readings to the server as
if they had arrived live: the same metrics, methods and confidence rules, and
the same de-duplication (running it twice stores nothing twice).

What a recording cannot give back is anything read from the camera's
temperature API: the eye temperature, the nostril's °C and the thermal floor
scan. A recording holds the picture's brightness, not degrees, so those
readings are absent and each minute's eye_check says why. Breathing (thermal
video, colour flank), activity, rest, the vices, lying down (colour detector)
and the colour floor check all come from the pictures and are measured.

  ~/EquiCare-demo/edge-venv/bin/python edge/replay.py \\
      --recordings ~/EquiCare-demo/recordings/rvc-night --tz Asia/Kolkata \\
      --device devices-1790666091722-307 \\
      --server http://127.0.0.1:8080 --token-file ~/EquiCare-demo/edge-token

Layout: <recordings>/thermal/*.mp4 and <recordings>/visible/*.mp4, each clip
named by its local start time, YYYY-MM-DDTHH-MM-SS.mp4 (the Windows and the
Mac recorders' layout alike). A colour-hd/ folder is ignored: the analysis
works on the small colour stream, as live.

Two passes. The posture model (standing vs lying from the horse box's height)
is learned per stall view, and a camera moved to a new view starts unlearned —
so a quick first pass runs the horse detector every 2 s over the whole night
and learns the model from it; the full pass then splits the night into
contiguous chunks analysed in parallel, each starting from that model.
"""
import argparse
import datetime as dt
import heapq
import json
import multiprocessing as mp
import os
import re
import subprocess
import sys
import time as _time
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("EQUICARE_DETECTOR_THREADS", "1")       # parts run side by side

NAME = re.compile(r"^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})\.mp4$")
NO_TEMPS = "not measured — recorded video holds no temperatures (the camera's temperature readings were not recorded)"
GAP_S = 5.0            # frames further apart than this: the recording stopped; skip the clock ahead


# --------------------------------------------------------------------------- #
# the recordings
# --------------------------------------------------------------------------- #
def clip_start(path, tz):
    m = NAME.match(path.name)
    if not m:
        return None
    d, hh, mm, ss = m.groups()
    local = dt.datetime.fromisoformat(f"{d}T{hh}:{mm}:{ss}").replace(tzinfo=tz)
    return local.timestamp()


def duration(path):
    try:
        out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                             capture_output=True, text=True, timeout=60).stdout.strip()
        return float(out) if out and out != "N/A" else None
    except (subprocess.SubprocessError, ValueError):
        return None


def list_clips(folder, tz, t_from=None, t_to=None):
    """[(start, end, path)] in time order; a clip's end is capped at the next
    clip's start (the recorder cuts them back to back)."""
    rows = []
    for p in sorted(Path(folder).glob("*.mp4")):
        s = clip_start(p, tz)
        if s is not None:
            rows.append([s, None, p])
    for i, r in enumerate(rows):
        d = duration(r[2])
        nxt = rows[i + 1][0] if i + 1 < len(rows) else None
        end = r[0] + d if d else nxt
        if end is None:
            continue
        r[1] = min(end, nxt) if nxt else end
    rows = [tuple(r) for r in rows if r[1] and r[1] > r[0]]
    return [r for r in rows if (t_from is None or r[1] > t_from) and (t_to is None or r[0] < t_to)]


def chunks(clips, n):
    """Split back-to-back clips into n contiguous runs of about equal length."""
    if not clips:
        return []
    total = sum(e - s for s, e, _ in clips)
    out, cur, acc = [], [], 0.0
    for c in clips:
        cur.append(c)
        acc += c[1] - c[0]
        if acc >= total / n and len(out) < n - 1:
            out.append(cur)
            cur, acc = [], 0.0
    if cur:
        out.append(cur)
    return out


def frames(clips, w, h, fps, t0, t1, kind):
    """(t, kind, frame) for the part of these clips between t0 and t1: gray,
    w×h, fps per second — decoded exactly as the live VideoStream decodes."""
    n = w * h
    for s, e, path in clips:
        a, b = max(s, t0), min(e, t1)
        if b - a < 1:
            continue
        cmd = ["ffmpeg", "-v", "error", "-nostdin", "-threads", "1", "-ss", f"{a - s:.3f}", "-i", str(path), "-t", f"{b - a:.3f}",
               "-map", "0:v:0", "-an", "-vf", f"fps={fps},scale={w}:{h},format=gray", "-f", "rawvideo", "pipe:1"]
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        k = 0
        try:
            while True:
                buf = p.stdout.read(n)
                if len(buf) < n:
                    break
                yield (a + k / fps, kind, buf)
                k += 1
        finally:
            p.stdout.close()
            p.wait()


# --------------------------------------------------------------------------- #
# the live worker, on the recording's clock
# --------------------------------------------------------------------------- #
class Clock:
    def __init__(self):
        self.t = 0.0


class TimeShim:
    """Stands in for the time module inside edge_agent: time() is the clock."""
    def __init__(self, clock):
        self._c = clock

    def time(self):
        return self._c.t

    def __getattr__(self, k):
        return getattr(_time, k)


class NoTemps:
    """The camera's temperature API, for a recording: every read is missing."""
    def read_pixels(self, pts):
        return [None] * len(pts)

    def box_grid(self, box, n=16):
        from mtrpc import grid_size  # noqa
        cols, rows = grid_size(box, n)
        return [None] * (cols * rows), cols, rows

    def box_max(self, *a, **k):
        return None

    def box_avg(self, *a, **k):
        return None

    def logout(self):
        pass


class Running:
    """A video stream that is up — the frames come from the feeder."""
    error = None
    frames = 1

    def is_alive(self):
        return True

    def stop(self):
        pass


class Feeder:
    """The worker's stop event: wait(s) plays the next s seconds of footage
    into the worker's analysers (and the detector once a second), then moves
    the clock on. is_set() once the footage has run out."""
    def __init__(self, clock, source, worker):
        self.clock, self.src, self.w = clock, source, worker
        self.head = next(self.src, None)
        self.done = self.head is None
        self.last_detect = -1e18
        self.st = {"last": None, "history": []}

    def is_set(self):
        return self.done

    def set(self):
        self.done = True

    def skip_gap(self):
        if self.head is not None and self.head[0] > self.clock.t + GAP_S:
            self.clock.t = self.head[0]

    def wait(self, seconds=None):
        target = self.clock.t + (seconds or 0)
        w = self.w
        while self.head is not None and self.head[0] < target:
            t, kind, fr = self.head
            if kind == "thermal":
                rois = w.dev.get("rois") or {}
                nb = w.box_px(rois["nostril"]) if rois.get("nostril") else None
                w.analyzer.feed(fr, nb, t=t)
            else:
                r = w.dev.get("rois") or {}
                fb = w.flank_bounds(r)
                fo, ig = w.motion_region(t)
                w.vanalyzer.feed(fr, flank_bounds=fb, t=t, focus=fo, ignore=ig)
                w.last_visible = (fr, t)
                if w.detector is not None and t - self.last_detect >= w.DETECT_EVERY_S:
                    self.last_detect = t
                    if not w._detect_step(self.st):
                        w.detector = None
            self.head = next(self.src, None)
        if self.head is None:
            self.done = True
        self.clock.t = max(self.clock.t, target)
        return self.done


def make_worker(dev, posture_state, detector_model, clock, sink):
    import edge_agent as ea
    from video_analytics import WindowAnalyzer, box_px as _box_px  # noqa
    from behaviour import PostureTracker  # noqa

    ea.time = TimeShim(clock)                                # this process only replays
    ea.now_iso = lambda: dt.datetime.fromtimestamp(clock.t, dt.timezone.utc).replace(microsecond=0) \
        .isoformat().replace("+00:00", "Z")

    class ReplayWorker(ea.MtrpcCameraWorker):
        box_px = staticmethod(_box_px)
        LIVE_BREATH_EVERY_S = None                           # the Live view's 10 s rate: not for a past night

        def _start_video(self):                              # the feeder plays the footage
            pass

        def _floor_scan(self, rois, calib, lying_recent):    # needs temperatures
            return []

        def _auto_eye(self):
            return None, NO_TEMPS, None

        def _note_eye(self, why):
            pass

        def _log_warnings(self):
            pass

        def _save_posture(self):                             # the live stall model is left as it was
            pass

    w = ReplayWorker(dev, sink, window_s=60)
    w.cam = NoTemps()
    w.posture = PostureTracker(posture_state)
    w.analyzer = WindowAnalyzer(mode="thermal")
    vw, vh = w.VISIBLE_SIZE
    w.vanalyzer = WindowAnalyzer(mode="visible", w=vw, h=vh)
    w.video = Running()
    w.vvideo = Running()
    if detector_model:
        from detector import load  # noqa
        w.detector, w.detector_note = load(detector_model)
    return w


def tidy(readings):
    """The minute's eye check says plainly why there is no eye reading."""
    for r in readings:
        r["meta"] = dict(r.get("meta") or {}, fromRecording=True)
        if r["metric"] == "eye_check":
            r["value"] = 0
            r["meta"] = {"detail": NO_TEMPS, "fromRecording": True}
    return readings


def run_chunk(job):
    """One contiguous run of the night, analysed minute by minute."""
    dev, therm, vis, t0, t1, posture_state, model, label = job
    from video_analytics import W, H, FPS  # noqa
    clock, out = Clock(), []
    w = make_worker(dev, posture_state, model, clock, lambda rs: out.extend(tidy(rs)))
    vw, vh = w.VISIBLE_SIZE
    src = heapq.merge(frames(therm, W, H, FPS, t0, t1, "thermal"),
                      frames(vis, vw, vh, FPS, t0, t1, "visible") if vis else iter(()),
                      key=lambda x: (x[0], x[1]))
    if not vis:
        w.vvideo, w.vanalyzer = None, None
    feeder = Feeder(clock, src, w)
    w.stop_evt = feeder
    clock.t = feeder.head[0] if feeder.head else t0
    started, windows = _time.time(), 0
    while not feeder.done:
        feeder.skip_gap()
        w._run_once()
        windows += 1
        if windows % 30 == 0:
            print(f"[replay] {label}: {windows} min analysed (to {local(clock.t)}), {_time.time() - started:.0f} s",
                  flush=True)
    print(f"[replay] {label}: done — {windows} min, {len(out)} readings, {_time.time() - started:.0f} s", flush=True)
    return out


def posture_samples(job):
    """First pass: the horse box every 2 s, for learning this view's model."""
    vis, t0, t1, model = job
    from detector import load, pick_horse  # noqa
    vw, vh = 352, 288
    det, why = load(model)
    if det is None:
        return []
    hist, scene = [], []
    for t, _, fr in frames(vis, vw, vh, 0.5, t0, t1, "visible"):
        best = pick_horse(det.detect(fr, vw, vh), scene)
        if not best:
            continue
        edges = (best["x0"] <= 0.01) + (best["y0"] <= 0.01) + (best["x1"] >= 0.99) + (best["y1"] >= 0.99)
        hgt, wid = best["y1"] - best["y0"], best["x1"] - best["x0"]
        if edges < 3 and hgt > 0:
            hist.append((t, [round(hgt, 4), round(wid / hgt, 3)]))
    return hist


# --------------------------------------------------------------------------- #
def local(t, tz=None):
    return dt.datetime.fromtimestamp(t, tz or LOCAL_TZ).strftime("%d %b %H:%M")


LOCAL_TZ = None


def device_from_state(state_file, dev_id):
    s = json.loads(Path(state_file).read_text())
    d = next((x for x in s["entities"].get("devices", []) if x["id"] == dev_id), None)
    if d is None:
        raise SystemExit(f"no device {dev_id} in {state_file}")
    # Without temperatures nothing can tell whether the head was in the eye
    # box, so the eye box is left out: the minute's breathing check then says
    # what the video showed (no rhythm, head moving…) instead of "the head was
    # not in the boxes". The thermal floor box needs temperatures too.
    rois = {k: v for k, v in (d.get("rois") or {}).items() if k not in ("eye", "floor", "pushedAt", "verified", "stale")}
    if not rois.get("nostril"):
        raise SystemExit("this camera has no calibration boxes — calibrate it first (the nostril box is needed)")
    return {"id": d["id"], "name": d.get("name") or d["id"], "kind": "thermal_camera", "rois": rois,
            "calibrated": not (d.get("rois") or {}).get("stale"), "behaviourStream": d.get("behaviourStream"),
            "colourStream": None, "floorCalib": d.get("floorCalib") or {}}


def post(server, token, readings, batch=500):
    import edge_agent as ea
    stored = dup = dropped = 0
    for i in range(0, len(readings), batch):
        r = ea._post(server.rstrip("/"), token, readings[i:i + batch])
        stored += r.get("accepted", 0) or 0
        dup += r.get("duplicates", 0) or 0
        dropped += r.get("dropped", 0) or 0
    return stored, dup, dropped


def main():
    global LOCAL_TZ
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--recordings", required=True, help="folder holding thermal/ and visible/")
    ap.add_argument("--device", required=True, help="the camera's id on the Hardware page")
    ap.add_argument("--tz", default="Asia/Kolkata", help="time zone of the recorder's clock (clip names)")
    ap.add_argument("--from", dest="t_from", help="local start, YYYY-MM-DDTHH:MM (default: first clip)")
    ap.add_argument("--to", dest="t_to", help="local end, YYYY-MM-DDTHH:MM (default: last clip)")
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) - 2))
    ap.add_argument("--state-file", default=str(Path.home() / "EquiCare-demo" / "data" / "state.json"))
    ap.add_argument("--detector-model", default=os.environ.get("EQUICARE_DETECTOR_MODEL")
                    or str(Path.home() / "EquiCare-demo" / "models" / "yolox_tiny.onnx"))
    ap.add_argument("--no-detector", action="store_true", help="skip the horse detector (no lying, no colour floor)")
    ap.add_argument("--out", help="also write the readings here (JSON lines)")
    ap.add_argument("--server", help="send the readings to this EquiCare server")
    ap.add_argument("--token-file", help="the edge box token, for --server")
    a = ap.parse_args()

    tz = LOCAL_TZ = ZoneInfo(a.tz)
    at = lambda s: dt.datetime.fromisoformat(s).replace(tzinfo=tz).timestamp() if s else None  # noqa: E731
    t_from, t_to = at(a.t_from), at(a.t_to)
    root = Path(a.recordings).expanduser()
    therm = list_clips(root / "thermal", tz, t_from, t_to)
    vis = list_clips(root / "visible", tz, t_from, t_to)
    if not therm:
        raise SystemExit(f"no thermal clips in {root / 'thermal'}")
    lo = max(therm[0][0], t_from or therm[0][0])
    hi = min(therm[-1][1], t_to or therm[-1][1])
    print(f"[replay] {len(therm)} thermal + {len(vis)} colour clips, {local(lo)} → {local(hi)} "
          f"({(hi - lo) / 3600:.1f} h), {a.jobs} at a time", flush=True)
    dev = device_from_state(a.state_file, a.device)
    model = None if a.no_detector else a.detector_model
    if model and not Path(model).expanduser().exists():
        print(f"[replay] no detector model at {model} — lying and the colour floor are not measured")
        model = None
    ctx = mp.get_context("spawn")

    posture_state = None
    if model and vis:
        print("[replay] pass 1: learning standing / lying for this view…", flush=True)
        parts = chunks(vis, a.jobs * 2)
        with ctx.Pool(a.jobs) as pool:
            got = pool.map(posture_samples, [(p, lo, hi, model) for p in parts])
        hist = [h for _, h in sorted((x for g in got for x in g), key=lambda x: x[0])]
        from behaviour import PostureTracker  # noqa
        pt = PostureTracker({"hist": hist})
        pt.learn()
        posture_state = {"hist": pt.hist, "model": pt.model, "posture": None}
        print(f"[replay]   {len(hist)} horse boxes; " + (
            f"standing ~{pt.model['stand_h']:.2f}, lying ~{pt.model['lie_h']:.2f} of the frame height" if pt.model
            else "only one posture seen — lying is not measured"), flush=True)

    print("[replay] pass 2: the full analysis, minute by minute…", flush=True)
    jobs = []
    for i, part in enumerate(chunks(therm, a.jobs)):
        c0, c1 = max(part[0][0], lo), min(part[-1][1], hi)
        jobs.append((dev, part, [v for v in vis if v[1] > c0 and v[0] < c1], c0, c1, posture_state, model,
                     f"part {i + 1} ({local(c0)}–{local(c1)})"))
    with ctx.Pool(len(jobs)) as pool:
        got = pool.map(run_chunk, jobs)
    readings = sorted((r for g in got for r in g), key=lambda r: r["ts"])
    counts = {}
    for r in readings:
        counts[r["metric"]] = counts.get(r["metric"], 0) + 1
    print(f"[replay] {len(readings)} readings: " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())), flush=True)
    if a.out:
        Path(a.out).expanduser().write_text("".join(json.dumps(r) + "\n" for r in readings))
        print(f"[replay] written to {a.out}")
    if a.server:
        token = Path(a.token_file).expanduser().read_text().strip() if a.token_file else ""
        stored, dup, dropped = post(a.server, token, readings)
        print(f"[replay] sent to {a.server}: {stored} stored, {dup} already there"
              + (f", {dropped} refused (unknown device or metric)" if dropped else ""))


if __name__ == "__main__":
    main()
