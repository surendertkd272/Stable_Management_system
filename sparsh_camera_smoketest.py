#!/usr/bin/env python3
"""
Sparsh / Samriddhi thermal camera (VD641NT) bring-up smoke test.

Run this the moment an eval unit is powered on and reachable. It walks the full
edge path end-to-end so you know within a minute whether the camera behaves as
the ISAPI + Modbus docs promise:

  1.  TCP reachability (HTTP + RTSP + Modbus ports)
  2.  ISAPI login  -> SessionID           (/ISAPI/Security/User/Login)
  3.  Device info + capabilities          (/ISAPI/System/Capability/...)
  4.  RTSP + meta stream URLs             (/ISAPI/System/Capability/RtspStreamAddress)
  5.  Thermometry basic params            (/ISAPI/Thermometry/BasicParam)
  6.  SET a Point + Area ROI over HTTP     (PUT /ISAPI/Thermometry/{Point,Area})
  7.  READ temperatures back over HTTP     (GET /ISAPI/Thermometry/Query)
  8.  READ the SAME temps over Modbus/TCP  (function 03, IEEE-754 little-endian)
  9.  RTSP OPTIONS probe on live + meta streams

Only dependency is `requests` (pip install requests). Modbus + RTSP use raw
sockets, so nothing else is needed. Nothing here touches the x86 SDK — it is
100% the ARM64-native path (HTTP + RTSP + Modbus).

Usage:
    python3 sparsh_camera_smoketest.py                # uses the CONFIG below
    python3 sparsh_camera_smoketest.py 192.168.1.102 admin 'YourPass'
"""

import sys
import json
import argparse
import time
import socket
import struct
import hashlib

try:
    import requests
    from requests.auth import HTTPDigestAuth
except ImportError:
    sys.exit("Missing dependency. Run:  pip install requests")

# --------------------------------------------------------------------------- #
# CONFIG  — override via argv:  script.py <ip> <user> <pass>
# --------------------------------------------------------------------------- #
CAMERA_IP   = "192.168.1.102"      # camera IP (per docs the factory default)
USERNAME    = "admin"
PASSWORD    = "Admin123"           # <-- set the real device password
HTTP_PORT   = 80
RTSP_PORT   = 554
MODBUS_PORT = 502                  # Modbus/TCP (per the Modbus doc capture)
USE_HTTPS   = False

# Device digest realm used in the login password hash (appendix "Password
# Encryption Rules"). The machine-translated doc prints this as the literal
# "Server Status"; the script also auto-discovers it from a WWW-Authenticate
# header and falls back to plain HTTP Digest if the session login is rejected.
DEVICE_REALM = "Server Status"

# ROI setup for the smoke test. Coordinates are proportional (0..10000) so they
# are resolution-independent. Emissivity 0.98 (=98) ~ animal coat; distance in cm.
EMISSIVITY_100 = 98
DISTANCE_CM    = 350               # our specified 3.5 m working distance

# Ports are overridable: cameras are not always on the defaults, and the mock
# camera (tools/mock_camera.py) deliberately runs on high ports so it needs no
# privileges.  Positional args stay supported for muscle memory.
_ap = argparse.ArgumentParser(
    description="Bench smoke test for the Sparsh VD641NT.",
    formatter_class=argparse.RawDescriptionHelpFormatter,
    epilog="examples:\n"
           "  %(prog)s 192.168.1.102 admin 'PW'\n"
           "  %(prog)s 127.0.0.1 admin pw --http-port 8099 --modbus-port 5502   # vs mock\n")
_ap.add_argument("ip", nargs="?", default=CAMERA_IP)
_ap.add_argument("user", nargs="?", default=USERNAME)
_ap.add_argument("password", nargs="?", default=PASSWORD)
_ap.add_argument("--http-port", type=int, default=HTTP_PORT)
_ap.add_argument("--rtsp-port", type=int, default=RTSP_PORT)
_ap.add_argument("--modbus-port", type=int, default=MODBUS_PORT)
_ap.add_argument("--https", action="store_true", default=USE_HTTPS)
_ap.add_argument("--realm", default=DEVICE_REALM,
                 help="device digest realm used in the login hash")
_ap.add_argument("--eval", action="store_true",
                 help="eval-unit day: also check the Digest fallback, HTTPS and ROI read-back, "
                      "in both the edge agent's driver and the server's client, and print a report")
