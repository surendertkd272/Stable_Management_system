"""One camera, several horses: a dual-lens (colour + thermal) camera that can
zoom, watching two or more stalls at once, and a separate record for each
horse.

How it works:

  * The camera is calibrated with VIEWS (server/devices.mjs, Hardware page):
      wide         zoomed out, every stall in the picture; each stall drawn as
                   a ZONE on the colour picture (and on the thermal one), with
                   its own hay and floor boxes;
      close:<stall> zoomed in on that stall's horse's head, with eye and
                   nostril boxes on the thermal picture.
  * Each stall gets a StallWorker — the single-horse camera worker
    (edge_agent.MtrpcCameraWorker) fed only its own part of the picture, so
    every measurement it already makes (activity, lying, eating, vices,
    urine and manure, people, recognition, eye, breathing) is made per horse
    and sent with that stall: the server files it under the horse there.
  * The hub owns the real camera (one login, one thermal and one colour
    stream, one detector) and the zoom. Minute by minute it decides the view:
    mostly wide (behaviour for every horse), and every few minutes a close-up
    of one horse in turn (that horse's eye temperature, breathing at the
    nostril and face recognition). While zoomed in on one horse the others
    are not watched — about one minute in `closeEveryMin`.

A camera without zoom that sees two stalls works too: a wide view only.
"""
import threading
import time

import edge_agent as ea
from edge_agent import MtrpcCameraWorker, NoRois, Worker, STATE_DIR

# What each kind of minute may report. Wide: behaviour (vitals at that
# distance are a pixel or two of the eye — not reported). Close: vitals and
# the face (a face filling the picture says nothing about activity or lying).
VITALS = {"body_temp_c", "nostril_temp_c", "eye_check"}
CLOSE_KEEP = VITALS | {"respiratory_rate_bpm", "respiratory_rate_live_bpm", "breathing_check", "horse_identity"}
FULL = {"x0": 0, "y0": 0, "x1": 10000, "y1": 10000}


def rel_box(b, z):
    """A box drawn on the whole picture (0–10000) -> the same box in zone z's
    own picture (0–10000), clipped to it; None if it falls outside."""
    if not b or not z:
        return None
    zw, zh = max(1, z["x1"] - z["x0"]), max(1, z["y1"] - z["y0"])
    f = lambda v, o, s: max(0, min(10000, round((v - o) * 10000 / s)))  # noqa: E731
    out = {"x0": f(b["x0"], z["x0"], zw), "y0": f(b["y0"], z["y0"], zh), "x1": f(b["x1"], z["x0"], zw), "y1": f(b["y1"], z["y0"], zh)}
    return out if out["x1"] > out["x0"] and out["y1"] > out["y0"] else None


