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


# --------------------------------------------------------------------------- #
# transport (offline-buffered)
# --------------------------------------------------------------------------- #
def enqueue(readings):
    with QUEUE.open("a") as f:
        for r in readings:
            f.write(json.dumps(r) + "\n")


def flush(api_url, token=""):
    if not QUEUE.exists():
        return 0, 0
    lines = QUEUE.read_text().splitlines()
    if not lines:
        return 0, 0
    batch = [json.loads(x) for x in lines]
    try:
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        req = urllib.request.Request(
            f"{api_url}/ingest/readings",
            data=json.dumps({"readings": batch}).encode(),
            headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=10) as resp:
            res = json.loads(resp.read())
        QUEUE.unlink()  # sent -> clear buffer
        if res.get("unattributed"):
            print(f"[edge] WARNING: {res['unattributed']} reading(s) matched no horse — "
                  f"unknown stall(s): {', '.join(str(s) for s in res.get('unknownStalls', []))}")
        return res.get("accepted", 0), res.get("dropped", 0)
    except Exception as e:
        print(f"[edge] flush failed ({e}); {len(batch)} readings stay queued")
        return 0, 0


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
    acf = {}
    for lag in range(lo, hi):
        overlap = n - lag
        acf[lag] = (sum(x[i] * x[i + lag] for i in range(overlap)) / overlap) / unit

    best_lag = max(acf, key=acf.get)
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


def real_camera(api_url, ip, user, password, stall, horse_id, live, interval, token="",
                http_port=80, window_s=60, target_hz=5.0):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from sparsh_camera import IsapiClient  # noqa

    cam = IsapiClient(ip, user, password, port=http_port)
    if not cam.login():
        sys.exit("[edge] camera login failed")
    cam.set_basic_param(emissivity_100=98, distance_cm=350)
    cam.set_point(0, 5000, 5000, name="eye")                      # eye/max ROI
    cam.set_area(1, [(4200, 5200), (5800, 5200), (5800, 6400), (4200, 6400)], name="nostril")
    print(f"[edge] camera {ip}:{http_port} ROIs set; sampling {window_s}s windows…")

    while True:
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
        if latest.get("Point", {}).get("point_c") is not None:
            batch.append(reading(horse_id, stall, "body_temp_c", latest["Point"]["point_c"], "°C", now, "thermal_camera"))
        rr, quality = compute_resp_rate(window, fs, with_quality=True)
        if rr:
            # Report the measured rhythm strength as confidence rather than a
            # flat guess, so weak windows are visibly weaker downstream.
            batch.append(reading(horse_id, stall, "respiratory_rate_bpm", rr, "bpm", now,
                                 "thermal_camera", conf=round(min(0.95, quality), 2)))
        else:
            print(f"[edge] no usable breathing rhythm this window "
                  f"(periodicity {quality:.2f} < {RESP_MIN_PERIODICITY}) — reporting nothing")
        enqueue(batch)
        a, _ = flush(api_url, token)
        print(f"[edge] camera tick -> {len(batch)} readings (resp={rr}), accepted {a}")
        if not live:
            return


# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default=os.environ.get("EQUICARE_API", "http://127.0.0.1:8080"))
    ap.add_argument("--simulate", action="store_true")
    ap.add_argument("--backfill-days", type=int, default=14)
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--interval", type=int, default=10)
    ap.add_argument("--camera"); ap.add_argument("--user", default="admin"); ap.add_argument("--pass", dest="pw")
    ap.add_argument("--http-port", type=int, default=80,
                    help="camera ISAPI port (use 8080 against tools/mock_camera.py)")
    ap.add_argument("--window", type=int, default=60,
                    help="seconds of nostril samples per respiration estimate")
    ap.add_argument("--stall", default="A-04",
                    help="the stall this camera watches; the backend maps it to the horse")
    ap.add_argument("--horse", default=None,
                    help="optional: pin readings to a horse id instead of resolving by stall")
    ap.add_argument("--token", default=os.environ.get("EQUICARE_TOKEN", ""),
                    help="device ingest token (Bearer) if the backend requires one")
    a = ap.parse_args()

    if a.simulate:
        simulate(a.api, a.backfill_days, a.live, a.interval, a.token)
    elif a.camera:
        real_camera(a.api, a.camera, a.user, a.pw, a.stall, a.horse, a.live, a.interval,
                    a.token, http_port=a.http_port, window_s=a.window)
    else:
        ap.error("choose --simulate or --camera <ip>")


if __name__ == "__main__":
    main()
