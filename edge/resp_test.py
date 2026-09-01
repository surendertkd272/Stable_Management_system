#!/usr/bin/env python3
"""Regression tests for the respiration estimator (edge_agent.compute_resp_rate).

Run:  python3 edge/resp_test.py

The estimator's job is not only to be accurate when a breath is present — it is
to stay SILENT when one is not. A thermal ROI that has slipped off the nostril,
a horse that has turned away, a camera warming up: all feed the estimator noise,
and a naive peak-pick answers with a confident ~16 bpm, which reads on the
dashboard as a perfectly healthy horse. These tests pin both halves.

Stdlib only, seeded — same style as the server/*.test.mjs suite.
"""
import sys
import math
import random
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from edge_agent import compute_resp_rate, RESP_MIN_PERIODICITY   # noqa: E402

FS = 2.0          # nostril ROI sampled at 2 Hz
WINDOW_S = 60

_fail = []


def check(name, cond, detail=""):
    print(f"  {'ok  ' if cond else 'FAIL'}  {name}{'' if cond else '  <- ' + detail}")
    if not cond:
        _fail.append(name)


def synth(bpm, amp=0.40, noise=0.06, drift=0.0, dropout=0.0, secs=WINDOW_S):
    """A nostril-ROI temperature window. bpm=0 => no breathing at all."""
    n, out = int(FS * secs), []
    for i in range(n):
        t = i / FS
        v = 36.4 + drift * (t / secs)
        if bpm:
            v += amp * math.sin(2 * math.pi * (bpm / 60.0) * t)
        v += random.gauss(0, noise)
        if dropout and out and random.random() < dropout:
            v = out[-1]                      # sensor held the previous sample
        out.append(v)
    return out


print("\nrecovers a genuine rate across the equine band (6-36 bpm)")
for bpm in (8, 10, 12, 16, 20, 24, 30):
    random.seed(11)
    got = compute_resp_rate(synth(bpm), FS)
    check(f"{bpm} bpm", got is not None and abs(got - bpm) <= 2.5,
          f"got {got}")

print("\nsurvives real-world degradation")
for name, kw in [("baseline drift +2C", dict(drift=2.0)),
                 ("25% sample dropout", dict(dropout=0.25)),
                 ("moderate noise (SNR 2)", dict(amp=0.20, noise=0.10)),
                 ("short 20s window", dict(secs=20))]:
    random.seed(11)
    got = compute_resp_rate(synth(16, **kw), FS)
    check(name, got is not None and abs(got - 16) <= 2.5, f"got {got}")

print("\nreports NOTHING rather than inventing a plausible vital sign")
for name, kw in [("pure noise", dict(noise=0.10)),
                 ("noisier", dict(noise=0.25)),
                 ("noise + baseline ramp (ROI lost the nostril)",
                  dict(noise=0.10, drift=2.0))]:
    random.seed(11)
    got = compute_resp_rate(synth(0, **kw), FS)
    check(name, got is None, f"fabricated {got} bpm")

check("flatline (sensor stuck)",
      compute_resp_rate([36.4] * int(FS * WINDOW_S), FS) is None)
random.seed(11)
check("window too short to trust (10s)",
      compute_resp_rate(synth(16, secs=10), FS) is None)

print("\ndoes not halve the rate (period-doubling / subharmonic)")
# A clean breath correlates strongly at twice its period too. Picking that
# taller peak would report 8 bpm for a horse breathing 16 - turning developing
# tachypnoea into a normal reading, the exact direction we cannot afford.
for bpm in (16, 20, 24, 30):
    random.seed(11)
    got = compute_resp_rate(synth(bpm), FS)
    check(f"{bpm} bpm not reported as ~{bpm / 2:.0f}",
          got is not None and got > bpm * 0.75, f"got {got}")

print("\nnoise never fabricates a rate (500 windows)")
bogus = []
for s in range(500):
    random.seed(70000 + s)
    got = compute_resp_rate(synth(0, noise=random.choice([0.06, 0.10, 0.25])), FS)
    if got is not None:
        bogus.append(round(got, 1))
check(f"0/500 fabricated (gate {RESP_MIN_PERIODICITY})", not bogus,
      f"{len(bogus)} fabricated, e.g. {bogus[:5]}")

print("\ndetection rate by signal-to-noise ratio")
# Above SNR 2 we must be essentially perfect; below SNR 1 the breath is inside
# the noise and staying quiet is the correct answer, not a failure.
for amp, noise, floor, label in [(0.40, 0.06, 200, "SNR 6.7 - clean"),
                                 (0.30, 0.10, 200, "SNR 3.0 - good"),
                                 (0.20, 0.10, 195, "SNR 2.0 - usable")]:
    hits = 0
    for s in range(200):
        random.seed(80000 + s)
        bpm = random.choice([10, 14, 18, 22, 26])
        if compute_resp_rate(synth(bpm, amp=amp, noise=noise), FS) is not None:
            hits += 1
    check(f"{label}: {hits}/200 detected", hits >= floor, f"floor {floor}")

print("\nconfidence tracks measured rhythm strength")
random.seed(11)
_, q_clean = compute_resp_rate(synth(16), FS, with_quality=True)
random.seed(11)
_, q_weak = compute_resp_rate(synth(16, amp=0.20, noise=0.10), FS, with_quality=True)
check("clean window is more confident than a weak one",
      q_clean > q_weak, f"{q_clean:.2f} vs {q_weak:.2f}")
check("confidence stays in 0..1", 0.0 <= q_weak <= 1.0 and 0.0 <= q_clean <= 1.0)

print(f"\n{'ALL PASS' if not _fail else str(len(_fail)) + ' FAILED: ' + ', '.join(_fail)}\n")
sys.exit(1 if _fail else 0)
