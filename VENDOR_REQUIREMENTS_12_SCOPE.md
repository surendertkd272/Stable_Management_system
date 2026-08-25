# Vendor Requirements — by the 12 Client Scope Points (BSV EquiCare)

*For each client requirement: the hardware/sensor, the vendor, and the specific requirements + target values the vendor must meet or confirm. Status: ✅ confirmed by vendor · 🟡 partly confirmed · ❓ to confirm.*

Vendors referenced: **Camera** (thermal+optical, Sparsh SC-IT6420-HB V2 640×512) · **IMU** (leg wearable) · **Feed/Water** (flow meter / load-cell / metered feeder) · **Mic** (audio) · plus **Edge/Network** (system, see §13).

---

## 1. Pedometer reading (steps / locomotion) — IMU wearable
- 6-axis minimum (**3-axis accel + 3-axis gyro**); 9-axis preferred. Provide sensor part numbers + datasheets. ❓
- Accel range **≥ ±16 g**, gyro **≥ ±2000 °/s** (no clipping at trot/canter/kick). ❓
- Configurable sample rate **≥100 Hz (target 100–200 Hz)**. ❓
- **Raw per-axis time-series** accessible (not only step counts). ❓
- Per-reading **quality/confidence** flag. ❓
- Unique immutable **hardware ID** per tag, bindable to `horseId` via API. ❓
- **Linux/ARM (Jetson) SDK/API**, documented data schema. ❓
- **India WPC/ETA** radio approval + BIS. ❓

## 2. Body temperature — Thermal camera
- **640×512** thermal, **NETD ≤0.05 °C**, **8–14 µm**. ✅
- **≥10 thermal px on a 5 cm target at 4 m** → 25 mm lens = 18 px ✅ / 13 mm = 9 px 🟡 (use 25 mm or 13 mm at ≤3 m).
- **Per-ROI emissivity** adjustable. ✅
- ROI temperature read **≥10 Hz** (poll up to 25 fps). ✅
- Accuracy ±2 °C = **screening-grade**; request **blackbody/higher-accuracy model in same SDK family** as upgrade path. 🟡
- **Vendor factory-calibrated visible↔thermal mapping**, exposed in SDK (no field calibration by us). ❓ *(critical-path)*

## 3. Respiration pattern — Thermal nostril ROI (+ optical flank)
- Thermal **≥25 fps**. ✅
- Continuous **ROI Avg** temperature read for a small nostril region, **≥10 Hz**. ✅
- **≥10 px on the nostril** at working distance (25 mm). 🟡 (lens/distance dependent)
- ROI position settable at runtime via SDK (we steer it; vendor mapping aligns it). ✅/❓

