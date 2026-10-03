"""Horse recognition: build a horse's gallery from recorded video, and measure
how well the galleries tell horses apart. See edge/identity.py.

  # enrol: fingerprints of the horse in these clips, every 2 min of video
  python3 tools/horse_id.py enrol --horse badal --name Badal \\
      --clips ~/EquiCare-demo/recordings/devices-1790666091722-307/visible \\
      --from 2026-10-01T20-50 --to 2026-10-02T06-10

  # test: same horse at later times vs other horses (clips or photos)
  python3 tools/horse_id.py test --horse badal --clips <dir> --from … --to … \\
      --others <dir or photos> …

Run with the edge venv (numpy + onnxruntime): ~/EquiCare-demo/edge-venv/bin/python.
Galleries live in ~/EquiCare-demo/state/identity.json unless --gallery says.
"""
import argparse
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "edge"))
import numpy as np  # noqa: E402
from detector import HorseDetector, pick_horse  # noqa: E402
import identity  # noqa: E402

GALLERY = Path.home() / "EquiCare-demo" / "state" / "identity.json"


def clip_start(p):
    try:
        return dt.datetime.strptime(p.stem, "%Y-%m-%dT%H-%M-%S")
    except ValueError:
        return None


def frames(clips, every_s, t0=None, t1=None, w=704, h=576):
    """(time, BGR frame) every `every_s` seconds of the clips in [t0, t1)."""
    for c in clips:
        start = clip_start(c)
        out = subprocess.run(["ffmpeg", "-v", "error", "-i", str(c), "-vf", f"fps=1/{every_s},scale={w}:{h}",
                              "-pix_fmt", "bgr24", "-f", "rawvideo", "pipe:1"], capture_output=True, timeout=600).stdout
        n = w * h * 3
        for i in range(len(out) // n):
            t = start + dt.timedelta(seconds=(i + 0.5) * every_s) if start else None
            if t is not None and ((t0 and t < t0) or (t1 and t >= t1)):
                continue
            yield t, np.frombuffer(out[i * n:(i + 1) * n], dtype=np.uint8).reshape(h, w, 3)


def photos(paths, w=704):
    for p in paths:
        out = subprocess.run(["ffmpeg", "-v", "error", "-i", str(p), "-vf", f"scale={w}:-2", "-pix_fmt", "bgr24",
                              "-f", "rawvideo", "pipe:1"], capture_output=True, timeout=60).stdout
        probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0",
                                "-f", "image2pipe", "-i", str(p)], capture_output=True, text=True).stdout
        try:
            iw, ih = map(int, probe.strip().split("\n")[0].split(","))
        except ValueError:
            continue
        h = round(ih * w / iw / 2) * 2
        if len(out) >= w * h * 3:
            yield p.name, np.frombuffer(out[:w * h * 3], dtype=np.uint8).reshape(h, w, 3)


def horse_box(det, img, scene, allow_close=False):
    """The horse's box, or None: no horse, people in the picture, a horse
    too small, or (unless allow_close) one cut by two or more frame edges."""
    h, w = img.shape[:2]
    boxes, persons = det.detect_all(img.tobytes(), w, h)
    if persons:
        return None
    b = pick_horse(boxes, scene)
    if not b:
        return None
    edges = (b["x0"] <= 0.01) + (b["y0"] <= 0.01) + (b["x1"] >= 0.99) + (b["y1"] >= 0.99)
    if (b["x1"] - b["x0"]) * (b["y1"] - b["y0"]) < 0.03 or (edges >= 2 and not allow_close):
        return None
    return b


def looks(det, emb, source, every_s, t0, t1, allow_close):
    """(label, vector) for each usable look at the horse in `source`
    (a folder of clips, or photos)."""
    src = Path(source).expanduser()
    files = sorted(src.glob("*.mp4")) if src.is_dir() else [src]
    if src.is_dir() and not files:
        files = sorted(p for p in src.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"))
    scene = []
    if files and files[0].suffix == ".mp4":
        it = frames(files, every_s, t0, t1)
    else:
        it = photos(files)
        allow_close = True
    for t, img in it:
        b = horse_box(det, img, scene if files[0].suffix == ".mp4" else [], allow_close)
        if b is None:
            continue
        v = emb.embed(img, b)
        if v is not None:
            yield (t.isoformat() if hasattr(t, "isoformat") else str(t)), v


def when(s):
    return dt.datetime.strptime(s, "%Y-%m-%dT%H-%M") if s else None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("enrol", "test"):
        p = sub.add_parser(name)
        p.add_argument("--horse", required=True)
        p.add_argument("--name")
        p.add_argument("--clips", required=True)
        p.add_argument("--from", dest="t0")
        p.add_argument("--to", dest="t1")
        p.add_argument("--every", type=int, default=120, help="seconds of video between looks")
        p.add_argument("--gallery", default=str(GALLERY))
        p.add_argument("--close", action="store_true", help="also use a horse filling the view (camera close to it)")
        if name == "test":
            p.add_argument("--others", nargs="*", default=[], help="folders of clips or photos of OTHER horses")
            p.add_argument("--json")
    a = ap.parse_args()
    det, emb = HorseDetector(), identity.HorseEmbedder()

    if a.cmd == "enrol":
        g = identity.Gallery(a.gallery)
        added = seen = 0
        for label, v in looks(det, emb, a.clips, a.every, when(a.t0), when(a.t1), a.close):
            seen += 1
            t = dt.datetime.fromisoformat(label).timestamp() if "T" in label else None
            added += g.add(a.horse, v, t=t, name=a.name, src=Path(a.clips).name, min_gap_s=a.every)
        g.save()
        print(f"{a.horse}: {seen} looks at the horse, {added} added; gallery {g.horses()}")
        return

    # test: gallery from the first half of the window, scores on the second
    # half (same horse) and on the others (different horses).
    mine = list(looks(det, emb, a.clips, a.every, when(a.t0), when(a.t1), a.close))
    half = len(mine) // 2
    g = identity.Gallery("/dev/null")
    for i, (label, v) in enumerate(mine[:half]):
        g.add(a.horse, v, t=i * 1e6, src="enrol")
    same = [g.score(v, a.horse) for _, v in mine[half:]]
    other = {}
    for src in a.others:
        other[Path(src).name] = [g.score(v, a.horse) for _, v in looks(det, emb, src, a.every, None, None, True)]   # any view of another horse
    allo = [s for v in other.values() for s in v]

    def q(x):
        return {k: round(float(np.percentile(x, p)), 3) for k, p in (("min", 0), ("p05", 5), ("median", 50), ("p95", 95), ("max", 100))} if x else {}
    res = {"horse": a.horse, "enrolled": half, "same": {"n": len(same), **q(same)},
           "others": {k: {"n": len(v), **q(v)} for k, v in other.items()}}
    if same and allo:
        best = max(((thr, np.mean([s >= thr for s in same]), np.mean([s < thr for s in allo]))
                    for thr in np.arange(0.3, 0.99, 0.005)), key=lambda x: x[1] + x[2])
        res["bestThreshold"] = {"score": round(float(best[0]), 3), "sameAccepted": round(float(best[1]), 3),
                                "othersRejected": round(float(best[2]), 3)}
        res["atSameMin"] = {"score": identity.SAME_MIN, "sameAccepted": round(float(np.mean([s >= identity.SAME_MIN for s in same])), 3),
                            "othersRejected": round(float(np.mean([s < identity.SAME_MIN for s in allo])), 3)}
    print(json.dumps(res, indent=1))
    if a.json:
        Path(a.json).write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
