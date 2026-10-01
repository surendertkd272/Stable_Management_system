"""Where is the horse in a picture? For the client report's zoomed photos.

Reads one request per line on stdin — "<path of an 8-bit grey raw frame> <w> <h>"
— and answers one JSON line each: the best horse box {x0, y0, x1, y1, score}
(0..1 of the frame) or null. The detector (edge/detector.py, YOLOX on COCO)
loads once, so a report's dozens of frames cost one model load.

  ~/EquiCare-demo/edge-venv/bin/python tools/horse_boxes.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "edge"))
from detector import load, pick_horse  # noqa: E402

det, why = load()
scene = []                                                   # the stall's opening, once seen (pick_horse)
print(json.dumps({"ready": det is not None, "why": why}), flush=True)
for line in sys.stdin:
    try:
        path, w, h = line.split()
        boxes = det.detect(Path(path).read_bytes(), int(w), int(h)) if det else []
        print(json.dumps(pick_horse(boxes, scene)), flush=True)
    except Exception as e:                                   # noqa: BLE001 — one bad frame must not stop the report
        print(json.dumps({"error": str(e)[:200]}), flush=True)
