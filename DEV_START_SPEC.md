# BSV EquiCare — Development-Start Specification + Recommended Hardware

---

# PART 1 — Specifications needed to START development

## 1.1 Data contract (freeze first — every component builds to this)
```
Reading {
  horseId:    string            // stable horse identifier
  metric:     string (enum)     // see table
  value:      number | string | boolean
  unit:       string            // e.g. "C", "bpm", "ml", "g", "min", "count", "index", "event"
  ts:         string            // ISO-8601 UTC, millisecond precision
  source:     enum              // thermal-roi | thermal-dsp | imu | optical-cv | audio | feed-water | manual | fused
  confidence: number            // 0.0–1.0
  meta?:      object            // deviceId, stallId, roi {x,y,w,h}, eventType, startTs, endTs, modelVersion
}
```
Events (vices, urination, excretion, drink/feed bouts) use `meta.eventType` + `meta.startTs/endTs`.

| metric | unit | source | scope point |
|---|---|---|---|
| `bodyTempC` | C | thermal-roi | 2 |
| `respRateBpm` | bpm | thermal-dsp | 4 |
| `respPattern` | enum | thermal-dsp | 3 |
| `steps` | count | imu | 1 |
| `activityLevel` | index | fused | 5 |
| `abnormalActivity` | boolean | fused | 5 |
| `restState` | enum | fused | 6 |
| `lyingMinutes` | min | fused | 6 |
| `gaitAsymmetry` | index | fused | 7 |
| `viceEvent` | event | fused | 8 |
| `waterMl` | ml | feed-water | 9 |
| `feedGrams` | g | feed-water | 10 |
| `refusalGrams` | g | feed-water | 10 |
| `urinationEvent` | event | optical-cv | 11 |
| `excretionEvent` | event | optical-cv | 12 |

`confidence` is lowered automatically on: ROI lost, sensor offline, night/low-contrast, target out of range, calibrating.

