"""Moving and zooming a camera: pan, tilt and the zoom of each lens.

A zoom camera watches two (or more) stalls from one place: zoomed out (the
"wide" view) it follows every horse's behaviour; zoomed in on one horse's head
(a "close" view) it reads that horse's eye temperature, breathing at the
nostril and its face. edge/multistall.py decides when to go where; this file
only moves the camera.

ONVIF PTZ (the open camera standard): positions are presets saved on the
camera, or absolute pan/tilt/zoom. A dual-lens (colour + thermal) camera
usually has one media profile per lens; a position names, for each lens it
moves, the profile and either a preset or a pan/tilt/zoom — e.g.

  {"moves": [{"profile": "Profile_1", "preset": "3"},          # colour lens
             {"profile": "Profile_2", "zoom": 0.6}],           # thermal lens zoom
   "settleS": 4}

Standard library only. WS-Security UsernameToken with a password digest; the
camera's own clock is used for the timestamp (the 13 mm unit's clock is months
out — a digest stamped with ours would be refused).
"""
import base64
import datetime as dt
import hashlib
import http.client
import os
import re
import time
import xml.etree.ElementTree as ET

NS = {"s": "http://www.w3.org/2003/05/soap-envelope", "tt": "http://www.onvif.org/ver10/schema",
      "tptz": "http://www.onvif.org/ver20/ptz/wsdl", "trt": "http://www.onvif.org/ver10/media/wsdl",
      "tds": "http://www.onvif.org/ver10/device/wsdl"}


class PtzError(RuntimeError):
    pass


def _digest(password, created, nonce):
    return base64.b64encode(hashlib.sha1(nonce + created.encode() + password.encode()).digest()).decode()  # noqa: S324 (the standard's scheme)


