#!/usr/bin/env python3
"""
BSV EquiCare edge agent — runs on the per-barn edge box (Jetson).

Two modes:
  --simulate   generate realistic readings for ALL 12 monitoring points across
               the roster and POST them to the backend. Backfills history so the
               dashboard, baselines, alerts and charts are alive BEFORE hardware.
  (real)       use sparsh_camera.py for the camera-derived points (2 body temp,
               3 respiration, 4 respiratory rate). Other points stay simulated /
               manual until their sensors (IMU, feed/water, mic) are procured.

Offline-first: readings are appended to a local queue file and flushed to the
cloud; anything that fails to send stays queued (>=24h buffering requirement).

Stdlib only.  Examples:
    python3 edge_agent.py --simulate --backfill-days 14         # seed + exit
    python3 edge_agent.py --simulate --live --interval 10       # seed then stream
    python3 edge_agent.py --camera 192.168.1.102 --pass PW --live
"""
import os
import sys
import json
import time
import random
import argparse
import datetime as dt
import urllib.request
import urllib.error
import threading
import hashlib
import socket
import struct
from pathlib import Path

random.seed(7)  # deterministic-ish demo (Date/rand vary only by horse+hour)

# roster mirrors server/roster.mjs (id, stall) — simulator only
ROSTER = [
    ("zarina", "A-04"), ("shaan", "B-01"), ("noor", "A-07"), ("raja", "C-02"),
    ("meher", "B-05"), ("sultan", "C-06"), ("laila", "A-09"),
]

# per-horse profiles reproduce the demo narrative from real pipeline data
PROFILES = {
    "zarina": dict(restless=True,  rest_scale=0.3),                 # colic pattern -> urgent
    "shaan":  dict(water_scale=0.4),                                # low water -> watch
    "noor":   dict(resp_offset=10),                                 # elevated resp -> watch
    "raja":   dict(vice="crib_biting"),                             # vice -> ok note, calm
    "meher":  dict(backfill_days=10),                               # still learning baseline
    "sultan": dict(),                                               # calm
    "laila":  dict(temp_offset=1.2),                                # fever -> urgent
}

QUEUE = Path(__file__).with_name("outbox.jsonl")
_LOCK_FH = None


def use_outbox(server, token):
    """Give this agent its own offline buffer, keyed by where it sends and as
    whom — and refuse to share it with another running process.

    Every agent used to buffer into the same edge/outbox.jsonl. Two agents on
    one machine (a leftover one, or two configurations) then flushed each
    other's readings to the wrong server under the wrong token — seen in
    testing, where a demo agent's readings turned up on a different server."""
    global QUEUE, SENDING, _LOCK_FH
    key = hashlib.sha256(f"{server}|{token}".encode()).hexdigest()[:10]
    QUEUE = Path(__file__).with_name(f"outbox-{key}.jsonl")
    SENDING = QUEUE.with_suffix(".sending")
    import fcntl
    _LOCK_FH = open(QUEUE.with_suffix(".lock"), "w")
    try:
        fcntl.flock(_LOCK_FH, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        raise SystemExit(f"[edge] another edge agent is already running for {server} with this token "
                         f"(buffer {QUEUE.name}) — not starting a second one.")


# --------------------------------------------------------------------------- #
# transport (offline-buffered)
# --------------------------------------------------------------------------- #
_QLOCK = threading.Lock()
SENDING = QUEUE.with_suffix(".sending")
FLUSH_CHUNK = 2000


def enqueue(readings):
    """Append to the offline buffer. Thread-safe: several device workers write here."""
    if not readings:
        return
    with _QLOCK, QUEUE.open("a") as f:
        for r in readings:
            f.write(json.dumps(r) + "\n")


def _post(api_url, token, batch):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{api_url}/ingest/readings",
                                 data=json.dumps({"readings": batch}).encode(),
                                 headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read())


def flush(api_url, token=""):
    """Send the buffer, in chunks, without losing anything queued meanwhile.

    It used to read the queue, POST it, then delete the file — so a reading a
    device worker appended during the POST was deleted unsent, and a 24-hour
    offline backlog went up as one enormous request. Now the queue is
    atomically moved aside first (new readings start a fresh file), sent in
    chunks, and trimmed as each chunk is acknowledged; a failure keeps the rest
    for next time."""
    with _QLOCK:
        if not SENDING.exists():
            if not QUEUE.exists() or QUEUE.stat().st_size == 0:
                return 0, 0
            QUEUE.rename(SENDING)
    lines = [x for x in SENDING.read_text().splitlines() if x.strip()]
    accepted = dropped = 0
    while lines:
        chunk = lines[:FLUSH_CHUNK]
        try:
            res = _post(api_url, token, [json.loads(x) for x in chunk])
        except Exception as e:                                  # noqa: BLE001
            print(f"[edge] flush failed ({e}); {len(lines)} readings stay queued")
            SENDING.write_text("\n".join(lines) + "\n")
            return accepted, dropped
        accepted += res.get("accepted", 0)
        dropped += res.get("dropped", 0)
        if res.get("unattributed"):
            print(f"[edge] WARNING: {res['unattributed']} reading(s) matched no horse — "
                  f"unknown stall(s): {', '.join(str(s) for s in res.get('unknownStalls', []))}")
        if res.get("rejected"):
            print(f"[edge] WARNING: server rejected {res['rejected']} reading(s): "
                  f"{res.get('rejections', [])[:3]}")
        lines = lines[FLUSH_CHUNK:]
        if lines:
            SENDING.write_text("\n".join(lines) + "\n")
    SENDING.unlink(missing_ok=True)
    return accepted, dropped


