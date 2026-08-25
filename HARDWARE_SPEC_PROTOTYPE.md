# Hardware Requirement Specification — Prototype (BSV EquiCare)

*Purpose: give each vendor the clarity to build a working prototype for a 1–2 stall pilot, and give the software team the fixed interfaces to build against. Status tags: ✅ confirmed (camera) · 🟡 partial · ❓ to confirm.*

---

## 0. Prototype goal
A **single-stall (scalable to 2) test rig** that captures all 12 data streams and emits them to one edge box in a common data contract, so the AI/backend can be validated on real horses before volume rollout.

**Per-stall device set:** 1 dual thermal+optical camera · 1 IMU leg wearable · 1 metered/weighed feeder + 1 water sensor · 1 microphone. **Shared:** 1 edge box + PoE switch + 4G router + UPS.

---

## 1. Common requirements (ALL devices/vendors must meet)
- **C1 — Local-first:** stream to the on-site **edge box**; **no mandatory external/vendor cloud**.
- **C2 — Linux/ARM:** drivers/SDK run on **Ubuntu 22.04+ / NVIDIA Jetson (ARM64)**; documented API + sample code.
- **C3 — Data contract:** every reading mappable to `{ horseId, metric, value, unit, ts, source, confidence }`.
- **C4 — Timestamps/sync:** device timestamps each reading and supports **NTP (PTP preferred)**; fusion alignment target **≤50 ms**.
- **C5 — Identity:** unique immutable device/tag ID, bindable to a stall/horse via API.
- **C6 — Offline resilience:** on-device/local **buffering ≥24 h** with timestamped backfill + acknowledged delivery on reconnect.
- **C7 — Confidence:** per-reading quality/status/confidence flag.
- **C8 — Power:** PoE (802.3af/at) preferred, or documented DC; **state per-device wattage**.
- **C9 — Environment:** continuous 24/7; barn dust/ammonia/humidity/wash-down; operating **0–50 °C**, high RH.
- **C10 — Compliance:** **India WPC/ETA** (any radio) + BIS; **DPDP-2023** data stays in India (asia-south1); camera/mic capture humans → privacy handling.
- **C11 — Prototype deliverable:** ship **1–2 units + SDK + docs + working sample code** for each device.

---

## 2. Device A — Dual thermal + optical camera  *(Sparsh SC-IT6420-HB V2, mostly confirmed)*
**Covers points 2, 3, 4, 5(optical), 6(optical), 7(optical), 8(video), 11, 12**

**Thermal**
- 640×512, NETD ≤0.05 °C, spectral 8–14 µm. ✅
- ≥25 fps; ROI temperature read ≥10 Hz (up to 25 fps). ✅
- **≥10 thermal px on a 5 cm target at 4 m** (25 mm lens = 18 px ✅; 13 mm = 9 px → use 25 mm, or 13 mm at ≤3 m).
- Per-ROI **emissivity** adjustable; **≥2 simultaneous ROIs** per horse (nostril Avg + eye Max). ✅
- **Runtime ROI** create/move/read by coordinates via SDK. ✅
- **Vendor factory visible↔thermal calibration**, exposed in SDK so we read **temperature at a supplied visible-image coordinate** — **no field calibration by us**. ❓ *(critical-path)*
- Accuracy ±2 °C = **screening-grade**; provide **blackbody/higher-accuracy model in same SDK family** as upgrade path. 🟡

**Visible**
- 1080p, ≥25 fps, **global shutter**, lens distortion ≤3% or correction. ✅
- Lenses: thermal **25 mm + 13 mm**, visible **4/6 mm**; **fixed focus factory-set to 3.5 m**. ✅
- Night: **940 nm IR**, usable image at 0 lux, IR **disable-able while thermal + ROI temp stay functional**. ✅

**Streaming/integration**
- **3 simultaneous RTSP** (IR/visible/fusion) @25 fps; **H.265**; target **≤4 Mbps per 1080p stream**. ✅ (exact Mbps ❓)
- SDK **C/C++ on Jetson**; ONVIF S/G; RTSP URLs documented. ✅

**Power/enclosure:** PoE **802.3af ≤6 W** ✅; **IP66**, −20…+50 °C ✅.
**Prototype:** 2 units (one 25 mm, one 13 mm) + SDK + calibration + samples.

---

## 3. Device B — IMU leg wearable
**Covers points 1, 5, 6, 7 (motion/lameness)**
- **6-axis min (3-axis accel + 3-axis gyro)**, 9-axis preferred; provide part numbers + datasheets.
- Accel range **≥ ±16 g**; gyro **≥ ±2000 °/s** (no clip at trot/canter/kick).
- Sample rate configurable **≥100 Hz (target 100–200 Hz)**.
- **Raw per-axis time-series** accessible; optional on-tag activity classification (disable-able).
- **BLE 5.x**, range to cover a stall through barn walls; **BLE-to-IP gateway** (state tags/gateway); local path to edge.
- On-tag **buffer ≥24 h** + timestamped backfill; clock sync (gateway beacon/NTP), skew ≤tens of ms.
- **Battery ≥7 days** at chosen rate, **or** rechargeable + hot-swap dock (no data gap); **IP67/68**.
- **Cannon-bone strap**, sizes pony→draft; **loss/detach alert**; weight ≤ ~50 g; welfare-safe for 24/7 wear.
- Unique HW ID → `horseId` binding via API; documented schema (units for accel/gyro/steps).
- **WPC/ETA + BIS**; on-prem/India data path.
**Prototype:** 3–5 tags + 1 gateway + SDK + samples + charging dock.

