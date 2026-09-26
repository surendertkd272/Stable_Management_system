"""Record a camera's thermal and visible video for labelling and training.

Why: every behaviour detector today is a hand-made heuristic. To learn real
models (lying down vs standing, rolling, pawing, urinating, defecating,
weaving…) we need footage from OUR camera, at OUR stalls, with events marked.
This keeps it: both streams, cut into clips aligned to the clock (10 minutes by
default), so the thermal and visible clip for the same period share a name.

- The streams are copied as the camera sends them (HEVC), not re-encoded, so
  recording costs almost no CPU. Audio (the visible stream carries G.726) and
  the metadata track are dropped.
- Clips are fragmented MP4: a clip cut short by a crash or power cut is still
  playable up to that point.
- A storage cap: the oldest clips are deleted once the folder passes it.

Layout:  <dir>/<camera id>/<thermal|visible>/<YYYY-MM-DDTHH-MM-SS>.mp4
(local time of the edge box, as the clock boundary it started on).

Stream paths are those the demo unit's firmware reports over ONVIF
(GetStreamUri): /media/live/202 thermal, /media/live/102 visible, both 704×576
at 25 fps. Standard library + ffmpeg only.
"""
import os
import subprocess
import threading
import time
import urllib.parse
from pathlib import Path

from video_analytics import local_relay

STREAMS = {"thermal": "/media/live/202", "visible": "/media/live/102"}
CLIP_SECONDS = 600


def recordings_dir():
    return Path(os.environ.get("EQUICARE_RECORDINGS_DIR") or Path.home() / "EquiCare-demo" / "recordings")


def folder_size(root):
    total = 0
    for p in Path(root).rglob("*.mp4"):
        try:
            total += p.stat().st_size
        except OSError:
            pass
    return total


def enforce_cap(root, cap_bytes, keep_newer_than_s=120):
    """Delete the oldest clips until the folder is under cap. Never touches a
    clip written in the last `keep_newer_than_s` seconds (being recorded).
    Returns the list of deleted paths."""
    clips = []
    for p in Path(root).rglob("*.mp4"):
        try:
            st = p.stat()
        except OSError:
            continue
        clips.append((st.st_mtime, st.st_size, p))
    total = sum(c[1] for c in clips)
    deleted = []
    now = time.time()
    for mtime, size, p in sorted(clips):
        if total <= cap_bytes:
            break
        if now - mtime < keep_newer_than_s:
            continue
        try:
            p.unlink()
            total -= size
            deleted.append(str(p))
        except OSError:
            pass
    return deleted


class StreamRecorder(threading.Thread):
    """One stream of one camera, into clock-aligned clips, reconnecting on loss."""

    def __init__(self, dev, stream, root, clip_seconds=CLIP_SECONDS):
        super().__init__(daemon=True, name=f"record:{dev['name']}:{stream}")
        self.dev, self.stream, self.clip_seconds = dev, stream, clip_seconds
        self.out = Path(root) / dev["id"] / stream
        self.stop_evt = threading.Event()
        self.proc = None
        self.error = None
        self.started_at = None

    def run(self):
        self.out.mkdir(parents=True, exist_ok=True)
        d = self.dev
        while not self.stop_evt.is_set():
            port = local_relay(d["host"], d.get("rtspPort") or 554, self.stop_evt)
            cred = f"{urllib.parse.quote(d.get('username', 'admin'))}:{urllib.parse.quote(d.get('password') or '')}"
            url = f"rtsp://{cred}@127.0.0.1:{port}{STREAMS[self.stream]}"
            cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp", "-timeout", "8000000",
                   "-i", url, "-map", "0:v:0", "-c", "copy", "-tag:v", "hvc1", "-an",
                   "-f", "segment", "-segment_time", str(self.clip_seconds), "-segment_atclocktime", "1",
                   "-reset_timestamps", "1", "-strftime", "1", "-segment_format", "mp4",
                   "-segment_format_options", "movflags=+frag_keyframe+empty_moov+default_base_moof",
                   str(self.out / "%Y-%m-%dT%H-%M-%S.mp4")]
            try:
                self.proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            except FileNotFoundError:
                self.error = "ffmpeg is not installed — recording needs it"
                return
            self.started_at = time.time()
            _, err = self.proc.communicate()
            if self.stop_evt.is_set():
                break
            self.error = f"recording stopped: {(err or b'').decode(errors='replace').strip()[-200:] or 'stream ended'} — reconnecting"
            print(f"[edge] {self.name}: {self.error}")
            self.stop_evt.wait(5)

    def stop(self):
        self.stop_evt.set()
        if self.proc and self.proc.poll() is None:
            # SIGTERM lets ffmpeg close the current clip cleanly; kill if it hangs.
            try:
                self.proc.terminate()
                self.proc.wait(timeout=5)
            except Exception:                                  # noqa: BLE001
                self.proc.kill()


class CameraRecorder:
    """Both streams of one camera."""

    def __init__(self, dev, root):
        self.dev = dev
        self.parts = [StreamRecorder(dev, s, root) for s in STREAMS]

    def start(self):
        for p in self.parts:
            p.start()
        print(f"[edge] recording {self.dev['name']} (thermal + visible) to {self.parts[0].out.parent}")

    def stop(self):
        for p in self.parts:
            p.stop()
        print(f"[edge] stopped recording {self.dev['name']}")

    def health(self):
        errs = [p.error for p in self.parts if p.error]
        return errs[0] if errs else None


class RetentionThread(threading.Thread):
    """Keeps the recordings folder under its cap."""

    def __init__(self, root, cap_gb, every_s=300):
        super().__init__(daemon=True, name="recordings-cap")
        self.root, self.cap = Path(root), int(cap_gb * 1024 ** 3)
        self.every_s = every_s
        self.stop_evt = threading.Event()

    def run(self):
        while not self.stop_evt.wait(self.every_s):
            gone = enforce_cap(self.root, self.cap)
            if gone:
                print(f"[edge] recordings over {self.cap / 1024 ** 3:.0f} GB — deleted {len(gone)} oldest clip(s)")