def reading(horse_id, stall, metric, value, unit, ts, source, conf=0.95, meta=None):
    """Build one reading.

    `horse_id` may be None: a camera knows its stall, not which horse is standing
    in it, and horses change stalls routinely. The backend resolves stall ->
    horse against the current roster, and reports anything it could not attribute
    rather than silently accepting it.
    """
    r = dict(stallId=stall, metric=metric, value=round(value, 3),
             unit=unit, ts=ts, source=source, confidence=conf, meta=meta)
    if horse_id:
        r["horseId"] = horse_id
    return r


# --------------------------------------------------------------------------- #
# simulation
# --------------------------------------------------------------------------- #
def sim_hour(horse_id, stall, when, p):
    """All-12-point readings for one horse for one clock hour."""
    hour = when.hour
    night = hour < 6 or hour >= 20
    ts = when.replace(microsecond=0).isoformat() + "Z"
    out = []
    R = lambda m, v, u, s, **k: out.append(reading(horse_id, stall, m, v, u, ts, s, **k))

    # 2 body temperature (eye region, thermal)
    R("body_temp_c", 37.6 + p.get("temp_offset", 0) + random.uniform(-0.15, 0.2), "°C", "thermal_camera")
    # 3/4 respiration (nostril thermal -> rate)
    resp = 11 + p.get("resp_offset", 0) + (1.5 if night else 0) + random.uniform(-1.5, 2)
    R("respiratory_rate_bpm", max(6, resp), "bpm", "thermal_camera")
    # 5 activity (IMU+optical) — low at night unless restless
    base_act = (0.08 if night else 0.28)
    if p.get("restless"):
        base_act += 0.5
    R("activity_index", min(1, max(0, base_act + random.uniform(-0.05, 0.08))), "0..1", "imu_optical")
    # 6 rest / lying minutes this hour (more at night), + time outside during day
    lying = (random.uniform(35, 55) if night else random.uniform(0, 20)) * p.get("rest_scale", 1.0)
    R("rest_minutes", lying, "min", "imu_optical")
    if not night and 8 <= hour <= 17 and random.random() < 0.5:
        R("outside_minutes", random.uniform(20, 55), "min", "optical")
    # 1 steps (IMU)
    R("steps", (20 if night else 140) * (2 if p.get("restless") else 1) + random.uniform(0, 40), "count", "imu")
    # 7 lameness / gait asymmetry (sampled a few times/day)
    if random.random() < 0.15:
        R("gait_asymmetry", max(0, 0.08 + p.get("gait_offset", 0) + random.uniform(-0.03, 0.05)), "0..1", "imu_optical", conf=0.8)
    # 9 water — a few visits/day
    if random.random() < (0.35 if not night else 0.1):
        ml = random.uniform(2500, 4500) * p.get("water_scale", 1.0)
        R("water_visit", 1, "event", "flow_meter")
        R("water_ml", ml, "ml", "flow_meter")
    # 10 feed — at feed slots
    if hour in (7, 12, 18):
        given = random.uniform(1800, 2400)
        R("feed_intake_g", given, "g", "feeder")
        R("feed_refusal_g", max(0, random.uniform(-200, 400)), "g", "feeder")
    # 8 vices (optical+audio)
    if p.get("vice") and random.random() < 0.12:
        R("vice_event", 1, "event", "optical_audio", conf=0.7, meta={"kind": p["vice"]})
    # 11/12 elimination (optical CV)
    if random.random() < 0.06:
        R("urination_event", 1, "event", "optical", conf=0.75)
    if random.random() < 0.08:
        R("excretion_event", 1, "event", "optical", conf=0.75)
    return out


