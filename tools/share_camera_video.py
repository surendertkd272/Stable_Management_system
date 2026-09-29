"""Share the camera's video from this Mac with ONE other computer on the same
Wi-Fi — e.g. a Windows laptop running the Sparsh VMS — when the camera is
cabled to this Mac only and there is no network switch.

  python3 tools/share_camera_video.py --allow 172.20.10.5
  python3 tools/share_camera_video.py --allow 172.20.10.5 --camera "fe80::1a74:e2ff:fedc:d5d0%en8"

It listens on this Mac's Wi-Fi address, port 8554, and forwards each
connection from an allowed address to the camera's video port (RTSP, 554).
Every other address is refused. In the VMS, add the camera by video link
(RTSP URL, TCP transport), with the camera's own username and password:

  rtsp://<this Mac's Wi-Fi address>:8554/media/live/101    colour, full HD
  rtsp://<this Mac's Wi-Fi address>:8554/media/live/201    thermal

Video only: the camera's settings pages and discovery are not forwarded, so
the VMS cannot change them. Each stream the VMS opens counts towards the
camera's limit on simultaneous streams — watch the Hardware page for video
warnings. The VMS logs in to the camera through this tool; the tool does not
read, store or log the password, and nothing is saved. Start scripts/demo.sh
first: it keeps the saved camera address in step with the adapter's port.
Ctrl-C stops it.
"""
import argparse
import json
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

STATE = Path.home() / "EquiCare-demo" / "data" / "state.json"


def registry_camera_host():
    """The stall camera's address as saved on the Hardware page, or None."""
    try:
        devices = json.loads(STATE.read_text()).get("entities", {}).get("devices", [])
    except (OSError, ValueError):
        return None
    cam = next((d for d in devices if d.get("kind") == "thermal_camera" and d.get("host")), None)
    return cam and cam["host"]


def wifi_address():
    for ifc in ("en0", "en1"):
        out = subprocess.run(["ipconfig", "getifaddr", ifc], capture_output=True, text=True).stdout.strip()
        if out:
            return out
    return None


def pipe(a, b, counter):
    try:
        while True:
            d = a.recv(65536)
            if not d:
                break
            b.sendall(d)
            counter[0] += len(d)
    except OSError:
        pass
    finally:
        for s in (a, b):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            s.close()


def serve(listen_ip, port, camera_host, camera_port, allowed, stop=None, log=print):
    """Accept on listen_ip:port; forward allowed peers to camera_host:camera_port."""
    target = socket.getaddrinfo(camera_host, camera_port, 0, socket.SOCK_STREAM)[0]
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((listen_ip, port))
    srv.listen(8)
    srv.settimeout(1.0)
    log(f"[share] forwarding {listen_ip}:{port} -> camera {camera_host} port {camera_port}; allowed: {', '.join(sorted(allowed))}")
    while not (stop and stop.is_set()):
        try:
            conn, (peer, _) = srv.accept()
        except socket.timeout:
            continue
        if peer not in allowed:
            log(f"[share] {time.strftime('%H:%M:%S')} refused {peer} (not on the --allow list)")
            conn.close()
            continue
        try:
            up = socket.socket(target[0], socket.SOCK_STREAM)
            up.settimeout(8)
            up.connect(target[4])
            up.settimeout(None)
        except OSError as e:
            log(f"[share] {time.strftime('%H:%M:%S')} camera not reachable for {peer}: {e}")
            conn.close()
            continue
        log(f"[share] {time.strftime('%H:%M:%S')} {peer} connected")
        down, upc = [0], [0]

        def run(c=conn, u=up, p=peer, d=down, uc=upc):
            t = threading.Thread(target=pipe, args=(u, c, d), daemon=True)
            t.start()
            pipe(c, u, uc)
            t.join()
            log(f"[share] {time.strftime('%H:%M:%S')} {p} disconnected ({d[0] / 1e6:.1f} MB of video sent)")
        threading.Thread(target=run, daemon=True).start()
    srv.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--allow", action="append", required=True, help="IP address of the computer allowed to connect (repeatable)")
    ap.add_argument("--camera", default=None, help="camera address (default: the one saved on the Hardware page)")
    ap.add_argument("--camera-port", type=int, default=554)
    ap.add_argument("--listen", default=None, help="this Mac's address to listen on (default: its Wi-Fi address)")
    ap.add_argument("--port", type=int, default=8554)
    a = ap.parse_args()
    cam = a.camera or registry_camera_host()
    if not cam:
        sys.exit("no camera address — pass --camera or add the camera on the Hardware page")
    listen = a.listen or wifi_address()
    if not listen:
        sys.exit("this Mac has no Wi-Fi address — join the same Wi-Fi as the other computer, or pass --listen")
    print(f"[share] in the VMS use: rtsp://{listen}:{a.port}/media/live/101 (colour) and "
          f"rtsp://{listen}:{a.port}/media/live/201 (thermal), TCP transport, the camera's login")
    try:
        serve(listen, a.port, cam, a.camera_port, set(a.allow))
    except KeyboardInterrupt:
        print("\n[share] stopped")


if __name__ == "__main__":
    main()
