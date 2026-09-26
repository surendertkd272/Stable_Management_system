"""JSON-RPC (/mtrpc) camera client for the edge agent — the firmware the Sparsh
demo unit runs. Python twin of server/mtrpc.mjs (login, session recovery,
pixel-sampled ROI temperatures); edge/mtrpc_parity_test.py holds the two to the
same grid and the same login response.

Standard library only (http.client), so it runs on a bare Jetson image. The
host may be an IPv6 link-local address with its interface, e.g.
"fe80::1a74:e2ff:fedc:d5d0%en8" — http.client resolves the scope itself.
"""
import hashlib
import http.client
import json
import secrets

CAM_SCALE = 8192
CAM_MAX = CAM_SCALE - 1
THERMAL_PX = 640
INVALID_SESSION = -100101


def md5(s):
    return hashlib.md5(s.encode()).hexdigest()  # noqa: S324 — the device's login scheme


def to_cam(v):
    """0–10000 (EquiCare) -> 0–8192 (camera). Same rounding as Math.round."""
    return int((v * CAM_SCALE / 10000) + 0.5)


def from_cam(v):
    return int((v * 10000 / CAM_SCALE) + 0.5)


def clamp_cam(v):
    return max(0, min(CAM_MAX, int(v + 0.5)))


def login_response(username, password, realm, nonce, qop, cnonce, nc="00000001", uri="/mtrpc"):
    ha1 = md5(f"{username}:{realm}:{password}")
    ha2 = md5(f"POST:{uri}")
    return md5(f"{ha1}:{nonce}:{nc}:{cnonce}:{qop}:{ha2}")


def grid_points(box, n):
    """Camera coordinates covering an EquiCare box, at most n×n (mirrors gridPoints)."""
    x0, x1 = clamp_cam(to_cam(box["x0"])), clamp_cam(to_cam(box["x1"]))
    y0, y1 = clamp_cam(to_cam(box["y0"])), clamp_cam(to_cam(box["y1"]))
    px_step = CAM_SCALE / THERMAL_PX
    cols = max(2, min(n, int((x1 - x0) / px_step) + 1))
    rows = max(2, min(n, int((y1 - y0) / px_step) + 1))
    return [{"x": int(x0 + (x1 - x0) * i / (cols - 1) + 0.5), "y": int(y0 + (y1 - y0) * j / (rows - 1) + 0.5)}
            for j in range(rows) for i in range(cols)]


def pixel_value(reply):
    """A reading, or None for the camera's out-of-frame sentinels ("0.00", "-1.00")."""
    try:
        v = float(((reply or {}).get("data") or {}).get("temperature"))
    except (TypeError, ValueError):
        return None
    return v if v > -1 and v != 0 else None


class RpcError(RuntimeError):
    def __init__(self, method, err):
        super().__init__(f"{method}: {(err or {}).get('message', 'error').strip()} (code {(err or {}).get('code')})")
        self.code = (err or {}).get("code")


class MtrpcCamera:
    def __init__(self, host, username="admin", password="", port=80, timeout=6.0):
        self.host, self.port, self.username, self.password, self.timeout = host, port, username, password, timeout
        self.session_id = ""
        self.logged_in = False
        self._id = 0

    # ---- transport ------------------------------------------------------- #
    def post(self, method, params=None):
        self._id += 1
        body = json.dumps({"id": self._id, "jsonrpc": "2.0", "method": method,
                           "params": {"session_id": self.session_id, **(params or {})}})
        conn = http.client.HTTPConnection(self.host, self.port, timeout=self.timeout)
        try:
            conn.request("POST", "/mtrpc", body=body, headers={"Content-Type": "application/json"})
            res = conn.getresponse()
            data = res.read(4 * 1024 * 1024 + 1)
            if res.status != 200:
                raise RuntimeError(f"{method} -> HTTP {res.status}")
            if len(data) > 4 * 1024 * 1024:
                raise RuntimeError(f"{method}: reply larger than 4 MB — not a camera reply")
            return json.loads(data)
        finally:
            conn.close()

    def rpc(self, method, params=None):
        r = self.post(method, params)
        if r.get("error"):
            raise RpcError(method, r["error"])
        return r.get("result")

    def login(self):
        self.session_id = ""
        ch = self.rpc("Auth.LoginChallenge", {"data": {"encrypt_type": "kEncryptDigest", "login_type": "kLoginWeb",
                                                       "username": self.username}})
        d = ((ch or {}).get("data") or {}).get("digest") or {}
        if not d.get("nonce"):
            raise RuntimeError("the camera's login challenge is not in the expected form")
        self.session_id = ch.get("session_id", "")
        cnonce = secrets.token_hex(8)
        digest = {"realm": d["realm"], "uri": "/mtrpc", "nonce": d["nonce"], "nc": "00000001", "cnonce": cnonce,
                  "qop": d.get("qop"),
                  "response": login_response(self.username, self.password, d["realm"], d["nonce"], d.get("qop"), cnonce)}
        try:
            r = self.rpc("Auth.Login", {"data": {"digest": digest, "encrypt_type": "kEncryptDigest",
                                                 "login_type": "kLoginWeb", "username": self.username}})
        except RpcError:
            self.session_id = ""
            return False
        sid = ((r or {}).get("data") or {}).get("session_id") or (r or {}).get("session_id")
        if not sid:
            return False
        self.session_id, self.logged_in = sid, True
        return True

    def call(self, method, params=None):
        """Survives the camera expiring the session: one re-login, never more
        (failed logins count towards the camera's lockout)."""
        try:
            return self.rpc(method, params)
        except RpcError as e:
            if e.code != INVALID_SESSION or not self.logged_in:
                raise
            if not self.login():
                raise RuntimeError("the camera session expired and logging in again failed — check the password") from e
            return self.rpc(method, params)

    def logout(self):
        if self.logged_in:
            try:
                self.rpc("Auth.Logout", {})
            except Exception:                                   # noqa: BLE001 — best effort
                pass
        self.logged_in, self.session_id = False, ""

    # ---- what the worker needs ------------------------------------------- #
    def identity(self):
        """MAC-based when the serial is blank, as the server pins it."""
        info = (self.call("Control.GetSystemInfo", {}) or {}).get("data") or {}
        serial = str(info.get("serial_number") or "")
        if serial.strip("0"):
            return serial
        net = (self.call("Config.GetConfig", {"name": "NetWork.net_interface_list"}) or {}).get("data") or {}
        mac = next((i.get("mac") for i in net.get("iface", []) if i.get("mac")), None)
        return f"MAC {mac.lower()}" if mac else None

    def read_pixels(self, points):
        return [pixel_value(self.call("Control.GetPointTemperature", {"data": p})) for p in points]

    def box_max(self, box, n=16):
        pts = grid_points(box, n)
        vals = self.read_pixels(pts)
        best = None
        for i, v in enumerate(vals):
            if v is not None and (best is None or v > vals[best]):
                best = i
        return None if best is None else vals[best]

    def box_avg(self, box, n=5):
        vals = [v for v in self.read_pixels(grid_points(box, n)) if v is not None]
        return sum(vals) / len(vals) if vals else None


def detect(host, port=80, timeout=4.0):
    """Is there a JSON-RPC camera here? A login challenge only — no login attempt."""
    try:
        r = MtrpcCamera(host, port=port, timeout=timeout).rpc(
            "Auth.LoginChallenge", {"data": {"encrypt_type": "kEncryptDigest", "login_type": "kLoginWeb", "username": "admin"}})
        return bool(((r or {}).get("data") or {}).get("digest", {}).get("nonce"))
    except Exception:                                           # noqa: BLE001
        return False