def simulate(api_url, backfill_days, live, interval, token=""):
    now = dt.datetime.utcnow().replace(minute=0, second=0, microsecond=0)
    total = 0
    for hid, stall in ROSTER:
        p = PROFILES.get(hid, {})
        days = p.get("backfill_days", backfill_days)
        start = now - dt.timedelta(days=days)
        t = start
        buf = []
        while t <= now:
            buf.extend(sim_hour(hid, stall, t, p))
            t += dt.timedelta(hours=1)
        enqueue(buf)
        total += len(buf)
    a, d = flush(api_url, token)
    print(f"[edge] backfill queued {total} readings -> accepted {a}, dropped {d}")

    if not live:
        return
    print(f"[edge] live mode: emitting a fresh hourly tick every {interval}s (Ctrl-C to stop)")
    while True:
        time.sleep(interval)
        when = dt.datetime.utcnow().replace(second=0, microsecond=0)
        batch = []
        for hid, stall in ROSTER:
            batch.extend(sim_hour(hid, stall, when, PROFILES.get(hid, {})))
        enqueue(batch)
        a, d = flush(api_url, token)
        print(f"[edge] tick {when.isoformat()}Z -> accepted {a}")


# --------------------------------------------------------------------------- #
# real camera mode (points 2,3,4)  — needs sparsh_camera.py + a live unit
# --------------------------------------------------------------------------- #
# A breathing signal has to be genuinely periodic before we report a rate.
# Normalised autocorrelation peak below this = no usable rhythm.
#
# Calibrated, not guessed: over 1000 pure-noise windows the strongest false
# rhythm reached 0.36 (p99 0.29), so anything at or under ~0.36 is within what
# noise alone produces. Real breathing at SNR >= 2 sits at 0.63+. We sit the
# gate above the noise ceiling and accept losing the weakest genuine windows —
# missing a window is harmless (we sample continuously, and a sustained gap is
# caught by the monitoring-gap rule), whereas a fabricated normal-looking rate
# is read by a vet as a healthy horse.
RESP_MIN_PERIODICITY = 0.40

# A peak at least this strong relative to the best one counts as the real
# fundamental — used to reject period-doubling (see _detrend note below).
RESP_SUBHARMONIC_RATIO = 0.80


def _detrend(samples):
    """Remove the least-squares linear trend, not just the mean.

    A slow baseline ramp — sun moving onto the stall wall, camera warming up,
    the horse drifting toward or away from the lens — is not breathing, but to
    a mean-subtracting autocorrelation it looks like one very strong slow cycle
    and produces a confident bogus rate. Taking out the ramp first leaves only
    the oscillation we actually care about.
    """
    n = len(samples)
    mx = (n - 1) / 2.0
    my = sum(samples) / n
    sxx = sum((i - mx) ** 2 for i in range(n))
    slope = 0.0 if sxx == 0 else sum((i - mx) * (samples[i] - my) for i in range(n)) / sxx
    return [samples[i] - (my + slope * (i - mx)) for i in range(n)]


def compute_resp_rate(samples, fs, with_quality=False):
    """Respiratory rate (bpm) from a window of nostril-ROI average temperatures.

    Breathing shows up as a slow oscillation because exhaled air is warmer than
    inhaled. Recovered by autocorrelation — pure Python, no numpy, so it runs on
    a bare Jetson image.

    Returns None when there is no real rhythm to find. That matters clinically:
    fed pure noise (ROI lost the nostril, horse turned away, sensor dropout) a
    bare peak-pick will happily return something like 16 bpm — a perfectly
    normal-looking equine respiratory rate — and a vet would read that as a
    healthy animal when in fact we measured nothing at all. Silence is safe;
    an invented vital sign is not.

    With with_quality=True returns (bpm, periodicity) so callers can attach the
    strength as a confidence on the reading.
    """
    n = len(samples)
    if n < fs * 15:                                # too short to trust
        return (None, 0.0) if with_quality else None

    x = _detrend(samples)
    energy = sum(v * v for v in x)                 # autocorrelation at lag 0
    if energy <= 1e-9:                             # flatline
        return (None, 0.0) if with_quality else None
    unit = energy / n

    # Normalised autocorrelation across the plausible equine band. Each lag is
    # divided by its own overlap length: fewer sample pairs contribute at long
    # lags, and without this the curve sags and biases us against slow rates.
    lo, hi = int(fs / 0.6), int(fs / 0.1)          # 0.1–0.6 Hz => 6–36 bpm
    hi = min(hi, n - 1)
    if hi <= lo:
        return (None, 0.0) if with_quality else None
    # One lag of margin on each side, so a candidate at the edge of the band
    # can be checked against its neighbours.
    acf = {}
    for lag in range(max(1, lo - 1), min(hi + 1, n - 1)):
        overlap = n - lag
        acf[lag] = (sum(x[i] * x[i + lag] for i in range(overlap)) / overlap) / unit

    # Only a true local maximum counts. A step in the signal — the horse lifting
    # its head into the box, the camera's periodic shutter recalibration, a
    # window straddling the moment the ROI was re-aimed — does not oscillate:
    # its autocorrelation just decays, so the "best" lag was simply the first
    # one searched, i.e. the top of the band. That fabricated ~37 bpm, above the
    # 24 bpm alert threshold: a false tachypnoea alarm from a head movement.
    peaks = [lag for lag in range(lo, hi)
             if lag - 1 in acf and lag + 1 in acf
             and acf[lag] > acf[lag - 1] and acf[lag] >= acf[lag + 1]]
    if not peaks:
        return (None, 0.0) if with_quality else None
    best_lag = max(peaks, key=acf.get)
    peak = acf[best_lag]
    if peak < RESP_MIN_PERIODICITY:
        return (None, max(0.0, peak)) if with_quality else None

    # Reject period doubling. A clean 16 bpm breath also correlates strongly at
    # twice its period, and that taller-looking peak would be reported as 8 bpm
    # — halving the rate, which turns tachypnoea into a normal reading. So take
    # the EARLIEST local maximum that is nearly as strong as the global one:
    # that is the fundamental, the later peaks are its harmonics.
    for lag in range(lo + 1, best_lag):
        if (acf[lag] >= RESP_SUBHARMONIC_RATIO * peak
                and acf[lag] >= acf[lag - 1] and acf[lag] >= acf[lag + 1]):
            best_lag = lag
            break

    periodicity = acf[best_lag]
    bpm = 60.0 * fs / best_lag
    return (bpm, periodicity) if with_quality else bpm


