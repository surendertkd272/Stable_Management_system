"""share_camera_video: an allowed computer reaches the camera, others do not.
Run: python3 tools/share_camera_video_test.py"""
import socket
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from share_camera_video import serve  # noqa: E402

fails = 0


def check(name, ok, detail=""):
    global fails
    if not ok:
        fails += 1
        print(f"FAIL {name} {detail}")


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


# A stand-in camera: answers an RTSP OPTIONS request, like the real one.
cam_port = free_port()
cam = socket.socket()
cam.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
cam.bind(("127.0.0.1", cam_port))
cam.listen(4)


def camera():
    while True:
        try:
            c, _ = cam.accept()
        except OSError:
            return
        req = c.recv(4096)
        if req.startswith(b"OPTIONS"):
            c.sendall(b"RTSP/1.0 200 OK\r\nCSeq: 1\r\nPublic: DESCRIBE, SETUP, PLAY\r\n\r\n" + b"x" * 200_000)
        c.close()


threading.Thread(target=camera, daemon=True).start()

logs = []
stop = threading.Event()
port = free_port()
threading.Thread(target=serve, args=("127.0.0.1", port, "127.0.0.1", cam_port, {"127.0.0.1"}, stop, logs.append),
                 daemon=True).start()
time.sleep(0.4)

# Allowed: the camera's reply comes back, in full.
s = socket.create_connection(("127.0.0.1", port), timeout=5)
s.sendall(b"OPTIONS rtsp://127.0.0.1/media/live/101 RTSP/1.0\r\nCSeq: 1\r\n\r\n")
got = b""
while True:
    d = s.recv(65536)
    if not d:
        break
    got += d
s.close()
check("allowed computer reaches the camera", got.startswith(b"RTSP/1.0 200 OK"), got[:60])
check("... and gets the whole stream through", len(got) > 200_000, len(got))
time.sleep(0.3)
check("connection logged", any("connected" in line for line in logs), logs)

# Not allowed: refused before anything reaches the camera.
stop.set()
time.sleep(1.2)
stop2 = threading.Event()
port2 = free_port()
threading.Thread(target=serve, args=("127.0.0.1", port2, "127.0.0.1", cam_port, {"10.9.9.9"}, stop2, logs.append),
                 daemon=True).start()
time.sleep(0.4)
s = socket.create_connection(("127.0.0.1", port2), timeout=5)
s.sendall(b"OPTIONS rtsp://x/ RTSP/1.0\r\nCSeq: 1\r\n\r\n")
try:
    refused = s.recv(100) == b""
except OSError:
    refused = True
s.close()
check("a computer not on the list is refused", refused)
check("... and it is logged", any("refused 127.0.0.1" in line for line in logs), logs)
stop2.set()

print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
