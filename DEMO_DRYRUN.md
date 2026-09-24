# Camera demo — dry run and live run

The camera-centric demo: a thermal camera watching a stall, deriving body
temperature and respiratory rate, and those readings appearing on the dashboard
as live vitals and alerts.

Everything below has been run end to end without hardware. The only difference
on demo day is the camera's IP and port.

---

## What the camera demo actually covers

Three of the client's twelve points are measured directly off the camera today:

| Point | Metric | How |
|---|---|---|
| 2 | Body temperature | ISAPI Point ROI on the eye region |
| 3 | Respiration (raw) | ISAPI Area ROI on the nostrils |
| 4 | Respiratory rate | autocorrelation of the nostril ROI temperature |

Points 6, 11 and 12 come from the same camera's visible stream but need CV
models we cannot train until we have labelled footage — `/api/coverage` reports
those as `model-pending`, and the dashboard shows them as **Not measured**
rather than as zeros. The remaining points wait on sensors (IMU, flow meter,
feeder, microphone) that are not procured.

Say this plainly in the demo. The dashboard is built to show it honestly, and
a horse with no sensor data reads "No sensor data has ever been received",
never "calm".

---

## Dry run (no hardware)

Four processes. Ports are chosen to avoid anything privileged.

### 1. RTSP video source

The mock camera advertises RTSP URLs but does not serve video. `mediamtx` (a
single binary, no install) serves a real clip on those URLs:

```bash
# once
curl -sL -o mediamtx.tar.gz \
  https://github.com/bluenviron/mediamtx/releases/download/v1.20.1/mediamtx_v1.20.1_darwin_arm64.tar.gz
tar xzf mediamtx.tar.gz

printf 'rtspAddress: :8554\nlogLevel: warn\npaths:\n  all_others:\n' > mediamtx.yml
./mediamtx mediamtx.yml &
```

Then push a horse clip into it on a loop. `testdata/` is gitignored (large
media); source clips from Wikimedia Commons — "A grazing horse at the
Écomusée de la Bintinais" (CC0) and "Sample of Bens horse feeding on Sundays-1"
(CC BY-SA 2.0) both work and show a mostly-stationary head, which is what an
ROI needs.

```bash
ffmpeg -re -stream_loop -1 -i testdata/horse_grazing_cc0.webm \
  -an -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -g 30 \
  -f rtsp -rtsp_transport tcp rtsp://127.0.0.1:8554/stream/live &
```

### 2. Mock camera — ISAPI + Modbus

Stands in for the Sparsh VD641NT. Its simulated horse has a nostril ROI whose
temperature oscillates at a rate you choose, so you know the right answer:

```bash
python3 tools/mock_camera.py --http-port 8081 --modbus-port 5502 \
        --rtsp-port 8554 --breathing-bpm 16 &
```

`--fever` raises the body temperature if you want to demo an alert firing.

### 3. Backend

```bash
npm run build && npm start &   # UI + API on :8080; prints a generated admin password on first boot
```

### 4. Edge agent

```bash
python3 edge/edge_agent.py --camera 127.0.0.1 --http-port 8081 \
        --user admin --pass admin --stall A-04 --window 60 --live
```

It sets the ROIs, samples the nostril area, and posts body temperature and
respiratory rate to the backend every window. The backend maps stall A-04 to
whichever horse is in it.

### Verify

```bash
python3 sparsh_camera_smoketest.py 127.0.0.1 admin admin \
        --http-port 8081 --rtsp-port 8554 --modbus-port 5502
```

Expect **OK on everything** — ISAPI login, ROI set/read, Modbus cross-check and
the RTSP probe. Measured on this rig: a mock breathing at 18 bpm reads 18.4,
at 22 bpm reads 22.7.

---

## Capturing footage for the CV models

The capture that matters — every stream plus a synchronised temperature track
and a manifest:

```bash
python3 tools/camera_capture.py <ip> --user admin --pass <pw> \
        --session 300 --horse zarina --out captures
```

**Set the ROIs before capturing.** With none configured the video records fine
but the temperature track is empty and the session is worthless for training;
the tool warns loudly and exits non-zero rather than letting that happen
quietly. Running `edge_agent --camera` once sets an eye Point and a nostril
Area.

---

## Live run (real camera)

Identical, minus mediamtx and the mock. Drop `--http-port` (the camera uses 80)
and point at the camera:

```bash
python3 sparsh_camera_smoketest.py <camera-ip> <user> <password>
python3 edge/edge_agent.py --camera <camera-ip> --user <user> --pass <pw> \
        --stall A-04 --live
```

Run the smoke test first, in the barn, on the actual network. It reports what
the camera really supports rather than what the datasheet claims.

### Before the demo

- Emissivity and distance are set in `real_camera()` (0.98, 350 cm). Measure the
  real camera-to-horse distance and set it — it moves the absolute temperature.
- The ROI coordinates are proportional (0–10000) and currently fixed at the
  frame centre. They must be aimed at the actual eye and nostrils for the
  numbers to mean anything.
- Absolute accuracy is ±2 °C without a blackbody reference. Present temperature
  as a **trend against the horse's own baseline**, not as a clinical
  thermometer reading. The alert thresholds are screening-grade and still need
  a vet's review.

---

## Calibrating a camera from the Hardware page

Run the mock with the head away from frame centre, so the edge agent's default
ROIs miss — the realistic case:

```bash
python3 tools/mock_camera.py --http-port 8081 --modbus-port 5502 --scene offset --breathing-bpm 14 &
npm run build && npm start &
```

1. **Hardware → Add camera**: IP `127.0.0.1`, HTTP port `8081`, Modbus `5502`,
   variant 640, lens 25 mm, 3.5 m. The optics panel shows pixels on target as you
   type.
2. **Test connection** — every ISAPI step and the Modbus cross-check should pass
   (RTSP fails unless mediamtx is running; that does not mark the camera offline).
3. **Calibrate ROIs** — click the eye's hot spot on the thermal image, drag a box
   over the nostril, **Push ROIs to camera**. The eye should read ~37.6 °C; if it
   reads cooler than the nostril box, the point is off the eye.
4. **Watch breathing (20 s)** — the box average should swing by a few tenths of a
   degree.
5. Run the edge agent. It now reports *"camera is calibrated — keeping its
   ROIs"* and records ~14 bpm. Before step 3 it warned, read the coat (~31 °C),
   and reported no respiratory rate.

On a real camera, use the thermal image: the eye's inner corner and the nostrils
are the warmest points on the head. Re-calibrate whenever the camera is moved or
its lens changed — the page flags that automatically.