def envelope(body, username=None, password=None, now=None):
    sec = ""
    if username is not None:
        nonce = os.urandom(16)
        created = (now or dt.datetime.now(dt.timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
        sec = ('<s:Header><Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/'
               'oasis-200401-wss-wssecurity-secext-1.0.xsd"><UsernameToken>'
               f"<Username>{_xml(username)}</Username>"
               '<Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">'
               f"{_digest(password or '', created, nonce)}</Password>"
               '<Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">'
               f"{base64.b64encode(nonce).decode()}</Nonce>"
               f'<Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">{created}</Created>'
               "</UsernameToken></Security></s:Header>")
    return (f'<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="{NS["s"]}" xmlns:tt="{NS["tt"]}" '
            f'xmlns:tptz="{NS["tptz"]}" xmlns:trt="{NS["trt"]}" xmlns:tds="{NS["tds"]}">{sec}<s:Body>{body}</s:Body></s:Envelope>')


def _xml(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _num(v, lo=-1.0, hi=1.0):
    return max(lo, min(hi, float(v)))


class OnvifPtz:
    """The camera's ONVIF services. host may be an IPv6 link-local address
    with its zone (fe80::…%en8), as for mtrpc.py."""

    def __init__(self, host, username, password, port=80, path="/onvif/device_service", timeout=8.0):
        self.host, self.port, self.username, self.password, self.timeout = host, port, username, password, timeout
        self.device_path = path
        self.ptz_path = self.media_path = None
        self.skew = None                                      # camera clock - ours (s)

    # ---- transport ------------------------------------------------------- #
    def _post(self, path, body, auth=True):
        now = None
        if auth and self.skew is not None:
            now = dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=self.skew)
        data = envelope(body, self.username if auth else None, self.password, now).encode()
        conn = http.client.HTTPConnection(self.host, self.port, timeout=self.timeout)
        try:
            conn.request("POST", path, body=data, headers={"Content-Type": "application/soap+xml; charset=utf-8"})
            res = conn.getresponse()
            raw = res.read(2 * 1024 * 1024)
        finally:
            conn.close()
        try:
            root = ET.fromstring(raw)
        except ET.ParseError as e:
            raise PtzError(f"not an ONVIF answer from {self.host} (HTTP {res.status})") from e
        fault = root.find(".//s:Fault", NS)
        if fault is not None:
            reason = " ".join(t.strip() for t in fault.itertext() if t.strip())
            raise PtzError(f"camera refused: {reason[:200]}")
        if res.status != 200:
            raise PtzError(f"HTTP {res.status} from the camera's ONVIF service")
        return root

    def _sync_clock(self):
        if self.skew is not None:
            return
        try:
            root = self._post(self.device_path, "<tds:GetSystemDateAndTime/>", auth=False)
            u = root.find(".//tt:UTCDateTime", NS)
            v = {k: int(u.find(f".//tt:{k}", NS).text) for k in ("Year", "Month", "Day", "Hour", "Minute", "Second")}
            cam = dt.datetime(v["Year"], v["Month"], v["Day"], v["Hour"], v["Minute"], v["Second"], tzinfo=dt.timezone.utc)
            self.skew = (cam - dt.datetime.now(dt.timezone.utc)).total_seconds()
        except Exception:                                    # noqa: BLE001  (then our clock)
            self.skew = 0.0

    def _services(self):
        if self.ptz_path:
            return
        self._sync_clock()
        root = self._post(self.device_path, '<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>')
        for name in ("PTZ", "Media"):
            x = root.find(f".//tt:{name}/tt:XAddr", NS)
            if x is not None and x.text:
                p = re.sub(r"^https?://[^/]+", "", x.text.strip()) or "/"
                setattr(self, f"{name.lower()}_path", p)
        if not self.ptz_path:
            raise PtzError("this camera has no ONVIF PTZ service — it cannot be moved or zoomed by EquiCare")

    # ---- what multistall needs -------------------------------------------- #
    def profiles(self):
        """[{token, name, ptz (bool), source}] — one per stream / lens."""
        self._services()
        root = self._post(self.media_path, "<trt:GetProfiles/>")
        out = []
        for p in root.findall(".//trt:Profiles", NS):
            src = p.find(".//tt:VideoSourceConfiguration/tt:SourceToken", NS)
            out.append({"token": p.get("token"), "name": (p.findtext("tt:Name", "", NS) or "").strip(),
                        "ptz": p.find(".//tt:PTZConfiguration", NS) is not None, "source": src.text if src is not None else None})
        return out

    def presets(self, profile):
        self._services()
        root = self._post(self.ptz_path, f"<tptz:GetPresets><tptz:ProfileToken>{_xml(profile)}</tptz:ProfileToken></tptz:GetPresets>")
        return [{"token": p.get("token"), "name": (p.findtext("tt:Name", "", NS) or "").strip()}
                for p in root.findall(".//tptz:Preset", NS)]

    def save_preset(self, profile, name, token=None):
        """Stores where the lens is now as a preset; returns its token."""
        self._services()
        tok = f"<tptz:PresetToken>{_xml(token)}</tptz:PresetToken>" if token else ""
        root = self._post(self.ptz_path, f"<tptz:SetPreset><tptz:ProfileToken>{_xml(profile)}</tptz:ProfileToken>"
                                         f"<tptz:PresetName>{_xml(name)}</tptz:PresetName>{tok}</tptz:SetPreset>")
        t = root.find(".//tptz:PresetToken", NS)
        return t.text if t is not None else token

    def goto_preset(self, profile, preset):
        self._services()
        self._post(self.ptz_path, f"<tptz:GotoPreset><tptz:ProfileToken>{_xml(profile)}</tptz:ProfileToken>"
                                  f"<tptz:PresetToken>{_xml(preset)}</tptz:PresetToken></tptz:GotoPreset>")

    def absolute(self, profile, pan=None, tilt=None, zoom=None):
        self._services()
        pos = ""
        if pan is not None and tilt is not None:
            pos += f'<tt:PanTilt x="{_num(pan)}" y="{_num(tilt)}"/>'
        if zoom is not None:
            pos += f'<tt:Zoom x="{_num(zoom, 0.0, 1.0)}"/>'
        self._post(self.ptz_path, f"<tptz:AbsoluteMove><tptz:ProfileToken>{_xml(profile)}</tptz:ProfileToken>"
                                  f"<tptz:Position>{pos}</tptz:Position></tptz:AbsoluteMove>")

    def nudge(self, profile, pan=0.0, tilt=0.0, zoom=0.0, seconds=0.4):
        """Move at a speed for a moment and stop — the calibration buttons."""
        self._services()
        vel = (f'<tt:PanTilt x="{_num(pan)}" y="{_num(tilt)}"/>' if (pan or tilt) else "") + (f'<tt:Zoom x="{_num(zoom)}"/>' if zoom else "")
        self._post(self.ptz_path, f"<tptz:ContinuousMove><tptz:ProfileToken>{_xml(profile)}</tptz:ProfileToken>"
                                  f"<tptz:Velocity>{vel}</tptz:Velocity></tptz:ContinuousMove>")
        time.sleep(max(0.05, min(3.0, seconds)))
        self._post(self.ptz_path, f"<tptz:Stop><tptz:ProfileToken>{_xml(profile)}</tptz:ProfileToken>"
                                  "<tptz:PanTilt>true</tptz:PanTilt><tptz:Zoom>true</tptz:Zoom></tptz:Stop>")

    def status(self, profile):
        """{pan, tilt, zoom, moving}"""
        self._services()
        root = self._post(self.ptz_path, f"<tptz:GetStatus><tptz:ProfileToken>{_xml(profile)}</tptz:ProfileToken></tptz:GetStatus>")
        pt, z = root.find(".//tt:Position/tt:PanTilt", NS), root.find(".//tt:Position/tt:Zoom", NS)
        moving = any((e.text or "").strip().upper() == "MOVING" for e in root.findall(".//tt:MoveStatus/*", NS))
        return {"pan": float(pt.get("x")) if pt is not None else None, "tilt": float(pt.get("y")) if pt is not None else None,
                "zoom": float(z.get("x")) if z is not None else None, "moving": moving}


class FakePtz:
    """A camera head that only remembers where it was sent — for tests and
    the simulator (edge/multistall.py --simulate)."""

    def __init__(self):
        self.moves, self.where, self.fail = [], {}, False

    def profiles(self):
        return [{"token": "colour", "name": "colour", "ptz": True, "source": "v1"},
                {"token": "thermal", "name": "thermal", "ptz": True, "source": "v2"}]

    def presets(self, profile):
        return [{"token": t, "name": t} for (p, t) in self.where.get("_saved", {}) if p == profile]

    def save_preset(self, profile, name, token=None):
        tok = token or f"{name}"
        self.where.setdefault("_saved", {})[(profile, tok)] = dict(self.where.get(profile, {}))
        return tok

    def goto_preset(self, profile, preset):
        if self.fail:
            raise PtzError("camera refused")
        self.moves.append((profile, "preset", preset))
        self.where[profile] = {"preset": preset}

    def absolute(self, profile, pan=None, tilt=None, zoom=None):
        if self.fail:
            raise PtzError("camera refused")
        self.moves.append((profile, "absolute", pan, tilt, zoom))
        self.where[profile] = {"pan": pan, "tilt": tilt, "zoom": zoom}

    def nudge(self, profile, pan=0.0, tilt=0.0, zoom=0.0, seconds=0.4):
        self.moves.append((profile, "nudge", pan, tilt, zoom))

    def status(self, profile):
        w = self.where.get(profile, {})
        return {"pan": w.get("pan"), "tilt": w.get("tilt"), "zoom": w.get("zoom"), "moving": False}


def go(ptz, position, wait=time.sleep):
    """Moves every lens a position names, then waits for the picture to
    settle (motors stopped, focus caught up). Returns the moves made."""
    done = []
    for m in (position or {}).get("moves", []):
        prof = m.get("profile")
        if not prof:
            continue
        if m.get("preset") is not None:
            ptz.goto_preset(prof, m["preset"])
        else:
            ptz.absolute(prof, m.get("pan"), m.get("tilt"), m.get("zoom"))
        done.append(prof)
    if done:
        wait(float((position or {}).get("settleS", 4.0)))
    return done


def make(dev):
    """The PTZ driver a camera's config asks for, or None (a fixed camera)."""
    p = dev.get("ptz") or {}
    proto = p.get("protocol")
    if proto == "fake":
        return FakePtz()
    if proto == "onvif":
        return OnvifPtz(dev["host"], dev.get("username", "admin"), dev.get("password") or "",
                        port=int(p.get("port") or dev.get("httpPort") or 80), path=p.get("path") or "/onvif/device_service")
    return None
