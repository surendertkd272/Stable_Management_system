#!/usr/bin/env python3
"""
camera_capture — bench + field capture for the Sparsh VD641NT.

The driver (sparsh_camera.py) covers the CONTROL path: log in, place ROIs, read
temperatures. This covers the VIDEO path, which is what you need to actually
test camera features and — critically — to collect the labelled footage the CV
models for points 5, 6, 8, 11 and 12 cannot be trained without.

Uses ffmpeg (present on macOS via brew and on JetPack) rather than OpenCV, so
there is nothing to build on the Jetson.

Modes
  --probe                 what each stream really is: codec, resolution, fps
  --snapshot              one JPEG per device (IR / visible / fusion)
  --radiometric           fetch the Type=1 JPEG and split off the temperature block
  --record N              record N seconds of every stream to a session folder
  --session N             record N seconds AND sample temperatures throughout,
                          writing a manifest — this is the CV-training capture

Examples
  python3 tools/camera_capture.py 192.168.1.102 --pass PW --probe
  python3 tools/camera_capture.py 192.168.1.102 --pass PW --session 300 --horse zarina
"""
import os
import sys
import json
import time
import shutil
import argparse
import datetime as dt
import subprocess
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# dev=0 infrared · dev=1 visible · dev=2 fusion  (see SDK/PROTOCOL_REFERENCE.md)
STREAMS = {
    "ir":      "dev=0&chn=0",
    "visible": "dev=1&chn=0",
    "fusion":  "dev=2&chn=0",
}
JPEG_EOI = b"\xff\xd9"


def rtsp_url(ip, query, user=None, pw=None, port=554):
    cred = f"{user}:{pw}@" if user and pw else ""
    return f"rtsp://{cred}{ip}:{port}/stream/live?{query}"


def need_ffmpeg():
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg not found.  macOS: brew install ffmpeg   ·   Jetson: sudo apt install ffmpeg")


# --------------------------------------------------------------------------- #
def probe(ip, user, pw):
    """Report what each stream actually is — not what the datasheet claims."""
    if not shutil.which("ffprobe"):
        sys.exit("ffprobe not found (ships with ffmpeg)")
    print(f"{'stream':9} {'codec':7} {'resolution':12} {'fps':>6}  status")
    for name, q in STREAMS.items():
        url = rtsp_url(ip, q, user, pw)
        try:
            out = subprocess.run(
                ["ffprobe", "-v", "error", "-rtsp_transport", "tcp",
                 "-select_streams", "v:0", "-show_entries",
                 "stream=codec_name,width,height,avg_frame_rate",
                 "-of", "json", "-timeout", "8000000", url],
                capture_output=True, text=True, timeout=30)
            s = (json.loads(out.stdout or "{}").get("streams") or [{}])[0]
            if not s:
                lines = (out.stderr or "").strip().splitlines()
                why = lines[-1].split(": ")[-1] if lines else "no stream"
                print(f"{name:9} {'-':7} {'-':12} {'-':>6}  {why}")
                continue
            num, _, den = (s.get("avg_frame_rate") or "0/1").partition("/")
            fps = round(int(num) / int(den), 1) if den and int(den) else 0
            print(f"{name:9} {s.get('codec_name','?'):7} "
                  f"{str(s.get('width'))+'x'+str(s.get('height')):12} {fps:>6}  ok")
        except subprocess.TimeoutExpired:
            print(f"{name:9} {'-':7} {'-':12} {'-':>6}  TIMEOUT")
        except Exception as e:
            print(f"{name:9} {'-':7} {'-':12} {'-':>6}  {e}")


def record(ip, user, pw, seconds, outdir, streams=None):
    """Record each stream with ffmpeg. Copies the codec — no re-encode, so the
    Jetson stays free and the footage is exactly what the camera produced."""
    need_ffmpeg()
    outdir.mkdir(parents=True, exist_ok=True)
    procs = []
    for name, q in (streams or STREAMS).items():
        dest = outdir / f"{name}.mp4"
        p = subprocess.Popen(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp",
             "-i", rtsp_url(ip, q, user, pw), "-t", str(seconds),
             "-c", "copy", "-movflags", "+faststart", "-y", str(dest)],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        procs.append((name, dest, p))
        print(f"  recording {name} -> {dest.name}")
    return procs


def finish(procs):
    ok = True
    for name, dest, p in procs:
        _, err = p.communicate()
        size = dest.stat().st_size if dest.exists() else 0
        if p.returncode == 0 and size > 0:
            print(f"  ✓ {name:9} {size/1e6:6.1f} MB")
        else:
            ok = False
            msg = (err or b"").decode(errors="replace").strip().splitlines()[-1:] or [""]
            print(f"  ✗ {name:9} failed: {msg[0]}")
    return ok