_ap.add_argument("--https-port", type=int, default=443, help="port for the HTTPS check in --eval")
_a = _ap.parse_args()

CAMERA_IP, USERNAME, PASSWORD = _a.ip, _a.user, _a.password
HTTP_PORT, RTSP_PORT, MODBUS_PORT = _a.http_port, _a.rtsp_port, _a.modbus_port
USE_HTTPS, DEVICE_REALM = _a.https, _a.realm

SCHEME = "https" if USE_HTTPS else "http"
BASE   = f"{SCHEME}://{CAMERA_IP}:{HTTP_PORT}"

# --------------------------------------------------------------------------- #
# tiny pretty logger
# --------------------------------------------------------------------------- #
_results = []
def _log(tag, msg):
    print(f"[{tag:>4}] {msg}")
def ok(msg):   _results.append(True);  _log("OK", msg)
def warn(msg): _results.append(None);  _log("WARN", msg)
def fail(msg): _results.append(False); _log("FAIL", msg)
def info(msg): _log("··", msg)
def md5(s):    return hashlib.md5(s.encode()).hexdigest()   # noqa: S324 (device-mandated)

# --------------------------------------------------------------------------- #
# 1. reachability
# --------------------------------------------------------------------------- #
def tcp_open(host, port, timeout=3.0):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False

def step_reachability():
    print("\n=== 1. TCP reachability ===")
    any_http = False
    for name, port in [("HTTP", HTTP_PORT), ("RTSP", RTSP_PORT), ("Modbus", MODBUS_PORT)]:
        if tcp_open(CAMERA_IP, port):
            ok(f"{name} port {port} open")
            if name == "HTTP":
                any_http = True
        else:
            warn(f"{name} port {port} closed/unreachable")
    return any_http

# --------------------------------------------------------------------------- #
# 2. ISAPI login / session
# --------------------------------------------------------------------------- #
class Isapi:
    def __init__(self, base=None, quiet=False):
        self.base = base or BASE
        self.quiet = quiet
        self.s = requests.Session()
        self.s.verify = False
        self.session_id = None
        self.digest = None          # fallback: plain HTTP Digest

    def _headers(self):
        h = {"Content-Type": "application/json;charset=utf8"}
        if self.session_id:
            h["SessionID"] = self.session_id
        return h

    def discover_realm(self):
        """Some firmware advertise the real digest realm in WWW-Authenticate."""
        try:
            r = self.s.get(f"{self.base}/ISAPI/System/Capability/DeviceInfo", timeout=5)
            auth = r.headers.get("WWW-Authenticate", "")
            if 'realm="' in auth:
                realm = auth.split('realm="', 1)[1].split('"', 1)[0]
                info(f"device advertised digest realm: {realm!r}")
                return realm
        except requests.RequestException:
            pass
        return None

    def login(self):
        realm = self.discover_realm() or DEVICE_REALM
        client_realm = "aB3xY7pQ"    # our per-login random string (fixed here for reproducibility)
        name_hash = md5(f"{USERNAME}:{client_realm}")
        pw_hash   = md5(f"{md5(f'{USERNAME}:{realm}:{PASSWORD}')}:{client_realm}")
        body = {"Realm": client_realm, "Name": name_hash, "Password": pw_hash}

        for method in ("PUT", "POST"):
            try:
                r = self.s.request(method, f"{self.base}/ISAPI/Security/User/Login",
                                   data=json.dumps(body),
                                   headers={"Content-Type": "application/json;charset=utf8"},
                                   timeout=5)
            except requests.RequestException as e:
                warn(f"login {method} error: {e}")
                continue
            if r.status_code == 200:
                try:
                    j = r.json()
                except ValueError:
                    j = {}
                sid = j.get("SessionID")
                if sid:
                    self.session_id = sid
                    ok(f"session login OK ({method}), permission={j.get('Permission')}")
                    return True
            info(f"login {method} -> HTTP {r.status_code}: {r.text[:160]}")

        # Fallback: plain HTTP Digest (works on some OEM firmware).
        warn("session login failed; falling back to HTTP Digest auth")
        self.digest = HTTPDigestAuth(USERNAME, PASSWORD)
        r = self.s.get(f"{self.base}/ISAPI/System/Capability/DeviceInfo",
                       auth=self.digest, timeout=5)
        if r.status_code == 200:
            ok("HTTP Digest auth OK")
            return True
        fail(f"could not authenticate (HTTP {r.status_code}). "
             f"Check password, and the DEVICE_REALM constant.")
        return False

    def get(self, path):
        r = self.s.get(f"{self.base}{path}", headers=self._headers(), auth=self.digest, timeout=6)
        r.raise_for_status()
        return r.json()

    def put(self, path, body):
        r = self.s.request("PUT", f"{self.base}{path}", data=json.dumps(body),
                           headers=self._headers(), auth=self.digest, timeout=6)
        try:
            j = r.json()
        except ValueError:
            j = {"raw": r.text[:200]}
        return r.status_code, j

