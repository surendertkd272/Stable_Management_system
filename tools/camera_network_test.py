"""camera_network against the stand-in camera (server/testing/fake-mtrpc.mjs):
a dry run changes nothing, --yes changes only the address and keeps the rest,
another camera's MAC is refused, and a wrong password is tried once only.
Run: python3 tools/camera_network_test.py"""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOL = [sys.executable, str(ROOT / "tools" / "camera_network.py")]
fails = 0


def check(name, ok, detail=""):
    global fails
    if not ok:
        fails += 1
        print(f"FAIL {name} {detail}")


# The stand-in camera, with a fuller network setting than its default. Each
# line on stdin gets back its config and login counts.
NODE = r"""
import { startFakeMtrpc } from "./server/testing/fake-mtrpc.mjs";
import readline from "node:readline";
const f = await startFakeMtrpc({ password: "pw" });
f.st.config["NetWork.net_interface_list"] = JSON.parse(process.env.NETCFG);
console.log(f.port);
readline.createInterface({ input: process.stdin }).on("line", () =>
  console.log(JSON.stringify({ net: f.st.config["NetWork.net_interface_list"], logins: f.st.logins, failed: f.st.failedLogins })));
"""
NETCFG = {"iface": [{"ifname": "eth0", "mac": "18:74:E2:DC:D5:D0", "mtu": 1500,
                     "ipv4": {"ipaddr": "192.168.0.10", "netmask": "255.255.255.0", "gateway": "192.168.0.1"},
                     "ipv6": {"ipaddr": "fe80::1a74:e2ff:fedc:d5d0"}}]}
fake = subprocess.Popen(["node", "--input-type=module", "-e", NODE], cwd=ROOT, text=True,
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, env={**os.environ, "NETCFG": json.dumps(NETCFG)})
port = fake.stdout.readline().strip()


def state():
    fake.stdin.write("?\n")
    fake.stdin.flush()
    return json.loads(fake.stdout.readline())


def run(*args, pw="pw", mac=None):
    env = {k: v for k, v in os.environ.items() if k not in ("CAMERA_PASSWORD", "CAMERA_MAC")}
    if pw is not None:
        env["CAMERA_PASSWORD"] = pw
    if mac:
        env["CAMERA_MAC"] = mac
    r = subprocess.run([*TOOL, "--camera", "127.0.0.1", "--port", port, *args], capture_output=True, text=True,
                       env=env, stdin=subprocess.DEVNULL, timeout=60)
    return r.returncode, r.stdout + r.stderr


def ip():
    return state()["net"]["iface"][0]["ipv4"]["ipaddr"]


try:
    code, out = run("show")
    check("show finds this camera", code == 0 and "IPv4 192.168.0.10  <- this camera" in out, out)

    code, out = run("set-ip", "192.168.0.150")
    check("dry run says what would change", "ipaddr: 192.168.0.10 -> 192.168.0.150" in out and "nothing changed" in out, out)
    check("... and changes nothing", ip() == "192.168.0.10")

    code, out = run("set-ip", "192.168.0.150", "--yes", mac="18:74:e2:aa:bb:cc")
    check("another camera's MAC is refused", code != 0 and "Nothing changed" in out, out)
    check("... and changes nothing", ip() == "192.168.0.10")

    code, out = run("set-ip", "10.0.0.5", "--gateway", "192.168.0.1", "--yes")
    check("a gateway off the new network is refused", code != 0 and "not on 10.0.0.0/24" in out, out)
    check("... and changes nothing", ip() == "192.168.0.10")

    code, out = run("set-ip", "192.168.0.150", "--yes")
    after = state()["net"]["iface"][0]
    check("--yes changes the address and confirms it", code == 0 and "confirmed" in out and after["ipv4"]["ipaddr"] == "192.168.0.150", out)
    check("... keeping everything else", after["ipv4"]["netmask"] == "255.255.255.0" and after["ipv4"]["gateway"] == "192.168.0.1"
          and after["mtu"] == 1500 and after["ipv6"] == NETCFG["iface"][0]["ipv6"], after)
    check("... and says how to undo it", "set-ip 192.168.0.10 --yes" in out, out)

    code, out = run("set-ip", "192.168.0.10", "--yes")
    check("putting it back works", code == 0 and ip() == "192.168.0.10", out)

    before = state()["failed"]
    code, out = run("show", pw="wrong")
    check("a wrong password is refused", code != 0 and "not retried" in out, out)
    check("... after one attempt only", state()["failed"] - before == 1, state())

    code, out = run("show", pw=None)
    check("no password and no terminal: asks for CAMERA_PASSWORD", code != 0 and "CAMERA_PASSWORD" in out, out)

    code, out = run("set-ip", "127.0.0.1", "--yes")
    check("a nonsense address is refused before logging in", code != 0 and "cannot be a camera's address" in out, out)
finally:
    fake.kill()

print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
