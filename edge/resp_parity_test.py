"""The calibration check in the browser (server/respiration.mjs) must judge a
camera with exactly the algorithm the edge agent uses for its readings
(compute_resp_rate). Same inputs, same answer — including "no rhythm".

Run: python3 edge/resp_parity_test.py
"""
import json
import math
import random
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from edge_agent import compute_resp_rate, roi_readings  # noqa: E402

rng = random.Random(20260925)
fails = 0


def check(name, ok, detail=""):
    global fails
    if not ok:
        fails += 1
        print(f"FAIL {name} {detail}")


def breath(bpm, fs, seconds, noise, amp=0.4, drift=0.0, step_at=None):
    n = int(fs * seconds)
    out = []
    for i in range(n):
        t = i / fs
        v = 36.0 + amp * math.sin(2 * math.pi * bpm / 60 * t) + drift * t + rng.gauss(0, noise)
        if step_at is not None and t >= step_at:
            v += 2.0
        out.append(v)
    return out


vecs = []
for _ in range(400):
    fs = rng.choice([1.0, 2.0, 3.7, 4.83, 5.0, 10.0])
    kind = rng.random()
    if kind < 0.55:
        s = breath(rng.uniform(7, 34), fs, rng.choice([20, 30, 60, 90]), rng.uniform(0, 0.5), drift=rng.uniform(-0.01, 0.01))
    elif kind < 0.7:
        s = [36 + rng.gauss(0, 0.3) for _ in range(int(fs * 60))]          # pure noise
    elif kind < 0.8:
        s = breath(0, fs, 60, 0.02, amp=0, step_at=30)                     # a step, no breathing
    elif kind < 0.9:
        s = [36.0] * int(fs * 60)                                          # flatline
    else:
        s = breath(16, fs, rng.uniform(3, 14), 0.05)                       # too short
    vecs.append({"fs": fs, "s": s})

js = """
import("%s").then(({ computeRespRate }) => {
  let d = ""; process.stdin.on("data", (c) => (d += c)).on("end", () => {
    const out = JSON.parse(d).map((v) => computeRespRate(v.s, v.fs));
    process.stdout.write(JSON.stringify(out));
  });
});
""" % (HERE.parent / "server" / "respiration.mjs").as_uri()
run = subprocess.run(["node", "-e", js], input=json.dumps(vecs), capture_output=True, text=True, timeout=120)
if run.returncode != 0:
    print("FAIL node respiration ran", run.stderr[-400:])
    sys.exit(1)
got = json.loads(run.stdout)

found = 0
for i, (v, j) in enumerate(zip(vecs, got)):
    bpm, q = compute_resp_rate(v["s"], v["fs"], with_quality=True)
    if bpm is None:
        check(f"vec {i}: both find no rhythm", j["bpm"] is None, f"js={j['bpm']}")
    else:
        found += 1
        check(f"vec {i}: same rate", j["bpm"] is not None and abs(j["bpm"] - bpm) < 1e-9, f"py={bpm} js={j['bpm']}")
    check(f"vec {i}: same periodicity", abs(j["periodicity"] - q) < 1e-9, f"py={q} js={j['periodicity']}")
check("the vectors exercised both outcomes", 50 < found < len(vecs) - 50, f"found={found}/{len(vecs)}")

# Eye and nostril are matched by type AND id, in any order.
rows = [{"type": "Area", "id": 1, "max_c": 36.8, "avg_c": 36.4},
        {"type": "Area", "id": 0, "max_c": 37.75, "avg_c": 33.0},
        {"type": "Point", "id": 0, "point_c": 31.0}]
check("eye = Area 0 max, nostril = Area 1 avg", roi_readings(rows) == (37.75, 36.4), str(roi_readings(rows)))
check("order does not matter", roi_readings(rows[::-1]) == (37.75, 36.4))
check("legacy point eye still read",
      roi_readings([{"type": "Point", "id": 0, "point_c": 37.1}, {"type": "Area", "id": 1, "avg_c": 36.0}]) == (37.1, 36.0))
check("unrelated ROIs are not the eye or nostril", roi_readings([{"type": "Area", "id": 5, "avg_c": 20}]) == (None, None))

print(f"{len(vecs)} windows compared, {found} with a rhythm found")
print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
