"""
sparsh_camera — reusable edge driver for the Sparsh/Samriddhi thermal camera
(VD641NT), for the BSV EquiCare stable-monitoring system.

100% ARM64-native path — HTTP (ISAPI) + Modbus/TCP + RTSP. No vendor x86 SDK.
Protocol details (endpoints, register map, meta-frame layout, known limits):
SDK/PROTOCOL_REFERENCE.md

Layers
------
  IsapiClient        session login + typed thermometry / capability / snapshot calls
  read_modbus_temps  point+area temperatures over Modbus/TCP (function 03)
  parse_meta_frame   decode the RTSP `stream/meta` frame (64B header + temp JSON),
                     the timestamped push path (per-frame sec/msec + group_id)
  RoiController      abstraction for placing/moving ROIs:
                       StaticRoiController  - ROIs preconfigured on the web UI (v1)
                       IsapiRoiController   - runtime reposition via ISAPI PUT (v2)

Temperatures from ISAPI/meta are integer (deg C * 100); Modbus are IEEE-754 float.
This module normalizes everything to float degrees Celsius.

The transport for the meta stream (RTSP SETUP/PLAY + RTP depacketization) is left
to ffmpeg/gstreamer/live555 in the app; feed each reassembled RTP payload to
`parse_meta_frame()`. Everything in this module is unit-testable offline
(run `python3 sparsh_camera.py` for the self-test).
"""
from __future__ import annotations

import abc
import json
import socket
import struct
import hashlib
import logging
from dataclasses import dataclass, field
from typing import Optional

log = logging.getLogger("sparsh_camera")

# --------------------------------------------------------------------------- #
# Modbus/TCP temperature read  (function 03; wire addr = doc addr - 1)
# --------------------------------------------------------------------------- #
# Register map (from the Modbus doc). Each value = 2 registers, IEEE-754 float,
# stored little-endian: first register = low 16 bits, second = high 16 bits.
MODBUS_POINT1_ADDR = 1019          # point 1 -> 1019..1020
MODBUS_BLOCK_LEN   = 8             # point1 + area1(min,max,avg) = 4 floats = 8 regs


def _regs_to_float(reg_low: int, reg_high: int) -> float:
    return struct.unpack("<f", struct.pack("<HH", reg_low, reg_high))[0]


