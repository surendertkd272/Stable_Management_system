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
import re
import ssl
import tempfile
import subprocess
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


# --------------------------------------------------------------------------- #
class Scene:
    """Where things are in the frame, in the camera's proportional 0..10000
    coordinates (the same RatX/RatY the ROI API uses).

    ROI readings depend on ROI POSITION. Put the eye point on the eye and it
    reads body temperature; miss and it reads coat or barn air. Put the nostril
    box over the nostril and its average carries the breath; miss and there is
    no rhythm at all. That is what makes ROI calibration testable without a
    horse — a mis-aimed ROI fails the way it would on a real one.

    "aligned" puts the targets where the edge agent's default ROIs point, so
    existing runs behave as before. "offset" moves the head, so the defaults
    miss and only a calibrated ROI recovers the vitals."""

    PRESETS = {
        "aligned": dict(head=(5200, 5400, 2600, 3400), eye=(5000, 5000, 300), nostril=(5000, 5800, 700, 450)),
        "offset":  dict(head=(3000, 5000, 2300, 3200), eye=(3300, 3400, 300), nostril=(2500, 6600, 600, 420)),
    }
    AMBIENT = 24.0          # barn air
    COAT = 31.5             # hair-covered skin reads well below core

    def __init__(self, preset="aligned"):
        self.__dict__.update(self.PRESETS[preset])
        self.preset = preset

    @staticmethod
    def _in_ellipse(x, y, cx, cy, rx, ry):
        return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0

    def temp_at(self, x, y):
        ex, ey, er = self.eye
        if (x - ex) ** 2 + (y - ey) ** 2 <= er * er:
            return HORSE.eye_temp()
        if self._in_ellipse(x, y, *self.nostril):
            return HORSE.nostril_temp()
        if self._in_ellipse(x, y, *self.head):
            return self.COAT + random.uniform(-0.3, 0.3)
        return self.AMBIENT + random.uniform(-0.4, 0.4)

    def area_stats(self, pts):
        """min/max/avg over the polygon, sampled on a grid (bbox + point-in-polygon)."""
        xs = [q[0] for q in pts]; ys = [q[1] for q in pts]
        vals = []
        steps = 14
        for i in range(steps + 1):
            for j in range(steps + 1):
                x = min(xs) + (max(xs) - min(xs)) * i / steps
                y = min(ys) + (max(ys) - min(ys)) * j / steps
                if _point_in_poly(x, y, pts):
                    vals.append(self.temp_at(x, y))
        if not vals:
            vals = [self.temp_at(sum(xs) / len(xs), sum(ys) / len(ys))]
        return min(vals), max(vals), sum(vals) / len(vals)


def _point_in_poly(x, y, pts):
    inside = False
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]; x2, y2 = pts[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-9) + x1:
            inside = not inside
    return inside


# --- snapshot rendering: a real image, so a browser can show it -------------- #
def _png(width, height, rows):
    """Minimal RGB PNG encoder (stdlib only). rows: list of bytes, 3*width each."""
    import zlib
    raw = b"".join(b"\x00" + r for r in rows)
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def _ironbow(t, lo=22.0, hi=39.0):
    """The palette thermal cameras ship with: black-purple-red-orange-yellow-white."""
    v = max(0.0, min(1.0, (t - lo) / (hi - lo)))
    stops = [(0, (0, 0, 20)), (.25, (90, 0, 140)), (.5, (200, 30, 60)),
             (.7, (240, 110, 0)), (.87, (255, 210, 40)), (1, (255, 255, 235))]
    for (a, ca), (b, cb) in zip(stops, stops[1:]):
        if v <= b:
            f = (v - a) / (b - a)
            return bytes(int(ca[k] + (cb[k] - ca[k]) * f) for k in range(3))
    return bytes(stops[-1][1])


def render_snapshot(dev):
    """dev 0 = thermal (640x512, ironbow), dev 1 = visible (960x540, greyscale).
    The field is evaluated on a coarse grid and scaled up — fine for aiming."""
    w, h, cell = (640, 512, 4) if dev == 0 else (960, 540, 6)
    gw, gh = w // cell, h // cell
    rows = []
    for gy in range(gh):
        y = (gy + 0.5) / gh * 10000
        line = b""
        for gx in range(gw):
            x = (gx + 0.5) / gw * 10000
            t = SCENE.temp_at(x, y)
            if dev == 0:
                px = _ironbow(t)
            else:  # visible: a brown horse head on a pale stall wall
                inside_head = Scene._in_ellipse(x, y, *SCENE.head)
                g = 70 if inside_head else 205
                if (x - SCENE.eye[0]) ** 2 + (y - SCENE.eye[1]) ** 2 <= SCENE.eye[2] ** 2:
                    g = 20
                elif Scene._in_ellipse(x, y, *SCENE.nostril):
                    g = 45
                px = bytes((min(255, g + (40 if inside_head else 0)), g, max(0, g - (20 if inside_head else 0))))
            line += px * cell
        rows.extend([line] * cell)
    return _png(w, h, rows)


