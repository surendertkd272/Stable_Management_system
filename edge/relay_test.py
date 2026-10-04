"""The local relay (video_analytics.local_relay) closes with its attempt: an
edge box retrying an unreachable camera every few seconds must not pile up
sockets and threads (it ran out of files overnight). Run: python3 edge/relay_test.py"""
import os
import socket
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from video_analytics import local_relay  # noqa: E402

fails = 0


def check(name, ok, detail=""):
    global fails
    if not ok:
        fails += 1
        print(f"FAIL {name} {detail}")


def open_files():
    return len(os.listdir("/dev/fd"))


# a closed port: every connection through the relay is refused, like a camera that is away
probe = socket.socket()
probe.bind(("127.0.0.1", 0))
dead_port = probe.getsockname()[1]
probe.close()

stop = threading.Event()
base_files, base_threads = open_files(), threading.active_count()
for _ in range(60):
    attempt = threading.Event()
    port = local_relay("127.0.0.1", dead_port, stop, attempt)
    c = socket.socket()
    try:
        c.connect(("127.0.0.1", port))                       # what ffmpeg does; the relay cannot reach the camera
        c.recv(1)
    except OSError:
        pass
    finally:
        c.close()
    attempt.set()                                            # ffmpeg gave up: this attempt is over
time.sleep(1.5)                                              # the relays notice within a second
check("60 failed attempts leave no sockets behind", open_files() - base_files <= 3, (base_files, open_files()))
check("... and no threads", threading.active_count() - base_threads <= 2, (base_threads, threading.active_count()))

# without `done`, a relay lives until the worker stops (the old behaviour, still right for one-off use)
port = local_relay("127.0.0.1", dead_port, stop)
time.sleep(0.2)
before = threading.active_count()
stop.set()
time.sleep(1.5)
check("the worker's stop still closes a relay", threading.active_count() < before)

print("relay_test:", "OK" if not fails else f"{fails} failed")
sys.exit(1 if fails else 0)