def roi_slots(cam):
    """The (Type, Id) of every enabled ROI the camera reports. Separate from
    camera_has_rois so the eval-unit check can prove this parsing works on the
    real firmware's response — if it didn't, the agent would silently go back to
    overwriting calibrations."""
    have = set()
    for kind in ("Point", "Area"):
        try:
            for it in cam.get(f"/ISAPI/Thermometry/{kind}?Dev=0&Idx=255").get("ThermometryList", []):
                if it.get("Enable", "Yes") != "No":
                    have.add((it.get("Type", kind), it.get("Id")))
        except Exception:                                       # noqa: BLE001
            pass
    return have


DEFAULT_EYE = (5000, 5000)
DEFAULT_NOSTRIL = [(4200, 5200), (5800, 5200), (5800, 6400), (4200, 6400)]


def roi_geometry(cam):
    """Where Point 0 (eye) and Area 1 (nostril) sit, as the camera reports them."""
    geo = {}
    for kind in ("Point", "Area"):
        try:
            for it in cam.get(f"/ISAPI/Thermometry/{kind}?Dev=0&Idx=255").get("ThermometryList", []):
                if it.get("Enable", "Yes") == "No":
                    continue
                t, i = it.get("Type", kind), it.get("Id")
                if t == "Point" and i == 0:
                    g = it.get("Point") or it.get("PointTemp") or {}
                    if "RatX" in g:
                        geo["eye"] = (g["RatX"], g["RatY"])
                elif t == "Area" and i == 1:
                    pts = (it.get("Area") or {}).get("EndPointList")
                    if pts:
                        geo["nostril"] = [(q.get("RatX"), q.get("RatY")) for q in pts]
        except Exception:                                       # noqa: BLE001
            pass
    return geo


def aimed_since_start(cam):
    """True once someone has moved the ROIs off the defaults this agent wrote —
    i.e. calibrated from the Hardware page while the agent was running.

    Without this the agent decided "uncalibrated" once, at startup, and kept
    flagging every reading after the camera had been aimed: the "camera not
    aimed" warning never cleared until someone restarted the agent. If the
    firmware does not report ROI coordinates this stays False — a lingering
    warning, never a false alarm."""
    g = roi_geometry(cam)
    return (g.get("eye") not in (None, DEFAULT_EYE)) or (g.get("nostril") not in (None, DEFAULT_NOSTRIL))


def camera_has_rois(cam):
    """True when the camera already holds our eye point (Point 0) and nostril
    area (Area 1) — i.e. someone calibrated it from the Hardware page."""
    have = roi_slots(cam)
    return ("Point", 0) in have and ("Area", 1) in have