def snapshot(cam, outdir, radiometric=False):
    """One JPEG per device. With radiometric=True also split the appended
    temperature block off the IR image (Type=1)."""
    outdir.mkdir(parents=True, exist_ok=True)
    written = []
    for dev, name in ((0, "ir"), (1, "visible"), (2, "fusion")):
        try:
            data = cam.snapshot(dev=dev) if hasattr(cam, "snapshot") else cam.snapshot_radiometric(dev)
            path = outdir / f"snap_{name}.jpg"
            path.write_bytes(data)
            written.append((name, path, len(data)))
            print(f"  ✓ {name:8} {len(data)/1024:7.1f} KB -> {path.name}")
        except Exception as e:
            print(f"  ✗ {name:8} {e}")

    if radiometric:
        try:
            raw = cam.snapshot_radiometric(0)
            path = outdir / "radiometric.jpg"
            path.write_bytes(raw)
            # The temperature block is appended AFTER the JPEG end-of-image marker.
            idx = raw.rfind(JPEG_EOI)
            if idx == -1 or idx + 2 >= len(raw):
                print("  ! no data found after the JPEG EOI marker — this build may "
                      "not append radiometric data, or Type=1 is unsupported")
            else:
                block = raw[idx + 2:]
                blob = outdir / "radiometric.bin"
                blob.write_bytes(block)
                px = 640 * 512
                print(f"  ✓ radiometric block {len(block)} bytes -> {blob.name}")
                print(f"    {len(block)/px:.2f} bytes/pixel at 640x512 "
                      f"({'looks like int16' if abs(len(block)-px*2) < 64 else 'unexpected size — check the format doc'})")
        except Exception as e:
            print(f"  ✗ radiometric: {e}")
    return written


# --------------------------------------------------------------------------- #
def session(ip, user, pw, seconds, horse, outroot):
    """Record every stream while sampling temperatures, then write a manifest.

    This is the capture that matters: video plus a synchronised temperature
    track, which is what a labelling pass needs to train the CV models."""
    from sparsh_camera import IsapiClient, read_modbus_temps  # noqa

    stamp = dt.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    outdir = Path(outroot) / f"{horse}_{stamp}"
    outdir.mkdir(parents=True, exist_ok=True)
    print(f"\nsession -> {outdir}\n")

    cam = IsapiClient(ip, user, pw)
    if not cam.login():
        sys.exit("camera login failed")

    info, caps = {}, {}
    try:
        info, caps = cam.device_info(), cam.capabilities()
    except Exception as e:
        print(f"  ! could not read device info: {e}")

    procs = record(ip, user, pw, seconds, outdir)

    samples, t0 = [], time.time()
    print(f"  sampling temperatures for {seconds}s…")
    while time.time() - t0 < seconds:
        try:
            samples.append({
                "ts": dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
                "elapsed_s": round(time.time() - t0, 2),
                "rois": cam.query_temps(),
            })
        except Exception as e:
            samples.append({"ts": dt.datetime.utcnow().isoformat() + "Z", "error": str(e)})
        time.sleep(1.0)

    ok = finish(procs)
    snapshot(cam, outdir, radiometric=True)

    manifest = {
        "horse": horse, "camera": ip, "started": stamp,
        "duration_s": seconds, "device": info, "capabilities": caps,
        "streams": {k: f"{k}.mp4" for k in STREAMS},
        "temperature_samples": samples,
        "note": "Temperatures are sampled on the host clock; for frame-accurate "
                "alignment use the camera's stream/meta endpoint, which carries a "
                "sensor-layer timestamp and group_id.",
    }
    (outdir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"\n  ✓ manifest.json — {len(samples)} temperature samples")
    print(f"  session {'complete' if ok else 'completed WITH ERRORS'}: {outdir}")
    return 0 if ok else 1


# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ip")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--pass", dest="pw", default=os.environ.get("CAMERA_PASSWORD", ""))
    ap.add_argument("--probe", action="store_true")
    ap.add_argument("--snapshot", action="store_true")
    ap.add_argument("--radiometric", action="store_true")
    ap.add_argument("--record", type=int, metavar="SECONDS")
    ap.add_argument("--session", type=int, metavar="SECONDS")
    ap.add_argument("--horse", default="unknown")
    ap.add_argument("--out", default="captures")
    a = ap.parse_args()

    if a.probe:
        return probe(a.ip, a.user, a.pw) or 0

    if a.record:
        outdir = Path(a.out) / dt.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
        return 0 if finish(record(a.ip, a.user, a.pw, a.record, outdir)) else 1

    if a.snapshot or a.radiometric:
        from sparsh_camera import IsapiClient
        cam = IsapiClient(a.ip, a.user, a.pw)
        if not cam.login():
            sys.exit("camera login failed")
        snapshot(cam, Path(a.out), radiometric=a.radiometric)
        return 0

    if a.session:
        return session(a.ip, a.user, a.pw, a.session, a.horse, a.out)

    ap.error("choose --probe, --snapshot, --radiometric, --record N or --session N")


if __name__ == "__main__":
    raise SystemExit(main())
