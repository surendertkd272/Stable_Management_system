"""The edge agent (edge/mtrpc.py) and the server (server/mtrpc.mjs) must sample
the same pixels for a box and compute the same login response — otherwise the
calibrator would show one temperature and the readings another.

Run: python3 edge/mtrpc_parity_test.py
"""
import json
import random
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from mtrpc import grid_points, login_response, pixel_value, to_cam, from_cam  # noqa: E402

rng = random.Random(8192)
fails = 0


def check(name, ok, detail=""):
    global fails
    if not ok:
        fails += 1
        print(f"FAIL {name} {detail}")


boxes = []
for _ in range(300):
    x0, y0 = rng.randint(0, 9800), rng.randint(0, 9800)
    boxes.append({"box": {"x0": x0, "y0": y0, "x1": min(10000, x0 + rng.randint(50, 4000)),
                          "y1": min(10000, y0 + rng.randint(50, 4000))}, "n": rng.choice([5, 16])})
logins = [{"username": "admin", "password": rng.choice(["Cam@123", "x", "päss"]), "realm": "A9FNF",
           "nonce": f"n{i}", "qop": "auth", "cnonce": f"c{i}"} for i in range(20)]

js = """
import("%s").then(({ gridPoints, loginResponse, toCam, fromCam }) => {
  let d = ""; process.stdin.on("data", (c) => (d += c)).on("end", () => {
    const { boxes, logins, coords } = JSON.parse(d);
    process.stdout.write(JSON.stringify({
      grids: boxes.map((b) => gridPoints(b.box, b.n)),
      logins: logins.map((l) => loginResponse(l)),
      coords: coords.map((v) => [toCam(v), fromCam(v)]),
    }));
  });
});
""" % (HERE.parent / "server" / "mtrpc.mjs").as_uri()
coords = list(range(0, 10001, 37)) + [8192, 8191, 10000]
run = subprocess.run(["node", "-e", js], input=json.dumps({"boxes": boxes, "logins": logins, "coords": coords}),
                     capture_output=True, text=True, timeout=60)
if run.returncode != 0:
    print("FAIL node ran", run.stderr[-400:])
    sys.exit(1)
got = json.loads(run.stdout)

for i, (b, g) in enumerate(zip(boxes, got["grids"])):
    check(f"grid {i}", grid_points(b["box"], b["n"]) == g, f"{b}")
for i, (l, r) in enumerate(zip(logins, got["logins"])):
    check(f"login {i}", login_response(**l) == r)
for v, (tc, fc) in zip(coords, got["coords"]):
    check(f"coord {v}", (to_cam(v), from_cam(v)) == (tc, fc), f"py={(to_cam(v), from_cam(v))} js={(tc, fc)}")

# The camera's out-of-frame sentinels are never readings.
check("0.00 is a sentinel", pixel_value({"data": {"temperature": "0.00"}}) is None)
check("-1.00 is a sentinel", pixel_value({"data": {"temperature": "-1.00"}}) is None)
check("a real value", pixel_value({"data": {"temperature": "37.50"}}) == 37.5)

print(f"{len(boxes)} grids, {len(logins)} logins, {len(coords)} coordinates compared")
print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