---

## 4. Device C — Feed & water sensing
**Covers points 9, 10**

**Water**
- Flow meter: resolution (ml/pulse) + accuracy across **0.1–8 L/min**; min-flow cutoff stated; **magnetic/no-moving-part preferred**; food-grade wetted parts.
- OR load-cell bucket: weight resolution (g); separates drinking from spillage/evaporation.
- **Refill vs consumption** as separate timestamped events.

**Feed**
- Dose resolution (g) + accuracy (pellets/textured/grain); **leftover/refusal weigh-back**; forage/hay load-cell option.
- **Schedule** programmable per horse; **dispense confirmation** + **fault alarms** (empty/jam/stall).

**Common**
- Output **Modbus/RS-485 / pulse / BLE / MQTT**; **open Linux driver** (no mandatory cloud).
- **IP66/67 wash-down**, corrosion-resistant, mechanical-abuse rated (kick/lean/crib).
- **Per-horse attribution** (dedicated per-stall vessel, or RFID at vessel).
- Onboard **RTC/timestamp + buffering**; per-reading status.
- **Power** stated (wired/PoE/battery).
- **Interim manual-logging** path with `{…, source:'manual'}` schema.
**Prototype:** 1 metered feeder + 1 water flow/load-cell sensor + driver docs.

---

## 5. Device D — Microphone (audio)
**Covers point 8 (audio: wind-sucking, cough, crib-biting)**
- MEMS/condenser; **frequency response ~50 Hz–12 kHz**; **max SPL >100 dB** without clipping; high SNR / low self-noise.
- **Uncompressed PCM**, sample rate **≥16 kHz** (configurable); **AGC disable-able**.
- Output to edge: **PoE network audio / USB / I2S**; **Linux/Jetson** driver; **PTP/NTP timestamping**.
- **Directional/per-stall** to limit cross-talk; **IP65+**, ammonia/wash-down rated; edge buffering.
- **DPDP**: edge-only processing, configurable retention (records human speech).
**Prototype:** 2 mics + interface/adapter to the edge box.

---

## 6. Edge box & network (integrator)
**Enables all 12 + cross-cutting**
- **Jetson tier** sized for the pilot (1–2 stalls now; quote 8/16/24 path) — state GPU/RAM.
- Ingest per stall: **3 RTSP + thermal ROI poll + IMU + audio + feed/water**; run CV + respiration DSP concurrently.
- **Local NVMe storage** (retention) with power-loss protection; **offline buffer + auto-resync**.
- **Managed PoE switch** (cameras ≤6 W each, headroom), **dual-SIM 4G failover**, **UPS** (clean shutdown).
- **Time-sync service** (aligns all sensors, compensates camera's lack of sync); **horse-identity service** (stall→horse).
- **Data-contract emitter** → GCP **asia-south1**; multi-tenant tagging.
- **Enclosure** rated for barn (dust/heat/humidity), fanless or filtered.
**Prototype:** 1 edge box provisioned for the 1–2 stall rig.

---

## 7. Data contract (the software interface — freeze this first)
`{ horseId, metric, value, unit, ts, source, confidence }`

| metric | unit | source | scope |
|---|---|---|---|
| `bodyTempC` | °C | thermal-roi | 2 |
| `respRateBpm` | bpm | thermal-dsp | 4 |
| `respPattern` | enum | thermal-dsp | 3 |
| `steps` | count | imu | 1 |
| `activityLevel` / `abnormalActivity` | index/bool | imu+optical | 5 |
| `restState` / `lyingMinutes` | enum/min | imu+optical | 6 |
| `gaitAsymmetry` | index | imu+optical | 7 |
| `viceEvent` | enum | optical+audio | 8 |
| `waterMl` / drink bout | ml/event | feed-water | 9 |
| `feedGrams` / refusalGrams | g | feed-water | 10 |
| `urinationEvent` / `excretionEvent` | event | optical-cv | 11,12 |

`source` ∈ `thermal-roi | thermal-dsp | imu | optical-cv | audio | feed-water | manual | fused`. `confidence` 0–1, lowered on degraded conditions (ROI lost, sensor offline, night, out-of-range).

---

## 8. Prototype acceptance tests (pass/fail before volume)
- **Camera/temp+respiration:** ≥10 px on the nose at mount distance; stable ROI temperature trend; respiration rate within ±X of manual count at rest; **vendor calibration maps a detected nose point to the correct thermal reading**.
- **IMU:** raw stream at ≥100 Hz; lying/standing + step + gait-asymmetry validated against video; tag survives wash-down; ≥24 h buffer backfills.
- **Feed/water:** intake within ±X% of a reference scale/meter; refill vs consumption separated; survives a horse interacting with the vessel.
- **Mic:** cough/wind-suck/crib captured cleanly; next-stall sound not misattributed.
- **Edge/system:** all streams time-aligned ≤50 ms; survives a power + network outage with no data loss; emits the data contract to the backend.

---

## 9. Scope coverage (quick map)
1 IMU · 2 Camera-thermal · 3 Camera-thermal · 4 Camera-thermal+DSP · 5 IMU+Camera · 6 IMU+Camera · 7 IMU+Camera (force plate parked) · 8 Camera+Mic · 9 Feed/Water · 10 Feed/Water · 11 Camera · 12 Camera.
