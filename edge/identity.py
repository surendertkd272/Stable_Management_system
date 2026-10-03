"""Which horse is this? — recognition from the colour picture.

Horses are told apart by people from their markings (blaze, star, socks),
coat and build; the forehead whorl and the iris are as individual as a
fingerprint but need a close-up (USDA APHIS equine identification guide;
Trokielewicz & Szadkowski, iris/periocular CNNs). A stall camera 3–4 m away
sees the markings and the build, so EquiCare compares the whole horse.

How: the horse's box from the detector (detector.py) is cut out of the colour
frame and turned into a fingerprint — a 768-number description from DINOv2
(Meta, Apache-2.0; ViT-S/14, a general image model that was not trained on
horses and is not fine-tuned here): the CLS token and the mean of the patch
tokens, each made unit length. Each horse has a gallery of fingerprints taken
at different times (standing, eating, day, night); a new look is scored by
its mean cosine similarity to the best few of each gallery.

Only enrolled horses can be recognised, and the scores mean little until
several horses are enrolled from the same kind of view: the thresholds below
are a starting point to be set from those galleries (see tools/horse_id.py
test). Optional, like the detector: needs numpy + onnxruntime and the model
(~/EquiCare-demo/models/dinov2_small.onnx, 88 MB, from
huggingface.co/onnx-community/dinov2-small).
"""
import base64
import json
import os
import time
from pathlib import Path

DEFAULT_MODEL = Path.home() / "EquiCare-demo" / "models" / "dinov2_small.onnx"
SIZE = 224                                   # 16 × 16 patches of 14 px
MEAN = (0.485, 0.456, 0.406)                 # ImageNet, as DINOv2 was trained (RGB)
STD = (0.229, 0.224, 0.225)

# Scores (mean cosine similarity of the best few). Starting points, ours —
# to be replaced by values measured on enrolled galleries (tools/horse_id.py).
SAME_MIN = 0.70        # at least this like the stall's horse: it is that horse
MARGIN = 0.05          # and this much more like it than any other enrolled horse
TOP_K = 5
MIN_SAMPLES = 12       # a gallery smaller than this is still learning
MIN_GAP_S = 300        # gallery samples at least 5 min apart (different poses)


def resize_bilinear(img, out_h, out_w):
    """img: (h, w, 3) uint8 -> (out_h, out_w, 3) float32, without OpenCV
    (the edge box has numpy and onnxruntime only)."""
    import numpy as np
    h, w = img.shape[:2]
    ys = (np.arange(out_h) + 0.5) * h / out_h - 0.5
    xs = (np.arange(out_w) + 0.5) * w / out_w - 0.5
    y0 = np.clip(np.floor(ys).astype(int), 0, h - 1)
    x0 = np.clip(np.floor(xs).astype(int), 0, w - 1)
    y1, x1 = np.clip(y0 + 1, 0, h - 1), np.clip(x0 + 1, 0, w - 1)
    wy = np.clip(ys - y0, 0, 1)[:, None, None]
    wx = np.clip(xs - x0, 0, 1)[None, :, None]
    f = img.astype(np.float32)
    top = f[y0][:, x0] * (1 - wx) + f[y0][:, x1] * wx
    bot = f[y1][:, x0] * (1 - wx) + f[y1][:, x1] * wx
    return top * (1 - wy) + bot * wy


def crop_square(img, box, margin=0.05):
    """The horse's box (0..1 of the frame) with a margin, padded to a square
    with the crop's mean colour so its shape is not stretched."""
    import numpy as np
    h, w = img.shape[:2]
    x0 = max(0, int((box["x0"] - margin) * w)); x1 = min(w, int((box["x1"] + margin) * w))
    y0 = max(0, int((box["y0"] - margin) * h)); y1 = min(h, int((box["y1"] + margin) * h))
    c = img[y0:y1, x0:x1]
    if c.size == 0:
        return None
    ch, cw = c.shape[:2]
    side = max(ch, cw)
    out = np.empty((side, side, 3), dtype=np.uint8)
    out[:] = c.reshape(-1, 3).mean(0).astype(np.uint8)
    oy, ox = (side - ch) // 2, (side - cw) // 2
    out[oy:oy + ch, ox:ox + cw] = c
    return out


