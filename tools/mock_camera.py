#!/usr/bin/env python3
"""
mock_camera — a stand-in Sparsh VD641NT, so the whole camera path can be
exercised before the eval units arrive (and afterwards, in CI).

Speaks the interfaces our driver actually uses, per SDK/PROTOCOL_REFERENCE.md:

  ISAPI (HTTP)   login/session, capabilities, thermometry get/set, snapshot
  Modbus/TCP     function 03, IEEE-754 float, low register first
  RTSP           advertises URLs; serve real video with --rtsp (needs mediamtx)

It models a horse rather than emitting constants, which is the point:

  * eye ROI  — body temperature around 37.6 C, slow drift
  * nostril ROI — a breathing OSCILLATION at a configurable rate, because
    exhaled air is warmer. This is what makes the respiration DSP testable
    without a live animal: set --breathing-bpm 12 and the edge agent should
    recover ~12.

Usage
    python3 tools/mock_camera.py                       # :8080 http, :5502 modbus
    python3 tools/mock_camera.py --breathing-bpm 24 --fever
"""
import io
import sys
import json
import math
import time
import random
import struct
import socket
import hashlib
import argparse
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# --------------------------------------------------------------------------- #
class Horse:
    """A simulated animal. Temperatures move the way a real one's would."""

    def __init__(self, breathing_bpm=12.0, fever=False, base_temp=37.6):
        self.t0 = time.time()
        self.breathing_bpm = breathing_bpm
        self.base_temp = base_temp + (1.6 if fever else 0.0)

    def eye_temp(self):
        """Body temperature: slow drift plus a little sensor noise."""
        drift = 0.15 * math.sin((time.time() - self.t0) / 240.0)
        return self.base_temp + drift + random.uniform(-0.05, 0.05)

    def nostril_temp(self):
        """Nostril ROI average — oscillates once per breath.

        Exhaled air is warmer than inhaled, so the ROI mean rises and falls at
        the breathing frequency. Amplitude is deliberately small (~0.4 C) and
        noise is real, because that is the hard case for the DSP."""
        f = self.breathing_bpm / 60.0                     # Hz
        phase = 2 * math.pi * f * (time.time() - self.t0)
        return self.base_temp - 1.2 + 0.40 * math.sin(phase) + random.uniform(-0.06, 0.06)


HORSE = Horse()
STATE = {"rois": {}, "basic": {
    "MeasureTempClass": 0, "SurroundTemp": 25, "AimHimidity": 50,
    "FPara100": 97, "AimDistance": 200, "MeasureTempUnit": 0,
}}
SESSIONS = set()


def _c100(v):
    return int(round(v * 100))


def thermometry_list():
    """Live values for every configured ROI, in the ISAPI Query shape."""
    out = []
    for (kind, idx), roi in sorted(STATE["rois"].items()):
        if not roi.get("enabled", True):
            continue
        if kind == "Point":
            out.append({"Id": idx, "Type": "Point", "PointTemp": {
                "Value": _c100(HORSE.eye_temp()),
                "RatX": roi.get("ratX", 5000), "RatY": roi.get("ratY", 5000)}})
        else:
            # Areas/circles stand in for the nostril ROI: Avg carries the breath.
            avg = HORSE.nostril_temp()
            out.append({"Id": idx, "Type": kind,
                        "MaxTemp": {"Value": _c100(avg + 0.5), "RatX": 5000, "RatY": 5000},
                        "MinTemp": {"Value": _c100(avg - 0.5), "RatX": 5000, "RatY": 5000},
                        "AvgTemp": {"Value": _c100(avg)}})
    return {"ThermometryList": out}


