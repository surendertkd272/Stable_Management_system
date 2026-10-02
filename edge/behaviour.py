"""Behaviour building blocks used by video_analytics.py — all standard library.

  periodicity()     a rhythm in a frequency band (autocorrelation)
  SwayMeter         side-to-side and up-down movement of whatever moves in a
                    region, from any grey video (thermal or colour)
  breath_analysis() breathing rate with the checks the research asks for
  warm_blob_box()   the box around the warm body in a thermal frame
  PostureTracker    standing / lying / lying down / getting up from a box over time

Everything here is a prototype heuristic: methods from published work
(sources in the docstrings), thresholds ours until labelled footage from our
own stalls says otherwise.
"""
import math


# --------------------------------------------------------------------------- #
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
    pick = next((lag for lag in peaks if acf[lag] >= subharmonic * acf[best]), best)
    # Parabolic interpolation between lags: at 10 frames/s whole lags alone
    # would read 72 breaths/min as 75.
    a, b, c = acf[pick - 1], acf[pick], acf[pick + 1]
    den = a - 2 * b + c
    frac = 0.5 * (a - c) / den if den < 0 else 0.0
    return fs / (pick + max(-0.5, min(0.5, frac))), acf[pick]


def persistence(samples, fs, hz, beats=(2, 3)):
    """Autocorrelation 2 and 3 beats later: a real rhythm keeps its beat, a
    jumble of sways at different speeds decorrelates. Returns the minimum."""
    n = len(samples)
    mean = sum(samples) / n
    x = [v - mean for v in samples]
    e = sum(v * v for v in x) / n or 1e-9
    vals = []
    for k in beats:
        lag = int(round(k * fs / hz))
        if lag >= n - fs:
            continue
        vals.append(sum(x[i] * x[i + lag] for i in range(n - lag)) / (n - lag) / e)
    return min(vals) if vals else 0.0


def highpass(x, fs, seconds):
    """Remove drift slower than ~`seconds` (centred moving average)."""
    half = max(1, int(fs * seconds / 2))
    out = []
    for i in range(len(x)):
        seg = x[max(0, i - half):i + half + 1]
        out.append(x[i] - sum(seg) / len(seg))
    return out


def smooth(x, k):
    if k <= 1:
        return list(x)
    half = k // 2
    return [sum(x[max(0, i - half):i + half + 1]) / len(x[max(0, i - half):i + half + 1]) for i in range(len(x))]


