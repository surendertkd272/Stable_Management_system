"""Behaviour from the camera's thermal video — the demo unit's 25 fps stream
(RTSP /media/live/202, white-hot palette), decoded small by ffmpeg.

Why video: this firmware refreshes its pixel-temperature API only ~1×/s, too
slow for breathing, while the video runs at 25 fps. Brightness in the white-hot
palette rises with temperature; the palette auto-ranges on the scene's hottest
and coldest points, which barely move while the horse stands, so SHORT changes
(a breath, a movement) survive it and slow drift is removed before analysis.
Everything here is relative (brightness, not °C): the eye temperature and the
floor events use the absolute pixel reads instead.

What each window produces — all heuristics, reported with how they were made
(meta.method) and never as more than they are:
  activity   share of the horse that changed between frames (0..1)
  inactive   minutes of the window with (almost) no movement — stillness, which
             is NOT the same as lying down
  weaving    a sustained, regular side-to-side sway (0.25–2 Hz)
  box_walk   laps of the stall; head_toss: a regular up-down rhythm in place
  breathing  the nostril box referenced to the skin around it, gated on head
             movement, rate cross-checked by counting breaths (None otherwise)
  posture    standing / lying from the horse's box (behaviour.PostureTracker)

The colour stream (mode "visible") sees the whole stall; the thermal stream
with the 25 mm lens covers ~1.5 × 1.2 m at 3.5 m — the head and neck.

Standard library only, so it runs on a bare Jetson image next to ffmpeg.
"""
import math
import socket
import subprocess
import threading
import time
import urllib.parse

from behaviour import (SwayMeter, PostureTracker, breath_analysis, bad_samples, cycle_times,  # noqa: F401
                       highpass, interval_cv, periodicity, persistence, warm_blob_box)

W, H, FPS = 176, 144, 10


# Areas the camera paints over the image: the timestamp (top right), the
# colour scale (right edge) and the channel label (bottom left). Changes there
# are not the horse.
def overlay(x, y, w=W, h=H):
    return (x >= w * 0.88) or (y <= h * 0.10 and x >= w * 0.55) or (y >= h * 0.90 and x <= w * 0.30)


def make_mask(w, h):
    return [not overlay(x, y, w, h) for y in range(h) for x in range(w)]


MASK = make_mask(W, H)


def box_px(box, w=W, h=H):
    """EquiCare box (0–10000) -> pixel bounds in the small frame."""
    fx = lambda v: max(0, min(w - 1, int(v / 10000 * w + 0.5)))
    fy = lambda v: max(0, min(h - 1, int(v / 10000 * h + 0.5)))
    return fx(box["x0"]), fy(box["y0"]), fx(box["x1"]), fy(box["y1"])


def box_mean(frame, bounds, w=W):
    x0, y0, x1, y1 = bounds
    s = n = 0
    for y in range(y0, y1 + 1):
        row = y * w
        for x in range(x0, x1 + 1):
            s += frame[row + x]
            n += 1
    return s / n if n else None


def ring_bounds(bounds, w=W, h=H, grow=0.6):
    """A larger box around `bounds` (its ring is the reference region)."""
    x0, y0, x1, y1 = bounds
    gx, gy = max(2, int((x1 - x0 + 1) * grow)), max(2, int((y1 - y0 + 1) * grow))
    return max(0, x0 - gx), max(0, y0 - gy), min(w - 1, x1 + gx), min(h - 1, y1 + gy)


def ring_mean(frame, inner, outer, w=W):
    """Mean of `outer` minus `inner` — skin around the nostril, which the
    palette re-ranging moves exactly as it moves the nostril."""
    ox0, oy0, ox1, oy1 = outer
    ix0, iy0, ix1, iy1 = inner
    s = n = 0
    for y in range(oy0, oy1 + 1):
        row = y * w
        for x in range(ox0, ox1 + 1):
            if ix0 <= x <= ix1 and iy0 <= y <= iy1:
                continue
            s += frame[row + x]
            n += 1
    return s / n if n else None