class HorseEmbedder:
    def __init__(self, model_path=None):
        import numpy as np
        import onnxruntime as ort
        self.np = np
        opts = ort.SessionOptions()
        threads = int(os.environ.get("EQUICARE_DETECTOR_THREADS") or 0)
        if threads > 0:
            opts.intra_op_num_threads = threads
            opts.inter_op_num_threads = 1
        providers = ["CPUExecutionProvider"]
        if os.environ.get("EQUICARE_DETECTOR_PROVIDER") == "coreml" and "CoreMLExecutionProvider" in ort.get_available_providers():
            providers = ["CoreMLExecutionProvider", "CPUExecutionProvider"]
        ort.set_default_logger_severity(3)
        self.sess = ort.InferenceSession(str(model_path or DEFAULT_MODEL), sess_options=opts, providers=providers)
        self.inp = self.sess.get_inputs()[0].name

    def embed(self, img_bgr, box):
        """img_bgr: (h, w, 3) uint8, box: the horse (0..1). A unit vector, or
        None when the box is empty."""
        np = self.np
        sq = crop_square(img_bgr, box)
        if sq is None:
            return None
        x = resize_bilinear(sq[:, :, ::-1], SIZE, SIZE) / 255.0          # BGR -> RGB
        x = (x - np.array(MEAN, dtype=np.float32)) / np.array(STD, dtype=np.float32)
        out = self.sess.run(None, {self.inp: x.transpose(2, 0, 1)[None].astype(np.float32)})[0][0]
        cls, patches = out[0], out[1:].mean(0)
        v = np.concatenate([cls / (np.linalg.norm(cls) + 1e-9), patches / (np.linalg.norm(patches) + 1e-9)])
        return (v / (np.linalg.norm(v) + 1e-9)).astype(np.float32)


def load(model_path=None):
    """A HorseEmbedder, or (None, reason) when it cannot run here."""
    try:
        return HorseEmbedder(model_path), None
    except ImportError as e:
        return None, f"horse recognition needs numpy + onnxruntime ({e.name} missing)"
    except Exception as e:                                   # noqa: BLE001
        return None, f"horse recognition model not loaded: {e}"


def _pack(v):
    import numpy as np
    return base64.b64encode(np.asarray(v, dtype=np.float16).tobytes()).decode()


def _unpack(s):
    import numpy as np
    return np.frombuffer(base64.b64decode(s), dtype=np.float16).astype(np.float32)


class Gallery:
    """Each horse's fingerprints, kept in a JSON file:
    {"horses": {id: {"name", "samples": [{"t", "v", "src"}]}}}."""

    def __init__(self, path):
        self.path = Path(path)
        try:
            self.data = json.loads(self.path.read_text())
        except Exception:                                    # noqa: BLE001  (first use)
            self.data = {"horses": {}}
        self._cache = {}

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data))
        tmp.replace(self.path)

    def horses(self):
        return {k: len(h["samples"]) for k, h in self.data["horses"].items()}

    def vectors(self, horse_id):
        import numpy as np
        h = self.data["horses"].get(horse_id)
        if not h or not h["samples"]:
            return None
        key = (horse_id, len(h["samples"]))
        if key not in self._cache:
            self._cache = {k: v for k, v in self._cache.items() if k[0] != horse_id}
            self._cache[key] = np.stack([_unpack(s["v"]) for s in h["samples"]])
        return self._cache[key]

    def add(self, horse_id, vec, t=None, name=None, src="", min_gap_s=MIN_GAP_S, max_samples=200):
        """Adds a sample when the last one is at least min_gap_s older (or the
        sample comes from another source). True when added."""
        t = time.time() if t is None else t
        h = self.data["horses"].setdefault(horse_id, {"name": name or horse_id, "samples": []})
        if name:
            h["name"] = name
        same_src = [s for s in h["samples"] if s.get("src") == src]
        if same_src and abs(t - max(s["t"] for s in same_src)) < min_gap_s:
            return False
        h["samples"].append({"t": round(t, 1), "v": _pack(vec), "src": src})
        if len(h["samples"]) > max_samples:                  # keep a spread over time: drop every other old one
            h["samples"] = h["samples"][:-max_samples // 2:2] + h["samples"][-max_samples // 2:]
        return True

    def score(self, vec, horse_id, k=TOP_K):
        import numpy as np
        g = self.vectors(horse_id)
        if g is None:
            return None
        sims = g @ vec
        top = np.sort(sims)[-min(k, len(sims)):]
        return float(top.mean())

    def rank(self, vec):
        out = [(h, self.score(vec, h)) for h in self.data["horses"]]
        return sorted([x for x in out if x[1] is not None], key=lambda x: -x[1])


def decide(gallery, vec, assigned):
    """What this look says about the horse in a stall whose horse is
    `assigned`: {"verdict": "match" | "other" | "unsure" | "learning", ...}.
    "other" only when another enrolled horse is clearly more alike."""
    ranked = gallery.rank(vec)
    n = gallery.horses().get(assigned, 0)
    mine = next((s for h, s in ranked if h == assigned), None)
    best, best_s = (ranked[0] if ranked else (None, None))
    second = next((s for h, s in ranked if h != best), None)
    out = {"assigned": assigned, "assignedScore": None if mine is None else round(mine, 3),
           "best": best, "bestScore": None if best_s is None else round(best_s, 3),
           "enrolled": len(ranked), "samples": n}
    if n < MIN_SAMPLES:
        out["verdict"] = "learning"
    elif best == assigned and mine >= SAME_MIN and (second is None or mine - second >= MARGIN):
        out["verdict"] = "match"
    elif best != assigned and best_s >= SAME_MIN and best_s - (mine or 0) >= MARGIN:
        out["verdict"] = "other"
    else:
        out["verdict"] = "unsure"
    return out
