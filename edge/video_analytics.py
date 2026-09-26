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
  activity   share of the stall that changed between frames (0..1)
  inactive   minutes of the window with (almost) no movement — stillness, which
             is NOT the same as lying down
  weaving    a sustained rhythmic side-to-side sway of the moving area
  breathing  the nostril box's brightness rhythm, through the same
             compute_resp_rate the pixel path uses (None when no rhythm)

Standard library only, so it runs on a bare Jetson image next to ffmpeg.
"""
import math
import socket
import subprocess
import threading
import time
import urllib.parse

W, H, FPS = 176, 144, 10

# Areas the camera paints over the image: the timestamp (top right), the
# colour scale (right edge) and the channel label (bottom left). Changes there
# are not the horse.
def overlay(x, y):
    return (x >= W * 0.88) or (y <= H * 0.10 and x >= W * 0.55) or (y >= H * 0.90 and x <= W * 0.30)


MASK = [not overlay(x, y) for y in range(H) for x in range(W)]


def box_px(box):
    """EquiCare box (0–10000) -> pixel bounds in the small frame."""
    fx = lambda v: max(0, min(W - 1, int(v / 10000 * W + 0.5)))
    fy = lambda v: max(0, min(H - 1, int(v / 10000 * H + 0.5)))
    return fx(box["x0"]), fy(box["y0"]), fx(box["x1"]), fy(box["y1"])


def box_mean(frame, bounds):
    x0, y0, x1, y1 = bounds
    s = n = 0
    for y in range(y0, y1 + 1):
        row = y * W
        for x in range(x0, x1 + 1):
            s += frame[row + x]
            n += 1
    return s / n if n else None


class MotionMeter:
    """Change against the frame from ~1 s earlier — frame-to-frame differences
    at 10 fps miss a horse shifting slowly. Robust to the palette's auto-range:
    each frame is normalised by its own mean and spread first, so a global
    brightness shift is not movement. Also reports where the warm body is
    (the centre of the frame's warmest pixels), for weaving."""

    STEP = 2                       # every 2nd pixel each way — plenty for "did it move"

    MIN_LEVELS = 6                 # real camera, still scene: 99 % of pixels change ≤ 6 gray levels

    def __init__(self, threshold=0.6, lag=FPS):
        self.threshold, self.lag = threshold, lag   # threshold in units of the frame's own spread
        self.ring = []
        self.idx = [y * W + x for y in range(0, H, self.STEP) for x in range(0, W, self.STEP) if MASK[y * W + x]]
        self.xs = [i % W for i in self.idx]

    def feed(self, frame):
        vals = [frame[i] for i in self.idx]
        n = len(vals)
        mean = sum(vals) / n
        sd = math.sqrt(sum((v - mean) ** 2 for v in vals) / n) or 1.0
        # A change must beat both the frame's spread and the sensor noise
        # floor — on a flat, low-contrast scene the spread alone is tiny and
        # would turn noise into "movement".
        sd = max(sd, self.MIN_LEVELS / self.threshold)
        z = [(v - mean) / sd for v in vals]
        # Warm-body centre: pixels well above the frame's average.
        wx = [self.xs[k] for k, v in enumerate(z) if v > 1.0]
        body_x = (sum(wx) / len(wx) / W) if len(wx) >= 8 else None
        self.ring.append(z)
        if len(self.ring) <= self.lag:
            return 0.0, body_x
        old = self.ring.pop(0)
        moved = sum(1 for a, b in zip(z, old) if abs(a - b) > self.threshold)
        # Share of the horse that moved, not of the frame: a horse far away
        # and one filling the frame read alike. The warm body is the pixels
        # well above the frame's average; with no body, use the frame.
        body = max(len(wx), n // 20)
        return min(1.0, moved / body), body_x


def periodicity(samples, fs, lo_hz, hi_hz, subharmonic=0.8):
    """Rhythm in a frequency band: (frequency, strength) or (None, 0). Takes
    the EARLIEST autocorrelation peak nearly as strong as the best one — a
    sway at 0.5 Hz also correlates at 0.25 Hz, and that later peak is its
    echo, not the rhythm (the same rule compute_resp_rate uses)."""
    n = len(samples)
    if n < fs * 10:
        return None, 0.0
    mean = sum(samples) / n
    x = [v - mean for v in samples]
    e = sum(v * v for v in x)
    if e <= 1e-9:
        return None, 0.0
    lo, hi = max(2, int(fs / hi_hz)), min(n - 2, int(fs / lo_hz))
    acf = {}
    for lag in range(max(1, lo - 1), min(n - 1, hi + 2)):
        acf[lag] = sum(x[i] * x[i + lag] for i in range(n - lag)) / (n - lag) / (e / n)
    peaks = [lag for lag in range(lo, hi + 1)
             if lag - 1 in acf and lag + 1 in acf and acf[lag] > acf[lag - 1] and acf[lag] >= acf[lag + 1]]
    if not peaks:
        return None, 0.0
    best = max(peaks, key=acf.get)
    for lag in peaks:
        if acf[lag] >= subharmonic * acf[best]:
            return fs / lag, acf[lag]
    return fs / best, acf[best]


class WindowAnalyzer:
    """Feed frames; call summary() at the end of each window."""

    STILL_FRAC = 0.02             # below this share of the body changing, the horse is "still"
    ACTIVE_FRAC = 0.5             # half the body changing within a second reads as activity 1.0
    WEAVE_MIN_STRENGTH = 0.5
    WEAVE_MIN_SWING = 0.06        # centroid must swing at least 6 % of the frame width

    def __init__(self, fs=FPS):
        self.fs = fs
        self.motion = MotionMeter()
        self.reset()

    def reset(self):
        self.fracs, self.cx, self.nostril, self.t0 = [], [], [], time.time()

    def feed(self, frame, nostril_bounds=None):
        frac, cx = self.motion.feed(frame)
        self.fracs.append(frac)
        self.cx.append(cx)
        if nostril_bounds:
            self.nostril.append(box_mean(frame, nostril_bounds))

    def summary(self, compute_resp_rate):
        n = len(self.fracs)
        out = {"frames": n, "seconds": n / self.fs if self.fs else 0}
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
        # Weaving: the warm body's horizontal centre swings rhythmically —
        # only meaningful when there is movement at all.
        cx = [c for c in self.cx if c is not None]
        if mean_frac >= self.STILL_FRAC and len(cx) >= self.fs * 20 and len(cx) > 0.6 * n:
            # Remove drift slower than ~5 s (walking about, turning) so only
            # a sway in the weaving band is left.
            half = int(self.fs * 2.5)
            hp = []
            for i in range(len(cx)):
                seg = cx[max(0, i - half):i + half + 1]
                hp.append(cx[i] - sum(seg) / len(seg))
            hp = hp[half:-half] or hp
            f, strength = periodicity(hp, self.fs, 0.2, 1.5)
            srt = sorted(hp)
            swing = srt[int(len(srt) * 0.95)] - srt[int(len(srt) * 0.05)]
            out["weave"] = {"hz": f, "strength": strength, "swing": swing,
                            "detected": bool(f and strength >= self.WEAVE_MIN_STRENGTH and swing >= self.WEAVE_MIN_SWING)}
        # Breathing from the nostril box's brightness.
        nos = [v for v in self.nostril if v is not None]
        if len(nos) >= self.fs * 15:
            rr, q = compute_resp_rate(nos, self.fs, with_quality=True)
            out["breathing"] = {"bpm": rr, "strength": q,
                                "swing": max(nos) - min(nos)}
        return out


class ThermalStream(threading.Thread):
    """ffmpeg reading the camera's thermal sub-stream, frames to a callback.
    A local relay carries RTSP because ffmpeg cannot use an IPv6 zone
    (fe80::…%en8) in a URL; for IPv4 cameras it connects directly."""

    def __init__(self, host, username, password, on_frame, port=554, path="/media/live/202"):
        super().__init__(daemon=True, name=f"thermal-video:{host}")
        self.host, self.port, self.path = host, port, path
        self.username, self.password, self.on_frame = username, password, on_frame
        self.stop_evt = threading.Event()
        self.proc = None
        self.error = None
        self.frames = 0

    def _relay(self):
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind(("127.0.0.1", 0))
        srv.listen(4)
        target = socket.getaddrinfo(self.host, self.port, 0, socket.SOCK_STREAM)[0][4]
        family = socket.AF_INET6 if ":" in self.host else socket.AF_INET

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
                for s in (a, b):
                    try:
                        s.close()
                    except OSError:
                        pass

        def serve():
            while not self.stop_evt.is_set():
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

    def run(self):
        while not self.stop_evt.is_set():
            port = self._relay()
            cred = f"{urllib.parse.quote(self.username)}:{urllib.parse.quote(self.password)}"
            url = f"rtsp://{cred}@127.0.0.1:{port}{self.path}"
            cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp", "-timeout", "8000000",
                   "-i", url, "-vf", f"fps={FPS},scale={W}:{H},format=gray", "-f", "rawvideo", "pipe:1"]
            try:
                self.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            except FileNotFoundError:
                self.error = "ffmpeg is not installed — install it to measure breathing and behaviour from video"
                return
            size = W * H
            while not self.stop_evt.is_set():
                chunk = self.proc.stdout.read(size)
                if not chunk or len(chunk) < size:
                    break
                self.frames += 1
                self.on_frame(chunk, time.time())
            if self.proc.poll() is None:
                self.proc.kill()
            err = (self.proc.stderr.read() or b"").decode(errors="replace").strip()
            if not self.stop_evt.is_set():
                self.error = f"thermal video stopped: {err[-200:] or 'stream ended'} — reconnecting"
                self.stop_evt.wait(5)

    def stop(self):
        self.stop_evt.set()
        if self.proc and self.proc.poll() is None:
            self.proc.kill()


class FloorWatcher:
    """Urination and excretion from the floor box, in real °C (pixel reads).

    Fresh urine and manure leave the body at ~37 °C, far above a stall floor.
    Each scan compares every floor cell with its own slow baseline; a warm
    patch that appears and persists is an event. It is classified when it
    fades: urine spreads wide and cools within minutes; a manure pile is
    compact and stays warm much longer. A prototype heuristic — thresholds are
    starting points to be tuned on real stalls."""

    WARM_ABOVE = 3.0              # °C above the cell's baseline
    MIN_CELLS = 2                 # warm cells needed to call it a patch
    CONFIRM_SCANS = 2
    URINE_MAX_MIN = 6.0           # fades faster than this -> urine
    MANURE_MAX_AREA = 0.06        # share of the floor box; compact -> manure

    def __init__(self, cols=12, rows=8):
        self.cols, self.rows = cols, rows
        self.base = None
        self.event = None
        self.confirm = 0

    def grid(self, box):
        pts = []
        for j in range(self.rows):
            for i in range(self.cols):
                pts.append({"x": box["x0"] + (box["x1"] - box["x0"]) * (i + 0.5) / self.cols,
                            "y": box["y0"] + (box["y1"] - box["y0"]) * (j + 0.5) / self.rows})
        return pts

    def scan(self, temps, now=None):
        """temps: °C per cell (None = no reading). Returns a finished event or None."""
        now = now or time.time()
        if self.base is None:
            self.base = [t for t in temps]
            return None
        warm = [i for i, (t, b) in enumerate(zip(temps, self.base))
                if t is not None and b is not None and t - b >= self.WARM_ABOVE]
        area = len(warm) / len(temps)
        done = None
        if len(warm) >= self.MIN_CELLS:
            self.confirm += 1
            if self.confirm >= self.CONFIRM_SCANS:
                if self.event is None:
                    self.event = {"start": now, "peak_area": area, "peak_c": max(temps[i] for i in warm)}
                else:
                    self.event["peak_area"] = max(self.event["peak_area"], area)
                    self.event["peak_c"] = max(self.event["peak_c"], max(temps[i] for i in warm))
        else:
            self.confirm = 0
            if self.event is not None:
                dur = (now - self.event["start"]) / 60
                # How fast it cooled decides; the patch size is kept as a second
                # opinion (wide + quick = urine, compact + slow = manure).
                kind = "urination" if dur < self.URINE_MAX_MIN else "excretion"
                shape_agrees = (self.event["peak_area"] > self.MANURE_MAX_AREA) == (kind == "urination")
                done = {**self.event, "minutes_warm": dur, "kind": kind, "shape_agrees": shape_agrees}
                self.event = None
        # Baselines follow the floor slowly, but not while something warm is on it.
        for i, t in enumerate(temps):
            if t is None:
                continue
            if self.base[i] is None:
                self.base[i] = t
            elif i not in warm:
                self.base[i] += 0.05 * (t - self.base[i])
        return done