# --------------------------------------------------------------------------- #
# 3-5. capabilities, streams, thermometry params
# --------------------------------------------------------------------------- #
def step_device_info(api):
    print("\n=== 3. Device info + capabilities ===")
    try:
        d = api.get("/ISAPI/System/Capability/DeviceInfo")
        ok(f"Model={d.get('Model')} IRModule={d.get('IRModule')} "
           f"CCDModule={d.get('CCDModule')} FW={d.get('FWVersion')} {d.get('FWDate')}")
    except Exception as e:
        fail(f"DeviceInfo failed: {e}")

    try:
        c = api.get("/ISAPI/System/Capability/CSCI")
        def yn(k): return c.get(k, "?")
        info(f"WithCCD={yn('WithCCD')}  WithDMMeasure={yn('WithDMMeasure')}  "
             f"WithBlackBody={yn('WithBlackBody')}  WithMetaRaw={yn('WithMetaRaw')}  "
             f"WithClientMeasure={yn('WithClientMeasure')}")
        if yn("WithDMMeasure") == "Yes": ok("point/line/area thermometry supported (NT variant)")
        else: warn("WithDMMeasure=No -> this unit is NOT the temperature (NT) variant")
        if yn("WithCCD") == "Yes": ok("visible (CCD) channel present -> dual-spectrum unit")
        else: warn("WithCCD=No -> IR-only unit (expected a dual thermal+optical build)")
        if yn("WithBlackBody") == "No": info("no blackbody (expected: +-2C screening-grade)")
    except Exception as e:
        warn(f"CSCI capability query failed: {e}")

def step_streams(api):
    print("\n=== 4. RTSP stream addresses ===")
    try:
        j = api.get("/ISAPI/System/Capability/RtspStreamAddress")
        for k, v in j.items():
            info(f"{k}: {v}")
        ok("RTSP addresses retrieved")
    except Exception as e:
        warn(f"RtspStreamAddress failed: {e}")
    # Documented stream layout (dev=0 IR, dev=1 visible, dev=2 fusion):
    info(f"IR   main : rtsp://{CAMERA_IP}:{RTSP_PORT}/stream/live?dev=0&chn=0")
    info(f"visible   : rtsp://{CAMERA_IP}:{RTSP_PORT}/stream/live?dev=1&chn=0")
    info(f"fusion    : rtsp://{CAMERA_IP}:{RTSP_PORT}/stream/live?dev=2&chn=0")
    info(f"meta/temp : rtsp://{CAMERA_IP}:{RTSP_PORT}/stream/meta?dev=0&chn=0  "
         f"(64B header + temp JSON, per-frame sec/msec timestamp)")

def step_thermo_basic(api):
    print("\n=== 5. Thermometry basic params ===")
    try:
        b = api.get("/ISAPI/Thermometry/BasicParam?Dev=0")
        info(f"emissivity(FPara100)={b.get('FPara100')}  distance(cm)={b.get('AimDistance')}  "
             f"surroundTemp={b.get('SurroundTemp')}  unit={b.get('MeasureTempUnit')}")
        ok("BasicParam retrieved")
    except Exception as e:
        warn(f"BasicParam failed: {e}")

# --------------------------------------------------------------------------- #
# 6. set ROIs over HTTP  (Point -> eye/max proxy, Area -> nostril/avg proxy)
# --------------------------------------------------------------------------- #
_ALARM = {"UpType": 0, "UpLimit": 7000, "DownType": 0, "DownLimit": 1000}
_ARM   = "ffffff-ffffff-ffffff-ffffff-ffffff-ffffff-ffffff-"   # 24/7 (deployment-time rule)
_COMMON = {"FPara100": EMISSIVITY_100, "AimDistance": DISTANCE_CM, "AlarmFilterTime": 2,
           "AlarmLinkOutInfo": "", "FtpPicNum": 1, "EMailPicNum": 1, "MailContentType": 1,
           "RecTime": 5, "PreRecordTime": 5, "ActiveTimeSet": _ARM}