def zone_size(z, frame_w, frame_h, pixels=352 * 288):
    """Analysis size for a zone: its own shape, about as many pixels as a
    single-stall camera's colour analysis (so the thresholds still fit)."""
    aw = (z["x1"] - z["x0"]) / 10000 * frame_w
    ah = (z["y1"] - z["y0"]) / 10000 * frame_h
    k = (pixels / max(1.0, aw * ah)) ** 0.5
    return max(32, int(aw * k) // 2 * 2), max(32, int(ah * k) // 2 * 2)


def crop_resize(buf, w, h, ch, z, ow, oh):
    """Zone z (0–10000) of a w×h frame with ch bytes a pixel, resized
    (nearest) to ow×oh. bytes in, bytes out."""
    import numpy as np
    a = np.frombuffer(buf, dtype=np.uint8).reshape(h, w, ch) if ch > 1 else np.frombuffer(buf, dtype=np.uint8).reshape(h, w)
    x0, x1 = int(z["x0"] / 10000 * w), max(int(z["x0"] / 10000 * w) + 1, int(z["x1"] / 10000 * w))
    y0, y1 = int(z["y0"] / 10000 * h), max(int(z["y0"] / 10000 * h) + 1, int(z["y1"] / 10000 * h))
    c = a[y0:y1, x0:x1]
    ys = (np.arange(oh) * c.shape[0] // oh).clip(0, c.shape[0] - 1)
    xs = (np.arange(ow) * c.shape[1] // ow).clip(0, c.shape[1] - 1)
    return np.ascontiguousarray(c[ys][:, xs]).tobytes()


class ZoneCam:
    """The camera's temperature reads for one stall: points in the stall's own
    picture (camera coordinates 0–8192) are moved into the whole thermal
    picture through the stall's thermal rectangle (wide) — or taken as they
    are (zoomed in on this horse)."""

    def __init__(self, hub, worker):
        self.hub, self.worker = hub, worker

    def _rect(self):
        if self.worker.mode == "close":
            return FULL
        return (self.worker.zone or {}).get("thermal")

    def read_pixels(self, points):
        from mtrpc import clamp_cam, to_cam  # noqa
        r = self._rect()
        if r is None:
            return [None] * len(points)
        x0, x1, y0, y1 = to_cam(r["x0"]), to_cam(r["x1"]), to_cam(r["y0"]), to_cam(r["y1"])
        mapped = [{"x": clamp_cam(x0 + p["x"] * (x1 - x0) / 8192), "y": clamp_cam(y0 + p["y"] * (y1 - y0) / 8192)} for p in points]
        with self.hub.cam_lock:
            return self.hub.cam.read_pixels(mapped)

    def box_max(self, box, n=16):
        from mtrpc import grid_points  # noqa
        vals = [v for v in self.read_pixels(grid_points(box, n)) if v is not None]
        return max(vals) if vals else None

    def box_grid(self, box, n=16):
        from mtrpc import grid_points, grid_size  # noqa
        cols, rows = grid_size(box, n)
        return self.read_pixels(grid_points(box, n)), cols, rows

    def box_avg(self, box, n=5):
        from mtrpc import grid_points  # noqa
        vals = [v for v in self.read_pixels(grid_points(box, n)) if v is not None]
        return sum(vals) / len(vals) if vals else None


class _Fed:
    """Stands in for a video stream: the hub feeds the frames."""
    error = None
    frames = 1

    def is_alive(self):
        return True

    def stop(self):
        pass


class StallWorker(MtrpcCameraWorker):
    """The single-horse worker, on one stall's part of a shared camera."""

    def __init__(self, hub, zone, sink, window_s):
        self.hub, self.zone, self.stall, self.mode = hub, zone, zone["stall"], "wide"
        super().__init__(hub.zone_dev(zone, "wide"), sink, window_s)
        self.name = f"{hub.dev['name']} · stall {self.stall}"
        self.VISIBLE_SIZE = hub.zone_visible_size(zone)
        self.detect_state = {"last": None, "history": []}

    def _posture_path(self):
        return STATE_DIR / f"posture-{self.dev['id']}-{self.stall}-visible.json"

    def connect(self):
        self.cam = ZoneCam(self.hub, self)
        self._start_video()

    def _start_video(self):
        from video_analytics import WindowAnalyzer  # noqa
        if self.posture is None:
            self._load_posture()
        vw, vh = self.VISIBLE_SIZE
        if self.analyzer is None:
            self.analyzer = WindowAnalyzer(mode="thermal")
        if self.vanalyzer is None:
            self.vanalyzer = WindowAnalyzer(mode="visible", w=vw, h=vh)
        if self.detector is None and self.detector_note is None:
            self.detector, self.detector_note = self.hub.detector, self.hub.detector_note
        self.video = self.vvideo = _Fed()
        self._video_started = getattr(self, "_video_started", None) or time.time()

    def feed_thermal(self, frame, t):
        from video_analytics import box_px  # noqa
        rois = self.dev.get("rois") or {}
        nb = box_px(rois["nostril"]) if (self.mode == "close" and rois.get("nostril")) else None
        with self._lock:
            if self.analyzer is not None:
                self.analyzer.feed(frame, nb, t=t)

    def feed_visible(self, grey, colour, t):
        rois = self.dev.get("rois") or {}
        fb = self.flank_bounds(rois)
        fo, ig = self.motion_region(t)
        with self._lock:
            if self.vanalyzer is not None:
                self.vanalyzer.feed(grey, flank_bounds=fb, t=t, focus=fo, ignore=ig)
            self.last_visible = (grey, t)
            self.last_colour = (colour, t)

    def set_mode(self, mode):
        self.mode = mode
        self.dev = self.hub.zone_dev(self.zone, mode, base=self.dev)

    def emit(self, readings):
        keep = []
        for r in readings or []:
            m, src = r.get("metric"), r.get("source")
            if self.mode == "close":
                if m not in CLOSE_KEEP:
                    continue
            else:
                if m in VITALS:
                    continue
                if m in ("respiratory_rate_bpm", "respiratory_rate_live_bpm") and src != "visible_video" \
                        and "flank" not in str((r.get("meta") or {}).get("method", "")):
                    continue
            r = dict(r, stallId=self.stall, meta=dict(r.get("meta") or {}, view=self.mode, stall=self.stall))
            keep.append(r)
        if keep:
            super().emit(keep)


class ZoomCameraHub(Worker):
    """The real camera behind the StallWorkers: login, streams, zoom, and the
    view for each minute."""

    THERMAL_SIZE = (352, 288)          # decoded larger than the analysis size, so a zone's crop keeps detail
    COLOUR_SIZE = (704, 576)
    DETECT_EVERY_S = 1.0

    def __init__(self, dev, sink, window_s=60):
        super().__init__(dev, sink)
        self.window_s = window_s
        self.cam = self.ptz = None
        self.cam_lock = threading.Lock()
        self.workers = {}               # stall -> StallWorker
        self.view = None                # the view the camera is in (None while moving)
        self.minute = 0
        self.next_close = 0
        self.detector, self.detector_note = None, None
        self.last_close = None          # (bgr, w, h, t) of the latest close-up colour frame
        self.video = self.vvideo = None
        self.moves = 0

    # ---- config ---------------------------------------------------------- #
    def views(self):
        return {v["id"]: v for v in (self.dev.get("views") or []) if v.get("id")}

    def wide(self):
        return next((v for v in self.views().values() if v.get("kind") == "wide"), None)

    def zones(self):
        return [z for z in (self.wide() or {}).get("zones", []) if z.get("stall") and z.get("colour")]

    def close_view(self, stall):
        return next((v for v in self.views().values() if v.get("kind") == "close" and v.get("stall") == stall), None)

    def zone_visible_size(self, z):
        return zone_size(z["colour"], *self.COLOUR_SIZE)

    def zone_dev(self, z, mode, base=None):
        """The single-horse config a StallWorker runs on, for this view."""
        d = self.dev
        out = dict(base or {})
        for k in ("id", "kind", "host", "username", "password", "httpPort", "rtspPort", "protocol", "emissivity",
                  "distanceM", "floorCalib", "serial", "configError"):
            out[k] = d.get(k)
        out.update(name=f"{d['name']} · {z['stall']}", stall=z["stall"], behaviourStream="visible", colourStream=None,
                   stallHorse=(d.get("stallHorses") or {}).get(z["stall"]), identityHd=False, record=False)
        close = self.close_view(z["stall"])
        if mode == "close" and close:
            r = close.get("rois") or {}
            out["rois"] = {"eye": r.get("eye"), "nostril": r.get("nostril") or FULL, "pushedAt": close.get("pushedAt")}
            out["calibrated"] = bool(r.get("eye") or r.get("nostril"))
        else:
            r = z.get("rois") or {}
            th = z.get("thermal")
            out["rois"] = {
                # the nostril box is the single-horse worker's sign that it was
                # aimed; zoomed out there is no nostril to read (vitals come
                # from close-ups), so the whole zone stands in for it.
                "nostril": FULL,
                "hay": rel_box(r.get("hay"), z["colour"]), "colourFloor": rel_box(r.get("colourFloor"), z["colour"]),
                "flank": rel_box(r.get("flank"), z["colour"]), "floor": rel_box(r.get("floor"), th) if th else None,
                "pushedAt": (self.wide() or {}).get("pushedAt"),
            }
            out["calibrated"] = True
        return out

    # ---- camera ---------------------------------------------------------- #
    def connect(self):
        import ptz as ptzmod  # noqa
        from mtrpc import MtrpcCamera  # noqa
        d = self.dev
        if d.get("configError"):
            raise RuntimeError(d["configError"])
        if not self.zones():
            raise NoRois("the zoom camera has no stalls drawn on its wide view — set it up in the Hardware page")
        cam = MtrpcCamera(d["host"], d.get("username", "admin"), d.get("password") or "", port=d.get("httpPort", 80))
        if not cam.login():
            raise RuntimeError("camera login failed — check the password in the Hardware page")
        self.cam = cam
        self.ptz = ptzmod.make(d)
        self._start()

    def _start(self):
        from video_analytics import VideoStream  # noqa
        from detector import load  # noqa
        if self.detector is None and self.detector_note is None:
            self.detector, self.detector_note = load(None)
            if self.detector_note:
                print(f"[edge] {self.dev['name']}: {self.detector_note} — the stalls cannot be told apart without it")
        wanted = {z["stall"] for z in self.zones()}
        for s in [s for s in self.workers if s not in wanted]:  # a stall taken off the wide view
            self.workers.pop(s).stop()
        for z in self.zones():
            if z["stall"] not in self.workers:
                w = StallWorker(self, z, self.sink, self.window_s)
                w.connect()
                self.workers[z["stall"]] = w
            else:
                self.workers[z["stall"]].zone = z
        d = self.dev
        tw, th = self.THERMAL_SIZE
        vw, vh = self.COLOUR_SIZE
        if self.video is None or not self.video.is_alive():
            self.video = VideoStream(d["host"], d.get("username", "admin"), d.get("password") or "", self.on_thermal,
                                     port=d.get("rtspPort", 554), path="/media/live/202", w=tw, h=th)
            self.video.start()
        if self.vvideo is None or not self.vvideo.is_alive():
            self.vvideo = VideoStream(d["host"], d.get("username", "admin"), d.get("password") or "", lambda g, t: None,
                                      port=d.get("rtspPort", 554), path="/media/live/102", w=vw, h=vh, on_colour=self.on_colour)
            self.vvideo.start()
        if not getattr(self, "_detect_thread", None):
            self._detect_thread = threading.Thread(target=self._detect_loop, daemon=True, name=f"detect:{d['name']}")
            self._detect_thread.start()

    # ---- frames ---------------------------------------------------------- #
    def on_thermal(self, frame, t):
        from video_analytics import W, H  # noqa
        v = self.view
        if v is None:
            return                                           # moving: the picture is a blur
        tw, th = self.THERMAL_SIZE
        if v.get("kind") == "close":
            w = self.workers.get(v.get("stall"))
            if w:
                w.feed_thermal(crop_resize(frame, tw, th, 1, FULL, W, H), t)
            return
        for w in self.workers.values():
            if w.mode == "wide" and w.zone.get("thermal"):
                w.feed_thermal(crop_resize(frame, tw, th, 1, w.zone["thermal"], W, H), t)

    def on_colour(self, bgr, t):
        from video_analytics import grey_of  # noqa
        v = self.view
        if v is None:
            return
        vw, vh = self.COLOUR_SIZE
        if v.get("kind") == "close":
            self.last_close = (bgr, vw, vh, t)
            return
        for w in self.workers.values():
            if w.mode != "wide":
                continue
            ow, oh = w.VISIBLE_SIZE
            c = crop_resize(bgr, vw, vh, 3, w.zone["colour"], ow, oh)
            w.feed_visible(grey_of(c), c, t)

    def _detect_loop(self):
        while not self.stop_evt.is_set():
            self.stop_evt.wait(self.DETECT_EVERY_S)
            self.detect_once()

    def detect_once(self):
        """One look for each stall's horse in its own zone (wide view only)."""
        if self.detector is None or self.view is None or self.view.get("kind") != "wide":
            return
        for w in list(self.workers.values()):
            if w.mode == "wide" and w.detector is not None:
                try:
                    w._detect_step(w.detect_state)
                except Exception as e:                       # noqa: BLE001
                    print(f"[edge] {w.name}: detector step failed ({e})")

    # ---- the minute ------------------------------------------------------ #
    def plan(self):
        """('wide', None) or ('close', stall) for the coming minute: a close-up
        every closeEveryMin minutes, the stalls in turn — only where a close
        view exists and the camera can zoom."""
        every = int((self.dev.get("schedule") or {}).get("closeEveryMin") or 5)
        stalls = [z["stall"] for z in self.zones() if self.close_view(z["stall"])]
        if self.ptz is None or not stalls or every < 2 or (self.minute + 1) % every:
            return "wide", None
        stall = stalls[self.next_close % len(stalls)]
        self.next_close += 1
        return "close", stall

    def go_to(self, view, wait=time.sleep):
        """Moves the camera to a view (and holds the frames while it moves)."""
        import ptz as ptzmod  # noqa
        if self.view is not None and self.view.get("id") == view.get("id"):
            return
        self.view = None
        if self.ptz is not None and view.get("position"):
            ptzmod.go(self.ptz, view["position"], wait=wait)
            self.moves += 1
        self.view = view

    def run_once(self):
        try:
            self._run_once()
        except NoRois:
            raise
        except Exception:
            self.cam = None
            raise

    def _run_once(self):
        if self.cam is None:
            self.connect()
        else:
            self._start()
        kind, stall = self.plan()
        target = self.close_view(stall) if kind == "close" else self.wide()
        try:
            self.go_to(target)
        except Exception as e:                               # noqa: BLE001
            print(f"[edge] {self.dev['name']}: could not move the camera ({e}) — staying in the wide view")
            kind, stall = "wide", None
            self.view = self.wide()
        for s, w in self.workers.items():
            w.set_mode("wide" if kind == "wide" else ("close" if s == stall else "off"))
        active = [w for w in self.workers.values() if w.mode != "off"]
        errors = []

        def one(w):
            try:
                w.run_once()
            except Exception as e:                           # noqa: BLE001
                errors.append(f"stall {w.stall}: {w.describe(e)}")
        threads = [threading.Thread(target=one, args=(w,), daemon=True) for w in active]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        if kind == "close" and stall in self.workers:
            self._face(self.workers[stall])
        self.minute += 1
        if errors:
            raise RuntimeError("; ".join(errors)[:300])

    def _face(self, w):
        """Who is in the close-up: the face against each horse's face gallery
        (key '<horse>#face'), learned while the stall's horse is new."""
        mine = (w.dev.get("stallHorse") or {}).get("id")
        if not mine or self.last_close is None or getattr(w, "identifier", None) is None and not self._load_identity(w):
            return
        from identity import decide  # noqa
        import numpy as np
        bgr, vw, vh, _ = self.last_close
        face = {"x0": 0.15, "y0": 0.1, "x1": 0.85, "y1": 0.9}       # the middle of a close-up: the head
        try:
            vec = w.identifier.embed(np.frombuffer(bgr, dtype=np.uint8).reshape(vh, vw, 3), face)
        except Exception as e:                               # noqa: BLE001
            print(f"[edge] {w.name}: face recognition failed ({e})")
            return
        key = f"{mine}#face"
        res = decide(w.gallery, vec, key)
        names = {k.split("#")[0]: h.get("name", k) for k, h in w.gallery.data["horses"].items()}
        if res["verdict"] != "other" and res["samples"] < w.LEARN_UP_TO:
            if w.gallery.add(key, vec, t=time.time(), name=(w.dev.get("stallHorse") or {}).get("name"), src=f"{self.dev['id']}:face"):
                w.gallery.save()
                res["learned"] = True
        best = (res.get("best") or "").split("#")[0] or None
        res.update(best=best, assigned=mine, kind="face", why="close-up", picture="close-up colour",
                   assignedName=(w.dev.get("stallHorse") or {}).get("name") or mine, bestName=names.get(best) if best else None)
        w.emit([dict(deviceId=self.dev["id"], metric="horse_identity", value=round(res["assignedScore"] or 0.0, 3),
                     unit="score", ts=ea.now_iso(), source="visible_video", confidence=1.0, meta=res)])

    def _load_identity(self, w):
        from identity import Gallery, load  # noqa
        if getattr(w, "identity_note", None):
            return False
        w.identifier, w.identity_note = load(None)
        if w.identity_note:
            return False
        w.gallery = Gallery(STATE_DIR / "identity.json")
        return True

    # ---- status ---------------------------------------------------------- #
    def warnings(self):
        out = []
        for name, v in (("thermal video", self.video), ("colour video", self.vvideo)):
            if v is not None and getattr(v, "error", None):
                out.append(f"{name}: {v.error}")
        if self.detector_note:
            out.append(f"stalls cannot be told apart — {self.detector_note}")
        for w in self.workers.values():
            out += [f"stall {w.stall}: {x}" for x in w.warnings() if "video" not in x]
        return out[:4]

    def stop(self):
        super().stop()
        for v in (self.video, self.vvideo):
            if v is not None:
                v.stop()
        for w in self.workers.values():
            w.stop()