def real_camera(api_url, ip, user, password, stall, horse_id, live, interval, token="",
                http_port=80, window_s=60, target_hz=5.0, reset_rois=False):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from sparsh_camera import IsapiClient  # noqa

    cam = IsapiClient(ip, user, password, port=http_port)
    if not cam.login():
        sys.exit("[edge] camera login failed")
    # This used to overwrite the ROIs with fixed frame-centre defaults on every
    # start — silently undoing a calibration made from the Hardware page, and
    # measuring coat or stall wall instead of the eye and nostril. Keep what the
    # camera holds; only fall back to defaults on an uncalibrated camera.
    calibrated = not reset_rois and camera_has_rois(cam)
    if not calibrated:
        cam.set_basic_param(emissivity_100=98, distance_cm=350)
        cam.set_point(0, *DEFAULT_EYE, name="eye")                # eye/max ROI
        cam.set_area(1, DEFAULT_NOSTRIL, name="nostril")
        print(f"[edge] WARNING: camera {ip} had no calibrated ROIs — using frame-centre defaults. "
              "Readings are only meaningful if the eye and nostril happen to be there; "
              "calibrate from the Hardware page.")
    else:
        print(f"[edge] camera {ip}:{http_port} is calibrated — keeping its ROIs")
    print(f"[edge] sampling {window_s}s windows…")

    while True:
        if not calibrated and aimed_since_start(cam):
            calibrated = True
            print("[edge] the camera has been aimed since start — readings are now trusted")
        window, t0 = [], time.time()
        misses = 0
        while time.time() - t0 < window_s:
            tick = time.time()
            try:
                temps = {x["type"]: x for x in cam.query_temps()}
                area = temps.get("Area", {}).get("avg_c")
                if area is not None:
                    window.append(area)
            except Exception as e:                                # noqa: BLE001
                # A blip on barn wifi must not take the agent down mid-demo.
                # Drop the sample, keep the window, log once per window.
                misses += 1
                if misses == 1:
                    print(f"[edge] camera read failed ({e}); continuing")
            # Sleep only the remainder: each ISAPI round-trip costs real time,
            # and sleeping a fixed 1/target_hz on top of it makes the TRUE
            # sample rate lower than the one we later divide by — which scales
            # the reported bpm up. A horse breathing 16 would read 19.
            time.sleep(max(0.0, (1.0 / target_hz) - (time.time() - tick)))

        # Use the rate we actually achieved, not the one we aimed for.
        elapsed = time.time() - t0
        fs = (len(window) / elapsed) if elapsed > 0 and window else target_hz
        if misses:
            print(f"[edge] {misses} camera read(s) failed this window; "
                  f"{len(window)} samples at {fs:.2f} Hz")

        now = dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
        try:
            latest = {x["type"]: x for x in cam.query_temps()}
        except Exception as e:                                    # noqa: BLE001
            print(f"[edge] camera unreachable ({e}); skipping this tick")
            if not live:
                return
            continue
        batch = []
        # Readings through default ROIs are tagged, and the server keeps them
        # out of clinical alerts: a frame-centre point reads whatever is there.
        meta = {"calibrated": calibrated}
        if latest.get("Point", {}).get("point_c") is not None:
            batch.append(reading(horse_id, stall, "body_temp_c", latest["Point"]["point_c"], "°C", now,
                                 "thermal_camera", conf=0.95 if calibrated else 0.3, meta=meta))
        rr, quality = compute_resp_rate(window, fs, with_quality=True)
        if rr:
            # Report the measured rhythm strength as confidence rather than a
            # flat guess, so weak windows are visibly weaker downstream.
            batch.append(reading(horse_id, stall, "respiratory_rate_bpm", rr, "bpm", now,
                                 "thermal_camera",
                                 conf=round(min(0.95, quality), 2) if calibrated else 0.3, meta=meta))
        else:
            print(f"[edge] no usable breathing rhythm this window "
                  f"(periodicity {quality:.2f} < {RESP_MIN_PERIODICITY}) — reporting nothing")
        enqueue(batch)
        a, _ = flush(api_url, token)
        print(f"[edge] camera tick -> {len(batch)} readings (resp={rr}), accepted {a}")
        if not live:
            return



# --------------------------------------------------------------------------- #
# Server mode — the edge box as the portal configures it
# --------------------------------------------------------------------------- #
# `edge_agent.py --server https://site-server --token eqd_…`
#
# The Hardware page is the single source of truth. This process fetches the
# devices assigned to its edge box, polls every camera and Modbus sensor in
# parallel, reports each one's health, and re-reads its configuration every
# minute — so adding, re-aiming or removing hardware in the portal takes effect
# here without anyone logging into the box. It never writes camera ROIs: only
# the portal does, so there is exactly one writer.
AGENT_VERSION = "2.0.0"
CONFIG_CACHE = Path(__file__).with_name("edge_config.json")

MODBUS_TYPES = {"uint16": 1, "int16": 1, "uint32": 2, "int32": 2, "float32": 2}


def modbus_decode(regs, typ, word_order="high-first"):
    """Same decoding as server/modbus.mjs (pinned by edge/modbus_test.py)."""
    if MODBUS_TYPES[typ] == 1:
        v = regs[0] & 0xFFFF
        return v - 0x10000 if typ == "int16" and v & 0x8000 else v
    a, b = (regs[1], regs[0]) if word_order == "low-first" else (regs[0], regs[1])
    raw = struct.pack(">HH", a & 0xFFFF, b & 0xFFFF)
    return struct.unpack(">f" if typ == "float32" else ">i" if typ == "int32" else ">I", raw)[0]


