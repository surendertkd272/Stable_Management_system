"""Horse recognition: the gallery and the decision, on synthetic fingerprints
(no model needed). Run: python3 edge/identity_test.py"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402
import identity  # noqa: E402
from identity import Gallery, crop_square, decide, resize_bilinear  # noqa: E402

rng = np.random.default_rng(3)
fails = 0


def check(name, ok, detail=""):
    global fails
    if not ok:
        fails += 1
        print(f"FAIL {name} {detail}")


def unit(v):
    return (v / np.linalg.norm(v)).astype(np.float32)


def looks_of(centre, n, spread):
    """n fingerprints of one horse: its own direction plus noise."""
    return [unit(centre + rng.normal(0, spread, centre.shape)) for _ in range(n)]


D = 768
badal, other = unit(rng.normal(size=D)), unit(rng.normal(size=D))

with tempfile.TemporaryDirectory() as tmp:
    g = Gallery(Path(tmp) / "identity.json")

    # Too few views: still learning, whatever it looks like.
    for i, v in enumerate(looks_of(badal, 5, 0.02)):
        g.add("badal", v, t=i * 600, name="Badal")
    r = decide(g, looks_of(badal, 1, 0.02)[0], "badal")
    check("small gallery is learning", r["verdict"] == "learning", r)

    # Samples closer than the gap are not added (the same pose twice).
    check("gap respected", g.add("badal", badal, t=4 * 600 + 100) is False)

    for i, v in enumerate(looks_of(badal, 20, 0.02)):
        g.add("badal", v, t=10_000 + i * 600)
    check("gallery grew", g.horses()["badal"] == 25, g.horses())
    r = decide(g, looks_of(badal, 1, 0.02)[0], "badal")
    check("same horse matches", r["verdict"] == "match" and r["assignedScore"] > identity.SAME_MIN, r)

    # A different, enrolled horse in Badal's stall: "other", named.
    for i, v in enumerate(looks_of(other, 20, 0.02)):
        g.add("raja", v, t=i * 600, name="Raja")
    r = decide(g, looks_of(other, 1, 0.02)[0], "badal")
    check("swapped horse is other", r["verdict"] == "other" and r["best"] == "raja", r)

    # An unknown horse (enrolled nowhere): not "match" and not "other".
    stranger = unit(rng.normal(size=D))
    r = decide(g, stranger, "badal")
    check("unknown horse is unsure", r["verdict"] == "unsure", r)

    # Saved and read back: the same scores (float16 storage).
    g.save()
    g2 = Gallery(Path(tmp) / "identity.json")
    v = looks_of(badal, 1, 0.02)[0]
    check("round trip", abs(g2.score(v, "badal") - g.score(v, "badal")) < 1e-3)
    check("names kept", g2.data["horses"]["raja"]["name"] == "Raja")

    # The gallery stays bounded, keeping old and new views.
    for i in range(300):
        g.add("raja", looks_of(other, 1, 0.02)[0], t=1e6 + i * 600)
    check("bounded", g.horses()["raja"] <= 200, g.horses())

# Crop: square, padded, the box's contents in the middle.
img = np.zeros((100, 200, 3), dtype=np.uint8)
img[20:80, 50:150] = (10, 200, 30)
sq = crop_square(img, {"x0": 0.25, "y0": 0.2, "x1": 0.75, "y1": 0.8}, margin=0)
check("crop is square", sq.shape[0] == sq.shape[1] == 100, sq.shape)
check("crop centre is the box", tuple(sq[50, 50]) == (10, 200, 30), sq[50, 50])
check("empty box", crop_square(img, {"x0": 0.5, "y0": 0.5, "x1": 0.5, "y1": 0.5}, margin=0) is None)
r = resize_bilinear(sq, 224, 224)
check("resize shape", r.shape == (224, 224, 3), r.shape)
check("resize keeps a flat colour", np.allclose(r[100, 100], (10, 200, 30), atol=1), r[100, 100])

# ---- when recognition looks (edge_agent._identity_due) ---------------------- #
from edge_agent import MtrpcCameraWorker  # noqa: E402
from video_analytics import read_ppm  # noqa: E402

w = MtrpcCameraWorker({"id": "cam", "name": "cam", "kind": "thermal_camera", "host": "x",
                       "stallHorse": {"id": "badal", "name": "Badal"}}, lambda r: None)
HORSE = {"x0": 0.2, "y0": 0.2, "x1": 0.6, "y1": 0.7, "edges": 0}
PERSON = [{"x0": 0.7, "y0": 0.1, "x1": 0.9, "y1": 0.9}]


def look(t, verdict="match"):
    """What _identity_step does when it looks."""
    w._idst.update(due=None, last_t=t, verdict=verdict)


check("first look is due", w._identity_due(HORSE, [], 0))
look(0)
check("matched: not due a minute later", not w._identity_due(HORSE, [], 60))
check("matched: not due at 19 min", not any(w._identity_due(HORSE, [], t) for t in range(61, 1140, 30)))
check("routine check at 20 min", w._identity_due(HORSE, [], 1200))
look(1200)
# out of view for 2 min, then back: look at once
for t in range(1201, 1330, 10):
    w._identity_due(None, [], t)
check("back in view", w._identity_due(HORSE, [], 1330) and w._idst["due"] == "back in view")
look(1330)
# a visit: people at the stall, then gone; due 30 s after they leave, never while there
check("not while people are there", not w._identity_due(HORSE, PERSON, 1400))
check("not right after they leave", not w._identity_due(HORSE, [], 1410))
check("after the visit", w._identity_due(HORSE, [], 1431) and w._idst["due"] == "after a visit")
look(1431, verdict="unsure")
check("unsure: again within 2 min", w._identity_due(HORSE, [], 1431 + 120))
look(1600, verdict="match")
check("partial view never", not w._identity_due(dict(HORSE, edges=2), [], 1600 + 1300))
check("busy never", (w._idst.update(busy=True), not w._identity_due(HORSE, [], 1600 + 1300))[1])
w._idst["busy"] = False
w.dev["stallHorse"] = None
check("no horse on the roster for the stall: never", not w._identity_due(HORSE, [], 1600 + 1400))

# ---- the full-HD still's format --------------------------------------------- #
ppm = b"P6\n# a comment\n2 1\n255\n" + bytes([10, 20, 30, 40, 50, 60])
got = read_ppm(ppm)
check("ppm read", got == (bytes([30, 20, 10, 60, 50, 40]), 2, 1), got)
check("not ppm", read_ppm(b"\x89PNG....") is None)
check("short ppm", read_ppm(b"P6 4 4 255\n" + bytes(10)) is None)

print("identity: all ok" if not fails else f"identity: {fails} failed")
sys.exit(1 if fails else 0)
