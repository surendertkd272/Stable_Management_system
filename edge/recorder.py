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

from video_analytics import clean_ffmpeg_error, local_relay, retry_wait

STREAMS = {"thermal": "/media/live/202", "visible": "/media/live/102"}
COLOUR_MAIN = "/media/live/101"            # the colour picture in full HD (1920x1080)


def stream_path(dev, stream):
    """The sub-stream — or, for colour, the full-HD main stream when the camera
    is set to it (Hardware → colour detail): sharper recordings to zoom into.
    A camera the stable already owns (ip_camera) keeps its streams wherever
    its make does: the paths come with it."""
    if dev.get("kind") == "ip_camera":
        return (dev.get("rtspPathMain") if dev.get("colourStream") == "main" else None) or dev["rtspPath"]
    return COLOUR_MAIN if stream == "visible" and dev.get("colourStream") == "main" else STREAMS[stream]


def streams_of(dev):
    """An ordinary camera has only the colour picture."""
    return ["visible"] if dev.get("kind") == "ip_camera" else list(STREAMS)


def record_cmd(url, out_dir, clip_seconds, codec, audio=False):
    """ffmpeg: copy the stream into clock-aligned clips. HEVC is tagged hvc1 so
    Safari plays it; an H.264 stream must not be (ffmpeg refuses the tag).
    codec None (could not ask): hvc1, which the demo unit's streams are.
    audio: keep the camera's microphone too, when the stream has it (the
    demo unit sends G.711 at 8 kHz, which MP4 cannot hold: stored as AAC)."""
    tag = ["-tag:v", "hvc1"] if codec in (None, "hevc") else []
    sound = ["-map", "0:a:0?", "-c:a", "aac", "-b:a", "32k"] if audio else ["-an"]
    return ["ffmpeg", "-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp", "-timeout", "8000000",
            "-i", url, "-map", "0:v:0", "-c:v", "copy", *tag, *sound,
            "-f", "segment", "-segment_time", str(clip_seconds), "-segment_atclocktime", "1",
            "-reset_timestamps", "1", "-strftime", "1", "-segment_format", "mp4",
            "-segment_format_options", "movflags=+frag_keyframe+empty_moov+default_base_moof",
            str(Path(out_dir) / "%Y-%m-%dT%H-%M-%S.mp4")]


def video_codec(url, timeout=15):
    """The stream's codec ("hevc", "h264"), or None if it cannot be asked."""
    try:
        out = subprocess.run(["ffprobe", "-v", "error", "-rtsp_transport", "tcp", "-select_streams", "v:0",
                              "-show_entries", "stream=codec_name", "-of", "csv=p=0", url],
                             capture_output=True, timeout=timeout).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None
    return out.decode(errors="replace").strip() or None
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
        if not d.get("password"):
            self.error = "no camera password set — not recording (enter it in the Hardware page)"
            print(f"[edge] {self.name}: {self.error}")
            return
        while not self.stop_evt.is_set():
            port = local_relay(d["host"], d.get("rtspPort") or 554, self.stop_evt)
            cred = f"{urllib.parse.quote(d.get('username', 'admin'))}:{urllib.parse.quote(d.get('password') or '')}"
            url = f"rtsp://{cred}@127.0.0.1:{port}{stream_path(d, self.stream)}"
            # Video only. record_cmd(..., audio=True) keeps the camera's microphone
            # (tested), for when sound is wanted — not switched on yet.
            cmd = record_cmd(url, self.out, self.clip_seconds, video_codec(url))
            try:
                self.proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            except FileNotFoundError:
                self.error = "ffmpeg is not installed — recording needs it"
                return
            self.started_at = time.time()
            _, err = self.proc.communicate()
            if self.stop_evt.is_set():
                break
            text = clean_ffmpeg_error((err or b'').decode(errors='replace'))
            ran = time.time() - self.started_at > 30
            self.failures = 0 if ran else getattr(self, "failures", 0) + 1
            wait = retry_wait(text, self.failures - 1)
            self.error = f"recording stopped: {text or 'stream ended'} — retrying in {wait} s"
            print(f"[edge] {self.name}: {self.error}")
            self.stop_evt.wait(wait)

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
        self.parts = [StreamRecorder(dev, s, root) for s in streams_of(dev)]

    def start(self):
        for p in self.parts:
            p.start()
        print(f"[edge] recording {self.dev['name']} ({' + '.join(p.stream for p in self.parts)}) to {self.parts[0].out.parent}")

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