def _roi_body(kind, idx, geom, name, enable="Yes"):
    """A full set-ROI payload for Point/Area, in the device's format."""
    base = dict(Id=idx, PresetIdx=0, Type=kind, Enable=enable, Name=name, **_COMMON)
    if kind == "Point":
        return {"ThermometryList": [dict(base, Point=geom, TempAlarm=_ALARM)]}
    return {"ThermometryList": [dict(base, Area=geom, MaxTempAlarm=_ALARM, MinTempAlarm=_ALARM, DiffTempAlarm=_ALARM)]}


def _saved_geometry(item, kind):
    """Coordinates from a GET Point/Area item, whichever shape the firmware
    uses (config: Point{RatX,RatY}; live: PointTemp{RatX,RatY})."""
    if kind == "Point":
        g = item.get("Point") or item.get("PointTemp") or {}
        return {"RatX": g.get("RatX", 5000), "RatY": g.get("RatY", 5000)}
    return item.get("Area") or None


def backup_rois(api):
    """Point 0 and Area 0 as they are now. Step 6 overwrites those slots, and
    Point 0 is the calibrated eye ROI — running this diagnostic on a working
    camera used to silently destroy its calibration."""
    saved = {}
    for kind in ("Point", "Area"):
        try:
            for it in api.get(f"/ISAPI/Thermometry/{kind}?Dev=0&Idx=255").get("ThermometryList", []):
                if it.get("Type", kind) == kind and it.get("Id") == 0:
                    saved[kind] = it
        except Exception:                                   # noqa: BLE001
            pass
    return saved


def restore_rois(api, saved):
    print("\n=== restore ROIs ===")
    for kind in ("Point", "Area"):
        it = saved.get(kind)
        if it is None:
            sc, j = api.put("/ISAPI/Thermometry/Delete?Dev=0", {"Type": kind, "Id": 0})
            (ok if j.get("Result") == "OK" else warn)(f"removed test {kind} 0 (there was none before) -> {j.get('Result', sc)}")
            continue
        geom = _saved_geometry(it, kind)
        if geom is None:
            warn(f"{kind} 0 existed but its geometry is not in the GET response — re-push it from the Hardware page")
            continue
        sc, j = api.put(f"/ISAPI/Thermometry/{kind}?Dev=0&Idx=0",
                        _roi_body(kind, 0, geom, it.get("Name", kind), it.get("Enable", "Yes")))
        (ok if j.get("Result") == "OK" else warn)(f"restored {kind} 0 ({it.get('Name', '')}) -> {j.get('Result', sc)}")


def step_set_rois(api):
    print("\n=== 6. Set ROIs over ISAPI (PUT) ===")
    info("existing Point 0 / Area 0 are backed up and restored afterwards")

    point = {"ThermometryList": [dict(
        Id=0, PresetIdx=0, Type="Point", Enable="Yes", Name="EyeMax",
        Point={"RatX": 5000, "RatY": 5000}, TempAlarm=_ALARM, **_COMMON)]}
    sc, j = api.put("/ISAPI/Thermometry/Point?Dev=0&Idx=0", point)
    (ok if j.get("Result") == "OK" else warn)(f"set Point ROI -> HTTP {sc} {j}")

    area = {"ThermometryList": [dict(
        Id=0, PresetIdx=0, Type="Area", Enable="Yes", Name="NostrilAvg",
        Area={"Total": 4, "EndPointList": [
            {"RatX": 4000, "RatY": 4000}, {"RatX": 6000, "RatY": 4000},
            {"RatX": 6000, "RatY": 6000}, {"RatX": 4000, "RatY": 6000}]},
        MaxTempAlarm=_ALARM, MinTempAlarm=_ALARM, DiffTempAlarm=_ALARM, **_COMMON)]}
    sc, j = api.put("/ISAPI/Thermometry/Area?Dev=0&Idx=0", area)
    (ok if j.get("Result") == "OK" else warn)(f"set Area ROI  -> HTTP {sc} {j}")

