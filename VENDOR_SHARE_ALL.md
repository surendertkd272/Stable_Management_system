# BSV EquiCare — System Overview & Vendor Requirements
*For hardware partners. Each vendor: please respond to your section (Recommended configuration + What we need before development).*

---

## 1. What we are building
A 24/7 monitoring system for stabled horses. Each stall is fitted with sensors that feed an on-site edge computer; our software turns the data into health and behaviour insights. We are building it to capture **12 data streams per horse**:

1. Steps / locomotion · 2. Body temperature · 3. Respiration pattern · 4. Respiratory rate · 5. Activity / abnormal activity · 6. Resting pattern & time · 7. Lameness / limb-favouring · 8. Stable vices (weaving, crib-biting, wind-sucking) · 9. Watering — quantity, pattern, time · 10. Feeding — quantity, pattern, time · 11. Urination pattern · 12. Excretion pattern.

**Per stall:** 1 dual thermal+optical camera · 1 IMU leg wearable · 1 feed + 1 water sensor · 1 microphone.
**Per barn (shared):** 1 edge computer + PoE network + 4G failover + UPS.

---

## 2. Common requirements (ALL devices)
- **Local-first:** stream to our on-site **edge computer** (Linux, Ubuntu 22.04+ / NVIDIA Jetson ARM64); **no mandatory external/vendor cloud**.
- **SDK/driver:** provide a **Linux/ARM SDK or driver** with documentation + working sample code.
- **Timestamps:** each reading timestamped; support **NTP (PTP preferred)** so data can be synced across sensors.
- **Identity:** each device has a unique ID we can map to a specific horse/stall.
- **Offline resilience:** on-device/local **buffering ≥24 h** with automatic backfill on reconnect (sites have power/internet interruptions).
- **Power:** **PoE preferred** (state class + watts) or documented DC.
- **Environment:** built for **24/7 barn use** — dust, ammonia, humidity, wash-down, 0–50 °C.
- **India compliance:** **WPC/ETA** for any wireless + **BIS**; data must be able to remain in India.
- **Evaluation deliverable:** **1–2 units + SDK/driver + docs + sample code**, with price and lead time.

---

## 3. CAMERA — dual thermal + optical (covers points 2,3,4,5,6,7,8,11,12)

**Recommended configuration (supply/build to this)**
- **Sparsh SC-IT6420-HB V2, 640×512 thermal** variant.
- Lenses: **25 mm thermal** (nose/eye detail) + **4 mm visible** (full stall); also quote **13 mm thermal**.
- **Fixed focus factory-set to 3.5 m.**
- **940 nm IR**, disable-able while thermal + ROI temperature stay functional.
- **H.265** on all three streams (IR/visible/fusion) at 25 fps; target ≤4 Mbps per 1080p stream.
- **Global-shutter** visible sensor.
- **Factory visible↔thermal calibration** exposed in the SDK (a visible-image coordinate returns the temperature at the matching thermal point — no field calibration by us).

**What we need before development**
1. **2 eval units** (one 25 mm, one 13 mm thermal; both 4 mm visible; focus set 3.5 m).
2. **SDK** with samples for **set-ROI, set-emissivity, poll-temperature, RTSP** + development licence.
3. **Factory visible↔thermal calibration** on the units + in the SDK; state **mapping accuracy (px/mm) at 3–4 m** and whether re-calibration is needed after re-mount.
4. Confirm SDK can **create/move/read an ROI by coordinates at runtime**, with **≥2 simultaneous ROIs per camera**.
5. **Max ROI reposition rate** + **max temperature-poll rate**; per-device vs per-host limit.
6. **Per-stream bitrate (Mbps)** + aggregate; confirm **H.265**.
7. **Visible sensor model** confirming **global shutter**; lens distortion (%).
8. **Thermal pixels on a 5 cm target at 3 m and 4 m** for 25 mm and 13 mm.

---

## 4. IMU LEG WEARABLE (covers points 1,5,6,7)