def _modbus_read_holding(host: str, port: int, doc_addr: int, count: int,
                         unit: int = 1, timeout: float = 4.0) -> tuple[int, ...]:
    req = struct.pack(">HHHBBHH", 0, 0, 6, unit, 3, doc_addr - 1, count)
    with socket.create_connection((host, port), timeout=timeout) as s:
        s.sendall(req)
        hdr = s.recv(9)                       # MBAP(7) + func(1) + bytecount(1)
        if len(hdr) < 9 or hdr[7] != 3:
            raise IOError(f"bad modbus response header: {hdr!r}")
        nbytes = hdr[8]
        data = b""
        while len(data) < nbytes:
            chunk = s.recv(nbytes - len(data))
            if not chunk:
                break
            data += chunk
    return struct.unpack(">" + "H" * (len(data) // 2), data)


@dataclass
class ModbusTemps:
    point1_c: float
    area1_min_c: float
    area1_max_c: float
    area1_avg_c: float


def read_modbus_temps(host: str, port: int = 502, unit: int = 1) -> ModbusTemps:
    """Read point-1 and area-1 (min/max/avg) temperatures over Modbus/TCP."""
    r = _modbus_read_holding(host, port, MODBUS_POINT1_ADDR, MODBUS_BLOCK_LEN, unit)
    return ModbusTemps(
        point1_c=_regs_to_float(r[0], r[1]),
        area1_min_c=_regs_to_float(r[2], r[3]),
        area1_max_c=_regs_to_float(r[4], r[5]),
        area1_avg_c=_regs_to_float(r[6], r[7]),
    )


# --------------------------------------------------------------------------- #
# RTSP `stream/meta` frame  (64-byte header + temperature JSON)
# --------------------------------------------------------------------------- #
META_MAGIC = 0x55AAAA55
# int magic; char major; char minor; short frame_type; int len; int sec;
# int msec; int group_id; int ip; char reserved[36]   => 64 bytes, little-endian.
_META_HDR = struct.Struct("<IBBHIIIII36s")
assert _META_HDR.size == 64

FRAME_TYPE_TEXT = 0x0000            # temperature JSON (per 5.7.2 Query format)
FRAME_TYPE_JPEG = 0x0100


@dataclass
class MetaFrame:
    major: int
    minor: int
    frame_type: int
    sec: int                       # seconds since 1970-01-01 (sensor clock)
    msec: int                      # 0..999
    group_id: int                  # ties frames across channels for sync
    ip: str
    temps: list[dict] = field(default_factory=list)   # normalized, Celsius
    raw_payload: bytes = b""

    @property
    def timestamp(self) -> float:
        return self.sec + self.msec / 1000.0


def parse_meta_frame(buf: bytes) -> MetaFrame:
    """Decode one meta-stream frame (64B header + payload). Raises on bad magic."""
    if len(buf) < _META_HDR.size:
        raise ValueError(f"short meta frame: {len(buf)} bytes")
    (magic, major, minor, ftype, flen, sec, msec,
     gid, ip, _res) = _META_HDR.unpack(buf[:64])
    if magic != META_MAGIC:
        raise ValueError(f"bad meta magic 0x{magic:08X}")
    payload = buf[64:64 + flen]
    ipdot = ".".join(str(b) for b in struct.pack(">I", ip))
    frame = MetaFrame(major, minor, ftype, sec, msec, gid, ipdot, raw_payload=payload)
    if ftype == FRAME_TYPE_TEXT and payload:
        try:
            frame.temps = _normalize_thermolist(json.loads(payload.decode("utf-8", "replace")))
        except (ValueError, KeyError):
            log.warning("meta frame: temperature JSON parse failed")
    return frame


# --------------------------------------------------------------------------- #
# shared temperature normalization  (ISAPI Query + meta share the JSON schema)
# --------------------------------------------------------------------------- #
def _c(v):                          # device value is degC * 100
    return None if v is None else v / 100.0


def _normalize_thermolist(obj: dict) -> list[dict]:
    """Flatten a ThermometryList (Point/Line/Area/Circle) into Celsius dicts."""
    out = []
    for it in obj.get("ThermometryList", []):
        t = it.get("Type")
        row = {"id": it.get("Id"), "type": t}
        if t == "Point":
            p = it.get("PointTemp", {})
            row.update(point_c=_c(p.get("Value")), rat_x=p.get("RatX"), rat_y=p.get("RatY"))
        else:  # Line / Area / Circle
            row.update(
                max_c=_c(it.get("MaxTemp", {}).get("Value")),
                min_c=_c(it.get("MinTemp", {}).get("Value")),
                avg_c=_c(it.get("AvgTemp", {}).get("Value")),
            )
        out.append(row)
    return out


# --------------------------------------------------------------------------- #
# ISAPI HTTP client
# --------------------------------------------------------------------------- #
_ALARM_OFF = {"UpType": 0, "UpLimit": 7000, "DownType": 0, "DownLimit": 1000}
_ARM_24_7 = "ffffff-ffffff-ffffff-ffffff-ffffff-ffffff-ffffff-"


def _md5(s: str) -> str:
    return hashlib.md5(s.encode()).hexdigest()   # noqa: S324 (device-mandated hash)


class IsapiClient:
    """Session-authenticated ISAPI client with typed thermometry helpers."""

    def __init__(self, host: str, user: str, password: str, port: int = 80,
                 https: bool = False, device_realm: str = "Server Status",
                 timeout: float = 6.0):
        import requests  # local import so the pure-logic parts need no deps
        self._requests = requests
        self.base = f"{'https' if https else 'http'}://{host}:{port}"
        self.user, self.password, self.device_realm = user, password, device_realm
        self.timeout = timeout
        self.s = requests.Session()
        self.s.verify = False
        self.session_id: Optional[str] = None
        self.digest = None

    # -- auth ------------------------------------------------------------- #
    def _discover_realm(self) -> Optional[str]:
        try:
            r = self.s.get(f"{self.base}/ISAPI/System/Capability/DeviceInfo",
                           timeout=self.timeout)
            a = r.headers.get("WWW-Authenticate", "")
            if 'realm="' in a:
                return a.split('realm="', 1)[1].split('"', 1)[0]
        except self._requests.RequestException:
            pass
        return None

    def login(self) -> bool:
        realm = self._discover_realm() or self.device_realm
        client_realm = "aB3xY7pQ"
        body = {
            "Realm": client_realm,
            "Name": _md5(f"{self.user}:{client_realm}"),
            "Password": _md5(f"{_md5(f'{self.user}:{realm}:{self.password}')}:{client_realm}"),
        }
        for method in ("PUT", "POST"):
            try:
                r = self.s.request(method, f"{self.base}/ISAPI/Security/User/Login",
                                   data=json.dumps(body),
                                   headers={"Content-Type": "application/json;charset=utf8"},
                                   timeout=self.timeout)
            except self._requests.RequestException as e:
                log.warning("login %s error: %s", method, e)
                continue
            if r.status_code == 200:
                sid = (r.json() if r.content else {}).get("SessionID")
                if sid:
                    self.session_id = sid
                    log.info("ISAPI session established")
                    return True
        # fallback: plain HTTP Digest
        from requests.auth import HTTPDigestAuth
        self.digest = HTTPDigestAuth(self.user, self.password)
        r = self.s.get(f"{self.base}/ISAPI/System/Capability/DeviceInfo",
                       auth=self.digest, timeout=self.timeout)
        if r.status_code == 200:
            log.info("ISAPI HTTP Digest auth OK")
            return True
        log.error("ISAPI auth failed (HTTP %s)", r.status_code)
        return False

    def _headers(self):
        h = {"Content-Type": "application/json;charset=utf8"}
        if self.session_id:
            h["SessionID"] = self.session_id
        return h

    def get(self, path: str) -> dict:
        r = self.s.get(f"{self.base}{path}", headers=self._headers(),
                       auth=self.digest, timeout=self.timeout)
        r.raise_for_status()
        return r.json()

    def put(self, path: str, body: dict) -> dict:
        r = self.s.request("PUT", f"{self.base}{path}", data=json.dumps(body),
                           headers=self._headers(), auth=self.digest, timeout=self.timeout)
        try:
            return r.json()
        except ValueError:
            return {"Result": "Failed", "raw": r.text[:200], "http": r.status_code}

    # -- info ------------------------------------------------------------- #
    def device_info(self) -> dict:
        return self.get("/ISAPI/System/Capability/DeviceInfo")

    def capabilities(self) -> dict:
        return self.get("/ISAPI/System/Capability/CSCI")

    def rtsp_addresses(self) -> dict:
        return self.get("/ISAPI/System/Capability/RtspStreamAddress")

    # -- thermometry ------------------------------------------------------ #
    def set_basic_param(self, emissivity_100: int, distance_cm: int, dev: int = 0) -> dict:
        cur = self.get(f"/ISAPI/Thermometry/BasicParam?Dev={dev}")
        cur.update(FPara100=emissivity_100, AimDistance=distance_cm)
        return self.put(f"/ISAPI/Thermometry/BasicParam?Dev={dev}", cur)

    def _common(self, emissivity_100, distance_cm):
        return {"FPara100": emissivity_100, "AimDistance": distance_cm,
                "AlarmFilterTime": 2, "AlarmLinkOutInfo": "", "FtpPicNum": 1,
                "EMailPicNum": 1, "MailContentType": 1, "RecTime": 5,
                "PreRecordTime": 5, "ActiveTimeSet": _ARM_24_7}

    def set_point(self, idx: int, rat_x: int, rat_y: int, *, name="Point",
                  emissivity_100=98, distance_cm=350, dev=0) -> dict:
        body = {"ThermometryList": [dict(
            Id=idx, PresetIdx=0, Type="Point", Enable="Yes", Name=name,
            Point={"RatX": rat_x, "RatY": rat_y}, TempAlarm=dict(_ALARM_OFF),
            **self._common(emissivity_100, distance_cm))]}
        return self.put(f"/ISAPI/Thermometry/Point?Dev={dev}&Idx={idx}", body)

    def set_circle(self, idx: int, rat_x: int, rat_y: int, radius_px: int, *,
                   name="Circle", emissivity_100=98, distance_cm=350, dev=0) -> dict:
        body = {"ThermometryList": [dict(
            Id=idx, PresetIdx=0, Type="Circle", Enable="Yes", Name=name,
            Circle={"Radius": radius_px, "RatX": rat_x, "RatY": rat_y},
            MaxTempAlarm=dict(_ALARM_OFF), MinTempAlarm=dict(_ALARM_OFF),
            DiffTempAlarm=dict(_ALARM_OFF), **self._common(emissivity_100, distance_cm))]}
        return self.put(f"/ISAPI/Thermometry/Circle?Dev={dev}&Idx={idx}", body)

    def set_area(self, idx: int, vertices: list[tuple[int, int]], *, name="Area",
                 emissivity_100=98, distance_cm=350, dev=0) -> dict:
        pts = [{"RatX": x, "RatY": y} for x, y in vertices]
        body = {"ThermometryList": [dict(
            Id=idx, PresetIdx=0, Type="Area", Enable="Yes", Name=name,
            Area={"Total": len(pts), "EndPointList": pts},
            MaxTempAlarm=dict(_ALARM_OFF), MinTempAlarm=dict(_ALARM_OFF),
            DiffTempAlarm=dict(_ALARM_OFF), **self._common(emissivity_100, distance_cm))]}
        return self.put(f"/ISAPI/Thermometry/Area?Dev={dev}&Idx={idx}", body)

    def query_temps(self, dev: int = 0, type_code: int = 255) -> list[dict]:
        """GET live temperatures, normalized to Celsius. Type 255 = all types."""
        return _normalize_thermolist(
            self.get(f"/ISAPI/Thermometry/Query?Dev={dev}&Type={type_code}"))

    def snapshot_radiometric(self, dev: int = 0) -> bytes:
        """JPEG with per-pixel radiometric data appended (Type=1)."""
        r = self.s.get(f"{self.base}/ISAPI/Snapshot/JPG?Dev={dev}&Type=1",
                       headers=self._headers(), auth=self.digest, timeout=self.timeout)
        r.raise_for_status()
        return r.content


# --------------------------------------------------------------------------- #
# ROI controller abstraction  (static now, ISAPI-dynamic drop-in later)
# --------------------------------------------------------------------------- #
class RoiController(abc.ABC):
    """The app steers ROIs through this interface; the answer to 'can we move an
    ROI at runtime?' only changes which implementation is wired in."""

    @abc.abstractmethod
    def move_point(self, idx: int, rat_x: int, rat_y: int) -> None: ...


class StaticRoiController(RoiController):
    """v1: ROIs are placed once via the web UI; runtime moves are no-ops."""

    def move_point(self, idx: int, rat_x: int, rat_y: int) -> None:
        log.debug("static ROI: ignoring move idx=%s -> (%s,%s)", idx, rat_x, rat_y)


class IsapiRoiController(RoiController):
    """v2: reposition an ROI at runtime via ISAPI PUT (a few Hz)."""

    def __init__(self, client: IsapiClient, *, emissivity_100=98, distance_cm=350):
        self.c = client
        self.emis = emissivity_100
        self.dist = distance_cm

    def move_point(self, idx: int, rat_x: int, rat_y: int) -> None:
        res = self.c.set_point(idx, rat_x, rat_y,
                               emissivity_100=self.emis, distance_cm=self.dist)
        if res.get("Result") != "OK":
            log.warning("move_point idx=%s failed: %s", idx, res)


# --------------------------------------------------------------------------- #
# offline self-test  (no hardware needed):  python3 sparsh_camera.py
# --------------------------------------------------------------------------- #
def _selftest():
    logging.basicConfig(level=logging.INFO)
    fails = 0

    # 1. Modbus float decode vs the doc's worked example (24.9 / 29.7 / 25.0)
    if round(_regs_to_float(0x3333, 0x41C7), 2) != 24.90: fails += 1
    if round(_regs_to_float(0x999A, 0x41ED), 2) != 29.70: fails += 1
    print("[ok] modbus float decode matches doc example")

    # 2. meta frame round-trip
    payload = json.dumps({"ThermometryList": [
        {"Id": 0, "Type": "Point", "PointTemp": {"Value": 3712, "RatX": 5000, "RatY": 5000}},
        {"Id": 0, "Type": "Area", "MaxTemp": {"Value": 3900}, "MinTemp": {"Value": 3500},
         "AvgTemp": {"Value": 3705}},
    ]}).encode()
    hdr = _META_HDR.pack(META_MAGIC, 1, 0, FRAME_TYPE_TEXT, len(payload),
                         1_700_000_000, 250, 42,
                         struct.unpack(">I", bytes([192, 168, 1, 102]))[0], b"")
    frame = parse_meta_frame(hdr + payload)
    assert frame.ip == "192.168.1.102", frame.ip
    assert frame.msec == 250 and frame.group_id == 42
    assert abs(frame.timestamp - 1_700_000_000.25) < 1e-6
    eye = next(t for t in frame.temps if t["type"] == "Point")
    nostril = next(t for t in frame.temps if t["type"] == "Area")
    assert eye["point_c"] == 37.12, eye
    assert nostril["avg_c"] == 37.05, nostril
    print(f"[ok] meta frame decode: ip={frame.ip} ts={frame.timestamp} "
          f"eye={eye['point_c']}C nostril_avg={nostril['avg_c']}C")

    # 3. bad magic is rejected
    try:
        parse_meta_frame(b"\x00" * 64)
        fails += 1; print("[FAIL] bad magic not rejected")
    except ValueError:
        print("[ok] bad-magic frame rejected")

    # 4. static controller is a safe no-op
    StaticRoiController().move_point(0, 1234, 5678)
    print("[ok] StaticRoiController no-op")

    print("\nSELF-TEST", "FAILED" if fails else "PASSED")
    return fails


if __name__ == "__main__":
    raise SystemExit(1 if _selftest() else 0)