# --------------------------------------------------------------------------- #
# 7. read temps back over HTTP
# --------------------------------------------------------------------------- #
def step_query(api):
    print("\n=== 7. Read temperatures over ISAPI (GET Query) ===")
    time.sleep(1.0)  # let the ROIs settle
    try:
        j = api.get("/ISAPI/Thermometry/Query?Dev=0&Type=255")
        items = j.get("ThermometryList", [])
        if not items:
            warn("Query returned no thermometry items yet")
            return
        for it in items:
            t = it.get("Type")
            if t == "Point":
                v = it["PointTemp"]["Value"] / 100.0
                ok(f"Point[{it['Id']}] = {v:.2f} C")
            else:
                mx = it.get("MaxTemp", {}).get("Value")
                mn = it.get("MinTemp", {}).get("Value")
                av = it.get("AvgTemp", {}).get("Value")
                fmt = lambda x: f"{x/100.0:.2f}C" if x is not None else "-"
                ok(f"{t}[{it['Id']}] max={fmt(mx)} min={fmt(mn)} avg={fmt(av)}")
    except Exception as e:
        warn(f"Query failed: {e}")

# --------------------------------------------------------------------------- #
# 8. read the SAME temps over Modbus/TCP (no pymodbus dependency)
# --------------------------------------------------------------------------- #
def modbus_read_holding(host, port, doc_addr, count, unit=1, timeout=4.0):
    """Function 03. Per the Modbus doc the on-wire address = documented addr - 1."""
    wire_addr = doc_addr - 1
    req = struct.pack(">HHHBBHH", 0, 0, 6, unit, 3, wire_addr, count)
    with socket.create_connection((host, port), timeout=timeout) as s:
        s.sendall(req)
        hdr = s.recv(9)                       # MBAP(7) + func(1) + bytecount(1)
        if len(hdr) < 9 or hdr[7] != 3:
            raise IOError(f"unexpected modbus response header: {hdr!r}")
        nbytes = hdr[8]
        data = b""
        while len(data) < nbytes:
            chunk = s.recv(nbytes - len(data))
            if not chunk:
                break
            data += chunk
    regs = struct.unpack(">" + "H" * (len(data) // 2), data)
    return regs

def regs_to_float(reg_low, reg_high):
    """Doc: first register = low 16 bits, second = high 16 bits; float LE."""
    return struct.unpack("<f", struct.pack("<HH", reg_low, reg_high))[0]

def step_modbus():
    print("\n=== 8. Read temperatures over Modbus/TCP ===")
    if not tcp_open(CAMERA_IP, MODBUS_PORT):
        warn(f"Modbus port {MODBUS_PORT} not open (enable Modbus, or check port)")
        return
    try:
        # Point 1 (1019-1020) + Area 1 min/max/avg (1021-1026): read 8 registers.
        regs = modbus_read_holding(CAMERA_IP, MODBUS_PORT, 1019, 8)
        point = regs_to_float(regs[0], regs[1])
        a_min = regs_to_float(regs[2], regs[3])
        a_max = regs_to_float(regs[4], regs[5])
        a_avg = regs_to_float(regs[6], regs[7])
        ok(f"Modbus point1={point:.2f}C  area1 min={a_min:.2f} max={a_max:.2f} avg={a_avg:.2f}")
        info("cross-check: Modbus point1 should ~match ISAPI Point[0]; "
             "area1 avg ~match ISAPI Area[0] avg")
    except Exception as e:
        warn(f"Modbus read failed: {e}")

# --------------------------------------------------------------------------- #
# 9. RTSP OPTIONS probe
# --------------------------------------------------------------------------- #
def rtsp_options(url, timeout=4.0):
    host = CAMERA_IP
    req = (f"OPTIONS {url} RTSP/1.0\r\nCSeq: 1\r\n"
           f"User-Agent: smoketest\r\n\r\n")
    try:
        with socket.create_connection((host, RTSP_PORT), timeout=timeout) as s:
            s.sendall(req.encode())
            resp = s.recv(1024).decode(errors="replace")
        first = resp.splitlines()[0] if resp else ""
        return ("200" in first or "401" in first), first  # 401 = alive but needs auth
    except OSError as e:
        return False, str(e)

def step_rtsp():
    print("\n=== 9. RTSP OPTIONS probe ===")
    for label, url in [
        ("IR live", f"rtsp://{CAMERA_IP}:{RTSP_PORT}/stream/live?dev=0&chn=0"),
        ("meta   ", f"rtsp://{CAMERA_IP}:{RTSP_PORT}/stream/meta?dev=0&chn=0"),
    ]:
        alive, line = rtsp_options(url)
        (ok if alive else warn)(f"RTSP {label}: {line}")
    info("full video validation: run  ffprobe -rtsp_transport tcp <url>  or open in VLC")

# --------------------------------------------------------------------------- #
# --eval: the three things only a real unit can answer
# --------------------------------------------------------------------------- #
EVAL = []          # (check, implementation, status, detail, fix)

def _eval(check, impl, status, detail, fix=""):
    EVAL.append((check, impl, status, detail, fix))
    {"PASS": ok, "N/A": info, "FAIL": fail}[status](f"{check} [{impl}]: {detail}")


def _node_check(https=False):
    """Run the server's camera client (tools/camera_check.mjs) against the unit."""
    import subprocess, os
    here = os.path.dirname(os.path.abspath(__file__))
    cmd = ["node", os.path.join(here, "tools", "camera_check.mjs"), "--host", CAMERA_IP,
           "--user", USERNAME, "--pass", PASSWORD,
           "--port", str(_a.https_port if https else HTTP_PORT)] + (["--https"] if https else [])
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        return json.loads(r.stdout.strip().splitlines()[-1])
    except FileNotFoundError:
        return {"error": "node is not installed on this machine"}
    except Exception as e:                                   # noqa: BLE001
        return {"error": f"checker failed: {e}"}


def step_eval(api):
    print("\n=== eval-unit checks ===")
    sys.path.insert(0, __import__("os").path.join(__import__("os").path.dirname(__import__("os").path.abspath(__file__)), "edge"))
    from edge_agent import roi_slots                       # the agent's real parsing

    # -- A. HTTP Digest fallback ------------------------------------------- #
    plain = requests.get(f"{BASE}/ISAPI/System/Capability/DeviceInfo", verify=False, timeout=5)
    challenge = plain.headers.get("WWW-Authenticate", "")
    if plain.status_code == 200:
        _eval("Digest fallback", "edge agent", "N/A", "camera answers without authentication — nothing to fall back from")
    elif not challenge.lower().startswith("digest"):
        _eval("Digest fallback", "edge agent", "N/A",
              f"camera does not offer Digest (HTTP {plain.status_code}); session login is the only path, and it worked above")
    else:
        r = requests.get(f"{BASE}/ISAPI/System/Capability/DeviceInfo", auth=HTTPDigestAuth(USERNAME, PASSWORD),
                         verify=False, timeout=5)
        _eval("Digest fallback", "edge agent", "PASS" if r.status_code == 200 else "FAIL",
              f"Digest login -> HTTP {r.status_code}", "sparsh_camera.py IsapiClient.login (Digest branch)")

    # -- C. ROI read-back (write to spare slots 9, never the calibrated 0/1) - #
    geom_a = {"Total": 4, "EndPointList": [{"RatX": 100, "RatY": 100}, {"RatX": 400, "RatY": 100},
                                           {"RatX": 400, "RatY": 400}, {"RatX": 100, "RatY": 400}]}
    api.put("/ISAPI/Thermometry/Point?Dev=0&Idx=9", _roi_body("Point", 9, {"RatX": 250, "RatY": 250}, "eval-point"))
    api.put("/ISAPI/Thermometry/Area?Dev=0&Idx=9", _roi_body("Area", 9, geom_a, "eval-area"))
    try:
        raw = api.get("/ISAPI/Thermometry/Point?Dev=0&Idx=255")
        info("GET Point?Idx=255 response shape (send this back if read-back fails): "
             + json.dumps(raw)[:400])
    except Exception as e:                                  # noqa: BLE001
        info(f"GET Point?Idx=255 failed: {e}")
    slots = roi_slots(api)
    found = ("Point", 9) in slots and ("Area", 9) in slots
    _eval("ROI read-back", "edge agent", "PASS" if found else "FAIL",
          f"agent sees slots {sorted(slots)}" + ("" if found else " — the test ROIs it just wrote are missing"),
          "edge/edge_agent.py roi_slots(): the response shape differs; the agent would overwrite calibrations")

    # -- server client (Node): Digest, read-back, then HTTPS ---------------- #
    n = _node_check()
    if "error" in n:
        for check in ("Digest fallback", "ROI read-back"):
            _eval(check, "Hardware page", "FAIL", n["error"], "install Node 20+ on this machine and re-run")
    else:
        d = n.get("digestLogin", {})
        if d.get("ok"):
            _eval("Digest fallback", "Hardware page", "PASS", f"Digest login OK ({d.get('model')})")
        elif "does not offer" in d.get("error", "") or "did not ask" in d.get("error", ""):
            _eval("Digest fallback", "Hardware page", "N/A", d["error"])
        else:
            _eval("Digest fallback", "Hardware page", "FAIL", d.get("error", "?"),
                  "server/camera.mjs digestHeader()/login(): compare with the edge agent's result above")
        rb = n.get("readback", {})
        seen = rb.get("slots", [])
        good = rb.get("ok") and "Point:9" in seen and "Area:9" in seen
        _eval("ROI read-back", "Hardware page", "PASS" if good else "FAIL",
              f"server sees {seen}" if rb.get("ok") else rb.get("error", "?"),
              "server/camera.mjs / tools/camera_check.mjs readback parsing")

    for kind in ("Point", "Area"):
        sc, j = api.put("/ISAPI/Thermometry/Delete?Dev=0", {"Type": kind, "Id": 9})
        if j.get("Result") != "OK":
            api.put(f"/ISAPI/Thermometry/{kind}?Dev=0&Idx=9",
                    _roi_body(kind, 9, {"RatX": 250, "RatY": 250} if kind == "Point" else geom_a, "eval", "No"))
            warn(f"could not delete test {kind} 9 ({j}); disabled it instead")
    info("test ROIs in slot 9 removed")

    # -- B. HTTPS ------------------------------------------------------------ #
    if not tcp_open(CAMERA_IP, _a.https_port):
        _eval("HTTPS", "edge agent", "N/A", f"nothing listening on {_a.https_port} — HTTPS not enabled on the camera "
              "(fine on an isolated barn LAN; plain HTTP is used)")
        _eval("HTTPS", "Hardware page", "N/A", "as above")
    else:
        s = Isapi(base=f"https://{CAMERA_IP}:{_a.https_port}")
        try:
            logged = s.login()
            model = s.get("/ISAPI/System/Capability/DeviceInfo").get("Model") if logged else None
            _eval("HTTPS", "edge agent", "PASS" if logged else "FAIL",
                  f"TLS + login OK ({model})" if logged else "TLS connected but login failed",
                  "sparsh_camera.py IsapiClient(https=True)")
        except Exception as e:                              # noqa: BLE001
            _eval("HTTPS", "edge agent", "FAIL", f"{type(e).__name__}: {e}", "sparsh_camera.py IsapiClient(https=True)")
        h = _node_check(https=True)
        sl = h.get("sessionLogin", {}) if "error" not in h else {"ok": False, "error": h["error"]}
        _eval("HTTPS", "Hardware page", "PASS" if sl.get("ok") else "FAIL",
              f"TLS + login OK ({sl.get('model')})" if sl.get("ok") else sl.get("error", "?"),
              "server/camera.mjs request() TLS options")


def eval_report():
    print("\n=== eval-unit report — paste this block back ===")
    for check, impl, status, detail, fix in EVAL:
        print(f"  {status:<4}  {check:<16} {impl:<14} {detail[:110]}")
        if status == "FAIL" and fix:
            print(f"        -> change: {fix}")
    if not any(s == "FAIL" for _, _, s, _, _ in EVAL):
        print("  All checks passed or not applicable. The Hardware page and edge agent will work with this unit.")


# --------------------------------------------------------------------------- #
def main():
    print(f"Sparsh/Samriddhi thermal camera smoke test -> {BASE}  (user={USERNAME})")
    if not step_reachability():
        fail("HTTP port unreachable; aborting. Check IP/network/PoE.")
        return _summary()

    api = Isapi()
    if not api.login():
        return _summary()

    step_device_info(api)
    step_streams(api)
    step_thermo_basic(api)
    saved = backup_rois(api)
    step_set_rois(api)
    step_query(api)
    step_modbus()
    restore_rois(api, saved)
    step_rtsp()
    if _a.eval:
        step_eval(api)
        eval_report()
    _summary()

def _summary():
    print("\n=== summary ===")
    passed = sum(1 for r in _results if r is True)
    warns  = sum(1 for r in _results if r is None)
    failed = sum(1 for r in _results if r is False)
    print(f"  OK: {passed}   WARN: {warns}   FAIL: {failed}")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    # device uses a self-signed cert if HTTPS; silence the warning
    try:
        import urllib3
        urllib3.disable_warnings()
    except Exception:
        pass
    main()