HORSE = Horse()
SCENE = Scene()
STATE = {"rois": {}, "basic": {
    "MeasureTempClass": 0, "SurroundTemp": 25, "AimHimidity": 50,
    "FPara100": 97, "AimDistance": 200, "MeasureTempUnit": 0,
}}
SESSIONS = set()
# Auth is opt-in so existing runs are unchanged. With --require-auth the mock
# verifies credentials the way the device does: the session-login hash, or an
# RFC 2617 Digest response. --digest-only refuses session login, like firmware
# that only speaks Digest — which is what exercises our fallback path.
AUTH = {"require": False, "digest_only": False, "user": "admin", "password": "admin", "realm": "Server Status"}
NONCES = set()


def _c100(v):
    return int(round(v * 100))


def thermometry_list():
    """Live values for every configured ROI, in the ISAPI Query shape."""
    out = []
    for (kind, idx), roi in sorted(STATE["rois"].items()):
        if not roi.get("enabled", True):
            continue
        if kind == "Point":
            x, y = roi.get("ratX", 5000), roi.get("ratY", 5000)
            out.append({"Id": idx, "Type": "Point", "Name": roi.get("name", ""),
                        "PointTemp": {"Value": _c100(SCENE.temp_at(x, y)), "RatX": x, "RatY": y}})
        else:
            # The reading is whatever is actually inside the box: over the
            # nostril, Avg carries the breath; anywhere else it does not.
            pts = roi.get("pts") or [(4200, 5200), (5800, 5200), (5800, 6400), (4200, 6400)]
            lo, hi, avg = SCENE.area_stats(pts)
            out.append({"Id": idx, "Type": kind, "Name": roi.get("name", ""),
                        "Area": {"Total": len(pts), "EndPointList": [{"RatX": a, "RatY": b} for a, b in pts]},
                        "MaxTemp": {"Value": _c100(hi), "RatX": 5000, "RatY": 5000},
                        "MinTemp": {"Value": _c100(lo), "RatX": 5000, "RatY": 5000},
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
        if not AUTH["require"]:
            return True
        if self.headers.get("SessionID") in SESSIONS:
            return True
        return self._digest_ok()

    def _digest_ok(self):
        h = self.headers.get("Authorization", "")
        if not h.startswith("Digest "):
            return False
        f = dict(re.findall(r'(\w+)="?([^",]*)"?', h[7:]))
        if f.get("username") != AUTH["user"] or f.get("nonce") not in NONCES:
            return False
        md5 = lambda s: hashlib.md5(s.encode()).hexdigest()
        ha1 = md5(f"{AUTH['user']}:{AUTH['realm']}:{AUTH['password']}")
        ha2 = md5(f"{self.command}:{f.get('uri', '')}")
        want = (md5(f"{ha1}:{f['nonce']}:{f.get('nc')}:{f.get('cnonce')}:{f.get('qop')}:{ha2}")
                if f.get("qop") else md5(f"{ha1}:{f['nonce']}:{ha2}"))
        return f.get("response") == want

    def _challenge(self):
        nonce = hashlib.sha256(f"{time.time()}{random.random()}".encode()).hexdigest()[:32]
        NONCES.add(nonce)
        body = json.dumps({"Result": "Failed", "Code": 401}).encode()
        self.send_response(401)
        self.send_header("WWW-Authenticate", f'Digest realm="{AUTH["realm"]}", nonce="{nonce}", qop="auth"')
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # -- routes ------------------------------------------------------------ #
    def do_GET(self):
        p = self.path.split("?")[0]
        if not self._authed():
            return self._challenge()
        q = dict(kv.split("=", 1) for kv in self.path.split("?")[1].split("&")) \
            if "?" in self.path and self.path.split("?")[1] else {}

        if p == "/ISAPI/System/Capability/DeviceInfo":
            return self._send(200, {
                "DeviceName": "VD641NT", "Model": "VD641NT", "DeviceSN": AUTH.get("serial", "MOCK0000001"),
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
            if q.get("Type") != "1":
                return self._send(200, render_snapshot(int(q.get("Dev", "0") or 0)), "image/png")
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
            if AUTH["digest_only"]:
                return self._send(401, {"Result": "Failed", "Code": 401, "Msg": "session login not supported"})
            if AUTH["require"]:
                md5 = lambda s: hashlib.md5(s.encode()).hexdigest()
                cr = body.get("Realm", "")
                want_pw = md5(f"{md5(AUTH['user'] + ':' + AUTH['realm'] + ':' + AUTH['password'])}:{cr}")
                if body.get("Name") != md5(f"{AUTH['user']}:{cr}") or body.get("Password") != want_pw:
                    return self._send(401, {"Result": "Failed", "Code": 401, "Msg": "bad credentials"})
            tok = hashlib.sha256(f"{time.time()}{random.random()}".encode()).hexdigest().upper()
            SESSIONS.add(tok)
            return self._send(200, {"SessionID": tok, "Permission": "Administrator"})

        if not self._authed():
            return self._challenge()

        if p == "/ISAPI/Thermometry/Delete":
            items = body if isinstance(body, list) else [body]
            for it in items:
                if it.get("Id") == 255:
                    for k in [k for k in STATE["rois"] if k[0] == it.get("Type")]:
                        del STATE["rois"][k]
                else:
                    STATE["rois"].pop((it.get("Type"), it.get("Id")), None)
            return self._send(200, {"Result": "OK", "URI": p})

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
                    pts = [(q.get("RatX", 0), q.get("RatY", 0)) for q in geom.get("EndPointList", [])]
                    STATE["rois"][(kind, idx)] = {
                        "enabled": item.get("Enable", "Yes") == "Yes",
                        "name": item.get("Name", ""),
                        "ratX": geom.get("RatX", 5000), "ratY": geom.get("RatY", 5000),
                        "pts": pts or None,
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
    ap.add_argument("--scene", choices=sorted(Scene.PRESETS), default="aligned",
                    help="aligned: targets sit under the edge agent's default ROIs; "
                         "offset: head elsewhere, so only calibrated ROIs read vitals")
    ap.add_argument("--require-auth", action="store_true",
                    help="verify credentials like the device (session hash or HTTP Digest)")
    ap.add_argument("--digest-only", action="store_true",
                    help="refuse session login — firmware that only speaks Digest (implies --require-auth)")
    ap.add_argument("--password", default="admin", help="device password when auth is required")
    ap.add_argument("--https", action="store_true", help="serve ISAPI over TLS with a self-signed certificate")
    ap.add_argument("--serial", default="MOCK0000001",
                    help="serial number to report — a different one simulates a swapped camera")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()

    HOST, RTSP_PORT, VERBOSE = a.host, a.rtsp_port, a.verbose
    HORSE = Horse(breathing_bpm=a.breathing_bpm, fever=a.fever)
    SCENE = Scene(a.scene)

    AUTH.update(require=a.require_auth or a.digest_only, digest_only=a.digest_only, password=a.password, serial=a.serial)
    threading.Thread(target=modbus_server, args=(a.modbus_port,), daemon=True).start()
    print(f"[mock-camera] ISAPI  http://{a.host}:{a.http_port}")
    print(f"[mock-camera] Modbus tcp://{a.host}:{a.modbus_port}")
    print(f"[mock-camera] horse: breathing {a.breathing_bpm} bpm"
          f"{', FEVER' if a.fever else ''}, base {HORSE.base_temp:.1f} C, scene={a.scene}")
    if AUTH["require"]:
        print(f"[mock-camera] auth required ({'digest only' if AUTH['digest_only'] else 'session or digest'})")
    srv = ThreadingHTTPServer((a.host, a.http_port), Handler)
    if a.https:
        # Self-signed, like the real camera — so clients must not verify it.
        d = tempfile.mkdtemp(prefix="mockcam-tls-")
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2",
                        "-subj", "/CN=mock-camera", "-keyout", f"{d}/k.pem", "-out", f"{d}/c.pem"],
                       check=True, capture_output=True)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(f"{d}/c.pem", f"{d}/k.pem")
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
        print(f"[mock-camera] TLS on (self-signed)")
    srv.serve_forever()