# --------------------------------------------------------------------------- #
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *a):
        if VERBOSE:
            sys.stderr.write("  [isapi] %s %s\n" % (self.command, self.path.split("?")[0]))

    # -- helpers ---------------------------------------------------------- #
    def _send(self, code, obj, ctype="application/json"):
        body = obj if isinstance(obj, bytes) else json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return {}

    def _authed(self):
        return self.headers.get("SessionID") in SESSIONS

    # -- routes ------------------------------------------------------------ #
    def do_GET(self):
        p = self.path.split("?")[0]
        q = dict(kv.split("=", 1) for kv in self.path.split("?")[1].split("&")) \
            if "?" in self.path and self.path.split("?")[1] else {}

        if p == "/ISAPI/System/Capability/DeviceInfo":
            return self._send(200, {
                "DeviceName": "VD641NT", "Model": "VD641NT", "DeviceSN": "MOCK0000001",
                "FWVersion": "V1.00.02", "FWDate": "Build mock", "IRModule": "VD641",
                "IRName": "M2228C-3", "CCDModule": "IMX290"})

        if p == "/ISAPI/System/Capability/CSCI":
            return self._send(200, {
                "WebServer": "lighttpd", "TempRefType": "1", "WithDMMeasure": "Yes",
                "WithCCD": "Yes", "WithBlackBody": "No", "WithMetaRaw": "Yes",
                "WithStorage": "No", "WithImage": "Yes", "WithPTZ": "No"})

        if p == "/ISAPI/System/Capability/RtspStreamAddress":
            b = f"rtsp://{HOST}:{RTSP_PORT}/stream/live"
            return self._send(200, {"stream0": f"{b}?dev=0&chn=0",
                                    "stream1": f"{b}?dev=0&chn=1",
                                    "stream2": f"rtsp://{HOST}:{RTSP_PORT}/stream/raw?dev=0&chn=0"})

        if p == "/ISAPI/Thermometry/BasicParam":
            return self._send(200, dict(STATE["basic"]))

        if p == "/ISAPI/Thermometry/Query":
            return self._send(200, thermometry_list())

        if p in ("/ISAPI/Thermometry/Point", "/ISAPI/Thermometry/Area",
                 "/ISAPI/Thermometry/Circle", "/ISAPI/Thermometry/Line"):
            return self._send(200, thermometry_list())

        if p == "/ISAPI/Snapshot/JPG":
            # minimal JPEG; Type=1 appends a 640x512 int16 temperature block,
            # matching the layout described in the vendor's RAW-format note
            jpg = b"\xff\xd8" + b"\x00" * 256 + b"\xff\xd9"
            if q.get("Type") == "1":
                px = 640 * 512
                base = _c100(HORSE.eye_temp())
                jpg += struct.pack("<%dh" % px, *([base] * px))
            return self._send(200, jpg, "image/jpeg")

        if p == "/ISAPI/System/Time/NTP":
            return self._send(200, {"Enable": "Yes", "Server": "10.0.0.1", "Port": 123, "Interval": 60})

        return self._send(404, {"Result": "Failed", "Code": -400, "URI": p})

    def do_PUT(self):
        p = self.path.split("?")[0]
        body = self._body()

        if p == "/ISAPI/Security/User/Login":
            # The real device hashes; for a mock we accept any credentials and
            # issue a session, since the point is to exercise OUR client.
            tok = hashlib.sha256(f"{time.time()}{random.random()}".encode()).hexdigest().upper()
            SESSIONS.add(tok)
            return self._send(200, {"SessionID": tok, "Permission": "Administrator"})

        if p == "/ISAPI/Security/User/Logout":
            SESSIONS.discard(self.headers.get("SessionID"))
            return self._send(200, {"Result": "OK"})

        if p == "/ISAPI/Thermometry/BasicParam":
            STATE["basic"].update({k: v for k, v in body.items() if not isinstance(v, (dict, list))})
            return self._send(200, {"Result": "OK", "URI": p})

        for kind in ("Point", "Line", "Area", "Circle"):
            if p == f"/ISAPI/Thermometry/{kind}":
                for item in body.get("ThermometryList", []):
                    idx = item.get("Id", 0)
                    geom = item.get(kind) or {}
                    STATE["rois"][(kind, idx)] = {
                        "enabled": item.get("Enable", "Yes") == "Yes",
                        "ratX": geom.get("RatX", 5000), "ratY": geom.get("RatY", 5000),
                        "fpara": item.get("FPara100"), "distance": item.get("AimDistance"),
                    }
                return self._send(200, {"Result": "OK", "URI": p})

        return self._send(404, {"Result": "Failed", "Code": -400, "URI": p})

    do_POST = do_PUT


# --------------------------------------------------------------------------- #
def modbus_server(port):
    """Function 03 only. Register map per the vendor doc: point N at
    1019+12(N-1) (documented 1-based, sent 0-based), each value two registers,
    IEEE-754 float, low register first."""
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", port))
    srv.listen(8)
    while True:
        try:
            conn, _ = srv.accept()
        except OSError:
            return
        threading.Thread(target=_modbus_conn, args=(conn,), daemon=True).start()


def _modbus_conn(conn):
    with conn:
        while True:
            req = conn.recv(512)
            if not req or len(req) < 12:
                return
            tid, _, _, unit, fn = struct.unpack(">HHHBB", req[:8])
            addr, count = struct.unpack(">HH", req[8:12])
            if fn != 3:
                conn.sendall(struct.pack(">HHHBBB", tid, 0, 3, unit, fn | 0x80, 1))
                continue
            doc = addr + 1                       # wire is 0-based, doc is 1-based
            vals = []
            for i in range(count // 2):
                slot = (doc - 1019 + i * 2) // 2
                # slot 0 = point (eye), 1..3 = area min/max/avg (nostril)
                v = HORSE.eye_temp() if slot % 6 == 0 else HORSE.nostril_temp()
                lo, hi = struct.unpack("<HH", struct.pack("<f", v))
                vals += [lo, hi]
            payload = b"".join(struct.pack(">H", v) for v in vals[:count])
            head = struct.pack(">HHHBBB", tid, 0, len(payload) + 3, unit, 3, len(payload))
            conn.sendall(head + payload)


# --------------------------------------------------------------------------- #
if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--http-port", type=int, default=8080)
    ap.add_argument("--modbus-port", type=int, default=5502)
    ap.add_argument("--rtsp-port", type=int, default=8554)
    ap.add_argument("--breathing-bpm", type=float, default=12.0)
    ap.add_argument("--fever", action="store_true")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()

    HOST, RTSP_PORT, VERBOSE = a.host, a.rtsp_port, a.verbose
    HORSE = Horse(breathing_bpm=a.breathing_bpm, fever=a.fever)

    threading.Thread(target=modbus_server, args=(a.modbus_port,), daemon=True).start()
    print(f"[mock-camera] ISAPI  http://{a.host}:{a.http_port}")
    print(f"[mock-camera] Modbus tcp://{a.host}:{a.modbus_port}")
    print(f"[mock-camera] horse: breathing {a.breathing_bpm} bpm"
          f"{', FEVER' if a.fever else ''}, base {HORSE.base_temp:.1f} C")
    ThreadingHTTPServer((a.host, a.http_port), Handler).serve_forever()
