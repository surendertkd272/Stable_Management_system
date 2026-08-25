# Camera — Development-Readiness Pack (Sparsh SC-IT6420-HB V2)

*Scope: ONLY what the camera covers. Goal: after the vendor answers the dev-blocking questions and we adopt the recommendations below, backend/software development can begin immediately. IMU / feed-water / mic / edge-hardware are deferred.*

---

## 1. What the camera covers (and the data it must produce)

| # | Scope point | Source modality | Method (runs on edge, consumes camera) | Data-contract metric |
|---|-------------|-----------------|----------------------------------------|----------------------|
| 2 | Body temperature | Thermal ROI | SDK ROI **max** at eye/body + per-horse baseline (screening-grade) | `bodyTempC` |
| 3 | Respiration pattern | Thermal nostril ROI | ROI **avg** temperature time-series → waveform shape | `respPattern` |
| 4 | Respiratory rate | Thermal nostril ROI | ROI avg series → band-pass (0.1–1 Hz) → rate | `respRateBpm` |
| 5 | Activity / abnormal | Optical CV (IMU later) | pose/motion model on visible/IR | `activityLevel`, `abnormalActivity` |
| 6 | Resting pattern & time | Optical CV (IMU later) | lying/standing detection | `restState`, `lyingMinutes` |
| 7 | Lameness / limb-favouring | Optical gait CV (IMU later) | head/pelvis vertical-displacement asymmetry | `gaitAsymmetry` |
| 8 | Vices (video half) | Optical CV (audio later) | weave/crib/wind-suck classifier | `viceEvent` |
| 11 | Urination pattern | Optical CV | posture/event detection | `urinationEvent` |
| 12 | Excretion pattern | Optical CV | posture/event detection | `excretionEvent` |

Every reading follows the contract: `{ horseId, metric, value, unit, ts, source, confidence }` — `source` ∈ `thermal-roi | thermal-dsp | optical-cv`; `confidence` 0–1.

---

## 2. Vendor questions — DEV-BLOCKING (answers needed to write the edge code correctly)

These gate the integration design. Get a **dev/eval unit + the SDK package now** so coding can start in parallel.

**SDK & coordinate model (most important for development)**
1. Please provide the **SDK package now** (headers, libraries, sample apps for C/C++) plus a **1–2 unit eval/dev camera (640×512)** so we can begin integration. Confirm SDK licensing terms for development.
2. Can the SDK return **per-pixel radiometric thermal frames**, or only Max/Min/Avg per point/line/area ROI? For respiration we need a continuous **Avg of a small nostril ROI**; for temperature the **Max of an eye ROI** — confirm both are obtainable simultaneously.
3. **Coordinate-system mapping:** our CV detects the nostril/eye on the decoded **visible RTSP** frame and gets pixel coordinates there. In what coordinate system are the SDK's ROI **PosX/PosY** defined (thermal-sensor pixels?), and how do we map a visible-frame pixel → the correct thermal ROI coordinate? Is there an API or documented transform, given fusion is approximate?
4. How many **independent ROIs** can return values **simultaneously** (we need ≥2 per horse: nostril for respiration + eye for temperature), and is each read in a separate call?
5. Maximum **ROI reposition rate** (PosX/PosY updates per second) sustained — our CV must chase a moving nostril every frame.
6. Maximum sustained **temperature poll rate when polling multiple cameras from one host** — does the SDK throttle per device or per host? (Determines cameras-per-edge-box.)
7. Confirm **NTP** behaviour and whether **frame timestamps can be embedded** in the RTSP stream (RTCP sender reports / OSD). Given there is no on-camera frame↔temperature sync, what is your **recommended method** to align visible + IR + fusion frames with polled temperature on our server? Is **PTP** supported?
8. **ONVIF Profile G event payload schema** for temperature/person/vehicle events (so we can ingest events instead of polling) — fields + timestamps.

**Stream characteristics (gate the ingestion/decode pipeline & sizing)**
9. Encoded **bitrate (Mbps) per stream** (IR/visible/fusion) at 25 fps, and aggregate with all three + temperature polling (CBR & VBR).
10. Confirm **H.264 only**, or is **H.265** available on all three streams (affects our Jetson NVDEC decode path)?
11. Max **simultaneous SDK/ONVIF clients & RTSP pulls**; does 20 Hz temperature polling contend with triple-RTSP@25fps on the camera?
12. **Fusion stream resolution** (fps already confirmed 25).
13. Visible sensor: **global- or rolling-shutter**, and lens distortion (% at edges)? (Rolling-shutter skew corrupts gait/lameness analysis — point 7.)

**Feasibility of the thermal features (gate whether points 2/3/4 work at all)**
14. For the 640 + each thermal lens, **how many thermal pixels fall on a 5 cm target (nostril/eye) at 3 m and 4 m?** (Decides if respiration + eye-temperature are viable at stall distance.)
15. **Minimum focus distance** for the 13 mm thermal and 4/6 mm visible lenses.
16. Is a **higher-accuracy / blackbody-referenced model available in the SAME SDK/RTSP/ONVIF family** (same ROI API, same stream layout), for later drop-in if ±2 °C proves insufficient?