## 1.2 Software architecture
```
PER STALL (sensors)                 EDGE BOX (per barn)                     CLOUD (later)
 Camera ──RTSP(IR/visible/fusion)─┐   ┌───────────────────────────┐
 Camera ──SDK temperature poll────┤   │ Camera Bridge (C++/SDK)    │
 IMU ──BLE→gateway────────────────┼──►│  → IPC (gRPC/shared mem)   │
 Mic ──PoE/USB/I2S────────────────┤   │ Processing (Python)        │   readings   ┌─────────────┐
 Feed/Water ──RS-485/MQTT─────────┘   │  CV models + resp DSP +    │──contract──► │ Ingest →     │
                                       │  fusion + time-sync +      │  (buffered)  │ store →      │
                                       │  ROI tracking              │              │ baselines →  │
                                       │ Reading emitter + 24h queue│              │ alerts → API │
                                       └───────────────────────────┘              └──────┬──────┘
                                                                                          │
                                                                            Existing React frontend
```
- **Edge — Camera Bridge (C++):** uses the vendor SDK — pull 3 RTSP streams, poll ROI temperature, set ROI coordinates, set emissivity, apply the vendor's visible↔thermal calibration. Exposes frames + temperatures over IPC.
- **Edge — Processing (Python):** CV models + respiration DSP + fusion; consumes Bridge IPC + IMU + audio + feed/water; stamps every reading on a common edge clock; emits the data contract; buffers ≥24 h and resyncs on reconnect.
- **Backend:** ingestion → time-series storage → per-horse baselines → alert engine → REST/WebSocket API (replaces the frontend's in-memory store).
- **Frontend:** existing React/Vite app — swap the in-memory store for an API client (no UI rework).
- **Contract-first:** build everything against a `CameraSource` interface with `SimulatedCameraSource` (now) and `SparshCameraSource` (on hardware) — drop-in swap.

## 1.3 Per-stream processing spec
- **Temperature (2):** eye-ROI **max** via SDK + vendor calibration; per-horse baseline; emit as **screening trend** (±2 °C). Confidence ↓ with distance/pixels/night.
- **Respiration (3,4):** nostril-ROI **avg** temperature @ ≥10 Hz → band-pass **0.1–1 Hz** → rate + waveform pattern; **gate on stillness**.
- **Activity / Resting (5,6):** optical pose/lying CV **fused** with IMU; emit from whichever is available.
- **Lameness (7):** optical gait asymmetry (head/pelvis vertical displacement) + IMU gait cadence/asymmetry.
- **Vices (8):** optical classifier (weave/crib/wind-suck) + audio confirmation.
- **Urination/Excretion (11,12):** optical event/posture detection.

## 1.4 Edge integration responsibilities (we own these)
- **Time-sync:** stamp all sensors on one edge clock (NTP/PTP), target alignment ≤50 ms; compensate the ~50 ms temperature poll latency. *(Camera provides none.)*
- **ROI tracking:** detect the nose/eye (preferably **on the thermal/IR image directly** → ROI is already in thermal coordinates), set PosX/PosY each frame.
- **Vendor calibration:** use the camera vendor's factory visible↔thermal mapping for any visible→thermal lookups.
- **Confidence model:** one consistent function across metrics.

## 1.5 What to build NOW vs on hardware arrival
**Now (no hardware):** freeze §1.1 contract → backend (ingest/store/baselines/alerts/API) → camera simulator (incl. messy states) → wire frontend → develop CV/DSP on sample video → **start collecting + labelling horse video** (longest lead).
**On eval-unit arrival:** build the C++ Camera Bridge; validate pixels-on-nose + vendor calibration; tune CV on real footage; pilot; then bulk order.

---

# PART 2 — Recommended technical hardware (best solution)

## 2.1 Camera (points 2,3,4,5,6,7,8,11,12) — **1 per stall**
- **Sparsh SC-IT6420-HB V2, 640×512 thermal variant** (highest thermal grade — needed for nose/eye).
- **Thermal lens 25 mm** (≈18 px on a 5 cm nose at 4 m) aimed at the head/feed/rest zone; **visible lens 4 mm** for full-stall behaviour. Fixed focus **factory-set to 3.5 m**.
- **Mandatory:** vendor **factory visible↔thermal calibration** exposed in SDK (so we read temperature at a detected coordinate without field calibration).
- 940 nm IR (invisible), global-shutter visible, H.265, PoE 802.3af, IP66. Treat temperature as **screening-grade**; keep a blackbody/higher-accuracy model as the upgrade path.

## 2.2 IMU wearable (points 1,5,6,7) — **1 per horse**
- **9-axis BLE 5.x leg tag** (cannon bone). Target sensor class: **TDK ICM-42688-P** or **Bosch BMI323** (accel ±16 g, gyro ±2000 °/s).
- **≥100 Hz raw** access (target 100–200 Hz for gait); on-tag ≥24 h buffer; **IP68**; **rechargeable + hot-swap dock**; loss/detach alert; unique ID → horseId.
- **1 BLE-to-IP gateway per barn** (local path to edge). **Must have India WPC/ETA + BIS.**
- Recommendation: evaluate **equine/livestock-specific activity tags** first (validated on horses); fall back to a custom tag on these ICs only if none fit.

## 2.3 Feed & water (points 9,10) — **1 set per stall**
- **Water:** **electromagnetic or hall-effect food-grade flow meter** (no/low moving parts, resists Indian hard water + debris), **RS-485/Modbus** output. *(Best: inline on the supply — avoids fabricating load-cell buckets.)*
- **Feed:** **load-cell weigh-back auto-feeder** (measures dispensed **and** refusal) + optional load-cell hay manger.
- **Interim (deploy day 1):** manual logging in the app + camera head-down presence — same contract via `source:'manual'`.
- IP67, corrosion-resistant, open Linux driver, per-stall (one horse) or RFID attribution.

## 2.4 Microphone (point 8 audio) — **1 per stall**
- **Weatherproof PoE/IP microphone (ONVIF audio)** or an **industrial MEMS mic → USB/I2S** into the edge.
- Frequency response **50 Hz–12 kHz**, max SPL **>100 dB** no-clip, **uncompressed PCM ≥16 kHz**, **AGC disable-able**, **PTP/NTP timestamp**, **IP65+**, directional to limit cross-talk.

## 2.5 Edge box & network — **1 per barn**
- **NVIDIA Jetson Orin NX 16 GB** for **1–4 cameras**; **AGX Orin 32–64 GB** for **8–16 cameras**. Confirm exact stall count with the vendor's measured inference budget.
- **NVMe SSD 1–2 TB** (retention + buffer, power-loss protected); **fanless rugged enclosure** for the barn.
- **Managed PoE+ switch** (cameras ≤6 W each + headroom, VLAN/QoS); **dual-SIM industrial 4G/LTE router** (failover); **online double-conversion UPS** (clean shutdown + ride-through).

## 2.6 Cloud (later phase) — **GCP asia-south1 (Mumbai)**
- **Pub/Sub** ingest · **Bigtable** (raw time-series) + **BigQuery** (analytics/baselines) · **Firestore** (app/realtime) · **Vertex AI** (models + per-horse baselines) · **GCS** (clips). Alerts via **FCM** + a **WhatsApp partner** (Twilio/Gupshup). *(No Google IoT Core — it's retired.)*

## 2.7 Software stack
- **Edge:** C++ (Sparsh SDK) bridge + **Python** processing (**PyTorch + TensorRT**, OpenCV, NumPy/SciPy for the respiration DSP), **gRPC** IPC, **MQTT/Pub-Sub** out.
- **Backend:** Python or Node API; time-series DB (Bigtable/TimescaleDB); Firestore/Postgres for app data.
- **Frontend:** existing **React + Vite** app.

## 2.8 Prototype bill of materials (1–2 stall pilot)
- 2 × Sparsh SC-IT6420-HB V2 640×512 (one 25 mm thermal, one 13 mm) + SDK + calibration
- 3–5 × IMU leg tags + 1 gateway + charging dock
- 1 × flow meter + 1 × weigh-back feeder (+ manual logging fallback)
- 2 × IP microphones
- 1 × Jetson Orin NX 16 GB edge box + NVMe + enclosure
- 1 × PoE+ switch, 1 × dual-SIM 4G router, 1 × online UPS

---

## Start sequence
1. Freeze §1.1 data contract.
2. Build backend + simulator; wire the existing frontend.
3. Develop CV/DSP on sample video; start labelling real footage.
4. Order eval hardware (camera done; IMU/feed-water/mic next).
5. On arrival: build the Camera Bridge; run the pilot; then bulk-order.
