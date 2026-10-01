"""Where is the horse in the colour picture? — an optional detector.

YOLOX (Megvii, Apache-2.0) trained on COCO, which has a "horse" class. It
gives a box around each horse; the box's shape over time is what tells
standing from lying (the method dairy research validated for cows: box
height, width/height and centre, smoothed — Adriaens et al., Wageningen 2022).

Optional: needs numpy + onnxruntime and a model file (yolox_tiny.onnx, 20 MB,
from github.com/Megvii-BaseDetection/YOLOX releases; `scripts/demo.sh
--setup-detector` fetches both). Without them the edge agent runs without it
and says lying is not measured. Not trained on our stalls. On 60 open photos
(greyscale, 27 Sep): whole horses standing in stalls 7/7, lying on the chest
13/14, lying flat on the side 0/4 — the tracker treats "lost while lying" as
possibly flat on the side. Untested on night infrared video.
"""
import os
from pathlib import Path

COCO_HORSE = 17
DEFAULT_MODEL = Path.home() / "EquiCare-demo" / "models" / "yolox_tiny.onnx"


class HorseDetector:
    def __init__(self, model_path=None, score_min=0.3):
        import numpy as np
        import onnxruntime as ort
        self.np = np
        path = str(model_path or DEFAULT_MODEL)
        opts = ort.SessionOptions()
        # Several detectors side by side (edge/replay.py's parallel parts):
        # one thread each, or they fight over the cores.
        threads = int(os.environ.get("EQUICARE_DETECTOR_THREADS") or 0)
        if threads > 0:
            opts.intra_op_num_threads = threads
            opts.inter_op_num_threads = 1
        self.sess = ort.InferenceSession(path, sess_options=opts, providers=["CPUExecutionProvider"])
        inp = self.sess.get_inputs()[0]
        self.name = inp.name
        self.size = (inp.shape[2], inp.shape[3])            # (h, w), e.g. 416x416 for nano
        self.score_min = score_min
        self._grids = None

    def _decode(self, out):
        np = self.np
        if self._grids is None:
            grids, strides = [], []
            h, w = self.size
            for s in (8, 16, 32):
                gy, gx = np.meshgrid(np.arange(h // s), np.arange(w // s), indexing="ij")
                grids.append(np.stack((gx, gy), 2).reshape(-1, 2))
                strides.append(np.full((grids[-1].shape[0], 1), s))
            self._grids = (np.concatenate(grids), np.concatenate(strides))
        g, s = self._grids
        out = out.copy()
        out[:, :2] = (out[:, :2] + g) * s
        out[:, 2:4] = np.exp(out[:, 2:4]) * s
        return out

    def detect(self, gray, w, h):
        """gray: bytes, w*h 8-bit. Returns horse boxes, best first:
        [{x0, y0, x1, y1 (0..1 of the frame), score}]."""
        np = self.np
        img = np.frombuffer(gray, dtype=np.uint8).reshape(h, w)
        th, tw = self.size
        r = min(th / h, tw / w)
        nh, nw = int(h * r), int(w * r)
        # nearest-neighbour resize (no OpenCV on the edge image)
        ys = (np.arange(nh) / r).astype(int).clip(0, h - 1)
        xs = (np.arange(nw) / r).astype(int).clip(0, w - 1)
        small = img[ys][:, xs]
        canvas = np.full((th, tw), 114, dtype=np.float32)
        canvas[:nh, :nw] = small
        blob = np.repeat(canvas[None, None], 3, axis=1)      # grey -> 3 equal channels, BGR order irrelevant
        out = self.sess.run(None, {self.name: blob})[0][0]
        out = self._decode(out)
        scores = out[:, 4] * out[:, 5 + COCO_HORSE]
        keep = scores >= self.score_min
        boxes = []
        for (cx, cy, bw, bh), sc in zip(out[keep, :4], scores[keep]):
            cx, cy, bw, bh = float(cx), float(cy), float(bw), float(bh)
            x0, y0, x1, y1 = (cx - bw / 2) / r, (cy - bh / 2) / r, (cx + bw / 2) / r, (cy + bh / 2) / r
            boxes.append({"x0": max(0.0, x0 / w), "y0": max(0.0, y0 / h), "x1": min(1.0, x1 / w), "y1": min(1.0, y1 / h),
                          "score": float(sc)})
        return nms(sorted(boxes, key=lambda b: -b["score"]))


def iou(a, b):
    ix = max(0.0, min(a["x1"], b["x1"]) - max(a["x0"], b["x0"]))
    iy = max(0.0, min(a["y1"], b["y1"]) - max(a["y0"], b["y0"]))
    inter = ix * iy
    ua = (a["x1"] - a["x0"]) * (a["y1"] - a["y0"]) + (b["x1"] - b["x0"]) * (b["y1"] - b["y0"]) - inter
    return inter / ua if ua > 0 else 0.0


def _area(b):
    return (b["x1"] - b["x0"]) * (b["y1"] - b["y0"])


def _inside(outer, inner):
    """Share of `inner` that lies within `outer`."""
    ix = max(0.0, min(outer["x1"], inner["x1"]) - max(outer["x0"], inner["x0"]))
    iy = max(0.0, min(outer["y1"], inner["y1"]) - max(outer["y0"], inner["y0"]))
    return ix * iy / max(1e-9, _area(inner))


def pick_horse(boxes, scene=None):
    """The horse among the detector's boxes: the largest-and-surest — except a
    box drawn round the scene. On 1 Oct the detector took a stall's round
    opening for a horse: the top box covered most of the picture in 106 of 281
    sampled frames, and in 97 of them the real horse was a smaller box inside
    it. So a box over half the frame with a sure horse box (a third its size or
    less) inside it is the scene; `scene` (a list the caller keeps) remembers
    it, and a box matching a remembered scene box is dropped even in frames
    where the real horse was missed — the opening never moves, a horse does."""
    if not boxes:
        return None
    if scene is not None:
        for a in boxes:
            if _area(a) > 0.5 and any(b is not a and b["score"] >= 0.4 and _area(b) <= _area(a) / 3 and _inside(a, b) >= 0.9
                                      for b in boxes) and not any(iou(a, s) >= 0.85 for s in scene):
                scene.append({k: a[k] for k in ("x0", "y0", "x1", "y1")})
        boxes = [a for a in boxes if not any(iou(a, s) >= 0.85 for s in scene)]
        if not boxes:
            return None
    return max(boxes, key=lambda b: _area(b) * b["score"])


def nms(boxes, thr=0.45):
    kept = []
    for b in boxes:
        if all(iou(b, k) < thr for k in kept):
            kept.append(b)
    return kept


def load(model_path=None):
    """A HorseDetector, or (None, reason) when it cannot run here."""
    try:
        return HorseDetector(model_path), None
    except ImportError as e:
        return None, f"lying detection needs numpy + onnxruntime on the edge box ({e.name} missing)"
    except Exception as e:                                   # noqa: BLE001  (model file missing / unreadable)
        return None, f"lying detection model not loaded: {e}"