## 4. Respiratory rate — Thermal nostril ROI → DSP
- Same thermal source as #3; **rate computed on our edge** (no extra hardware). ✅
- Requires the continuous ROI Avg stream (#3). ✅

## 5. Activity / abnormal activity — IMU + Optical camera (fused)
- IMU as **§1**. ❓
- Visible **1080p ≥25 fps**, **global shutter**. ✅
- Night: **940 nm IR**, usable image at 0 lux. ✅
- Fusion of IMU + optical done on **our edge**.

## 6. Resting pattern & time — IMU lying-detection + Optical (fused)
- IMU lying detection (leg-mount) as **§1**. ❓
- Optical lying/standing detection — same camera as §5. ✅
- 24/7 incl. night (940 nm IR). ✅

## 7. Weight-bearing → Lameness / limb-favouring — IMU gait + Optical gait CV
- IMU **ODR ≥100 Hz** + adequate gyro range for gait asymmetry. ❓
- Optical: **global shutter** ✅, **lens distortion ≤3% or correction** ✅, ≥25 fps ✅.
- *(True per-limb kg = force plate — PARKED, out of current scope.)*

## 8. Vices (weaving / crib-biting / wind-sucking) — Optical CV + Microphone
**Camera:** visible CV stream ✅ (night 940 nm ✅).
**Microphone (❓ all):**
- MEMS/condenser; **frequency response ~50 Hz–12 kHz** (covers grunt, cough, wind-suck gulp, teeth-on-wood).
- **Max SPL >100 dB** without clipping; good SNR; low self-noise.
- **Uncompressed PCM**, sample rate **≥16 kHz** (configurable).
- Output to edge: **PoE network audio / USB / I2S**; **Linux/Jetson** driver.
- **Timestamping (PTP/NTP)** for fusion with video.
- **Disable AGC**; directional/per-stall to limit cross-talk.
- **IP65+**, ammonia/wash-down rated; edge buffering.
- **DPDP**: edge-only processing, configurable retention (records human speech).

## 9. Watering — quantity + pattern + time — Flow meter / load-cell bucket
- **Water resolution** (ml/pulse) + accuracy across **0.1–8 L/min**; min-flow cutoff stated. ❓
- OR **load-cell bucket**: weight resolution (g), separates drinking from spillage/evaporation. ❓
- **Refill vs consumption** as separate timestamped events. ❓
- Output: **Modbus/RS-485 / pulse / BLE / MQTT** to edge, **open Linux driver** (no mandatory cloud). ❓
- **IP66/67 wash-down**, corrosion-resistant, **food-grade** wetted parts. ❓
- **Per-horse attribution** (dedicated per-stall vessel, or RFID at vessel). ❓
- Onboard **timestamp + buffering**; per-reading confidence/status. ❓
- **Interim manual-logging** path with same `{…, source:'manual'}` schema. ❓

## 10. Feeding — quantity + pattern + time — Metered feeder / load-cell
- **Dose resolution (g)** + accuracy for pellets/textured/grain. ❓
- **Leftover / refusal** measured via weigh-back (not just dispensed). ❓
- **Forage/hay** load-cell option (consumption vs wastage). ❓
- **Schedule** programmable per horse; **dispense confirmation + fault alarms** (empty/jam/stall). ❓
- Integration / IP / attribution / buffering — as **§9**. ❓
- **Interim manual-logging** path. ❓

## 11. Urination pattern — Optical CV
- Visible (+ 940 nm IR night) stream — same camera as §5. ✅
- Event/posture detection model — **our software** (needs labelled data). 
- No extra hardware.

## 12. Excretion pattern — Optical CV
- Same as **§11** (camera stream ✅; model + labelled data = ours).

---

## 13. Cross-cutting hardware/vendor requirements (needed to deliver all 12)
*(Camera-confirmed items noted; rest to confirm with respective vendors / integrator.)*
- **Per-stream bitrate (Mbps)** + **H.265** on all three camera streams. ✅ (numbers ❓)
- **Visible↔thermal factory calibration** delivered by camera vendor. ❓ *(critical-path — §2)*
- **Time-sync**: camera has none (we stamp on edge) 🟡; IMU/mic/feed must expose **timestamps (PTP/NTP)** for fusion. ❓
- **Horse identity**: stall→horse mapping + IMU tag-ID + optional RFID at vessels. ❓
- **Offline buffering** on every device (camera 12 GB ✅ small; IMU/feed/mic on-device buffer ❓; edge box does main retention).
- **Power**: camera **PoE 802.3af ≤6 W** ✅; other devices' power/PoE class ❓.
- **Environment**: camera **IP66, −20…+50 °C** ✅; IMU IP67/68 ❓; feed/water IP66/67 ❓; mic IP65+ ❓.
- **SDKs/drivers**: all must run on **Linux/ARM (Jetson)** and avoid mandatory cloud. Camera ✅ (C/C++/C#); others ❓.
- **India compliance**: WPC/ETA (radios), BIS; **DPDP-2023** residency (asia-south1), staff-privacy for camera/mic. ❓

---

## Status summary
- **Camera (points 2,3,4,5,6,7-optical,8-video,11,12):** largely ✅; open = pixels/lens choice, blackbody option, and the **vendor visible↔thermal calibration** (critical-path).
- **IMU (1,5,6,7):** full RFI ❓ — not yet sent.
- **Feed/Water (9,10):** full RFI ❓ — not yet sent (interim = manual + camera presence).
- **Microphone (8 audio):** full RFI ❓ — not yet sent.
- **Parked:** true per-limb load (force plate).
