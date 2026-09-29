"""Look at, and only when told to, change the stall camera's network address.
For when the camera goes into the stable's router (used as the switch) instead
of straight into this Mac, so a second computer (the Sparsh VMS) can reach it.

  CAMERA_PASSWORD='…' python3 tools/camera_network.py show
  python3 tools/camera_network.py check 192.168.0.150          (on the stable's Wi-Fi)
  CAMERA_PASSWORD='…' python3 tools/camera_network.py set-ip 192.168.0.150         (dry run)
  CAMERA_PASSWORD='…' python3 tools/camera_network.py set-ip 192.168.0.150 --yes   (changes it)

Run set-ip while the camera is still on the direct cable: this Mac reaches it
by its link-local address (fe80::…), which does not change with the IP, so the
tool can read the setting back and confirm it. The password comes from
CAMERA_PASSWORD (or is typed), is used for one login and is never saved. A
refused login is not retried, because failed logins count towards the
camera's lockout. Only the camera with the expected MAC (CAMERA_MAC, default
ours) is changed, and only its IPv4 address (plus mask or gateway if given).
"""
import argparse
import copy
import getpass
import ipaddress
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "edge"))
from mtrpc import MtrpcCamera  # noqa: E402
from share_camera_video import registry_camera_host  # noqa: E402

NET = "NetWork.net_interface_list"
OUR_MAC = "18:74:e2:dc:d5:d0"
MASK_KEYS = ("netmask", "mask", "subnet_mask", "submask")
GW_KEYS = ("gateway", "gw", "default_gateway")
DHCP_KEYS = ("dhcp", "dhcp_enable", "enable_dhcp", "dhcp_enabled")
SECRET = re.compile(r"pass|psk|secret|token", re.I)


def norm_mac(m):
    return ":".join(p.zfill(2) for p in re.split(r"[:-]", str(m or "").lower()))


def redact(v):
    if isinstance(v, dict):
        return {k: ("•••" if SECRET.search(k) else redact(x)) for k, x in v.items()}
    if isinstance(v, list):
        return [redact(x) for x in v]
    return v


def ours(data, mac):
    return [i for i in (data.get("iface") or []) if norm_mac(i.get("mac")) == norm_mac(mac)]


def connect(a):
    host = a.camera or registry_camera_host()
    if not host:
        sys.exit("no camera address: pass --camera or add the camera on the Hardware page")
    pw = os.environ.get("CAMERA_PASSWORD")
    if pw is None:
        if not sys.stdin.isatty():
            sys.exit("set CAMERA_PASSWORD (used for one login, not saved)")
        pw = getpass.getpass("camera password (not saved): ")
    cam = MtrpcCamera(host, username=os.environ.get("CAMERA_USER", "admin"), password=pw, port=a.port)
    try:
        ok = cam.login()
    except Exception as e:                                      # noqa: BLE001
        sys.exit(f"camera not reachable at {host}: {e}")
    if not ok:
        sys.exit("the camera refused the login. Check the password; not retried, "
                 "because failed logins count towards the camera's lockout")
    return cam, host


def read_net(cam):
    return (cam.call("Config.GetConfig", {"name": NET}) or {}).get("data") or {}


def cmd_show(a):
    cam, host = connect(a)
    try:
        data = read_net(cam)
    finally:
        cam.logout()
    for i in data.get("iface") or []:
        v4 = i.get("ipv4") or {}
        tag = "  <- this camera" if norm_mac(i.get("mac")) == norm_mac(a.mac) else ""
        print(f"{i.get('ifname', '?')}  MAC {i.get('mac')}  IPv4 {v4.get('ipaddr', '-')}{tag}")
    print(json.dumps(redact(data), indent=2, ensure_ascii=False))


def cmd_check(a):
    ip = str(ipaddress.IPv4Address(a.ip))
    route = subprocess.run(["route", "-n", "get", ip], capture_output=True, text=True).stdout
    gw = re.search(r"gateway:\s*(\S+)", route)
    if gw:
        mine = subprocess.run(["ipconfig", "getifaddr", "en0"], capture_output=True, text=True).stdout.strip()
        print(f"this Mac ({mine or 'no Wi-Fi address'}) is not on {ip}'s network; it would go through {gw.group(1)}. "
              "Join the stable's Wi-Fi first: from here the check means nothing.")
        return 2
    replied = subprocess.run(["ping", "-c", "2", "-t", "3", ip], capture_output=True).returncode == 0
    arp = subprocess.run(["arp", "-n", ip], capture_output=True, text=True).stdout
    m = re.search(r" at ([0-9a-f:]+) ", arp, re.I)
    mac = norm_mac(m.group(1)) if m else None
    if mac and mac == norm_mac(a.mac):
        print(f"{ip} is this camera already.")
        return 0
    if replied or mac:
        print(f"{ip} is IN USE by {'the device with MAC ' + mac if mac else 'a device'}. Pick another address.")
        return 1
    print(f"no device answered at {ip} just now, so it is probably free. A device that is switched off does not "
          "answer either: ask whoever runs the stable's router that it is outside the router's automatic (DHCP) "
          "range and not reserved.")
    return 0