**Recommended configuration**
- **9-axis BLE 5.x leg tag** (cannon bone) — accel **±16 g**, gyro **±2000 °/s**.
- **Sample rate configurable ≥100 Hz (target 100–200 Hz)** with **raw per-axis data access**.
- **IP68**, **rechargeable + hot-swap dock**, ≥7-day battery (or hot-swap), ~≤50 g, **loss/detach alert**.
- **1 BLE-to-IP gateway per barn** with a local path to the edge.

**What we need before development**
1. **3–5 eval tags + 1 gateway + charging dock + SDK/API** (Linux/Jetson) + docs/sample.
2. Confirm **raw streaming**, **on-tag ≥24 h buffer**, and the **timestamp/clock-sync** method.
3. Confirm **unique tag ID → horse mapping via API** + documented data schema/units (accel/gyro/steps).
4. Confirm **India WPC/ETA + BIS**.
5. Share any **equine validation/reference** data (steps, lying time, gait/lameness).

---

## 5. FEED & WATER SENSING (covers points 9,10)

**Recommended configuration**
- **Water:** food-grade **electromagnetic / hall-effect inline flow meter** (no/low moving parts; handles hard water + debris), **RS-485/Modbus** output. *(Load-cell water bucket is an acceptable alternative.)*
- **Feed:** **load-cell weigh-back auto-feeder** (measures **dispensed AND refusal**); optional load-cell hay manger.
- **IP67**, corrosion-resistant, mechanical-abuse rated; **one device per horse** (or RFID attribution at the vessel).

**What we need before development**
1. **1 water sensor + 1 weigh-back feeder eval units** + **open Linux driver / protocol docs (Modbus register map)** + sample.
2. Confirm **resolution/accuracy** (water in ml; feed in g) and **min-flow cut-off**.
3. Confirm separate **refill-vs-consumption** events, **dispense confirmation**, and **fault alarms** (empty/jam/stall).
4. Confirm **timestamp + ≥24 h buffering**, output to edge (no mandatory cloud).
5. Confirm **wash-down IP rating + corrosion + abuse** rating.
6. Confirm an **interim manual-logging** option (staff log given/refused) before sensors are installed.

---

## 6. MICROPHONE / AUDIO (covers point 8 — wind-sucking, cough, crib-biting)

**Recommended configuration**
- **Weatherproof PoE/IP microphone (ONVIF audio)**, or an **industrial MEMS mic → USB/I2S** to the edge.
- **Frequency response 50 Hz–12 kHz**, **max SPL >100 dB** without clipping, **uncompressed PCM ≥16 kHz**, **AGC disable-able**, **directional** (limit cross-talk), **IP65+**.

**What we need before development**
1. **2 eval mics + interface + Linux driver** + docs/sample.
2. Confirm **uncompressed PCM** output, sample rate, **AGC-off** option.
3. Confirm **timestamping (PTP/NTP)** and **edge buffering**.
4. Confirm **IP65+** and ammonia/wash-down suitability.

---

## 7. EDGE COMPUTER & NETWORK (shared per barn) — *if supplied by a hardware/integration partner*

**Recommended configuration**
- **NVIDIA Jetson Orin NX 16 GB** for 1–4 cameras / **AGX Orin 32–64 GB** for 8–16; **NVMe 1–2 TB**; **rugged fanless enclosure**.
- **Managed PoE+ switch**, **dual-SIM 4G/LTE router**, **online UPS**.

**What we need before development**
1. **1 edge unit for the pilot.**
2. State **how many camera streams + sensors one unit handles** (measured inference budget), with GPU/RAM.
3. Confirm **NVMe storage/retention + offline buffer + auto-resync**, **barn-rated enclosure**, and **remote management/OTA**.

---

*Notes: (a) the horse-detection / AI / data-processing logic is on our side — vendors provide raw data + (for the camera) the factory calibration only. (b) Commercial terms (price, MOQ, lead time, warranty) to be discussed separately.*