def modbus_read(host, port, unit, fn, address, count, timeout=4.0):
    req = struct.pack(">HHHBBHH", 1, 0, 6, unit, fn, address, count)
    with socket.create_connection((host, port), timeout=timeout) as s:
        s.sendall(req)
        head = b""
        while len(head) < 9:
            chunk = s.recv(9 - len(head))
            if not chunk:
                raise IOError("connection closed by the device")
            head += chunk
        if head[7] & 0x80:
            raise IOError(f"Modbus exception {head[8]} — check the register address and function")
        data = b""
        while len(data) < head[8]:
            chunk = s.recv(head[8] - len(data))
            if not chunk:
                break
            data += chunk
    regs = struct.unpack(">" + "H" * (len(data) // 2), data)
    if len(regs) < count:
        raise IOError(f"asked for {count} registers, got {len(regs)}")
    return regs


class NoRois(RuntimeError):
    code = "NO_ROIS"


class Worker(threading.Thread):
    """One device. Subclasses implement run_once(); failures back off and retry."""

    def __init__(self, dev, sink):
        super().__init__(daemon=True, name=f"{dev['kind']}:{dev['name']}")
        self.dev, self.sink = dev, sink
        self.stop_evt = threading.Event()
        self.ok, self.error, self.code, self.last_reading_at = None, None, None, None

    def health(self):
        # ok=None: no verdict yet (the worker hasn't finished its first cycle).
        # This used to be reported as an error "starting", so every device on a
        # freshly started edge box showed red while it was working fine.
        return {"id": self.dev["id"], "ok": self.ok, "code": self.code if self.ok is False else None,
                "error": self.error if self.ok is False else None, "lastReadingAt": self.last_reading_at}

    def emit(self, readings):
        if readings:
            self.sink(readings)
            self.last_reading_at = now_iso()

    def run(self):
        backoff = 5
        while not self.stop_evt.is_set():
            try:
                self.run_once()
                self.ok, self.error, self.code, backoff = True, None, None, 5
            except Exception as e:                              # noqa: BLE001
                self.ok, self.error = False, self.describe(e)[:300]
                self.code = getattr(e, "code", None) if isinstance(getattr(e, "code", None), str) else None
                # "no ROIs yet" clears the moment someone calibrates: check often.
                wait = 15 if self.code == "NO_ROIS" else backoff
                print(f"[edge] {self.name}: {self.error} — retrying in {wait}s")
                self.stop_evt.wait(wait)
                if self.code != "NO_ROIS":
                    backoff = min(backoff * 2, 120)

    def stop(self):
        self.stop_evt.set()

    def describe(self, e):
        """Plain words for the portal. Staff read these, not engineers."""
        name, msg = type(e).__name__, str(e)
        host = f"{self.dev.get('host')}:{self.dev.get('httpPort') or self.dev.get('port')}"
        if "Timeout" in name or "timed out" in msg:
            return f"no answer from {host} — check the device's power, cable and IP address"
        if "ConnectionError" in name or "refused" in msg or "Max retries" in msg or isinstance(e, ConnectionRefusedError):
            return f"cannot reach {host} — the device is off, unplugged, or at a different IP address"
        return msg or name


def now_iso():
    return dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


class CameraWorker(Worker):
    """Eye temperature + respiration from the camera's calibrated ROIs."""

    def __init__(self, dev, sink, window_s=60, target_hz=5.0):
        super().__init__(dev, sink)
        self.window_s, self.target_hz = window_s, target_hz
        self.cam = None

    def connect(self):
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        from sparsh_camera import IsapiClient  # noqa
        d = self.dev
        if d.get("configError"):
            raise RuntimeError(d["configError"])
        cam = IsapiClient(d["host"], d.get("username", "admin"), d.get("password") or "",
                          port=d.get("httpPort", 80), https=bool(d.get("https")))
        if not cam.login():
            raise RuntimeError("camera login failed — check the password in the Hardware page")
        want = d.get("serial")
        got = cam.device_info().get("DeviceSN")
        if want and got and want != got:
            raise RuntimeError(f"a different camera (S/N {got}) is answering at {d['host']}; expected S/N {want}. "
                               "Not sampling — confirm the unit in the Hardware page.")
        self.cam = cam

    def run_once(self):
        try:
            self._run_once()
        except NoRois:
            raise
        except Exception:
            # After any failure start from a fresh login. A camera that rebooted
            # rejects the old session, and keeping it looped on that error
            # forever instead of recovering.
            self.cam = None
            raise

    def _run_once(self):
        if self.cam is None:
            self.connect()
        # A camera nobody has calibrated has no ROIs, so there is nothing to
        # read. Say so plainly instead of sampling empty windows while the
        # portal shows "waiting for the first reading" forever.
        present = {x["type"] for x in self.cam.query_temps()}
        if "Point" not in present and "Area" not in present:
            raise NoRois("the camera answers but has no ROIs — calibrate it in the Hardware page")
        window, t0 = [], time.time()
        while time.time() - t0 < self.window_s and not self.stop_evt.is_set():
            tick = time.time()
            temps = {x["type"]: x for x in self.cam.query_temps()}
            area = temps.get("Area", {}).get("avg_c")
            if area is not None:
                window.append(area)
            self.stop_evt.wait(max(0.0, (1.0 / self.target_hz) - (time.time() - tick)))
        if self.stop_evt.is_set():
            return
        elapsed = time.time() - t0
        fs = (len(window) / elapsed) if elapsed > 0 and window else self.target_hz
        latest = {x["type"]: x for x in self.cam.query_temps()}
        # The portal knows whether this camera's ROIs were aimed (and not moved
        # since); readings through un-aimed ROIs are flagged, never alerted on.
        calibrated = bool(self.dev.get("calibrated"))
        meta = {"calibrated": calibrated}
        ts, out = now_iso(), []
        point = latest.get("Point", {}).get("point_c")
        if point is not None:
            out.append(dict(deviceId=self.dev["id"], metric="body_temp_c", value=round(point, 3), unit="°C",
                            ts=ts, source="thermal_camera", confidence=0.95 if calibrated else 0.3, meta=meta))
        rr, quality = compute_resp_rate(window, fs, with_quality=True)
        if rr:
            out.append(dict(deviceId=self.dev["id"], metric="respiratory_rate_bpm", value=round(rr, 3), unit="bpm",
                            ts=ts, source="thermal_camera",
                            confidence=round(min(0.95, quality), 2) if calibrated else 0.3, meta=meta))
        self.emit(out)

    def stop(self):
        super().stop()
        try:
            if self.cam is not None:
                self.cam.s.request("PUT", f"{self.cam.base}/ISAPI/Security/User/Logout",
                                   headers=self.cam._headers(), timeout=3)
        except Exception:                                       # noqa: BLE001
            pass


class ModbusWorker(Worker):
    """Any Modbus/TCP sensor, per its register map.

    'gauge' registers report their value; 'counter' registers (a flow meter's
    running total) report the increase since the last poll. The first poll only
    sets the baseline, and a counter that goes backwards (meter reset, rollover)
    re-baselines instead of reporting a negative intake."""

    def __init__(self, dev, sink):
        super().__init__(dev, sink)
        self.last = {}

    def run_once(self):
        d, out, ts = self.dev, [], now_iso()
        errors = []
        for reg in d.get("registers", []):
            try:
                addr = reg["address"] - 1 if d.get("addressing") == "one-based" else reg["address"]
                regs = modbus_read(d["host"], d.get("port", 502), d.get("unitId", 1), d.get("function", 3),
                                   addr, MODBUS_TYPES[reg["type"]])
                raw = modbus_decode(regs, reg["type"], reg.get("wordOrder", "high-first"))
                value = raw * reg.get("scale", 1) + reg.get("offset", 0)
            except Exception as e:                              # noqa: BLE001
                errors.append(f"{reg.get('name')}: {e}")
                continue
            if reg.get("mode") == "counter":
                prev = self.last.get(reg["name"])
                self.last[reg["name"]] = value
                if prev is None or value < prev:
                    continue
                value = value - prev
            out.append(dict(deviceId=d["id"], metric=reg["metric"], value=round(value, 4), unit=reg.get("unit"),
                            ts=ts, source="modbus", confidence=0.95))
        self.emit(out)
        if errors:
            raise RuntimeError("; ".join(errors)[:300])
        self.stop_evt.wait(d.get("pollSeconds", 10))


class EdgeRuntime:
    def __init__(self, server, token, window_s=60):
        self.server, self.token, self.window_s = server.rstrip("/"), token, window_s
        self.workers = {}          # id -> (worker, connection fingerprint)
        self.started = time.time()
        self.stop_evt = threading.Event()

    def _req(self, method, path, body=None, timeout=15):
        req = urllib.request.Request(f"{self.server}{path}", method=method,
                                     data=None if body is None else json.dumps(body).encode(),
                                     headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())

    def fetch_config(self):
        """From the portal; falls back to the last good copy so a reboot while
        the server is unreachable still polls the devices (readings buffer)."""
        try:
            cfg = self._req("GET", "/edge/config")
            tmp = CONFIG_CACHE.with_suffix(".tmp")
            tmp.write_text(json.dumps(cfg))
            os.chmod(tmp, 0o600)                                # holds camera logins
            tmp.replace(CONFIG_CACHE)
            return cfg
        except urllib.error.HTTPError as e:
            if e.code == 401:
                raise SystemExit("[edge] the server rejected this edge box's token (revoked or mistyped) — stopping.")
            print(f"[edge] config fetch failed (HTTP {e.code}); keeping the current devices")
        except Exception as e:                                  # noqa: BLE001
            print(f"[edge] config fetch failed ({e}); keeping the current devices")
        if not self.workers and CONFIG_CACHE.exists():
            print("[edge] using the cached configuration from the last successful fetch")
            return json.loads(CONFIG_CACHE.read_text())
        return None

    @staticmethod
    def _fingerprint(d):
        keys = ("kind", "host", "httpPort", "https", "username", "password", "port", "unitId",
                "function", "addressing", "pollSeconds", "registers", "serial", "configError")
        return hashlib.sha256(json.dumps({k: d.get(k) for k in keys}, sort_keys=True).encode()).hexdigest()

    def apply(self, cfg):
        wanted = {d["id"]: d for d in cfg.get("devices", []) if d["kind"] in ("thermal_camera", "modbus_sensor")}
        for did in list(self.workers):
            w, fp = self.workers[did]
            if did not in wanted or self._fingerprint(wanted[did]) != fp:
                print(f"[edge] stopping {w.name}" + ("" if did in wanted else " (removed in the portal)"))
                w.stop()
                del self.workers[did]
        for did, d in wanted.items():
            if did in self.workers:
                self.workers[did][0].dev = d                   # e.g. calibration changed: no restart
                continue
            w = CameraWorker(d, enqueue, self.window_s) if d["kind"] == "thermal_camera" else ModbusWorker(d, enqueue)
            print(f"[edge] starting {w.name}")
            w.start()
            self.workers[did] = (w, self._fingerprint(d))

    def heartbeat(self):
        body = {"agent": {"version": AGENT_VERSION, "host": socket.gethostname(),
                          "uptimeS": int(time.time() - self.started)},
                "devices": [w.health() for w, _ in self.workers.values()]}
        try:
            self._req("POST", "/edge/heartbeat", body)
        except Exception as e:                                  # noqa: BLE001
            print(f"[edge] heartbeat failed ({e})")

    def run(self, refresh_s=60, flush_s=10, beat_s=30):
        cfg = self.fetch_config()
        if cfg is None:
            raise SystemExit("[edge] no configuration from the server and none cached — cannot start")
        print(f"[edge] edge box \"{cfg.get('edge', {}).get('name')}\": {len(cfg.get('devices', []))} device(s)")
        self.apply(cfg)
        last_refresh = last_beat = last_flush = 0.0
        try:
            while not self.stop_evt.is_set():
                t_now = time.time()
                if t_now - last_flush >= flush_s:
                    flush(self.server, self.token)
                    last_flush = t_now
                if t_now - last_beat >= beat_s:
                    self.heartbeat()
                    last_beat = t_now
                if t_now - last_refresh >= refresh_s:
                    new = self.fetch_config()
                    if new is not None:
                        self.apply(new)
                    last_refresh = t_now
                self.stop_evt.wait(1.0)
        finally:
            for w, _ in self.workers.values():
                w.stop()
            flush(self.server, self.token)

# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default=os.environ.get("EQUICARE_API", "http://127.0.0.1:8080"))
    ap.add_argument("--server", help="server mode: the site server URL; devices come from the Hardware page")
    ap.add_argument("--refresh", type=int, default=60, help="server mode: seconds between config refreshes")
    ap.add_argument("--simulate", action="store_true")
    ap.add_argument("--backfill-days", type=int, default=14)
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--interval", type=int, default=10)
    ap.add_argument("--camera"); ap.add_argument("--user", default="admin"); ap.add_argument("--pass", dest="pw")
    ap.add_argument("--http-port", type=int, default=80,
                    help="camera ISAPI port (use 8080 against tools/mock_camera.py)")
    ap.add_argument("--reset-rois", action="store_true",
                    help="overwrite the camera's ROIs with frame-centre defaults")
    ap.add_argument("--window", type=int, default=60,
                    help="seconds of nostril samples per respiration estimate")
    ap.add_argument("--stall", default="A-04",
                    help="the stall this camera watches; the backend maps it to the horse")
    ap.add_argument("--horse", default=None,
                    help="optional: pin readings to a horse id instead of resolving by stall")
    ap.add_argument("--token", default=os.environ.get("EQUICARE_TOKEN", ""),
                    help="device ingest token (Bearer) if the backend requires one")
    a = ap.parse_args()

    if a.server:
        if not a.token:
            ap.error("--server needs --token (the edge box's token from the Hardware page)")
        use_outbox(a.server, a.token)
        EdgeRuntime(a.server, a.token, window_s=a.window).run(refresh_s=a.refresh)
        return
    if a.simulate:
        simulate(a.api, a.backfill_days, a.live, a.interval, a.token)
    elif a.camera:
        real_camera(a.api, a.camera, a.user, a.pw, a.stall, a.horse, a.live, a.interval,
                    a.token, http_port=a.http_port, window_s=a.window, reset_rois=a.reset_rois)
    else:
        ap.error("choose --simulate or --camera <ip>")


if __name__ == "__main__":
    main()