**Night operation (gate 24/7 CV correctness)**
17. **Minimum lux** (colour & B/W) with IR off; confirm usable image at 0 lux with IR on.
18. **IR wavelength — 850 or 940 nm?** (850 nm glows red and can disturb horses at night, corrupting resting/behaviour data.) Is 940 nm available? Can IR be scheduled/disabled while thermal + ROI temperature keep working in darkness?

## 2b. Vendor questions — PROCUREMENT (run in parallel; do NOT block development)
- Bulk lead time + MOQ for 640×512 beyond stock; price at 10/25/50/100+; stock reserved on PO?
- Warranty term, India RMA turnaround, loaner availability.
- IK (impact) rating + horse/vandal-resistant mount option. *(IP66 + −20…+50 °C already confirmed.)*
- Behaviour after power loss / UPS cutover (auto-resume streams + restore ROIs); cold-boot time; watchdog.
- Security beyond the listed HTTPS/802.1X/IP-filtering: signed firmware/secure boot, SRTP/RTSP-over-TLS, isolated-VLAN/no phone-home, no backdoor accounts; firmware-update mechanism + patch cadence.

---

## 3. Recommendations — scope of work so backend dev can start NOW

### 3.1 Start backend development today against the data contract (don't wait for hardware)
Exactly like the frontend-first approach: **build the backend to the contract using a camera-feed simulator**, then swap in the real edge feed later.
- Define the **camera-metric contract** (table in §1) as the fixed interface.
- Build: ingestion endpoint → storage (time-series) → per-horse baseline store → the API that **replaces the frontend's in-memory store** (frontend already consumes this shape).
- Write a **camera simulator** that emits synthetic readings in the contract — including *messy* states: `confidence` low, `source` offline, "calibrating", ROI-lost, night-degraded. This unblocks full backend + alerting development immediately.

### 3.2 Edge service design (build once the dev unit + SDK arrive)
Two processes, because the SDK is C/C++/C# (no Python) but the ML is Python:
- **Camera Bridge (C++):** pulls 3 RTSP streams; polls SDK ROI temperature (~20 Hz); sets ROI PosX/PosY from CV; timestamps everything on a common edge clock. Exposes frames + temperatures over IPC (shared-memory ring buffer or gRPC).
- **Processing service (Python/TensorRT):** consumes frames/temps; runs CV models + respiration DSP; emits contract readings to the backend.

### 3.3 Per-metric method + mitigation for known limits
- **Temperature (2):** eye-ROI **max** + per-horse baseline; emit as **screening trend, not clinical**; lower `confidence` with distance / few pixels-on-target / night. Mitigates ±2 °C.
- **Respiration (3,4):** nostril-ROI **avg** temperature @ ~20 Hz → band-pass → rate; **gate on stillness**; absolute accuracy irrelevant (we use oscillation). This is the camera's strongest thermal feature.
- **Activity/Resting (5,6):** optical CV now; **fuse with IMU later** — design the contract so IMU readings merge without rework.
- **Lameness (7):** optical gait asymmetry; **confirm global-shutter** (Q13) or compensate; IMU adds confirmation later.
- **Vices (8), Urination/Excretion (11,12):** optical CV event/posture classifiers; **add audio later** for wind-sucking.

### 3.4 Cross-cutting we own (the camera provides none of it)
- **Time-sync:** stamp on edge capture; NTP-discipline camera + edge; align RTSP (RTCP) + polled temp by arrival time, compensating the ~50 ms temp latency. *(Build it; depends on Q7.)*
- **ROI tracking:** CV detects nostril/eye on visible → map to thermal ROI coords → set PosX/PosY each frame. *(Depends on Q3, Q5.)*
- **Fusion calibration:** one-time per-camera offset at the fixed stall distance; use a slightly larger ROI + max-temp to absorb misalignment. *(Depends on Q3, Q14.)*
- **Confidence model:** define once (model probability, ROI-locked?, day/night, distance) — backend stores it; frontend can surface it.

### 3.5 Start collecting training data NOW (longest lead item)
The CV models for 5,6,7,8,11,12 need **labelled equine video/thermal**. Begin recording + annotating from the dev unit immediately — this has the longest lead time and blocks the AI, not the backend plumbing.

### 3.6 Known limits to design around (recap)
±2 °C = screening-only · no frame/temp sync (we build it) · no on-camera tracking (we build ROI loop) · no WDR (mount away from backlight) · 12 GB onboard (edge does storage) · H.264 (size bandwidth) · C/C++/C# SDK (C++ bridge + IPC to Python).

---

## 4. Recommended start order (so everything is ready ASAP)
1. **Now (no hardware):** freeze the §1 contract → build backend ingestion + storage + API + simulator → point the existing frontend at it. Full backend can be developed and tested today.
2. **Now (procurement parallel):** send §2 dev-blocking + §2b procurement questions; request 1–2 dev units + SDK.
3. **On unit arrival:** build the C++ Camera Bridge + Python processing; validate pixels-on-target (Q14) and the coordinate mapping (Q3) first — they decide if thermal features are viable.
4. **In parallel from day one:** record + label training video for the CV models.
5. **Integrate:** swap the simulator for the real edge feed — backend unchanged because both speak the same contract.