class MotionMeter:
    """Change against the frame from ~1 s earlier — frame-to-frame differences
    at 10 fps miss a horse shifting slowly. Robust to the palette's auto-range:
    each frame is normalised by its own mean and spread first, so a global
    brightness shift is not movement. A frame where most of the picture
    changed at once is a scene change (the infrared lamp switching at dusk,
    the palette jumping), not a horse: it restarts the comparison.

    thermal: also reports where the warm body is (for weaving) and scales
    activity to the warm body's size. colour: "bright" means nothing, so
    activity is scaled to the largest moving area seen recently."""

    STEP = 2                       # every 2nd pixel each way — plenty for "did it move"
    MIN_LEVELS = 6                 # real camera, still scene: 99 % of pixels change ≤ 6 gray levels
    SCENE_CHANGE = 0.6             # more than 60 % of the picture changed at once

    def __init__(self, threshold=0.6, lag=FPS, w=W, h=H, mode="thermal", mask=None):
        self.threshold, self.lag, self.w, self.h, self.mode = threshold, lag, w, h, mode
        mask = mask or (MASK if (w, h) == (W, H) else make_mask(w, h))
        step = self.STEP * max(1, w // W)
        self.ring = []
        self.idx = [y * w + x for y in range(0, h, step) for x in range(0, w, step) if mask[y * w + x]]
        self.xs = [i % w for i in self.idx]
        self.ys = [i // w for i in self.idx]
        self.last_moved = [-10 ** 9] * len(self.idx)   # frame number each sample point last changed
        self.frame_no = 0
        self.envelope = len(self.idx) / 20
        self.scene_changes = 0
        self.move_x = None

    def feed(self, frame):
        """(activity share 0..1 or None on a scene change, warm-body x or None)."""
        self.frame_no += 1
        vals = [frame[i] for i in self.idx]
        n = len(vals)
        mean = sum(vals) / n
        sd = math.sqrt(sum((v - mean) ** 2 for v in vals) / n) or 1.0
        # A change must beat both the frame's spread and the sensor noise
        # floor — on a flat, low-contrast scene the spread alone is tiny and
        # would turn noise into "movement".
        sd = max(sd, self.MIN_LEVELS / self.threshold)
        z = [(v - mean) / sd for v in vals]
        body_x, wx = None, []
        if self.mode == "thermal":
            # Warm-body centre: pixels well above the frame's average.
            wx = [self.xs[k] for k, v in enumerate(z) if v > 1.0]
            body_x = (sum(wx) / len(wx) / self.w) if len(wx) >= 8 else None
        self.ring.append(z)
        if len(self.ring) <= self.lag:
            return 0.0, body_x
        old = self.ring.pop(0)
        mid = self.ring[len(self.ring) // 2 - 1] if len(self.ring) >= 2 else old
        # Against 1 s ago AND 0.5 s ago: one lag alone is blind to a rhythm
        # whose period equals it (a 1 Hz nod looks identical 1 s later).
        thr = self.threshold
        moved_k = [k for k, (a, b, c) in enumerate(zip(z, old, mid)) if abs(a - b) > thr or abs(a - c) > thr]
        moved = len(moved_k)
        if moved > self.SCENE_CHANGE * n:
            self.scene_changes += 1
            self.ring = [z]
            return None, body_x
        for k in moved_k:
            self.last_moved[k] = self.frame_no
        self.move_x = (sum(self.xs[k] for k in moved_k) / moved / self.w) if moved >= 8 else None
        if self.mode == "thermal":
            # Share of the horse that moved, not of the frame: a horse far away
            # and one filling the frame read alike. The warm body is the pixels
            # well above the frame's average; with no body, use the frame.
            body = max(len(wx), n // 20)
        else:
            self.envelope = max(moved, self.envelope * 0.99995, n / 50)
            body = self.envelope
        return min(1.0, moved / body), body_x

    def moving_cells(self, bounds, cols, rows, within_frames):
        """Cells of a cols×rows grid over `bounds` (pixels) where something
        moved in the last `within_frames` frames — where the horse is."""
        x0, y0, x1, y1 = bounds
        out = set()
        cw, ch = (x1 - x0 + 1) / cols, (y1 - y0 + 1) / rows
        for k, fno in enumerate(self.last_moved):
            if self.frame_no - fno > within_frames:
                continue
            x, y = self.xs[k], self.ys[k]
            if x0 <= x <= x1 and y0 <= y <= y1:
                out.add(min(rows - 1, int((y - y0) / ch)) * cols + min(cols - 1, int((x - x0) / cw)))
        return out


class WindowAnalyzer:
    """Feed frames; call summary() at the end of each window.

    mode "thermal": the thermal stream (warm body = horse). mode "visible":
    the colour stream, which sees the whole stall — the thermal view with the
    25 mm lens is only ~1.5 × 1.2 m at 3.5 m, about one horse's head and neck."""

    STILL_FRAC = 0.02             # below this share of the body changing, the horse is "still"
    ACTIVE_FRAC = 0.5             # half the body changing within a second reads as activity 1.0
    WEAVE_MIN_STRENGTH = 0.5
    WEAVE_MIN_SWING = 0.06        # thermal: centroid must swing at least 6 % of the frame width
    WEAVE_MAX_CV = 0.25           # a weave keeps its beat: cycle-to-cycle gaps vary < 25 %
    WEAVE_BAND = (0.25, 2.0)      # no verified weaving frequency exists — search wide
    TOSS_BAND = (0.3, 2.0)
    WALK_BAND = (0.03, 0.15)      # a lap of the box every ~7–30 s
    POSTURE_EVERY = 5             # thermal blob posture at 2 samples/s

    def __init__(self, fs=FPS, w=W, h=H, mode="thermal", posture=None):
        self.fs, self.w, self.h, self.mode = fs, w, h, mode
        self.mask = MASK if (w, h) == (W, H) else make_mask(w, h)
        self.motion = MotionMeter(w=w, h=h, mode=mode, mask=self.mask)
        self.sway = SwayMeter(w, h, fs, mask=self.mask, step=2 * max(1, w // W))
        self.flank_sway = None
        self.flank_bounds = None
        self.posture = posture
        self.n_frames = 0
        self.reset()

    def reset(self):
        self.fracs, self.cx, self.mx, self.sx, self.sy, self.t0 = [], [], [], [], [], time.time()
        self.nostril, self.nref, self.glob, self.flank = [], [], [], []
        self.scene_changes = self.motion.scene_changes
        self.sway.paired()

    def feed(self, frame, nostril_bounds=None, flank_bounds=None, t=None):
        t = time.time() if t is None else t
        self.n_frames += 1
        frac, cx = self.motion.feed(frame)
        if frac is None:                                   # scene change: this frame says nothing
            self.sway.reset()
            return
        self.fracs.append(frac)
        self.cx.append(cx)
        self.mx.append(self.motion.move_x)
        sx, sy = self.sway.feed(frame)
        self.sx.append(sx)
        self.sy.append(sy)
        if nostril_bounds:
            self.nostril.append(box_mean(frame, nostril_bounds, self.w))
            self.nref.append(ring_mean(frame, nostril_bounds, ring_bounds(nostril_bounds, self.w, self.h), self.w))
            self.glob.append(sum(frame[i] for i in self.motion.idx[::7]) / len(self.motion.idx[::7]))
        if flank_bounds:
            if self.flank_sway is None or self.flank_bounds != flank_bounds:
                # A new region (re-aimed, or the horse moved): start a fresh
                # stretch — samples from two places must not be joined.
                self.flank_sway = SwayMeter(self.w, self.h, self.fs, bounds=flank_bounds, mean_s=8, step=1)
                self.flank_bounds, self.flank = flank_bounds, []
            self.flank.append(self.flank_sway.feed(frame)[1])
        elif self.flank:
            self.flank_bounds, self.flank = None, []
        if self.posture is not None and self.n_frames % self.POSTURE_EVERY == 0 and self.mode == "thermal":
            self.posture.feed(t, warm_blob_box(frame, self.w, self.h, self.mask), self.recent_motion())

    def recent_motion(self, seconds=2):
        k = int(self.fs * seconds)
        seg = self.fracs[-k:]
        return min(1.0, (sum(seg) / len(seg)) / self.ACTIVE_FRAC) if seg else 0.0

    def _rhythm(self, sig, band, min_strength):
        """(hz, strength, cycle-gap CV) of a rhythm in `band`, drift removed."""
        hp = highpass(sig, self.fs, 5)
        f, strength = periodicity(hp, self.fs, *band)
        cv = interval_cv(cycle_times(hp, self.fs, 1 / f)) if f else None
        if f and persistence(hp, self.fs, f) < 0.3:
            cv = max(cv or 0.0, 1.0)                  # does not keep its beat: not a regular rhythm
        return f, strength, cv, hp

    def summary(self, compute_resp_rate):
        n = len(self.fracs)
        out = {"frames": n, "seconds": n / self.fs if self.fs else 0,
               "scene_changes": self.motion.scene_changes - self.scene_changes}
        if n < self.fs * 10:
            return out
        mean_frac = sum(self.fracs) / n
        out["activity"] = min(1.0, mean_frac / self.ACTIVE_FRAC)
        out["motion_frac"] = mean_frac
        # Stillness in 5-second blocks: a block is still when almost nothing moved.
        block = int(self.fs * 5)
        still = sum(1 for i in range(0, n - block + 1, block)
                    if max(self.fracs[i:i + block]) < self.STILL_FRAC * 4 and sum(self.fracs[i:i + block]) / block < self.STILL_FRAC)
        out["inactive_min"] = still * 5 / 60
        moving = mean_frac >= self.STILL_FRAC
        # Weaving: a sustained, regular side-to-side sway. Thermal follows the
        # warm body's centre (and checks its size); colour follows the moving
        # mass's position (SwayMeter). Only meaningful when there is movement.
        if self.mode == "thermal":
            cx = [c for c in self.cx if c is not None]
            sig = cx if (len(cx) >= self.fs * 20 and len(cx) > 0.6 * n) else None
        else:
            sig = self.sx if n >= self.fs * 20 else None
        # Which way does the movement mostly go? A weave is mostly sideways,
        # a nod mostly up and down (paired +/− change along each axis).
        side, updown = self.sway.paired()
        side /= max(1, len(self.sway.ys))
        updown /= max(1, len(self.sway.xs))
        if moving and sig:
            f, strength, cv, hp = self._rhythm(sig, self.WEAVE_BAND, self.WEAVE_MIN_STRENGTH)
            regular = cv is not None and cv <= self.WEAVE_MAX_CV
            swing = None
            ok = bool(f and strength >= self.WEAVE_MIN_STRENGTH and regular and side >= updown)
            if self.mode == "thermal":
                srt = sorted(hp[int(self.fs * 2.5):-int(self.fs * 2.5)] or hp)
                swing = srt[int(len(srt) * 0.95)] - srt[int(len(srt) * 0.05)]
                ok = ok and swing >= self.WEAVE_MIN_SWING
            out["weave"] = {"hz": f, "strength": strength, "swing": swing, "cv": cv, "detected": ok}
        # Box walking: laps of the stall — a slow, large back-and-forth of
        # where the movement is, with the horse busy the whole time.
        pos = [c for c in (self.cx if self.mode == "thermal" else self.mx) if c is not None]
        if out["activity"] >= 0.3 and len(pos) >= 0.7 * n and n >= self.fs * 40:
            f, strength = periodicity(pos, self.fs, *self.WALK_BAND)
            srt = sorted(pos)
            span = srt[int(len(srt) * 0.95)] - srt[int(len(srt) * 0.05)]
            out["box_walk"] = {"hz": f, "strength": strength, "span": span,
                               "detected": bool(f and strength >= 0.5 and span >= 0.3)}
        # Head nodding/tossing: a REGULAR up-down rhythm while the horse stays
        # in one place (a walking horse nods with each stride). Irregular
        # tossing is left alone — that is discomfort or flies, not a vice.
        if moving and n >= self.fs * 20 and not (out.get("box_walk") or {}).get("detected"):
            f, strength, cv, _ = self._rhythm(self.sy, self.TOSS_BAND, 0.5)
            pos_span = 0.0
            if pos:
                srt = sorted(pos)
                pos_span = srt[int(len(srt) * 0.95)] - srt[int(len(srt) * 0.05)]
            out["head_toss"] = {"hz": f, "strength": strength, "cv": cv,
                                "detected": bool(f and strength >= 0.6 and cv is not None and cv <= self.WEAVE_MAX_CV
                                                 and pos_span < 0.15 and updown > side
                                                 and not (out.get("weave") or {}).get("detected"))}
        # Breathing from the nostril box, referenced to the skin around it
        # (cancels the palette re-ranging) and gated on head movement.
        pairs = [(a, b, g) for a, b, g in zip(self.nostril, self.nref, self.glob) if a is not None and b is not None]
        if len(pairs) >= self.fs * 15:
            sig = [a - b for a, b, _ in pairs]
            bad = bad_samples([b for _, b, _ in pairs], [g for _, _, g in pairs], self.fs)
            br = breath_analysis(sig, self.fs, compute_resp_rate, bad)
            br["swing"] = max(sig) - min(sig)
            out["breathing"] = br
        if len(self.flank) >= self.fs * 30:
            out["flank_breathing"] = breath_analysis(self.flank, self.fs, compute_resp_rate)
        if self.posture is not None:
            out["posture"] = self.posture.drain()
        return out


def clean_ffmpeg_error(err):
    """ffmpeg's complaint, safe to log and show: no credentials (the RTSP URL
    carries the camera password), no changing relay port, the last line only."""
    import re
    lines = [l.strip() for l in (err or "").splitlines() if l.strip()]
    text = lines[-1] if lines else ""
    text = re.sub(r"rtsp://[^@\s/]+@", "rtsp://", text)
    text = re.sub(r"127\.0\.0\.1:\d+", "camera", text)
    return text[-160:]


def local_relay(host, port, stop_evt):
    """A 127.0.0.1 TCP port that forwards to host:port, until stop_evt. ffmpeg
    cannot use an IPv6 zone (fe80::…%en8) in a URL; this lets it reach a
    camera on a direct cable. Returns the local port."""
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", 0))
    srv.listen(4)
    target = socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM)[0][4]
    family = socket.AF_INET6 if ":" in host else socket.AF_INET

    def pipe(a, b):
        try:
            while True:
                d = a.recv(65536)
                if not d:
                    break
                b.sendall(d)
        except OSError:
            pass
        finally:
            for x in (a, b):
                try:
                    x.close()
                except OSError:
                    pass

    def serve():
        while not stop_evt.is_set():
            try:
                srv.settimeout(1.0)
                c, _ = srv.accept()
            except OSError:
                continue
            r = socket.socket(family, socket.SOCK_STREAM)
            try:
                r.connect(target)
            except OSError:
                c.close()
                continue
            threading.Thread(target=pipe, args=(c, r), daemon=True).start()
            threading.Thread(target=pipe, args=(r, c), daemon=True).start()
        srv.close()

    threading.Thread(target=serve, daemon=True).start()
    return srv.getsockname()[1]


class VideoStream(threading.Thread):
    """ffmpeg reading one of the camera's sub-streams as small grey frames, to
    a callback. /media/live/202 is thermal, /media/live/102 the colour camera
    (found via ONVIF GetStreamUri on the demo unit). A local relay carries
    RTSP because ffmpeg cannot use an IPv6 zone (fe80::…%en8) in a URL."""

    def __init__(self, host, username, password, on_frame, port=554, path="/media/live/202", w=W, h=H):
        super().__init__(daemon=True, name=f"video:{host}{path}")
        self.host, self.port, self.path, self.w, self.h = host, port, path, w, h
        self.username, self.password, self.on_frame = username, password, on_frame
        self.stop_evt = threading.Event()
        self.proc = None
        self.error = None
        self.frames = 0

    def _relay(self):
        return local_relay(self.host, self.port, self.stop_evt)

    def run(self):
        while not self.stop_evt.is_set():
            port = self._relay()
            cred = f"{urllib.parse.quote(self.username)}:{urllib.parse.quote(self.password)}"
            url = f"rtsp://{cred}@127.0.0.1:{port}{self.path}"
            cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp", "-timeout", "8000000",
                   "-i", url, "-vf", f"fps={FPS},scale={self.w}:{self.h},format=gray", "-f", "rawvideo", "pipe:1"]
            try:
                self.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            except FileNotFoundError:
                self.error = "ffmpeg is not installed — install it to measure breathing and behaviour from video"
                return
            size = self.w * self.h
            while not self.stop_evt.is_set():
                chunk = self.proc.stdout.read(size)
                if not chunk or len(chunk) < size:
                    break
                self.frames += 1
                self.on_frame(chunk, time.time())
            if self.proc.poll() is None:
                self.proc.kill()
            err = clean_ffmpeg_error((self.proc.stderr.read() or b"").decode(errors="replace"))
            if not self.stop_evt.is_set():
                self.error = f"video {self.path} stopped: {err or 'stream ended'} — reconnecting"
                self.stop_evt.wait(5)

    def stop(self):
        self.stop_evt.set()
        if self.proc and self.proc.poll() is None:
            self.proc.kill()


ThermalStream = VideoStream


from floor import FloorTracker  # noqa: E402,F401  (urination / manure from the floor)


# --------------------------------------------------------------------------- #
# Is a horse there at all?
#
# Learned from a real stable recording (a mare-and-foal pen, 2 h 13 min): the
# pen was EMPTY for 87 of 133 minutes, and a movement-only rule counted 86 of
# those as "a horse at rest" — stillness is not rest when nobody is there. Nor
# can movement decide presence: a horse dozing or lying still moves as little
# as an empty pen. A thermal camera can do better: a horse is warm.
# --------------------------------------------------------------------------- #
PRESENT_CONTRAST_C = 2.5          # warmest cells vs coolest cells of the frame
PRESENT_EYE_C = 32.0              # the eye box's hottest pixel, if a horse is in it


def horse_present(grid_c, eye_max_c=None):
    """grid_c: °C over a coarse grid of the whole frame (None = no reading).
    Returns (present: bool | None, reason). None = cannot tell (no readings).

    Present when the frame holds a clearly warmer body than its background, or
    when the eye box reads like a living eye. The second rule covers a head
    filling the frame at stall distance (no background to contrast with); it
    will over-report in ambient heat above ~32 °C — noted, not solved."""
    vals = sorted(v for v in grid_c if v is not None)
    if len(vals) < 8 and eye_max_c is None:
        return None, "no temperature readings"
    if vals:
        hi = vals[int(0.95 * (len(vals) - 1))]
        lo = vals[int(0.10 * (len(vals) - 1))]
        if hi - lo >= PRESENT_CONTRAST_C:
            return True, f"warm body {hi:.1f} °C against {lo:.1f} °C"
    if eye_max_c is not None and eye_max_c >= PRESENT_EYE_C:
        return True, f"eye box {eye_max_c:.1f} °C"
    return False, "no warm body in view"