def cycle_times(x, fs, period_s):
    """Times (s) of the peaks of a rhythm whose period is ~period_s: local
    maxima of the smoothed signal, at least 0.6 periods apart, above the
    signal's middle."""
    if not x or not period_s:
        return []
    y = smooth(x, max(1, int(fs * period_s / 4)))
    mid = sorted(y)[len(y) // 2]
    min_gap = 0.6 * period_s * fs
    peaks = []
    for i in range(1, len(y) - 1):
        if y[i] > y[i - 1] and y[i] >= y[i + 1] and y[i] > mid:
            if peaks and i - peaks[-1] < min_gap:
                if y[i] > y[peaks[-1]]:
                    peaks[-1] = i
                continue
            peaks.append(i)
    return [p / fs for p in peaks]


def interval_cv(times):
    """Coefficient of variation of the gaps between cycles (0 = metronome)."""
    gaps = [b - a for a, b in zip(times, times[1:])]
    if len(gaps) < 2:
        return None
    m = sum(gaps) / len(gaps)
    if m <= 0:
        return None
    return math.sqrt(sum((g - m) ** 2 for g in gaps) / len(gaps)) / m


# --------------------------------------------------------------------------- #
class SwayMeter:
    """Side-to-side (x) and up-down (y) movement of what moves in a region.

    The first moment of (current column profile − its mean over the last few
    seconds) is proportional to how far the moving mass sits from its recent
    average position: sum_x x·(p_t − p̄) = mass·(x_t − x̄). Works on colour
    video, where "warm" means nothing, and ignores the static background,
    whose profile cancels. The sign and scale depend on contrast, so only the
    rhythm is used, not the size."""

    def __init__(self, w, h, fs, bounds=None, mean_s=5.0, step=2, mask=None):
        self.w, self.h, self.step = w, h, step
        x0, y0, x1, y1 = bounds or (0, 0, w - 1, h - 1)
        self.xs = list(range(x0, x1 + 1, step))
        self.ys = list(range(y0, y1 + 1, step))
        self.mask = mask
        self.keep = int(max(2, fs * mean_s))
        self.ring, self.sum_c, self.sum_r = [], None, None
        self.pair = [0.0, 0.0]
        self._np = None
        try:                                          # the per-pixel sums with numpy: the same whole numbers
            import numpy as np
            m = None if mask is None else np.array([[1 if mask[y * w + x] else 0 for x in self.xs] for y in self.ys], dtype=np.int64)
            self._np = (np, np.array(self.ys), np.array(self.xs), m)
        except ImportError:
            pass

    def feed(self, frame):
        w, mask = self.w, self.mask
        if self._np is not None:
            np, ys, xs, m = self._np
            sub = np.frombuffer(frame, dtype=np.uint8).reshape(-1, w)[np.ix_(ys, xs)].astype(np.int64)
            if m is not None:
                sub = sub * m
            cols = [float(v) for v in sub.sum(axis=0).tolist()]
            rows = [float(v) for v in sub.sum(axis=1).tolist()]
        else:
            cols = [0.0] * len(self.xs)
            rows = [0.0] * len(self.ys)
            for j, y in enumerate(self.ys):
                base = y * w
                acc = 0.0
                for i, x in enumerate(self.xs):
                    v = frame[base + x] if (mask is None or mask[base + x]) else 0
                    cols[i] += v
                    acc += v
                rows[j] = acc
        if self.sum_c is None:
            self.sum_c, self.sum_r = [0.0] * len(cols), [0.0] * len(rows)
        self.ring.append((cols, rows))
        for i, v in enumerate(cols):
            self.sum_c[i] += v
        for j, v in enumerate(rows):
            self.sum_r[j] += v
        if len(self.ring) > self.keep:
            oc, orr = self.ring.pop(0)
            for i, v in enumerate(oc):
                self.sum_c[i] -= v
            for j, v in enumerate(orr):
                self.sum_r[j] -= v
        n = len(self.ring)
        rc = [v - self.sum_c[i] / n for i, v in enumerate(cols)]
        rr = [v - self.sum_r[j] / n for j, v in enumerate(rows)]
        # Movement along an axis leaves a +/− pair in that axis's profile (the
        # leading edge gains, the trailing edge loses); a brightness change
        # (a head passing in front of the body) leaves one sign. Keep score.
        for res, k in ((rc, 0), (rr, 1)):
            tot = sum(abs(v) for v in res)
            self.pair[k] += tot - abs(sum(res))
        mx = sum(i * v for i, v in enumerate(rc)) / max(1, len(self.ys))
        my = sum(j * v for j, v in enumerate(rr)) / max(1, len(self.xs))
        return mx, my

    def paired(self):
        """(sideways, up-down) paired change since the last call — how much of
        the movement was real displacement along each axis."""
        out = tuple(self.pair)
        self.pair = [0.0, 0.0]
        return out

    def reset(self):
        self.ring, self.sum_c, self.sum_r = [], None, None


# --------------------------------------------------------------------------- #
# Breathing. Published thermal/visible respiration work (calves, pigs, sheep,
# humans) agrees on: a tracked region's MEAN (never a sum), a band-pass, windows
# of 30–60 s, a signal-quality check, motion gating, and reporting nothing when
# quality is low. Horses rest at 8–16 breaths/min but pant at 60–120 in heat
# stress, which a 6–36 bpm search would fold down to a normal-looking rate.
BREATH_MIN_S = 30.0


def bad_samples(ref, glob, fs):
    """Samples to drop: where the region around the nostril or the whole frame
    jumps — a head movement or the palette re-ranging. ±1 s around each jump."""
    n = len(ref)
    bad = [False] * n

    def jumps(sig):
        d = [abs(b - a) for a, b in zip(sig, sig[1:])]
        if not d:
            return []
        med = sorted(d)[len(d) // 2] or 1e-6
        return [i + 1 for i, v in enumerate(d) if v > 6 * med and v > 0.5]

    pad = int(fs)
    for sig in (ref, glob):
        if sig and len(sig) == n:
            for i in jumps(sig):
                for k in range(max(0, i - pad), min(n, i + pad + 1)):
                    bad[k] = True
    return bad


def longest_run(bad):
    best, start = (0, 0), None
    for i, b in enumerate(bad + [True]):
        if not b and start is None:
            start = i
        elif b and start is not None:
            if i - start > best[1] - best[0]:
                best = (start, i)
            start = None
    return best


def breath_analysis(signal, fs, compute_resp_rate, bad=None):
    """{bpm, strength, regularity, intervalCv, band, seconds} or {bpm: None, reason}."""
    if bad is None:
        bad = [False] * len(signal)
    a, b = longest_run(bad)
    seg = signal[a:b]
    secs = len(seg) / fs if fs else 0
    if secs < BREATH_MIN_S:
        return {"bpm": None, "reason": "head moving — no 30 s still stretch", "seconds": round(secs, 1)}
    rr, q = compute_resp_rate(seg, fs, with_quality=True)
    x = highpass(seg, fs, 12)
    f_hi, s_hi = periodicity(x, fs, 0.6, 2.0)
    band, rate, strength = "rest", rr, q
    if f_hi and s_hi >= 0.5 and (rr is None or any(abs(rr * k - f_hi * 60) <= 0.1 * f_hi * 60 for k in (2, 3, 4))):
        band, rate, strength = "fast", f_hi * 60, s_hi
    if not rate:
        return {"bpm": None, "reason": "no clear breathing rhythm", "seconds": round(secs, 1)}
    times = cycle_times(x, fs, 60.0 / rate)
    if len(times) >= 3:
        counted = 60.0 * (len(times) - 1) / (times[-1] - times[0])
    else:
        counted = None
    if counted is None or abs(counted - rate) > max(2.0, 0.15 * rate):
        return {"bpm": None, "reason": "rate and breath count disagree", "seconds": round(secs, 1),
                "acfBpm": round(rate, 1), "countBpm": round(counted, 1) if counted else None}
    cv = interval_cv(times)
    reg = None if cv is None else max(0.0, min(1.0, 1 - 2 * cv))
    return {"bpm": rate, "strength": strength, "regularity": reg, "intervalCv": cv, "band": band,
            "seconds": round(secs, 1), "countBpm": round(counted, 1)}


# --------------------------------------------------------------------------- #
def warm_blob_box(frame, w, h, mask=None, step=2, z=1.0):
    """Box (0..1 of the frame) around the largest warm connected area of a
    thermal frame, with its area share and how many frame edges it touches.
    None when there is no clear warm body."""
    gw, gh = (w + step - 1) // step, (h + step - 1) // step
    vals = []
    for gy in range(gh):
        for gx in range(gw):
            i = gy * step * w + gx * step
            vals.append(frame[i] if (mask is None or mask[i]) else None)
    got = [v for v in vals if v is not None]
    if len(got) < 20:
        return None
    m = sum(got) / len(got)
    sd = math.sqrt(sum((v - m) ** 2 for v in got) / len(got)) or 1.0
    if sd < 4:                                   # flat scene — no body to find
        return None
    thr = m + z * sd
    hot = [v is not None and v > thr for v in vals]
    seen = [False] * len(hot)
    best = None
    for s in range(len(hot)):
        if not hot[s] or seen[s]:
            continue
        stack, cells = [s], []
        seen[s] = True
        while stack:
            c = stack.pop()
            cells.append(c)
            cx, cy = c % gw, c // gw
            for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                if 0 <= nx < gw and 0 <= ny < gh:
                    k = ny * gw + nx
                    if hot[k] and not seen[k]:
                        seen[k] = True
                        stack.append(k)
        if best is None or len(cells) > len(best):
            best = cells
    if not best or len(best) < 0.01 * gw * gh:
        return None
    xs = [c % gw for c in best]
    ys = [c // gw for c in best]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    edges = (x0 == 0) + (y0 == 0) + (x1 == gw - 1) + (y1 == gh - 1)
    return {"x0": x0 / gw, "y0": y0 / gh, "x1": (x1 + 1) / gw, "y1": (y1 + 1) / gh,
            "area": len(best) / (gw * gh), "edges": edges}


# --------------------------------------------------------------------------- #
class PostureTracker:
    """Standing vs lying from the horse's box over time, learned per stall.

    Dairy research timed lying down / getting up from a detector box's height,
    width/height and centre over time (Adriaens et al. 2022: 92 % of get-ups,
    80–87 % of lie-downs). A fixed "lying is shorter than X" cannot work: box
    size depends on where the camera hangs and on the horse. So each stall
    learns its own two heights (standing, lying) from its own data; until both
    have been seen it reports "learning" rather than guessing.

    Also, prototype rules of ours (no published thresholds exist):
      possible flat on side — lying, box longer and lower than this horse's
        usual lying box, or the detector lost a lying horse without it walking
        off (open-photo test: YOLOX found 13/14 chest-lying horses, 0/4 flat
        on the side);
      possible roll        — lying, a burst of movement with the box's height
        swinging;
      possible cast        — lying 10+ min with 3+ bursts of struggling and no
        getting up."""

    MIN_BOUT_S = 30.0
    # Lying: a box at least 40 % lower than standing at the same spot. 25 %
    # was not enough: on 1 Oct's stall recording a horse that only stood and
    # ate learned 'lying' from his head lowered to the hay (~25 % lower) and
    # from standing at the back of the stall (further away looks smaller) —
    # 93 % 'lying' and nine 'possible rolls'. Hence also the depth correction
    # (_ref): his box is compared with his standing height at that spot.
    SEPARATION = 0.40
    LEARN_EVERY = 120
    HISTORY = 20000
    LOST_LATERAL_S = 30.0

    def __init__(self, state=None):
        st = state or {}
        self.hist = list(st.get("hist", []))[-self.HISTORY:]     # [height, aspect, box bottom y]
        self.model = st.get("model")                             # {split, stand_h, lie_h, lie_ar}
        self.state = st.get("posture")                           # "standing" | "lying" | None
        self.cand, self.cand_t = None, None
        self.recent = []                                         # (t, h, ar, motion)
        self.since_learn = 0
        self.last_t = None
        self.lying_since = None
        self.lost_since = None
        self.bursts = []
        self.last_roll = self.last_cast = -1e18
        self.drain()

    # -- persistence ------------------------------------------------------- #
    def to_state(self):
        return {"hist": self.hist[-self.HISTORY:], "model": self.model, "posture": self.state}

    def drain(self):
        """Per-window totals, then start a new window."""
        out = getattr(self, "acc", None)
        self.acc = {"observed_s": 0.0, "lying_s": 0.0, "lateral_s": 0.0, "events": []}
        return out

    # -- learning ---------------------------------------------------------- #
    def _ref(self):
        """Standing height by depth in the stall: (a, b) for h ≈ a + b·y (y the
        box's bottom, the hooves), from the upper quartile of heights in six
        bands of y — a horse further back looks smaller. None when he stood at
        about one depth (no correction needed) or the fit makes no sense."""
        pts = sorted((e[2], e[0]) for e in self.hist if len(e) >= 3 and e[2] is not None)
        if len(pts) < 200:
            return None
        size = len(pts) // 6
        xs, ys = [], []
        for i in range(6):
            seg = pts[i * size:(i + 1) * size] if i < 5 else pts[i * size:]
            if len(seg) >= 20:
                hs = sorted(h for _, h in seg)
                xs.append(sum(y for y, _ in seg) / len(seg))
                ys.append(hs[int(0.75 * (len(hs) - 1))])
        if len(xs) < 3 or max(xs) - min(xs) < 0.08:
            return None
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        sxx = sum((x - mx) ** 2 for x in xs)
        b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx if sxx else 0.0
        a = my - b * mx
        if b <= 0 or a + b * min(xs) <= 0.05:
            return None                                       # nearer must look bigger
        return [round(a, 4), round(b, 4)]

    @staticmethod
    def _norm(h, y, ref):
        """A box height as a share of his standing height at that depth."""
        if not ref or y is None:
            return h
        r = ref[0] + ref[1] * y
        return h / r if r > 0.05 else h

    def learn_labelled(self, lying, standing):
        """This stall's model from boxes a person has labelled — lying ones
        (a stretch seen lying on the recording) and standing ones — where the
        view does not separate them by itself (2 Oct: lying at the front of
        the stall facing the camera is about as tall as standing there with
        the legs out of the picture). The depth correction comes from the
        standing boxes only, so lying cannot pass for 'standing height'. A
        labelled model is kept: learn() does not replace it."""
        if len(lying) < 30 or len(standing) < 200:
            return None
        keep_hist = self.hist
        self.hist = [list(e) for e in standing]
        ref = self._ref()
        self.hist = keep_hist
        norm = lambda e: self._norm(e[0], e[2] if len(e) >= 3 else None, ref)  # noqa: E731
        lh = sorted(norm(e) for e in lying)
        sh = sorted(norm(e) for e in standing)
        lie_h, stand_h = lh[len(lh) // 2], sh[len(sh) // 2]
        if stand_h <= 0 or lie_h >= stand_h:
            return None
        # The split: where lying and standing heights are told apart best (the
        # fewest labelled boxes on the wrong side).
        cands = sorted(set(round(v, 3) for v in lh + sh))
        split = min(cands, key=lambda c: sum(v >= c for v in lh) / len(lh) + sum(v < c for v in sh) / len(sh))
        ars = sorted(e[1] for e in lying)
        self.model = {"split": split, "stand_h": stand_h, "lie_h": lie_h, "lie_ar": ars[len(ars) // 2], "ref": ref, "labelled": True,
                      "agreement": round(1 - (sum(v >= split for v in lh) / len(lh) + sum(v < split for v in sh) / len(sh)) / 2, 3)}
        return self.model

    def learn(self):
        if self.model and self.model.get("labelled"):
            return                                            # a person-labelled model stands
        ref = self._ref()
        rows = [e for e in self.hist if not ref or (len(e) >= 3 and e[2] is not None)]
        hs = [self._norm(e[0], e[2] if len(e) >= 3 else None, ref) for e in rows]
        if len(hs) < 200:
            return
        lo, hi = min(hs), max(hs)
        c = [lo, hi]
        for _ in range(20):                                     # 1-D two-means on height
            groups = ([], [])
            for h in hs:
                groups[0 if abs(h - c[0]) <= abs(h - c[1]) else 1].append(h)
            if not groups[0] or not groups[1]:
                return
            c = [sum(g) / len(g) for g in groups]
        lie_h, stand_h = sorted(c)
        small = [e[1] for e, h in zip(rows, hs) if abs(h - lie_h) < abs(h - stand_h)]
        big = [e[1] for e, h in zip(rows, hs) if abs(h - lie_h) >= abs(h - stand_h)]
        share = len(small) / len(hs)
        if stand_h <= 0 or (stand_h - lie_h) / stand_h < self.SEPARATION or not (0.03 <= share <= 0.97):
            self.model = None                                   # one posture only so far
            return
        lie_ar = sorted(small)[len(small) // 2]
        stand_ar = sorted(big)[len(big) // 2]
        if lie_ar <= stand_ar:                                  # lying must also be wider/lower
            self.model = None
            return
        self.model = {"split": (lie_h + stand_h) / 2, "stand_h": stand_h, "lie_h": lie_h, "lie_ar": lie_ar, "ref": ref}

    # -- per sample --------------------------------------------------------- #
    def feed(self, t, box, motion=0.0):
        """box: {x0,y0,x1,y1} 0..1 (None = no horse box this sample)."""
        dt = 0.0 if self.last_t is None else max(0.0, min(5.0, t - self.last_t))
        self.last_t = t
        if box is None or box.get("edges", 0) >= 3:
            # A box touching 3 edges is a head filling the view, not a posture.
            self._lost(t, dt, motion)
            return
        self.lost_since = None
        hgt = box["y1"] - box["y0"]
        wid = box["x1"] - box["x0"]
        if hgt <= 0:
            return
        ar = wid / hgt
        self.hist.append([round(hgt, 4), round(ar, 3), round(box["y1"], 4)])
        if len(self.hist) > self.HISTORY:
            del self.hist[: len(self.hist) - self.HISTORY]
        self.since_learn += 1
        if self.model is None or self.since_learn >= self.LEARN_EVERY:
            self.since_learn = 0
            self.learn()
        self.recent.append((t, hgt, ar, motion, box["y1"]))
        self.recent = [r for r in self.recent if t - r[0] <= 12]
        self.acc["observed_s"] += dt
        if self.model is None:
            return
        ref = self.model.get("ref")
        med_h = sorted(self._norm(r[1], r[4], ref) for r in self.recent[-5:])[len(self.recent[-5:]) // 2]
        med_ar = sorted(r[2] for r in self.recent[-5:])[len(self.recent[-5:]) // 2]
        now = "lying" if med_h < self.model["split"] else "standing"
        self._advance(t, now)
        if self.state == "lying":
            self.acc["lying_s"] += dt
            if med_ar >= self.model["lie_ar"] * 1.2 and med_h <= self.model["lie_h"] * 0.9:
                self.acc["lateral_s"] += dt
            self._lying_checks(t, motion)

    def _lost(self, t, dt, motion):
        if self.state == "lying":
            if self.lost_since is None:
                self.lost_since = t
            # Lost while lying and not after a burst of walking: the detector
            # tends to lose a horse lying flat on its side.
            if t - self.lost_since >= self.LOST_LATERAL_S:
                self.acc["lying_s"] += dt
                self.acc["lateral_s"] += dt
                self.acc["observed_s"] += dt
                self._lying_checks(t, motion)

    def _advance(self, t, now):
        if self.state is None:
            self.state = now
            if now == "lying":
                self.lying_since = t
            return
        if now == self.state:
            self.cand, self.cand_t = None, None
            return
        if self.cand != now:
            self.cand, self.cand_t = now, t
            return
        if t - self.cand_t >= self.MIN_BOUT_S:
            kind = "lie_down" if now == "lying" else "get_up"
            # The change began at cand_t: back-date the lying time to it.
            if now == "lying":
                self.acc["lying_s"] += t - self.cand_t
            else:
                self.acc["lying_s"] = max(0.0, self.acc["lying_s"] - (t - self.cand_t))
            self.acc["events"].append({"t": self.cand_t, "kind": kind})
            self.state, self.cand = now, None
            self.lying_since = self.cand_t if now == "lying" else None
            self.bursts = []

    def _lying_checks(self, t, motion):
        if motion >= 0.4:
            if not self.bursts or t - self.bursts[-1][1] > 5:
                self.bursts.append([t, t])
            else:
                self.bursts[-1][1] = t
        self.bursts = [b for b in self.bursts if t - b[0] <= 600]
        hs = [r[1] for r in self.recent if t - r[0] <= 10]
        if len(hs) >= 4 and motion >= 0.4:
            m = sum(hs) / len(hs)
            sd = math.sqrt(sum((v - m) ** 2 for v in hs) / len(hs))
            if m > 0 and sd / m >= 0.15 and t - self.last_roll >= 60:
                self.last_roll = t
                self.acc["events"].append({"t": t, "kind": "possible_roll"})
        long_bursts = [b for b in self.bursts if b[1] - b[0] >= 5]
        if (self.lying_since is not None and t - self.lying_since >= 600 and len(long_bursts) >= 3
                and t - self.last_cast >= 1800):
            self.last_cast = t
            self.acc["events"].append({"t": t, "kind": "possible_cast"})


# --------------------------------------------------------------------------- #
# Eye temperature wherever the head is. With one camera the thermal view is
# aimed where the head spends most time (hay net, door), but the head moves.
# The inner corner of the eye is normally the warmest spot on a horse's head,
# so when the fixed eye box misses, the view is searched for an eye.
#
# Warmth alone does not find it: in a warm stall the coat of a horse facing
# away reads 33–34 °C, the same as its eye (Badal, 27 Sep: 33.0–34.4 °C while
# he faced away, 33.0–34.6 °C with his face in view). The shape does — an eye is a small hot spot with
# cooler skin all round it; the coat is a broad warm area and a skin fold a
# warm line, and both run out of a small window around their hottest point.
EYE_MIN_C, EYE_MAX_C = 33.0, 41.0      # a living eye; hotter is a lamp or the sun
EYE_HOT_C = 0.7                        # within this of the peak: part of the same hot spot
EYE_RING_C = 1.0                       # the skin round an eye is at least this much cooler
EYE_MAX_SHARE = 0.12                   # an eye covers little of the window around it


def hotspot_candidates(vals, cols, rows, n=3):
    """Up to n (col, row, °C), hottest first, of the readings on a cols×rows
    grid that could be an eye on a head: 33–41 °C, not on the frame edge, with
    warm body around them, and not next to one already chosen."""
    cands = []
    for k, v in enumerate(vals):
        if v is None or not (EYE_MIN_C <= v <= EYE_MAX_C):
            continue
        c, r = k % cols, k // cols
        if c in (0, cols - 1) or r in (0, rows - 1):
            continue                                        # partly out of view
        around = [vals[(r + dy) * cols + (c + dx)] for dx in (-1, 0, 1) for dy in (-1, 0, 1) if dx or dy]
        warm = sum(1 for a in around if a is not None and a >= v - 6)
        if warm < 4:
            continue                                        # an isolated hot dot, not a head
        cands.append((c, r, v))
    out = []
    for c, r, v in sorted(cands, key=lambda x: -x[2]):
        if all(max(abs(c - oc), abs(r - orow)) > 1 for oc, orow, _ in out):
            out.append((c, r, v))
        if len(out) == n:
            break
    return out


def pick_hotspot(vals, cols, rows):
    """(col, row, °C) of the hottest reading that could be an eye on a head
    (see hotspot_candidates), or None."""
    c = hotspot_candidates(vals, cols, rows, 1)
    return c[0] if c else None


def eye_spot(vals, cols, rows):
    """(°C, None) when the hottest reading on this grid (a small window of
    pixel reads, row by row) is eye-shaped, else (None, why not)."""
    pts = [(k, v) for k, v in enumerate(vals) if v is not None]
    if len(pts) < 0.5 * cols * rows:
        return None, "too few pixel readings"
    k, peak = max(pts, key=lambda p: p[1])
    if not (EYE_MIN_C <= peak <= EYE_MAX_C):
        return None, f"nothing eye-warm (hottest {peak:.1f} °C, an eye reads 33–41)"
    spot, todo = {k}, [k]                                   # the hot spot: joined to the peak, within EYE_HOT_C
    while todo:
        i = todo.pop()
        c, r = i % cols, i // cols
        for dc in (-1, 0, 1):
            for dr in (-1, 0, 1):
                cc, rr = c + dc, r + dr
                j = rr * cols + cc
                if (0 <= cc < cols and 0 <= rr < rows and j not in spot
                        and vals[j] is not None and vals[j] >= peak - EYE_HOT_C):
                    spot.add(j)
                    todo.append(j)
    edge = lambda i: i % cols in (0, cols - 1) or i // cols in (0, rows - 1)  # noqa: E731
    if any(edge(i) for i in spot):
        return None, "the warm area runs on past the eye window (coat or a skin fold)"
    if len(spot) > max(9, EYE_MAX_SHARE * cols * rows):     # up to 3×3: a close eye spans a few reads
        return None, "a broad warm area (coat), not a small hot spot"
    ring = sorted(vals[i] for i in range(cols * rows) if edge(i) and vals[i] is not None)
    if not ring or ring[len(ring) // 2] > peak - EYE_RING_C:
        return None, "no cooler skin around the hot spot"
    return peak, None


def flank_from_box(box, w, h):
    """The flank region inside a horse box (pixel bounds): the barrel, behind
    the shoulder, where the ribs rise and fall. The box runs from the back to
    the hooves, so the barrel is its upper middle — the box's own middle is
    the gap under the belly, between the legs (seen 2 Oct on the stall's
    recording: the wall behind showed there, not the horse)."""
    bw, bh = box["x1"] - box["x0"], box["y1"] - box["y0"]
    x0, x1 = box["x0"] + 0.35 * bw, box["x0"] + 0.65 * bw
    y0, y1 = box["y0"] + 0.15 * bh, box["y0"] + 0.45 * bh
    return (max(0, int(x0 * w)), max(0, int(y0 * h)), min(w - 1, int(x1 * w)), min(h - 1, int(y1 * h)))