def cmd_set_ip(a):
    new = ipaddress.IPv4Address(a.ip)
    if new.is_loopback or new.is_multicast or new.is_unspecified or new.is_link_local or str(new).endswith(".255"):
        sys.exit(f"{new} cannot be a camera's address")
    cam, host = connect(a)
    try:
        data = read_net(cam)
        mine = ours(data, a.mac)
        if len(mine) != 1:
            found = ", ".join(str(i.get("mac")) for i in data.get("iface") or []) or "none"
            sys.exit(f"this camera is not the one with MAC {a.mac} (it has: {found}). Nothing changed.")
        v4 = mine[0].get("ipv4")
        if not isinstance(v4, dict) or "ipaddr" not in v4:
            sys.exit(f"the camera's network setting is not in the expected form: {json.dumps(redact(mine[0]))}. Nothing changed.")
        on_dhcp = next((k for k in DHCP_KEYS if v4.get(k) in (True, 1, "1", "true", "on", "kDhcp")), None)
        if on_dhcp:
            sys.exit(f"the camera gets its address automatically ({on_dhcp} is on); change that on its own web page "
                     "first. Nothing changed.")
        changes = [("ipaddr", v4["ipaddr"], str(new))]
        for opt, keys in (("mask", MASK_KEYS), ("gateway", GW_KEYS)):
            val = getattr(a, opt)
            if val is None:
                continue
            ipaddress.IPv4Address(val)
            key = next((k for k in keys if k in v4), None)
            if not key:
                sys.exit(f"the camera's setting has no {opt} field (it has: {', '.join(v4)}). Nothing changed.")
            changes.append((key, v4[key], val))
        after = {**v4, **{k: n for k, _, n in changes}}
        mask = next((after[k] for k in MASK_KEYS if after.get(k)), None)
        gw = next((after[k] for k in GW_KEYS if after.get(k)), None)
        if mask and gw:
            net = ipaddress.IPv4Network(f"{new}/{mask}", strict=False)
            if ipaddress.IPv4Address(gw) not in net:
                sys.exit(f"the gateway {gw} is not on {net}, the network {new} would be on. Nothing changed.")
        print(f"camera {host}, MAC {mine[0].get('mac')}:")
        for k, old, n in changes:
            print(f"  {k}: {old} -> {n}" + ("   (no change)" if str(old) == str(n) else ""))
        if not a.yes:
            print("dry run: nothing changed. Add --yes to change it.")
            return 0
        if all(str(old) == str(n) for _, old, n in changes):
            print("already set: nothing to change.")
            return 0

        want = copy.deepcopy(data)
        target = ours(want, a.mac)[0]["ipv4"]
        for k, _, n in changes:
            target[k] = n
        try:
            cam.call("Config.SetConfig", {"name": NET, "data": want})
        except Exception as e:                                  # noqa: BLE001 — the camera may drop us as it re-addresses
            print(f"(the camera closed the connection while changing address: {e})")

        if host == str(changes[0][1]):
            print(f"this Mac reached the camera by {host}, the address that just changed, so it cannot read the "
                  f"setting back from here. The camera should now answer at {new}.")
            return 0
        now = None
        for _ in range(10):
            try:
                now = ours(read_net(cam), a.mac)[0].get("ipv4", {}).get("ipaddr")
                break
            except Exception as e:                              # noqa: BLE001
                if "logging in again failed" in str(e):
                    break
                time.sleep(3)
        if now == str(new):
            print(f"confirmed: the camera now reports its address as {new}.")
            print(f"  to put it back: set-ip {changes[0][1]} --yes")
            print("  next: plug the camera into a LAN port on the stable's router, join this Mac to the stable's "
                  "Wi-Fi, run scripts/demo.sh (it finds the camera by its MAC).")
            return 0
        print(f"could not confirm: the camera reports {now!r}. Run 'show' to see its setting.")
        return 1
    finally:
        cam.logout()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--camera", help="camera address (default: the one saved on the Hardware page)")
    ap.add_argument("--port", type=int, default=80)
    ap.add_argument("--mac", default=os.environ.get("CAMERA_MAC", OUR_MAC), help="only change the camera with this MAC")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("show", help="print the camera's network setting")
    c = sub.add_parser("check", help="is this address free on the network this Mac is on?")
    c.add_argument("ip")
    s = sub.add_parser("set-ip", help="change the camera's IPv4 address (dry run without --yes)")
    s.add_argument("ip")
    s.add_argument("--mask")
    s.add_argument("--gateway")
    s.add_argument("--yes", action="store_true", help="really change it")
    a = ap.parse_args()
    sys.exit({"show": cmd_show, "check": cmd_check, "set-ip": cmd_set_ip}[a.cmd](a) or 0)


if __name__ == "__main__":
    main()
