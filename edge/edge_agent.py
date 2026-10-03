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
    "sultan": dict(lame_lf_days=4),                                 # calm; left-fore lameness developing over 4 days
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
def _iso(t):
    return t.replace(microsecond=0).isoformat() + "Z"


def _limb(head, pelvis):
    """Which leg, from the trot asymmetries — the rule server/gait.mjs applies
    (noise floors ~5 mm head, ~3 mm pelvis; positive = the left limb)."""
    h = max(head, key=abs) if head else 0.0
    pv = max(pelvis, key=abs) if pelvis else 0.0
    hs, ps = abs(h) / 5.0, abs(pv) / 3.0
    if max(hs, ps) <= 1:
        return None
    if hs >= ps:
        return "LF" if h > 0 else "RF"
    return "LH" if pv > 0 else "RH"


def sim_hour(horse_id, stall, when, p):
    """All-12-point readings for one horse for the clock hour ending at `when`.

    Events inside the hour (drinks, meals, exercise) are stamped back from
    `when`, never after it, so the live tick never writes the future."""
    hour = when.hour
    night = hour < 6 or hour >= 20
    ts = _iso(when)
    back = lambda minutes: when - dt.timedelta(minutes=minutes)  # noqa: E731
    out = []

    def R(m, v, u, s, at=None, **k):
        out.append(reading(horse_id, stall, m, v, u, _iso(at) if at else ts, s, **k))

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

    # Exercise, once a day for most horses (hour by horse), on the wearable:
    # a session with its trots analysed for lameness (§1 shapes, prototype).
    steps = (20 if night else 140) * (2 if p.get("restless") else 1) + random.uniform(0, 40)
    ex_hour = 9 + sum(map(ord, horse_id)) % 3
    if hour == ex_hour and random.random() < 0.85:
        minutes = random.uniform(30, 50)
        start = back(55)
        trot = random.uniform(10, 20)
        strides = minutes * 60 * random.uniform(0.8, 0.95)       # walk ~1 Hz, trot ~1.4 Hz, some standing
        ex_steps = round(strides * 4)                            # tagged leg's strikes × 4 legs
        dist = (minutes - trot) * 60 * 1.6 + trot * 60 * 3.5     # walk 1.6 m/s, trot 3.5 m/s
        steps += ex_steps
        R("exercise_session", minutes, "min", "imu", at=start,
          meta={"start": _iso(start), "end": _iso(start + dt.timedelta(minutes=minutes)), "steps": ex_steps,
                "distanceM": round(dist), "trotMin": round(trot, 1), "prototype": True})
        # Left-fore lameness developing: the head drops less when the sore
        # leg lands (positive head asymmetry), growing over `lame_lf_days`.
        lame = 0.0
        if p.get("lame_lf_days"):
            now = p.get("_now") or dt.datetime.utcnow()
            onset = now - dt.timedelta(days=p["lame_lf_days"])
            lame = min(1.0, max(0.0, (when - onset).total_seconds() / (p["lame_lf_days"] * 86400)))
        for at_min in (12, 28):
            head = [3 + 14 * lame + random.uniform(-2, 2), 1 + 6 * lame + random.uniform(-2, 2)]
            pelvis = [random.uniform(-2.5, 2.5), random.uniform(-2.5, 2.5)]
            if not lame:
                head = [random.uniform(-4, 4), random.uniform(-4, 4)]
            R("lameness_result", max(abs(x) for x in head + pelvis), "mm", "imu", at=start + dt.timedelta(minutes=at_min),
              meta={"limb": _limb(head, pelvis),
                    "head": {"minDiffMm": round(head[0], 1), "maxDiffMm": round(head[1], 1)},
                    "pelvis": {"minDiffMm": round(pelvis[0], 1), "maxDiffMm": round(pelvis[1], 1)},
                    "strides": random.randint(18, 36), "durationS": random.randint(14, 30), "prototype": True})
    # 1 steps (IMU leg tag) — prototype until validated, so the colic rule
    # does not lean on them
    R("steps", steps, "count", "imu", at=back(60), meta={"sensor": "leg", "periodMin": 60, "prototype": True})
    # Wearable status: battery by charge cycle (the SIM hub, with GPS, runs
    # down fastest), signal = LTE for the hub, Bluetooth to the hub for tags.
    k = sum(map(ord, horse_id))
    hours = int(when.timestamp() // 3600)
    for sensor, cycle, dbm in (("leg", 120, -68), ("head", 72, -85), ("pelvis", 168, -70)):
        frac = ((hours + k * 7) % cycle) / cycle
        R("device_status", 100 - 85 * frac, "%", "imu",
          meta={"sensor": sensor, "hardwareId": f"SIM-{horse_id.upper()}-{sensor.upper()}",
                "signalDbm": round(dbm + random.uniform(-6, 6)), "attached": True, "firmware": "sim-1.0"})
    # 7 lameness / gait asymmetry (legacy index, sampled a few times/day)
    if random.random() < 0.15:
        R("gait_asymmetry", max(0, 0.08 + p.get("gait_offset", 0) + random.uniform(-0.03, 0.05)), "0..1", "imu_optical", conf=0.8)
    # 9 water — drinking bouts (a visit + its ml, stamped at the bout start)
    for chance in ((0.55, 0.15) if not night else (0.2,)):
        if random.random() < chance:
            ml = round(random.uniform(1500, 4000) * p.get("water_scale", 1.0))
            at = back(random.uniform(1, 59))
            meta = {"ml": ml, "durationS": round(ml / random.uniform(40, 80)),
                    "boutId": f"sim-{horse_id}-{at.strftime('%Y%m%dT%H%M%S')}"}
            R("water_visit", 1, "event", "flow_meter", at=at, meta=meta)
            R("water_ml", ml, "ml", "flow_meter", at=at, meta=dict(meta))
    if hour in (6, 16) and random.random() < 0.8:                # staff refilling the bucket
        R("water_refill", random.uniform(8000, 16000), "ml", "flow_meter", at=back(random.uniform(5, 50)))
    # 10 feed — meals offered / eaten / left, stamped at the fill
    meal = {7: "morning", 12: "midday", 18: "evening"}.get(hour)
    if meal:
        at = back(50)
        offered = random.uniform(1800, 2400)
        refused = min(offered, max(0, random.uniform(-200, 400)))
        meta = {"meal": meal, "mealId": f"sim-{horse_id}-{at.strftime('%Y%m%dT%H%M')}-{meal}"}
        R("feed_offered_g", offered, "g", "feeder", at=at, meta=meta)
        R("feed_intake_g", offered - refused, "g", "feeder", at=at, meta=dict(meta))
        R("feed_refusal_g", refused, "g", "feeder", at=at, meta=dict(meta))
    # hay from the weighed net, per hour
    hay = random.uniform(150, 350) if night else random.uniform(350, 600)
    R("hay_intake_g", hay * p.get("hay_scale", 1.0), "g", "feeder", at=back(60), meta={"periodMin": 60})
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
        p = dict(PROFILES.get(hid, {}), _now=now)
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
            batch.extend(sim_hour(hid, stall, when, dict(PROFILES.get(hid, {}), _now=now)))
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


# ROI slots, shared with the server (server/devices.mjs). The eye is a small
# box, Area 0, read as its MAXIMUM — the inner corner of the eye is the warmest
# spot on the head, so the aim need not be pixel-exact. Cameras calibrated
# before that used a single point, Point 0, which is still read as a fallback.
EYE_AREA_ID, NOSTRIL_AREA_ID, LEGACY_EYE_POINT_ID = 0, 1, 0

DEFAULT_EYE = [(4850, 4880), (5150, 4880), (5150, 5120), (4850, 5120)]
DEFAULT_NOSTRIL = [(4200, 5200), (5800, 5200), (5800, 6400), (4200, 6400)]
LEGACY_DEFAULT_EYE_POINT = (5000, 5000)


def roi_readings(rows):
    """Eye temperature and nostril average from a query_temps() result, matched
    by type AND id. With two Areas on the camera, picking "the Area" by type
    alone would read whichever came last — possibly the eye box as the nostril,
    or the nostril's maximum as body temperature."""
    by = {(r.get("type"), r.get("id")): r for r in rows}
    eye_box = by.get(("Area", EYE_AREA_ID))
    point = by.get(("Point", LEGACY_EYE_POINT_ID))
    eye = eye_box.get("max_c") if eye_box else (point.get("point_c") if point else None)
    nostril = (by.get(("Area", NOSTRIL_AREA_ID)) or {}).get("avg_c")
    return eye, nostril


def roi_geometry(cam):
    """Where the eye (Area 0, or a legacy Point 0) and nostril (Area 1) sit, as
    the camera reports them."""
    geo = {}
    for kind in ("Point", "Area"):
        try:
            for it in cam.get(f"/ISAPI/Thermometry/{kind}?Dev=0&Idx=255").get("ThermometryList", []):
                if it.get("Enable", "Yes") == "No":
                    continue
                t, i = it.get("Type", kind), it.get("Id")
                if t == "Point" and i == LEGACY_EYE_POINT_ID and "eye" not in geo:
                    g = it.get("Point") or it.get("PointTemp") or {}
                    if "RatX" in g:
                        geo["eye"] = (g["RatX"], g["RatY"])
                elif t == "Area" and i in (EYE_AREA_ID, NOSTRIL_AREA_ID):
                    pts = (it.get("Area") or {}).get("EndPointList")
                    if pts:
                        geo["eye" if i == EYE_AREA_ID else "nostril"] = [(q.get("RatX"), q.get("RatY")) for q in pts]
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
    # The old frame-centre point an earlier agent version wrote is a default
    # too — counting it as "aimed" would trust readings nobody calibrated.
    return (g.get("eye") not in (None, DEFAULT_EYE, LEGACY_DEFAULT_EYE_POINT)) \
        or (g.get("nostril") not in (None, DEFAULT_NOSTRIL))


def camera_has_rois(cam):
    """True when the camera already holds our eye ROI (Area 0, or a legacy
    Point 0) and nostril area (Area 1) — i.e. someone calibrated it from the
    Hardware page."""
    have = roi_slots(cam)
    return (("Area", EYE_AREA_ID) in have or ("Point", LEGACY_EYE_POINT_ID) in have) \
        and ("Area", NOSTRIL_AREA_ID) in have


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
        cam.set_area(EYE_AREA_ID, DEFAULT_EYE, name="eye")            # eye: hottest pixel in the box
        cam.set_area(NOSTRIL_AREA_ID, DEFAULT_NOSTRIL, name="nostril")
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
                _, area = roi_readings(cam.query_temps())
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
            eye_c, _ = roi_readings(cam.query_temps())
        except Exception as e:                                    # noqa: BLE001
            print(f"[edge] camera unreachable ({e}); skipping this tick")
            if not live:
                return
            continue
        batch = []
        # Readings through default ROIs are tagged, and the server keeps them
        # out of clinical alerts: a frame-centre point reads whatever is there.
        meta = {"calibrated": calibrated}
        if eye_c is not None:
            batch.append(reading(horse_id, stall, "body_temp_c", eye_c, "°C", now,
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


# Modbus RTU over RS-485 — stall sensors (load cells, meters) often have no
# network port, only a two-wire bus to the edge box's USB adapter. The framing
# and CRC are ours (a few lines, pinned by edge/modbus_test.py); pyserial only
# opens the port, so the rest of the agent keeps working without it.
MODBUS_EXCEPTIONS = {1: "illegal function", 2: "illegal data address", 3: "illegal data value", 4: "device failure"}


class NoReply(IOError):
    """The line is fine, the sensor is silent (wiring, address, baud)."""


def crc16(data):
    """Modbus CRC-16 (reflected 0xA001, start 0xFFFF). Sent low byte first."""
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


def rtu_request(unit, fn, address, count):
    body = struct.pack(">BBHH", unit, fn, address, count)
    return body + struct.pack("<H", crc16(body))


def rtu_parse(frame, unit, fn, count):
    """Registers from one reply frame, or an error staff can act on."""
    if len(frame) < 5:
        raise IOError(f"reply too short ({len(frame)} bytes)")
    body = frame[:-2]
    if crc16(body) != struct.unpack("<H", frame[-2:])[0]:
        raise IOError("garbled reply (CRC error) — check the RS-485 wiring and the 120 Ω terminator, "
                      "and that no two sensors share one unit address")
    if body[0] != unit:
        raise IOError(f"reply from unit {body[0]}, expected {unit} — two sensors at one address?")
    if body[1] == fn | 0x80:
        raise IOError(f"Modbus exception {body[2]} ({MODBUS_EXCEPTIONS.get(body[2], 'unknown')}) — "
                      "check the register address and function")
    if body[1] != fn or len(body) != 3 + body[2]:
        raise IOError("unexpected reply — another master on the RS-485 line?")
    regs = struct.unpack(">" + "H" * (body[2] // 2), body[3:3 + body[2] // 2 * 2])
    if len(regs) < count:
        raise IOError(f"asked for {count} registers, got {len(regs)}")
    return regs


def open_serial(path, baud, parity, stop_bits, timeout):
    """The serial port, via pyserial — imported here so only a box with RS-485
    sensors needs it installed."""
    try:
        import serial  # noqa: PLC0415
    except ImportError:
        raise RuntimeError("RS-485 (Modbus RTU) sensors need pyserial on the edge box: "
                           "pip3 install pyserial") from None
    return serial.Serial(path, baudrate=baud, bytesize=8, parity=parity, stopbits=stop_bits, timeout=timeout)


class RtuBus:
    """One RS-485 line. Several sensors (unit ids) share it, each polled by its
    own worker thread, so every request/reply holds the line: two frames
    interleaved on the wire corrupt both."""

    def __init__(self, path, baud=9600, parity="N", stop_bits=1, timeout=1.0):
        self.path, self.settings, self.timeout = path, (baud, parity, stop_bits), timeout
        self.lock = threading.Lock()
        self.users = set()
        self.ser = None
        # A frame ends after 3.5 character times of silence (11 bits each);
        # the standard fixes 1.75 ms above 19200 baud.
        self.gap = 1.75e-3 if baud > 19200 else 3.5 * 11 / baud

    def describe(self):
        baud, parity, stop = self.settings
        return f"{self.path} at {baud} 8{parity}{stop}"

    def _read(self, n, unit):
        data = b""
        while len(data) < n:
            chunk = self.ser.read(n - len(data))
            if not chunk:
                raise NoReply(f"no reply from unit {unit} on {self.describe()} — check the A/B wiring, "
                              "the sensor's unit address, baud rate and parity")
            data += chunk
        return data

    def read_registers(self, unit, fn, address, count):
        if unit == 0:
            raise IOError("unit id 0 is the RS-485 broadcast address — nothing replies to it; "
                          "set the sensor's own address (1–247)")
        with self.lock:
            try:
                if self.ser is None:
                    self.ser = open_serial(self.path, *self.settings, self.timeout)
                self.ser.reset_input_buffer()      # a late reply to an earlier request is not this one's
                self.ser.write(rtu_request(unit, fn, address, count))
                head = self._read(3, unit)
                # A transceiver turning the line round can leave a stray byte
                # in front of the reply.
                for _ in range(3):
                    if head[0] == unit:
                        break
                    head = head[1:] + self._read(1, unit)
                frame = head + self._read(2 if head[1] & 0x80 else head[2] + 2, unit)
            except OSError as e:
                if not isinstance(e, NoReply):
                    self.close()                   # unplugged adapter: reopen on the next poll
                raise
            finally:
                time.sleep(self.gap)
        return rtu_parse(frame, unit, fn, count)

    def close(self):
        if self.ser is not None:
            try:
                self.ser.close()
            except Exception:                                   # noqa: BLE001
                pass
            self.ser = None


_RTU_BUSES, _RTU_LOCK = {}, threading.Lock()


def rtu_bus_for(dev):
    """The shared line for this sensor's serial port. Every sensor on one line
    must use the same settings — refused clearly rather than flipping the
    port between them."""
    path = dev.get("serialPort")
    if not path:
        raise IOError("RS-485 sensor without a serial port — set it in the Hardware page (e.g. /dev/ttyUSB0)")
    want = (int(dev.get("baud") or 9600), str(dev.get("parity") or "N").upper(), int(dev.get("stopBits") or 1))
    with _RTU_LOCK:
        bus = _RTU_BUSES.get(path)
        if bus is not None and bus.settings != want:
            if bus.users - {dev["id"]}:
                raise IOError(f"{bus.describe()} is already used by another sensor — every sensor on one "
                              "RS-485 line needs the same baud rate, parity and stop bits")
            bus.close()
            bus = None
        if bus is None:
            bus = _RTU_BUSES[path] = RtuBus(path, *want)
        bus.users.add(dev["id"])
        return bus


def rtu_bus_release(dev_id):
    with _RTU_LOCK:
        for path, bus in list(_RTU_BUSES.items()):
            bus.users.discard(dev_id)
            if not bus.users:
                with bus.lock:
                    bus.close()
                del _RTU_BUSES[path]


def modbus_read_rtu(dev, unit, fn, address, count):
    return rtu_bus_for(dev).read_registers(unit, fn, address, count)


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
                "error": self.error if self.ok is False else None, "lastReadingAt": self.last_reading_at,
                "warnings": self.warnings()}

    def warnings(self):
        """Working, but part of it is not (a video stream, the detector)."""
        return []

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
        eye0, nostril0 = roi_readings(self.cam.query_temps())
        if eye0 is None and nostril0 is None:
            raise NoRois("the camera answers but has no ROIs — calibrate it in the Hardware page")
        window, t0 = [], time.time()
        while time.time() - t0 < self.window_s and not self.stop_evt.is_set():
            tick = time.time()
            _, area = roi_readings(self.cam.query_temps())
            if area is not None:
                window.append(area)
            self.stop_evt.wait(max(0.0, (1.0 / self.target_hz) - (time.time() - tick)))
        if self.stop_evt.is_set():
            return
        elapsed = time.time() - t0
        fs = (len(window) / elapsed) if elapsed > 0 and window else self.target_hz
        point, _ = roi_readings(self.cam.query_temps())
        # The portal knows whether this camera's ROIs were aimed (and not moved
        # since); readings through un-aimed ROIs are flagged, never alerted on.
        calibrated = bool(self.dev.get("calibrated"))
        meta = {"calibrated": calibrated}
        ts, out = now_iso(), []
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


STATE_DIR = Path(os.environ.get("EQUICARE_STATE_DIR") or (Path.home() / "EquiCare-demo" / "state"))


# Why a window has (no) breathing rate — the nostril path in the thermal video,
# and the flank path in the colour video. Stored per minute (breathing_check).
BREATHING_WHY = {
    "measured": "breathing rate found",
    "no_thermal_video": "thermal video not running",
    "head_out_of_view": "head not in the thermal view",
    "head_off_boxes": "head in view but not where the boxes were drawn (the eye was not in its box)",
    "head_moving": "head moving — no 30 s still stretch",
    "no_rhythm": "no clear breathing rhythm",
    "count_disagrees": "rate and breath count disagree",
    "too_little_video": "too little thermal video this minute",
    "no_colour_video": "colour video not running",
    "no_flank_region": "no flank to watch (the horse was not standing still, or no detector)",
}


def pick_breathing(br, fl, followed=False):
    """(result, method) from the thermal nostril (br) and the colour flank
    (fl) breathing results: the stronger when both found a rate (and whether
    they agreed), else whichever did; (None, None) when neither."""
    if br.get("bpm") and fl.get("bpm"):
        agree = abs(br["bpm"] - fl["bpm"]) <= max(2.0, 0.15 * br["bpm"])
        pick = br if br["strength"] >= fl["strength"] else fl
        return pick, ("thermal nostril + colour flank agree" if agree
                      else "thermal nostril (colour flank disagreed)" if pick is br else "colour flank (thermal nostril disagreed)")
    if br.get("bpm"):
        return br, "thermal video, nostril box"
    if fl.get("bpm"):
        return fl, "colour video, flank movement" + (" (followed the horse)" if followed else "")
    return None, None


def _iou_px(a, b):
    """Overlap of two pixel regions (x0, y0, x1, y1), 0..1."""
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def _warmest(vals, pts):
    """The point (0–10000, rounded) of the warmest read, or None."""
    best = max(((v, i) for i, v in enumerate(vals) if v is not None), default=None)
    if best is None:
        return None
    p = pts[best[1]]
    return {"x": int(round(p["x"])), "y": int(round(p["y"]))}


def breathing_why(video_ok, head_in_view, has_eye_box, in_boxes, nostril_res, vis_ok, flank_res):
    """(nostril reason, flank reason), each a BREATHING_WHY key."""
    def of(res):
        if res.get("bpm"):
            return "measured"
        r = res.get("reason") or ""
        return "head_moving" if r.startswith("head moving") else "count_disagrees" if "disagree" in r else "no_rhythm"
    if nostril_res and nostril_res.get("bpm") and head_in_view:
        nostril = "measured"
    elif not video_ok:
        nostril = "no_thermal_video"
    elif not head_in_view:
        nostril = "head_out_of_view"
    elif has_eye_box and not in_boxes:
        nostril = "head_off_boxes"
    else:
        nostril = of(nostril_res) if nostril_res else "too_little_video"
    flank = of(flank_res) if flank_res else ("no_flank_region" if vis_ok else "no_colour_video")
    return nostril, flank


class MtrpcCameraWorker(CameraWorker):
    """A JSON-RPC (/mtrpc) camera — the firmware on the Sparsh demo unit.

    Data paths, each used for what it is good at:
      pixel reads (absolute °C, ~1 refresh/s): eye temperature (hottest pixel
        in the eye box), the nostril box's average °C, floor warm patches;
      thermal video (25 fps, relative brightness): breathing rhythm, and where
        the horse is moving over the floor (so the floor detector waits for it
        to step off a deposit);
      behaviour video — the COLOUR stream by default (more detail, and the
        horse detector runs on it; day and night with the IR lamp). On the
        demo unit it shows about the same ~25° view as the 25 mm thermal
        (~1.5 × 1.2 m at 3.5 m), not the whole stall.
        Activity, stillness, weaving, box walking, head tossing, and — with
        the optional detector — lying down / getting up. behaviourStream
        "thermal" keeps it on the thermal view (a camera hung far enough back
        to see the whole horse), where posture comes from the warm body's box.
    Without ffmpeg the video paths are off and breathing falls back to pixel
    sampling (too slow on this firmware to find a rhythm reliably)."""

    FLOOR_EVERY_S = 2.0
    DISTURBED_S = 15.0                 # colour floor patches this close together: bedding moved, not events
    LIVE_BREATH_EVERY_S = 10.0         # the Live view's breathing: the last 35 s, every 10 s (None: off)
    VISIBLE_SIZE = (352, 288)          # finer than thermal: flank movement is ~1 cm
    FILLS_VIEW = 0.5                   # horse box at least half the frame wide: laps cannot be seen
    DETECT_EVERY_S = 1.0

    def __init__(self, dev, sink, window_s=60, target_hz=5.0):
        super().__init__(dev, sink, window_s, target_hz)
        self.video = self.vvideo = None
        self.analyzer = self.vanalyzer = None
        self.floor = None
        self.detector, self.detector_note = None, None
        self.last_visible = None
        self.boxes_seen = 0
        self.box_widths = []               # horse box widths (share of the frame) this window
        self._walk_prev = None             # box walking seen last window: its minutes, or True mid-bout
        self.posture = None
        self.auto_flank = None             # flank bounds from the detector box while the horse stands still
        self.flank_followed = False        # this window's flank breathing used auto_flank (followed the horse)
        self.horse_focus, self.people_px, self._focus_t = None, [], None   # last detection (colour pixels)
        self.people_s = 0                  # seconds with people at the stall, this window
        self.budget, self.where = {}, {}   # this window: seconds per state; seconds per 12x8 cell (where he stood)
        self.cfloor, self.cfloor_events = None, []
        self._lock = threading.Lock()

    # -- which stream does behaviour ------------------------------------------ #
    def behaviour_stream(self):
        return "thermal" if self.dev.get("behaviourStream") == "thermal" else "visible"

    def _posture_path(self):
        return STATE_DIR / f"posture-{self.dev['id']}-{self.behaviour_stream()}.json"

    def _load_posture(self):
        from behaviour import PostureTracker  # noqa
        try:
            st = json.loads(self._posture_path().read_text())
        except Exception:                                   # noqa: BLE001  (first run / unreadable)
            st = None
        # Learned for another aim of the camera (calibrated again since): the
        # box heights of two views must not be mixed — start learning afresh.
        if st and st.get("calibratedAt") != (self.dev.get("rois") or {}).get("pushedAt"):
            st = None
        self.posture = PostureTracker(st)

    def _save_posture(self):
        try:
            STATE_DIR.mkdir(parents=True, exist_ok=True)
            tmp = self._posture_path().with_suffix(".tmp")
            tmp.write_text(json.dumps({**self.posture.to_state(), "calibratedAt": (self.dev.get("rois") or {}).get("pushedAt")}))
            tmp.replace(self._posture_path())
        except Exception as e:                              # noqa: BLE001
            print(f"[edge] {self.name}: could not save the posture model ({e})")

    def connect(self):
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from mtrpc import MtrpcCamera  # noqa
        d = self.dev
        if d.get("configError"):
            raise RuntimeError(d["configError"])
        cam = MtrpcCamera(d["host"], d.get("username", "admin"), d.get("password") or "", port=d.get("httpPort", 80))
        if not cam.login():
            raise RuntimeError("camera login failed — check the password in the Hardware page")
        want, got = d.get("serial"), cam.identity()
        if want and got and want != got:
            raise RuntimeError(f"a different camera ({got}) is answering at {d['host']}; expected {want}. "
                               "Not sampling — confirm the unit in the Hardware page.")
        self.cam = cam
        self._start_video()

    def _start_video(self):
        from video_analytics import VideoStream, WindowAnalyzer, box_px  # noqa
        if self.posture is None:
            self._load_posture()
        d = self.dev
        thermal_posture = self.posture if self.behaviour_stream() == "thermal" else None
        self._video_started = getattr(self, "_video_started", None) or time.time()
        if self.video is None or not self.video.is_alive():
            self.analyzer = WindowAnalyzer(mode="thermal", posture=thermal_posture)

            def on_thermal(frame, t):
                rois = self.dev.get("rois") or {}
                nb = box_px(rois["nostril"]) if rois.get("nostril") else None
                with self._lock:
                    self.analyzer.feed(frame, nb, t=t)

            self.video = VideoStream(d["host"], d.get("username", "admin"), d.get("password") or "", on_thermal,
                                     port=d.get("rtspPort", 554), path="/media/live/202")
            self.video.start()
        rois = d.get("rois") or {}
        want_visible = self.behaviour_stream() == "visible" or rois.get("flank")
        if want_visible and (self.vvideo is None or not self.vvideo.is_alive()):
            vw, vh = self.VISIBLE_SIZE
            self.vanalyzer = WindowAnalyzer(mode="visible", w=vw, h=vh)

            def on_visible(frame, t):
                r = self.dev.get("rois") or {}
                fb = self.flank_bounds(r)
                fo, ig = self.motion_region(t)
                with self._lock:
                    self.vanalyzer.feed(frame, flank_bounds=fb, t=t, focus=fo, ignore=ig)
                    self.last_visible = (frame, t)

            started_detector = False
            if self.behaviour_stream() == "visible" and self.detector is None and self.detector_note is None:
                from detector import load  # noqa
                self.detector, self.detector_note = load(os.environ.get("EQUICARE_DETECTOR_MODEL"))
                if self.detector_note:
                    print(f"[edge] {self.name}: {self.detector_note} — lying is not measured")
                else:
                    started_detector = True

            # The detector (and recognition) look at the colour frame itself:
            # far better than grey for a brown horse on brown straw (2 Oct).
            def on_colour(frame, t):
                with self._lock:
                    self.last_colour = (frame, t)
            # Full HD colour when the camera is set to it: the same picture,
            # less compressed; analysed at the same small size.
            vpath = "/media/live/101" if d.get("colourStream") == "main" else "/media/live/102"
            self.vvideo = VideoStream(d["host"], d.get("username", "admin"), d.get("password") or "", on_visible,
                                      port=d.get("rtspPort", 554), path=vpath, w=vw, h=vh,
                                      on_colour=on_colour if self.detector is not None else None)
            self.vvideo.start()
            if started_detector:
                threading.Thread(target=self._detect_loop, daemon=True, name=f"detect:{self.name}").start()

    def _detect_loop(self):
        """The horse's box in the colour picture, once a second, into the
        posture tracker (standing / lying from the box's shape over time), the
        colour floor watcher (urination / manure on the bedding) and, while
        the horse stands still, the flank region for breathing."""
        st = {"last": None, "history": []}
        while not self.stop_evt.is_set():
            self.stop_evt.wait(self.DETECT_EVERY_S)
            if not self._detect_step(st):
                return

    def _detect_step(self, st):
        """One look for the horse in the latest colour frame (see _detect_loop).
        st carries the last frame's time and the 30 s of boxes between calls.
        False when the detector failed and should not be asked again. Also
        called directly by edge/replay.py, once per second of recorded video."""
        from behaviour import flank_from_box  # noqa
        from colour_floor import ColourFloorWatcher  # noqa
        from video_analytics import box_px  # noqa
        from detector import iou, pick_horse  # noqa
        vw, vh = self.VISIBLE_SIZE
        with self._lock:
            snap = self.last_visible
            colour = getattr(self, "last_colour", None)
            motion = self.vanalyzer.recent_motion() if self.vanalyzer else 0.0
        if not snap or snap[1] == st["last"]:
            return True
        st["last"] = snap[1]
        # The detector sees the colour picture of this second when there is
        # one (edge/replay.py decodes it), else the grey analysis frame.
        look = colour[0] if colour and abs(colour[1] - snap[1]) <= 1.5 else snap[0]
        try:
            if hasattr(self.detector, "detect_all"):
                boxes, persons = self.detector.detect_all(look, vw, vh)
            else:
                boxes, persons = self.detector.detect(look, vw, vh), []
        except Exception as e:                              # noqa: BLE001
            print(f"[edge] {self.name}: detector failed ({e}) — lying not measured")
            self.detector, self.detector_note = None, f"detector failed: {e}"
            return False
        best = pick_horse(boxes, st.setdefault("scene", []))   # not the stall's opening (see pick_horse)
        if best:
            best["edges"] = (best["x0"] <= 0.01) + (best["y0"] <= 0.01) + (best["x1"] >= 0.99) + (best["y1"] >= 0.99)
            self.boxes_seen += 1
            self.box_widths.append(best["x1"] - best["x0"])
        t = snap[1]

        def px(b, m):
            return (max(0, int((b["x0"] - m) * vw)), max(0, int((b["y0"] - m) * vh)),
                    min(vw - 1, int((b["x1"] + m) * vw)), min(vh - 1, int((b["y1"] + m) * vh)))
        with self._lock:                                     # movement is counted on the horse, not on people
            self.horse_focus = px(best, 0.05) if best else None
            self.people_px = [px(b, 0.02) for b in persons]
            self._focus_t = t
            if persons:
                self.people_s += self.DETECT_EVERY_S
        history = [(ht, hb) for ht, hb in st["history"] if t - ht <= 30] + ([(t, best)] if best else [])
        st["history"] = history
        still = bool(best) and motion < 0.1 and len(history) >= 20 and all(iou(hb, best) >= 0.85 for _, hb in history)
        # Breathing from the flank wherever the horse stands still, its whole
        # body in view (a box touching 2+ edges is a horse filling the view:
        # its middle need not be the flank — the drawn box is used then).
        # The region only moves when the horse does: the detector's box
        # jitters by a pixel or two every second, and any change of region
        # restarts the breathing count, so a flank still overlapping the
        # horse's current one is kept as it is.
        here = flank_from_box(best, vw, vh) if best and best.get("edges", 0) <= 1 else None
        if here is not None and self.auto_flank is not None and _iou_px(here, self.auto_flank) >= 0.6:
            pass                                             # same horse, same place: keep the region steady
        elif here is not None and still:
            self.auto_flank = here
        else:
            self.auto_flank = None
        rois = self.dev.get("rois") or {}
        # The floor is only watched where someone drew it: a guessed area
        # may be the horse's body or a wall (camera close to the horse).
        bounds = box_px(rois["colourFloor"], vw, vh) if rois.get("colourFloor") else None
        if bounds is None:
            self.cfloor = None
        elif self.cfloor is None or self.cfloor.bounds != bounds:
            self.cfloor = ColourFloorWatcher(vw, vh, bounds)
        with self._lock:
            self.posture.feed(t, best, motion)
            moving = self.vanalyzer.motion.moving_cells(self.cfloor.bounds, self.cfloor.COLS, self.cfloor.ROWS, 30) \
                if (self.vanalyzer and self.cfloor) else set()
        state = self._budget_state(best, motion, rois.get("hay"))
        with self._lock:
            self.budget[state] = self.budget.get(state, 0) + self.DETECT_EVERY_S
            if best:                                         # where he stood: his hooves, the box's bottom middle
                cx, cy = (best["x0"] + best["x1"]) / 2, best["y1"]
                cell = min(self.GRID[1] - 1, int(cy * self.GRID[1])) * self.GRID[0] + min(self.GRID[0] - 1, int(cx * self.GRID[0]))
                self.where[cell] = self.where.get(cell, 0) + self.DETECT_EVERY_S
        evs = self.cfloor.feed(snap[0], t, best, still, moving) if self.cfloor else []
        if evs:
            with self._lock:
                self.cfloor_events += evs
        if best and look is not snap[0]:                     # recognition needs the colour frame
            self._identity_step(look, vw, vh, best, persons, t)
        return True

    IDENTITY_EVERY_S = 120.0           # a look at who the horse is, every 2 min of video
    LEARN_UP_TO = 60                   # gallery size learned automatically for the stall's horse

    def _identity_step(self, frame, w, h, best, persons, t):
        """Is the horse in this stall the one the roster puts here? Every
        IDENTITY_EVERY_S with a clear view (whole horse, no people): its
        fingerprint against the enrolled horses (edge/identity.py), sent as
        horse_identity. While the stall's horse has a small gallery, clear
        looks that are not clearly another enrolled horse are added to it."""
        mine = self.dev.get("stallHorse") or {}
        if persons or best.get("edges", 0) >= 2 or (best["x1"] - best["x0"]) * (best["y1"] - best["y0"]) < 0.03:
            return
        if t - getattr(self, "_id_last", -1e9) < self.IDENTITY_EVERY_S or not mine.get("id"):
            return
        if getattr(self, "identifier", None) is None:
            if getattr(self, "identity_note", None):
                return
            from identity import Gallery, load  # noqa
            self.identifier, self.identity_note = load(os.environ.get("EQUICARE_IDENTITY_MODEL"))
            if self.identity_note:
                print(f"[edge] {self.name}: {self.identity_note} — horse recognition off")
                return
            self.gallery = Gallery(STATE_DIR / "identity.json")
        from identity import decide  # noqa
        import numpy as np
        self._id_last = t
        try:
            vec = self.identifier.embed(np.frombuffer(frame, dtype=np.uint8).reshape(h, w, 3), best)
        except Exception as e:                              # noqa: BLE001
            print(f"[edge] {self.name}: horse recognition failed ({e}) — off")
            self.identifier, self.identity_note = None, f"recognition failed: {e}"
            return
        if vec is None:
            return
        res = decide(self.gallery, vec, mine["id"])
        names = {k: h.get("name", k) for k, h in self.gallery.data["horses"].items()}
        if self.dev.get("identityLearn", True) and res["verdict"] != "other" and res["samples"] < self.LEARN_UP_TO:
            if self.gallery.add(mine["id"], vec, t=t, name=mine.get("name"), src=self.dev["id"]):
                self.gallery.save()
                res["learned"] = True
        res.update(assignedName=mine.get("name") or mine["id"], bestName=names.get(res["best"]) if res["best"] else None)
        self.emit([dict(deviceId=self.dev["id"], metric="horse_identity", value=round(res["assignedScore"] or 0.0, 3),
                        unit="score", ts=now_iso(), source="visible_video", confidence=1.0, meta=res)])

    def _live_breathing(self, rois):
        """The breathing rate of the last 35 s, for the Live view, sent at once
        (respiratory_rate_live_bpm, a diagnostic: the minute's
        respiratory_rate_bpm stays the record). Nothing is sent when no rate
        is found — the minute's breathing_check says why."""
        with self._lock:
            rec = self.analyzer.breathing_recent(compute_resp_rate) if self.analyzer else {}
            vrec = self.vanalyzer.breathing_recent(compute_resp_rate) if self.vanalyzer else {}
        br = (rec.get("nostril") or {}) if getattr(self, "_head_in_view", True) else {}
        pick, method = pick_breathing(br, vrec.get("flank") or {}, self.auto_flank is not None)
        if not pick:
            return
        calibrated = bool(self.dev.get("calibrated"))
        meta = {"method": method + " · last 35 s", "seconds": pick.get("seconds"), "rolling": True, "calibrated": calibrated,
                "regularity": None if pick.get("regularity") is None else round(pick["regularity"], 2)}
        if pick is br and rois.get("nostril"):
            meta["box"] = rois["nostril"]
        self.emit([dict(deviceId=self.dev["id"], metric="respiratory_rate_live_bpm", value=round(pick["bpm"], 1), unit="bpm",
                        ts=now_iso(), source="thermal_video" if pick is br else "visible_video",
                        confidence=round(min(0.95, pick["strength"]) if calibrated else 0.3, 2), meta=meta)])

    GRID = (12, 8)                     # where he stood: the colour picture split 12 across, 8 down

    def _budget_state(self, best, motion, hay):
        """This second, for the time budget: lying (the posture model),
        eating (his box well over the hay drawn at calibration, and moving a
        little — head down, chewing), standing at rest (still), moving about,
        or not seen. motion is the horse's own (people left out)."""
        if self.posture is not None and self.posture.state == "lying":
            return "lying"
        if not best:
            return "unseen"
        if hay and motion >= 0.05:
            hx0, hy0, hx1, hy1 = hay["x0"] / 10000, hay["y0"] / 10000, hay["x1"] / 10000, hay["y1"] / 10000
            ix = max(0.0, min(best["x1"], hx1) - max(best["x0"], hx0))
            iy = max(0.0, min(best["y1"], hy1) - max(best["y0"], hy0))
            area = max(1e-9, (best["x1"] - best["x0"]) * (best["y1"] - best["y0"]))
            if ix * iy / area >= 0.3:
                return "eating"
        return "resting" if motion < 0.1 else "moving"

    def motion_region(self, t):
        """(focus, ignore) for the colour movement at time t: the horse's box
        and the people's, from the last look (held 3 s); (None, ()) with no
        detector — the whole picture, as before."""
        if self._focus_t is None or t - self._focus_t > 3:
            return None, ()
        return self.horse_focus, tuple(self.people_px)

    def flank_bounds(self, rois):
        """Where to watch the flank this frame: the horse's own flank when the
        detector sees it standing still, whole body in view — the boxes follow
        the horse round the stall — else the flank box drawn at calibration."""
        from video_analytics import box_px  # noqa
        if self.auto_flank is not None:
            self.flank_followed = True
            return self.auto_flank
        vw, vh = self.VISIBLE_SIZE
        return box_px(rois["flank"], vw, vh) if rois.get("flank") else None

    def _auto_eye(self):
        """An eye anywhere in the thermal view: a coarse 16×12 scan of pixel
        reads for warm points on a head, then a close 7×7 look around each of
        the three warmest; the first that is eye-shaped (behaviour.eye_spot)
        wins. (°C, None, where), or (None, why not, None); where is the
        warmest read of that eye, 0–10000, for the Live view."""
        from behaviour import eye_spot, hotspot_candidates  # noqa
        from mtrpc import to_cam, clamp_cam  # noqa
        cols, rows = 16, 12
        pts = [{"x": clamp_cam(to_cam((i + 0.5) * 10000 / cols)), "y": clamp_cam(to_cam((j + 0.5) * 10000 / rows))}
               for j in range(rows) for i in range(cols)]
        cands = hotspot_candidates(self.cam.read_pixels(pts), cols, rows, 3)
        if not cands:
            return None, "no eye-warm point on a head in the thermal view", None
        why = None
        hw, hh = 10000 / cols, 10000 / rows
        for c, r, _ in cands:
            cx, cy = (c + 0.5) * hw, (r + 0.5) * hh
            fine = [{"x": clamp_cam(to_cam(cx - hw + 2 * hw * i / 6)), "y": clamp_cam(to_cam(cy - hh + 2 * hh * j / 6))}
                    for j in range(7) for i in range(7)]
            vals = self.cam.read_pixels(fine)
            eye, why = eye_spot(vals, 7, 7)
            if eye is not None:
                return eye, None, _warmest(vals, [{"x": cx - hw + 2 * hw * i / 6, "y": cy - hh + 2 * hh * j / 6}
                                                  for j in range(7) for i in range(7)])
        return None, why, None

    def _note_eye(self, why):
        """Log once when the eye goes out of view (and why), and when it is back."""
        if why != getattr(self, "_eye_why", None):
            print(f"[edge] {self.name}: " + (f"no eye temperature — {why}" if why else "eye in view again"))
            self._eye_why = why

    def warnings(self):
        out = []
        for name, v in (("thermal video", self.video), ("colour video", self.vvideo)):
            if name == "colour video" and v is None and self.behaviour_stream() != "visible":
                continue
            if v is None:
                out.append(f"{name} not started")
            elif v.error:
                out.append(f"{name}: {v.error}")
            elif v.is_alive() and getattr(v, "frames", 1) == 0 and time.time() - getattr(self, "_video_started", time.time()) > 30:
                out.append(f"{name}: connected but no frames yet")
        if self.behaviour_stream() == "visible" and self.detector_note:
            out.append(f"lying and colour floor not measured — {self.detector_note}")
        return out[:4]

    def _log_warnings(self):
        w = self.warnings()
        if w != getattr(self, "_last_warnings", None):
            for line in w:
                print(f"[edge] {self.name}: {line}")
            if not w and getattr(self, "_last_warnings", None):
                print(f"[edge] {self.name}: video and detector OK again")
            self._last_warnings = w

    def _floor_scan(self, rois, calib, lying_recent):
        from floor import FloorTracker  # noqa
        from video_analytics import box_px  # noqa
        from mtrpc import to_cam, clamp_cam  # noqa
        if not rois.get("floor"):
            self.floor = None
            return []
        key = (calib.get("deltaC"), calib.get("urineHalfLifeMin"), tuple(sorted(rois["floor"].items())))
        if self.floor is None or getattr(self, "_floor_key", None) != key:
            self.floor = FloorTracker(delta_c=calib.get("deltaC"), urine_half_life_min=calib.get("urineHalfLifeMin"))
            self._floor_key = key
        pts = [{"x": clamp_cam(to_cam(p["x"])), "y": clamp_cam(to_cam(p["y"]))} for p in self.floor.grid(rois["floor"])]
        temps = self.cam.read_pixels(pts)
        horse = set()
        if self.analyzer is not None:
            with self._lock:
                horse = self.analyzer.motion.moving_cells(box_px(rois["floor"]), self.floor.cols, self.floor.rows, 30)
        return self.floor.scan(temps, horse_cells=horse, lying_recent=lying_recent)

    def _run_once(self):
        rois = self.dev.get("rois")
        if not rois or not rois.get("nostril"):
            raise NoRois("the camera answers but has no ROIs — calibrate it in the Hardware page")
        if self.cam is None:
            self.connect()
        else:
            self._start_video()                              # a stream may have died, or a flank box was added
        video_ok = self.video is not None and self.video.is_alive() and not self.video.error
        vis_ok = self.vvideo is not None and self.vvideo.is_alive() and not self.vvideo.error
        self._log_warnings()
        with self._lock:
            self.analyzer.reset()
            if self.vanalyzer:
                self.vanalyzer.reset()
        self.boxes_seen, self.box_widths = 0, []
        self.flank_followed = False
        self.people_s = 0
        with self._lock:
            self.budget, self.where = {}, {}
        pixel_window, floor_events = [], []
        calib = self.dev.get("floorCalib") or {}
        t0 = last_floor = last_live = time.time()
        while time.time() - t0 < self.window_s and not self.stop_evt.is_set():
            tick = time.time()
            rois = self.dev.get("rois") or rois               # re-aimed mid-window: follow it
            if video_ok and self.LIVE_BREATH_EVERY_S and tick - last_live >= self.LIVE_BREATH_EVERY_S:
                self._live_breathing(rois)
                last_live = tick
            if not video_ok:                                  # fallback: pixel-sampled breathing
                v = self.cam.box_avg(rois["nostril"])
                if v is not None:
                    pixel_window.append(v)
            if tick - last_floor >= self.FLOOR_EVERY_S:
                lying_recent = self.posture is not None and self.posture.state == "lying"
                floor_events += self._floor_scan(rois, calib, lying_recent)
                last_floor = tick
            self.stop_evt.wait(max(0.0, (1.0 / self.target_hz if not video_ok else 0.5) - (time.time() - tick)))
        if self.stop_evt.is_set():
            return
        with self._lock:
            summary = self.analyzer.summary(compute_resp_rate) if video_ok else {}
            vsummary = self.vanalyzer.summary(compute_resp_rate) if (vis_ok and self.vanalyzer) else {}
            posture = self.posture.drain() if self.posture else None
        if self.posture is not None:
            self._save_posture()
        # The eye, if it is in view: eye-shaped, not just warm (see behaviour.eye_spot).
        from behaviour import eye_spot  # noqa
        eye, eye_why, eye_method, box_peak, eye_at, eye_where = None, "no eye box drawn", None, None, None, None
        if rois.get("eye") and "x0" in rois["eye"]:
            vals, cols, rows = self.cam.box_grid(rois["eye"])
            eye, eye_why = eye_spot(vals, cols, rows)
            eye_method, eye_at = "eye box, eye-shaped hot spot", time.time()
            box_peak = max((v for v in vals if v is not None), default=None)
            if eye is not None:
                b = rois["eye"]
                eye_where = _warmest(vals, [{"x": b["x0"] + (b["x1"] - b["x0"]) * i / max(1, cols - 1),
                                             "y": b["y0"] + (b["y1"] - b["y0"]) * j / max(1, rows - 1)}
                                            for j in range(rows) for i in range(cols)])
        in_boxes = eye is not None                           # the head is where the boxes were drawn
        if eye is None:
            # The head is not in the eye box: look for the eye anywhere in the
            # thermal view (one camera, aimed where the head spends most time).
            eye, why, eye_where = self._auto_eye()
            eye_method, eye_at = "eye-shaped hot spot, found anywhere in view (eye box missed)", time.time()
            eye_why = None if eye is not None else f"eye box: {eye_why}; rest of the view: {why}"
        self._note_eye(eye_why if eye is None else None)
        nostril_c = self.cam.box_avg(rois["nostril"])
        calibrated = bool(self.dev.get("calibrated"))
        ts, out = now_iso(), []
        dev_id = self.dev["id"]

        # Is a horse there at all? An empty stall is not a horse at rest, and
        # its "eye box" reads the wall. (A real recording: empty 87 of 133
        # minutes, 86 of which a movement-only rule counted as rest.) The
        # thermal view only covers the head, so the colour view counts too: a
        # detector box, or movement.
        from video_analytics import horse_present  # noqa
        from mtrpc import grid_points  # noqa
        grid = self.cam.read_pixels(grid_points({"x0": 0, "y0": 0, "x1": 10000, "y1": 10000}, 8))
        present, why = horse_present(grid, eye if eye is not None else box_peak)   # warm eye box: a head filling the view
        seen_colour = self.boxes_seen > 0 or (vsummary.get("activity") or 0) >= 0.05
        if present is False and not seen_colour:
            if getattr(self, "_absent_logged", False) is False:
                print(f"[edge] {self.name}: no horse in view ({why}) — reporting nothing until one is")
                self._absent_logged = True
            self.emit([])
            return
        self._absent_logged = False
        head_in_view = present is not False
        self._head_in_view = head_in_view                   # for the 10 s breathing until the next window

        def add(metric, value, unit, source="thermal_camera", conf=0.95, at=None, **meta):
            out.append(dict(deviceId=dev_id, metric=metric, value=round(value, 3), unit=unit, ts=at or ts,
                            source=source, confidence=round(conf, 2), meta=meta))

        vit = {"calibrated": calibrated}
        if head_in_view:                                     # vitals only when the head is in the thermal view
            if eye is not None:
                add("body_temp_c", eye, "°C", conf=(0.95 if eye_method.startswith("eye box") else 0.7) if calibrated else 0.3,
                    method=eye_method, readAt=round(eye_at, 1), where=eye_where, **vit)   # when the eye was read: a report's photo comes from then
            if nostril_c is not None and in_boxes:          # the nostril box is on the nostril only when the eye box is on the eye
                add("nostril_temp_c", nostril_c, "°C", conf=0.9 if calibrated else 0.3, method="nostril box average", **vit)
        # Why the eye was (not) read this minute, and where it was found — the
        # Live view shows it, so a missing temperature says why, not just "old".
        add("eye_check", 1 if eye is not None and head_in_view else 0, "0/1", conf=1.0,
            detail=eye_method if eye is not None and head_in_view else (eye_why or "head not in the thermal view"),
            **({"where": eye_where} if eye is not None and eye_where else {}))
        br = summary.get("breathing") or {} if head_in_view else {}
        fl = vsummary.get("flank_breathing") or {}
        pick, method = pick_breathing(br, fl, self.flank_followed)
        bs = (summary.get("breathing_search") or {}) if head_in_view else {}
        if pick is br and br:
            pick = dict(br, box=rois.get("nostril"))
        elif not pick and bs.get("bpm"):
            # The head was not where the boxes were drawn: breathing found by
            # searching the whole thermal view. Said so, with less confidence.
            pick, method = bs, "thermal video, breathing found by search (head not in the boxes)"
        if pick:
            conf = min(0.8 if pick is bs else 0.95, pick["strength"]) if calibrated else 0.3
            add("respiratory_rate_bpm", pick["bpm"], "bpm", conf=conf, method=method,
                **({"box": pick["box"]} if pick.get("box") else {}),
                regularity=None if pick.get("regularity") is None else round(pick["regularity"], 2),
                intervalCv=None if pick.get("intervalCv") is None else round(pick["intervalCv"], 3),
                band=pick.get("band"), seconds=pick.get("seconds"), **vit)
        elif not video_ok and head_in_view:
            rr, q = compute_resp_rate(pixel_window, len(pixel_window) / self.window_s if pixel_window else 1, with_quality=True)
            if rr:
                pick, method = {"bpm": rr}, "pixel sampling"
                add("respiratory_rate_bpm", rr, "bpm", conf=min(0.95, q) if calibrated else 0.3,
                    method="pixel sampling", regularity=round(q, 2), **vit)
        # Why breathing was or was not measured this window — so a session can
        # say which cause dominates (and whether following the nostril when
        # the head moves would be worth building).
        nostril, flank = breathing_why(video_ok, head_in_view, bool(rois.get("eye")), in_boxes,
                                       summary.get("breathing"), vis_ok, vsummary.get("flank_breathing"))
        add("breathing_check", 1 if pick else 0, "0/1", source="thermal_video", conf=1.0,
            reason="measured" if pick else nostril, nostril=nostril, flank=flank,
            detail=f"{method}" if pick else BREATHING_WHY[nostril],
            **({"box": pick["box"]} if pick and pick.get("box") else {}),
            stillS=(summary.get("breathing") or {}).get("seconds"))
        # Behaviour — prototype heuristics, reported as such.
        bstream = self.behaviour_stream()
        bsum = vsummary if (bstream == "visible" and vsummary) else summary
        bsrc = "visible_video" if bsum is vsummary and vsummary else "thermal_video"
        proto = {"prototype": True, "presence": why if present else "seen in the colour view", "stream": bsrc}
        wmin = round((bsum.get("seconds") or 0) / 60, 2)
        # People at the stall: their movement is left out of the horse's, and
        # rhythms are not judged while they are there (handling, mucking out).
        horse_only = bsrc == "visible_video" and self.detector is not None
        crowded = self.people_s >= 10
        if "activity" in bsum:
            add("activity_index", bsum["activity"], "0..1", source=bsrc, conf=0.6,
                method=f"{bsrc.replace('_', ' ')} motion" + (" (the horse only)" if horse_only else ""),
                **({"peopleS": self.people_s} if horse_only else {}), **proto)
            add("inactive_minutes", bsum["inactive_min"], "min", source=bsrc, conf=0.6,
                method="stillness (not lying-down)", windowMin=wmin, **proto)
        wv = bsum.get("weave") or {}
        if wv.get("detected") and not crowded:
            add("vice_event", 1, "event", source=bsrc, conf=min(0.8, wv["strength"]), kind="weaving",
                hz=round(wv["hz"], 2), cv=round(wv["cv"], 3), windowMin=wmin,
                method="regular side-to-side sway rhythm", **proto)
        # Box walking is a habit of many minutes: laps in two windows running.
        # Not judged when the horse fills the colour view — the view is then
        # narrower than the stall and a horse turning round looks like laps.
        bw = bsum.get("box_walk") or {}
        widths = sorted(self.box_widths)
        fills = bsrc == "visible_video" and len(widths) >= 5 and widths[len(widths) // 2] >= self.FILLS_VIEW
        walking = bool(bw.get("detected")) and not fills and not crowded
        if walking and self._walk_prev:
            add("vice_event", 1, "event", source=bsrc, conf=min(0.7, bw["strength"]), kind="box_walking",
                hz=round(bw["hz"], 3), laps=round(bw["laps"], 1),
                windowMin=round(wmin + (self._walk_prev if self._walk_prev is not True else 0), 2),
                method="laps of the stall, in consecutive windows", **proto)
            self._walk_prev = True                           # later windows of the same bout count their own minutes
        else:
            self._walk_prev = wmin if walking else None      # held until the next window confirms it
        ht = bsum.get("head_toss") or {}
        if ht.get("detected") and not crowded:
            add("vice_event", 1, "event", source=bsrc, conf=min(0.6, ht["strength"]), kind="head_tossing",
                hz=round(ht["hz"], 2), windowMin=wmin, method="regular up-down head rhythm, in place", **proto)
        if horse_only:
            add("people_in_view_s", self.people_s, "s", source="visible_video", conf=1.0, windowMin=wmin,
                method="people seen in the colour picture, once a second")
            with self._lock:
                budget, where = dict(self.budget), sorted(self.where.items())
            if budget:
                add("time_budget", sum(budget.values()), "s", source="visible_video", conf=0.5, windowMin=wmin,
                    **{f"{k}S": budget.get(k, 0) for k in ("lying", "eating", "resting", "moving", "unseen")},
                    hay=bool(rois.get("hay")), grid=f"{self.GRID[0]}x{self.GRID[1]}", where=[[c, v] for c, v in where],
                    method="once a second from the colour picture: lying (posture model), eating (at the hay, moving a little), "
                           "standing at rest, moving about", prototype=True)
        # Posture: lying minutes and events, once this stall's model has
        # seen both standing and lying.
        if posture and posture["observed_s"] > 0 and self.posture.model:
            psrc = "thermal_video" if bstream == "thermal" else "visible_video"
            pm = {**proto, "stream": psrc, "method": "horse box shape over time (per-stall)" +
                  ("" if bstream == "thermal" else ", colour detector")}
            add("lying_minutes", posture["lying_s"] / 60, "min", source=psrc, conf=0.5,
                lateralMin=round(posture["lateral_s"] / 60, 2), observedMin=round(posture["observed_s"] / 60, 2),
                windowMin=wmin, **pm)
            for ev in posture["events"]:
                add("posture_event", 1, "event", source=psrc, conf=0.5 if ev["kind"] in ("lie_down", "get_up") else 0.35,
                    at=dt.datetime.fromtimestamp(ev["t"], dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
                    kind=ev["kind"], **pm)
        # Colour-picture floor events; one also seen by the thermal floor check
        # within 5 minutes is the same event, now confirmed by both.
        with self._lock:
            colour_events, self.cfloor_events = self.cfloor_events, []
        # A real urination or manure leaves one new patch. Several appearing
        # within seconds of each other is the bedding being moved — the horse
        # walking through the hay, mucking out (2 Oct's night: three 'events'
        # in 4 s as the horse stepped forward over the hay). Not events.
        colour_events = [ce for ce in colour_events
                         if not any(o is not ce and abs(o["start"] - ce["start"]) <= self.DISTURBED_S for o in colour_events)]
        thermal = [e for e in floor_events if e.get("kind")]
        for ce in colour_events:
            twin = next((e for e in thermal if e["kind"] == ce["kind"] and abs(e["start"] - ce["start"]) <= 300), None)
            if twin:
                twin["confidence"] = min(0.8, twin["confidence"] + 0.15)
                twin["tier"] = "thermal + colour"
                continue
            add(f"{ce['kind']}_event", 1, "event", source="visible_video", conf=ce["confidence"],
                at=dt.datetime.fromtimestamp(ce["start"], dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
                tier=ce["tier"], area=ce["area"], darkening=ce["darkening"], texture=ce["texture"],
                horseStoodThere=ce["horseStoodThere"],
                method="new patch on the bedding in the colour picture (shape and texture)", prototype=True)
        for ev in floor_events:
            if not ev.get("kind"):
                continue                                     # rejected (a body print) — not an event
            add(f"{ev['kind']}_event", 1, "event", source="thermal_video", conf=ev["confidence"],
                at=dt.datetime.fromtimestamp(ev["start"], dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
                tier=ev["tier"], halfLifeMin=ev["half_life_min"], peakRiseC=ev["peak_rise_c"],
                area=ev["area_max"], spread=ev["spread"], shapeAgrees=ev["shape_agrees"],
                method="warm patch on the floor, classified by how it cooled", prototype=True)
        self.emit(out)

    def stop(self):
        Worker.stop(self)
        for v in (self.video, self.vvideo):
            if v is not None:
                v.stop()
        try:
            if self.cam is not None:
                self.cam.logout()                     # the camera allows only a couple of sessions
        except Exception:                                   # noqa: BLE001
            pass


def camera_worker_for(dev, sink, window_s):
    """ISAPI or JSON-RPC, as the portal detected it; asks the camera if unknown."""
    proto = dev.get("protocol") or "auto"
    if proto == "auto":
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from mtrpc import detect  # noqa
        proto = "mtrpc" if detect(dev["host"], dev.get("httpPort", 80)) else "isapi"
    return (MtrpcCameraWorker if proto == "mtrpc" else CameraWorker)(dev, sink, window_s)


# Register `use` -> which intake processor turns its values into events
# (edge/intake.py), and the source those events carry.
USE_SOURCE = {"flow": "flow_meter", "bucket": "flow_meter", "feed_bowl": "feeder", "hay": "feeder", "fault": "feeder"}
# The processors work in grams / ml; a register scaled to kg or litres in the
# portal is converted here.
TO_GRAMS = {"kg": 1000, "l": 1000, "litre": 1000, "litres": 1000, "liter": 1000, "liters": 1000}


def iso_at(t):
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class ModbusWorker(Worker):
    """Any Modbus sensor, per its register map — over TCP, or RTU on an RS-485
    line (`transport: "rtu"`, serialPort / baud / parity / stopBits).

    'gauge' registers report their value; 'counter' registers (a flow meter's
    running total) report the increase since the last poll. The first poll only
    sets the baseline, and a counter that goes backwards (meter reset, rollover)
    re-baselines instead of reporting a negative intake.

    A register with a `use` is not reported value by value: its readings go
    through an intake processor that keeps state across polls — "flow" (meter
    total -> drinking bouts), "bucket" (weighed bucket -> bouts and refills),
    "feed_bowl" (weigh-back bowl -> offered / eaten / left per meal), "hay"
    (weighed net -> hay eaten per hour), "fault" (fault code -> feeder_fault).
    Its `metric` is then ignored: the processor decides what it measured."""

    def __init__(self, dev, sink):
        super().__init__(dev, sink)
        self.last = {}
        self.procs = {}            # register name -> (use, intake processor)
        self.clock = time.time

    def read(self, addr, count):
        d = self.dev
        if d.get("transport") == "rtu":
            return modbus_read_rtu(d, d.get("unitId", 1), d.get("function", 3), addr, count)
        return modbus_read(d["host"], d.get("port", 502), d.get("unitId", 1), d.get("function", 3), addr, count)

    def processor(self, reg):
        use = reg["use"]
        have = self.procs.get(reg["name"])
        if have is not None and have[0] == use:
            return have[1]
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import intake  # noqa: PLC0415
        if use not in intake.PROCESSORS:
            raise ValueError(f"unknown register use \"{use}\" (one of {', '.join(intake.PROCESSORS)})")
        key = f"{self.dev['id']}:{reg['name']}"
        proc = (intake.FeederFault(key, codes=reg.get("faultCodes")) if use == "fault"
                else intake.PROCESSORS[use](key))
        self.procs[reg["name"]] = (use, proc)
        return proc

    def intake_readings(self, use, events):
        return [dict(deviceId=self.dev["id"], metric=e["metric"], value=e["value"], unit=e["unit"],
                     ts=iso_at(e["t"]), source=USE_SOURCE[use], confidence=0.9,
                     **({"meta": e["meta"]} if e.get("meta") else {}))
                for e in events]

    def run_once(self):
        d, out, ts, t = self.dev, [], now_iso(), self.clock()
        errors, fed = [], set()
        for reg in d.get("registers", []):
            try:
                addr = reg["address"] - 1 if d.get("addressing") == "one-based" else reg["address"]
                regs = self.read(addr, MODBUS_TYPES[reg["type"]])
                raw = modbus_decode(regs, reg["type"], reg.get("wordOrder", "high-first"))
                value = raw * reg.get("scale", 1) + reg.get("offset", 0)
                if reg.get("use"):
                    if value != value or value in (float("inf"), float("-inf")):
                        raise ValueError("the sensor sent no number (NaN) — check its wiring or its error register")
                    proc = self.processor(reg)
                    if reg["use"] != "fault":
                        value *= TO_GRAMS.get(str(reg.get("unit") or "").lower(), 1)
                    out += self.intake_readings(reg["use"], proc.add(t, value))
                    fed.add(reg["name"])
                    continue
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
        # A register that failed this round still closes what is due (a
        # drinking bout whose 60 s gap has passed).
        for name, (use, proc) in self.procs.items():
            if name not in fed:
                out += self.intake_readings(use, proc.tick(t))
        self.emit(out)
        if errors:
            raise RuntimeError("; ".join(errors)[:300])
        self.stop_evt.wait(d.get("pollSeconds", 10))

    def warnings(self):
        return [w for _, p in self.procs.values() if (w := getattr(p, "warning", None))]

    def describe(self, e):
        if self.dev.get("transport") == "rtu":
            return str(e) or type(e).__name__               # RTU errors already name the port
        return super().describe(e)

    def stop(self):
        super().stop()
        if self.dev.get("transport") == "rtu":
            rtu_bus_release(self.dev["id"])


class EdgeRuntime:
    def __init__(self, server, token, window_s=60, recordings=None, recordings_cap_gb=100):
        self.server, self.token, self.window_s = server.rstrip("/"), token, window_s
        self.workers = {}          # id -> (worker, connection fingerprint)
        self.recorders = {}        # id -> (CameraRecorder, fingerprint)
        self.recordings, self.recordings_cap_gb = recordings, recordings_cap_gb
        self.retention = None
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
                "function", "addressing", "pollSeconds", "registers", "serial", "configError", "protocol", "rtspPort",
                "behaviourStream", "colourStream", "transport", "serialPort", "baud", "parity", "stopBits")
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
            w = camera_worker_for(d, enqueue, self.window_s) if d["kind"] == "thermal_camera" else ModbusWorker(d, enqueue)
            print(f"[edge] starting {w.name}")
            w.start()
            self.workers[did] = (w, self._fingerprint(d))
        self._apply_recording(wanted)

    def _apply_recording(self, wanted):
        """Record the cameras switched to "record" in the Hardware page."""
        from recorder import CameraRecorder, RetentionThread, recordings_dir  # noqa
        rec = {did: d for did, d in wanted.items()
               if d["kind"] == "thermal_camera" and d.get("record") and d.get("protocol") == "mtrpc"}
        for did in list(self.recorders):
            r, fp = self.recorders[did]
            if did not in rec or self._fingerprint(rec[did]) != fp:
                r.stop()
                del self.recorders[did]
        root = Path(self.recordings) if self.recordings else recordings_dir()
        for did, d in rec.items():
            if did in self.recorders:
                continue
            r = CameraRecorder(d, root)
            r.start()
            self.recorders[did] = (r, self._fingerprint(d))
        if self.recorders and self.retention is None:
            self.retention = RetentionThread(root, self.recordings_cap_gb)
            self.retention.start()
        for did, d in wanted.items():
            if d["kind"] == "thermal_camera" and d.get("record") and d.get("protocol") not in ("mtrpc",):
                print(f"[edge] {d['name']}: recording is only available for JSON-RPC cameras so far — not recording")

    def heartbeat(self):
        body = {"agent": {"version": AGENT_VERSION, "host": socket.gethostname(),
                          "uptimeS": int(time.time() - self.started)},
                "devices": [w.health() for w, _ in self.workers.values()]}
        try:
            self._req("POST", "/edge/heartbeat", body)
        except Exception as e:                                  # noqa: BLE001
            print(f"[edge] heartbeat failed ({e})")

    def run(self, refresh_s=60, flush_s=5, beat_s=30):
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
            for r, _ in self.recorders.values():
                r.stop()
            flush(self.server, self.token)

# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default=os.environ.get("EQUICARE_API", "http://127.0.0.1:8080"))
    ap.add_argument("--server", help="server mode: the site server URL; devices come from the Hardware page")
    ap.add_argument("--refresh", type=int, default=60, help="server mode: seconds between config refreshes")
    ap.add_argument("--recordings", default=os.environ.get("EQUICARE_RECORDINGS_DIR"),
                    help="server mode: where to keep camera recordings (default ~/EquiCare-demo/recordings)")
    ap.add_argument("--recordings-cap-gb", type=float, default=100, help="delete the oldest clips beyond this size")
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
        EdgeRuntime(a.server, a.token, window_s=a.window, recordings=a.recordings,
                    recordings_cap_gb=a.recordings_cap_gb).run(refresh_s=a.refresh)
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
