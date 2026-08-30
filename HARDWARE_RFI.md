# BSV EquiCare — Hardware Procurement RFI & Scope-Coverage Pack

*Goal: ensure every one of the 12 data streams and every cross-cutting requirement is closed by a concrete vendor question before purchase/build. This is the **internal** target-spec sheet — keep it private; send the standalone vendor-facing RFIs (see status box below).*


> ## ⚠️ Status — read before sending anything from this document
>
> This is the **internal question bank / target-spec sheet**. Keep it private. Do **not** send
> sections of it to a vendor directly — send the standalone RFIs instead, which are written to
> be vendor-facing (context, hard pass/fail requirements, inline reply slots) and exist as PDFs
> in [`pdf/`](pdf/) plus WhatsApp-ready text.
>
> | Section | Status | Send this instead |
> |---|---|---|
> | §1 Scope coverage matrix | ✅ **Current** — still the best internal view of the 12 points | *(internal only)* |
> | §2 Camera follow-up | ✅ **Answered** by Sparsh/Samriddhi — see `ARCHITECTURE.md` for what was confirmed | *(closed)* |
> | `RFI_IMU` | 🔁 **Superseded** | `RFI_IMU.md` → `pdf/RFI_IMU.pdf` |
> | `RFI_FEED_WATER` | 🔁 **Superseded** | `RFI_FEED_WATER.md` → `pdf/RFI_FEED_WATER.pdf` |
> | `RFI_MICROPHONE` | 🔁 **Superseded** | `RFI_MICROPHONE.md` → `pdf/RFI_MICROPHONE.pdf` |
> | `RFI_EDGE_INFRA` box & integration | ⚠️ **Partly obsolete** — see warning below | `RFI_EDGE_INFRA.md` → `pdf/RFI_EDGE_INFRA.pdf` |
>
> **Scope correction:** this document repeatedly asks about **multi-tenant isolation and
> multi-site fleet management**. That is no longer in scope — the system is
> **single-client, single-site, not SaaS**. Do not ask a vendor to quote for tenant
> separation or cross-site orchestration.
>
> **§6 obsolete items — do not ask a vendor to quote for these:**
> - *"Camera SDK is C/C++/C# only (no Python) — who builds the native wrapper?"* — **no wrapper
>   is needed.** The camera exposes an HTTP/JSON API (ISAPI) plus Modbus/TCP; the driver is
>   `sparsh_camera.py`, pure Python, ARM64-native.
> - *"Who designs multi-sensor time-sync?"* — **partly solved.** The camera's `stream/meta`
>   RTSP endpoint pushes temperature with a sensor-layer timestamp and `group_id`. What remains
>   is barn-wide clock discipline, which is Q17 of the new edge RFI.
> - The data contract, per-horse baselines, health/failure flagging, offline buffering and
>   fleet-facing software described in §6 are **already built** (`server/`, `edge/`, `src/`).
>   The new edge RFI states explicitly what BSV builds so no vendor prices it twice.
>
> The deeper questions from §3–§5 have been **merged into** the standalone RFIs — nothing of
> substance was dropped.

---

## 1. Scope coverage matrix (the 12 points)

| # | Scope point | Device / vendor | Status | Where it's closed |
|---|-------------|-----------------|--------|-------------------|
| 1 | Pedometer → activity/steps | IMU wearable | ❓ Open (RFI not yet sent) | `RFI_IMU` |
| 2 | Body temperature | Camera thermal (Sparsh) | 🟡 Sensor confirmed, **screening-grade ±2 °C** | §2 Camera |
| 3 | Respiration pattern | Camera thermal nostril + optical flank | 🟡 Confirmed (25 fps thermal, ROI temp); pixels-on-target open | §2 Camera |
| 4 | Respiratory rate | Camera thermal → DSP on edge | 🟡 Confirmed; DSP is ours | §2 Camera + `RFI_EDGE_INFRA` |
| 5 | Activity / abnormal | IMU + camera (fused) | 🟡 Camera stream ✅; IMU open | `RFI_IMU` + `RFI_EDGE_INFRA` |
| 6 | Resting pattern & time | IMU lying + camera (fused) | 🟡 Camera ✅; IMU open | `RFI_IMU` + `RFI_EDGE_INFRA` |
| 7 | Weight-bearing → **lameness/limb-favouring** | IMU gait asymmetry + camera gait CV | 🟡 Reframed; IMU open. **True kg/limb (force plate) parked** | `RFI_IMU` + `RFI_EDGE_INFRA` |
| 8 | Vices | Camera CV + **microphone** | 🟡 Camera ✅; mic open | §2 Camera + `RFI_MICROPHONE` |
| 9 | Watering: qty + pattern + time | Flow meter / load-cell bucket; interim manual + camera | ❓ Open | `RFI_FEED_WATER` §3 Water |
| 10 | Feeding: qty + pattern + time | Metered feeder / load-cell; interim manual + camera | ❓ Open | `RFI_FEED_WATER` §4 Feed |
| 11 | Urination pattern | Camera CV (event/posture) | 🟡 Stream ✅; night + model open | §2 Camera + `RFI_EDGE_INFRA` |
| 12 | Excretion pattern | Camera CV (event/posture) | 🟡 Stream ✅; night + model open | §2 Camera + `RFI_EDGE_INFRA` |

### Cross-cutting requirements

| Requirement | Closed by |
|-------------|-----------|
| Horse identity / attribution per reading | Edge stall-mapping + IMU tag-ID + optional RFID at vessel — §6, §3, §4 |
| Multi-sensor time-sync fusion (camera+thermal+IMU+audio) | Edge sync design §6 + per-device timestamp Qs (§2–§5) |
| Edge inference + offline resilience | Edge buffering §6 + on-device buffering (IMU/feed/mic) |
| Per-horse baselines (offline) | Edge baseline store §6 |
| Reliable night operation | Camera IR §2 + edge night-confidence §6 |
| Data contract `source` + `confidence` | Edge §6 + per-device confidence flags §2–§5 |
| DPDP-2023 residency / staff privacy / retention | Edge §6 + device data-path Qs (§3, §5) |
| Multi-tenant isolation | Edge §6 |
| Scalability across stalls/sites | Edge §6 |
| Integration ownership (wrapper, fusion, ROI tracker, calibration) | Edge/Integrator §6 |

**Parked (out of current scope by decision):** true per-limb load (force plate / instrumented mat); camera WDR (mitigate by mounting away from backlight).

---

## 2. Camera vendor (Sparsh) — follow-up questions

> ✅ **ANSWERED** by Sparsh / Samriddhi Automations. Outcomes are recorded in
> `ARCHITECTURE.md`; the delivered API docs are the ISAPI Web API reference and the
> ModbusTCP protocol spec. Retained here as a record of what was asked.

*Already answered the first RFI. These close the remaining gaps.*

1. **(CRITICAL)** Bulk **lead time + MOQ** for the 640×512 variant beyond current stock, and price-break tiers at 10/25/50/100+; is stock reserved on PO?
2. **(CRITICAL)** Actual **encoded bitrate (Mbps) per stream** (IR dev=0, visible dev=1, fusion dev=2) at 25 fps, and **aggregate** with all three pulled + temperature polling (give CBR & VBR).
3. **(CRITICAL)** Do the streams support **H.265** on all three simultaneously at 25 fps, with confirmed Jetson NVDEC hardware decode?
4. **(CRITICAL)** **Minimum lux** for a usable visible image (IR off), and confirm usable image at 0 lux (IR on).
5. **(CRITICAL)** **IR illuminator wavelength — 850 nm or 940 nm?** 850 nm glows red and can disturb horses at night (corrupts our resting/behaviour data). Is **940 nm** available?
6. **(CRITICAL)** Can the IR illuminator be **scheduled/motion-gated or disabled**, and confirm **thermal capture + ROI temperature work in total darkness** independent of the IR LED?
7. **(CRITICAL)** **Minimum focus distance** for the 13 mm thermal lens and each visible lens (4/6 mm) — boxes are small, mount ~2.5–4 m.
8. **(CRITICAL)** For 640×512, list **all thermal lens options (focal length + FoV/IFOV)**, and **how many thermal pixels cover a 5 cm target (nostril/eye) at 3 m and 4 m** — we need enough for respiration + a stable temperature ROI.
9. **(CRITICAL)** Is there a **higher-accuracy / blackbody-referenced model in the same SDK/RTSP/ONVIF family** (same PosX/PosY ROI API, same dev=0/1/2 layout) we can drop in later without rewriting edge software? Accuracy and differences?
10. **(CRITICAL)** Fusion stream (dev=2): **resolution, fps, and rated thermal↔visible registration error (px or mm) at 3 m and 4 m** (you said fusion is approximate/parallax-dependent — quantify it).
11. **(CRITICAL)** Max **simultaneous SDK/ONVIF clients + RTSP pulls**; does ~20 Hz temperature polling contend with triple-RTSP@25fps? Does per-frame PosX/PosY ROI repositioning reduce poll rate or fps?
12. **(CRITICAL)** How many **independent ROIs** simultaneously, and the **max ROI reposition rate (updates/sec)** via the API? (Our CV must chase the nostril every frame.)
13. **(CRITICAL)** Max sustained **per-ROI temperature poll rate when polling MULTIPLE cameras from one edge host** — does the SDK throttle per device or per host? (Sizes cameras-per-edge-box.)
14. **(CRITICAL)** **NTP/PTP** time sync support; can frame timestamps be embedded (RTCP/OSD)? Given no on-camera frame↔temperature sync, what's your recommended edge-side alignment practice?
15. **(CRITICAL)** **Cybersecurity:** signed firmware/secure boot, TLS ONVIF/SDK, SRTP/RTSP-over-TLS, operate on isolated VLAN with **no mandatory cloud/phone-home**, no default backdoor accounts, disable telnet/UPnP?
16. **(CRITICAL)** Behaviour after **power loss / UPS cutover**: auto-reboot, auto-resume all three streams, restore ROIs/temperature settings, stream watchdog, cold-boot-to-streaming time?
17. Event delivery: can temperature/person/vehicle events be pushed via **ONVIF Profile G / RTSP metadata / HTTP/MQTT callback** (event-driven instead of polling)? Payload schema + timestamps?
18. Visible sensor: **global- or rolling-shutter**, and lens geometric distortion (%)? (Rolling-shutter skew/barrel distortion corrupts gait/lameness CV.)
19. Confirm **worst-case power draw** with IR + thermal + 3 streams active (you said ≤6 W on 802.3af) — or recommend 802.3at headroom.
20. Enclosure: operating temp/humidity, **IP + IK rating**, horse/vandal-resistant mount option.
21. **Firmware update** mechanism (local vs cloud), patch cadence, offline/bulk update, rollback.
22. **India support:** warranty term, RMA turnaround, loaner, SDK developer-support SLA + versioning.
23. **(CRITICAL)** **Capability-gap confirmation** (so we design around them): (1) no on-camera tracking, (2) no frame↔temp sync, (3) no WDR, (4) no Python SDK, (5) no audio, (6) ±2 °C no blackbody, (7) visible has no analytics, (8) 12 GB onboard only. Are any addressable via firmware or an alternative model?
24. **(CRITICAL)** Confirm one camera can keep **water vessel + feed manger in frame** at usable resolution for head-down presence CV given the stated FoVs and no WDR in the bright/shadowed vessel corners.
25. **(CRITICAL)** Does IR adequately/evenly light the **trough/feeder zone at close range** for 24/7 night drinking/feeding presence detection (any near-field IR wash-out)?

---

## 3. IMU wearable vendor — RFI (points 1, 5, 6, 7)

> 🔁 **SUPERSEDED — do not send this section.** Use **`RFI_IMU.md`** / `pdf/RFI_IMU.pdf`
> (vendor-facing, with hard pass/fail requirements and reply slots). The questions below were
> merged into it; nothing of substance was dropped.

**Sensing**
1. **(CRITICAL)** Confirm **6-axis (3-axis accel + 3-axis gyro)** minimum; magnetometer (9-axis)? Give exact sensor part numbers + datasheets.
2. **(CRITICAL)** Selectable **full-scale range** — accel (±2/4/8/16 g) and gyro (±250–2000 °/s); confirm no clipping at trot/canter/kick.
3. **(CRITICAL)** Max and **configurable sample rate (ODR, Hz)** per axis, OTA-configurable? We target ≥50 Hz, ideally 100–200 Hz for gait.
4. **(CRITICAL)** Does it expose **raw per-axis time-series**, or only processed steps/buckets? Over what interface and throughput? Raw + processed simultaneously?
5. Native on-firmware **activity classes** (standing/lying/walking/trotting/grazing/restless), accuracy, validated on horses? Can it be disabled (we classify on edge)?
6. Step counting **equine-validated** or generic? Error at walk/trot?
7. **(CRITICAL)** Per-reading **quality/confidence** flag (for our data contract)?

**Connectivity & resilience**
8. **(CRITICAL)** BLE version (4.2/5.x), Long-Range/Coded-PHY?, realistic range through masonry/steel barn, TX power.
9. **(CRITICAL)** **BLE-to-IP gateway** model; tags per gateway at our sample rate (esp. raw); uplink (Eth/PoE/Wi-Fi/4G); **local-only path to our edge box (no mandatory cloud)**.
10. **(CRITICAL)** **On-tag buffering** during gateway/network loss — capacity (hours/days), auto-backfill with original timestamps, acknowledged delivery?
11. **(CRITICAL)** **Timestamp source / clock sync** across tags; worst-case drift/skew; NTP/PTP-disciplinable via gateway? (Need ±tens-of-ms vs camera/thermal/audio.)

**Power, ruggedness, fit**
12. **(CRITICAL)** Battery life at each sample rate (lying-only vs 100–200 Hz raw); chemistry/mAh; rechargeable vs replaceable; charge method/time/cycles.
13. Charging/ops model for many horses — hot-swap spares, multi-bay dock; data-gap handling; re-pairing a tag to the same horse after swap.
14. **(CRITICAL)** **IP67/IP68** rating; validated vs wash-down, mud, urine/manure, sweat; operating temp/humidity (45 °C+, monsoon).
15. **(CRITICAL)** Attachment to cannon bone (strap/boot pocket); sizes pony→draft; **loss prevention + tamper/detach alert**.
16. Tag weight/dimensions; 24/7 welfare assessment (no rub sores); equine field-trial/welfare data.

**Identity, integration, compliance, commercial**
17. **(CRITICAL)** Globally unique immutable **hardware ID** in every record; how to **bind tag→horseId**; API-queryable mapping.
18. **(CRITICAL)** SDK/API (REST/MQTT/WebSocket/gRPC/broker); **Linux ARM/Jetson build**; Python or language-agnostic? Docs + sample.
19. **(CRITICAL)** Exact **output schema** (fields/types/units); confirm mappable to `{horseId, metric, value, unit, ts, source, confidence}`; versioned.
20. Calibration (factory + in-field); gyro bias drift with heat; recalibration without removing tag.
21. **(CRITICAL)** Fleet/multi-site management; firmware OTA; battery/health monitoring; **tenant isolation**; data stays in India/on-prem.
22. **(CRITICAL)** Any vendor cloud in the data path + its server location; can the whole path be **edge-only/on-prem, no data leaving India**; DPA for DPDP-2023.
23. **(CRITICAL)** India **WPC/ETA** radio approval + BIS; RoHS/CE/FCC.
24. **(CRITICAL)** Lead time, MOQ, unit price (tag + gateways), warranty/RMA in India, local spares.
25. Equine reference sites / validation papers for steps, lying time, gait/lameness; tag-loss rate per tag-year.

---

## 4. Feed & water sensing vendor — RFI (points 9, 10)

> 🔁 **SUPERSEDED — do not send this section.** Use **`RFI_FEED_WATER.md`** /
> `pdf/RFI_FEED_WATER.pdf`. Questions below were merged into it.

**Water measurement**
1. **(CRITICAL)** Flow-meter **resolution (ml/pulse)** + accuracy across 0.1–8 L/min incl. slow-sip trickle.
2. **(CRITICAL)** Minimum measurable flow (cut-off), L/min and ml/min.
3. **(CRITICAL)** Potable/**food-grade** wetted materials; tolerant of high-TDS Indian groundwater scaling?
4. **(CRITICAL)** Technology (turbine/paddle/magnetic/ultrasonic); tolerance to hay debris/bio-fouling; cleaning interval.
5. **(CRITICAL)** **Load-cell water-bucket alternative:** weight resolution/accuracy/capacity; separating drinking from spillage/evaporation/refill/play.
6. **(CRITICAL)** Distinguish + log **refill (up) vs consumption (down)** as separate timestamped events.

**Feed measurement**
7. **(CRITICAL)** Auto-feeder **dose resolution (g)** + accuracy for pellets / textured mix / loose grain; holds in monsoon humidity?
8. **(CRITICAL)** Measures **leftover/refusal** (offered − consumed) via weigh-back, or only dispensed? (Refusal is our key early-illness signal.)
9. **(CRITICAL)** **Forage/hay** measurement — load-cell manger/net option, resolution/capacity, consumption vs wastage.
10. **(CRITICAL)** Load-cell sampling rate + **debounce** of nudge/lean/bite/kick spikes.

**Attribution**
11. **(CRITICAL)** Dedicated per-stall vessel (one horse) or shared? If shared, how is intake **attributed to an individual** (RFID/tag reader, or via our IMU/camera identity)?
12. **(CRITICAL)** If RFID: standard (LF 134.2 kHz ISO equine microchip / UHF / BLE), read reliability while feeding, emits animal ID with each event?

**Integration**
13. **(CRITICAL)** Interfaces — **Modbus-RTU/RS-485, pulse/dry-contact, 4-20 mA, BLE, Wi-Fi, Ethernet, MQTT** — push to Linux/ARM edge with **no mandatory cloud**?
14. **(CRITICAL)** If RS-485/Modbus: full register map, baud rates, devices-per-bus, **open/Linux driver** (not Windows/.NET-only).
15. **(CRITICAL)** Onboard **RTC + timestamp** or edge-stamped? RTC sync/drift (for fusion).
16. **(CRITICAL)** **Local buffering** + backfill (with timestamps) on reconnect; onboard depth.
17. **(CRITICAL)** Event model: continuous totals vs discrete drink/feed bouts (start/end/duration/volume/grams) — we need timestamped bouts for pattern + timing.
18. Per-reading **confidence/status flag** (in-range, settled vs in-motion, dispense verified)?

**Environment & ops**
19. **(CRITICAL)** **IP66/IP67** on housing AND connectors/glands; validated for daily high-pressure wash-down.
20. **(CRITICAL)** Corrosion resistance (ammonia/urine, salt licks, monsoon); housing material; service life.
21. **(CRITICAL)** Mechanical abuse rating (kick/lean/crib/rub); guard/recessed-mount option.
22. **(CRITICAL)** Power — wired DC/PoE/mains/battery; if PoE, class + watts (shares camera switch budget).
23. **(CRITICAL)** **Calibration** procedure/frequency, in-field by staff, Linux-accessible.
24. **(CRITICAL)** Documented **drift spec** (zero + span over temp/time); auto-tare between fills.
25. Temperature effect on readings across 5–50 °C + onboard compensation.
26. **(CRITICAL)** **Hygiene** — food/water-contact parts removable + disinfectant/dishwasher-safe daily without re-calibration.
27. **(CRITICAL)** Vessel capacity (L water / kg feed); manual refill logged as event with operator ID/time.
28. **(CRITICAL)** Feeder **schedule** programmable per horse (Morning/Midday/Evening/Free-choice), remote update; each dispense emits confirmation (scheduled vs actual time, grams, status).
29. **(CRITICAL)** Feeder **fault reporting** — hopper empty, bridging/jam, motor stall, under/over-run as distinct alarms.
30. Mounting options/dimensions; electronics out of kick/chew/wash zones; brackets/templates.

**Interim path & commercial**
31. **(CRITICAL)** **Interim manual-logging** integration: staff log given/refused by hand carrying the same `{…, source:'manual', confidence}` schema so the sensor upgrade is seamless.
32. Manual entries record staff identity/time (DPDP consent/residency aware).
33. **(CRITICAL)** Devices-per-edge-box limit (RS-485/wireless addressing/throughput) ingesting water+feed from multiple stalls.
34. **(CRITICAL)** Lead time, MOQ, price at volume, **Indian stock/service**.
35. Warranty (esp. load cells / wetted parts), RMA in India, consumables coverage.
36. Field-validation/reference data with horses or comparable livestock (real-world accuracy over weeks).
37. Remote firmware/config update from edge (schedules, recalibrate) without per-stall access; offline-capable.

---

## 5. Microphone / audio — RFI (point 8 audio: wind-sucking, cough, crib-biting)

> 🔁 **SUPERSEDED — do not send this section.** Use **`RFI_MICROPHONE.md`** /
> `pdf/RFI_MICROPHONE.pdf`. Questions below were merged into it.

1. **(CRITICAL)** Transducer type (analog/PDM MEMS, electret, condenser) recommended for unattended Indian stall (0–50 °C, humidity, dust); reliability.
2. **(CRITICAL)** Full **frequency response** curve; confirm flat-ish across 50–500 Hz (respiration/grunt/crib wood-contact), 500 Hz–4 kHz (cough, wind-suck gulp), up to 8–12 kHz (teeth-on-wood transients).
3. **(CRITICAL)** Sensitivity + **max SPL / Acoustic Overload Point** — capture a quiet ~30 dB breath at 2–3 m AND a >100 dB crib-bite/whinny without clipping.
4. **(CRITICAL)** Self-noise (EIN dB(A)) + SNR; realistic noise floor of mic+preamp+ADC chain.
5. **(CRITICAL)** Sample rates/bit depths; **uncompressed PCM/lossless** available + configurable (for edge ML).
6. **(CRITICAL)** Output/transport — analog line, USB-Audio, I2S/PDM, **PoE network mic (RTSP/RTP)**, ONVIF audio, Dante/AES67; cable type + max run for each.
7. **(CRITICAL)** **Linux ARM (Jetson, Ubuntu 22.04+)** driver/SDK; standard ALSA/Pulse/PipeWire device or C/C++/**Python** API (avoid the camera's no-Python/no-sync limits).
8. **(CRITICAL)** Per-sample/packet **timestamping** — NTP and/or **PTP**, accuracy/jitter (align to camera RTSP + IMU).
9. End-to-end latency + jitter; buffering/packet size.
10. **(CRITICAL)** Effective **pickup radius** to reliably catch quiet breathing/crib-biting anywhere in a ~3.5×3.5 m stall; mounting distance/height.
11. **(CRITICAL)** **Cross-talk** between adjacent stalls — directional/cardioid/shotgun/beamforming options + off-axis rejection figures (so next-stall cough isn't misattributed).
12. Sound-source **localisation / DoA** (multi-mic array)? angular resolution, capsules.
13. Wind/vibration/structure-borne mitigation (windscreen, shock mount, high-pass).
14. **(CRITICAL)** **IP65+ / IK** housing; sealed vs ammonia/urine vapour, dust, wash-down; chew/tamper-resistant; acoustic port protection that preserves HF.
15. **(CRITICAL)** Operating temp/humidity; 24/7 rating; MTBF; anti-condensation/anti-fungal for monsoon.
16. **(CRITICAL)** Power — PoE class+watts / USB / DC; fits barn PoE+UPS budget; draw per unit.
17. Multi-channel synchronised capture on a common clock; channels per interface; aggregation box vs terminate at Jetson.
18. **(CRITICAL)** **Disable any on-device analytics** — raw stream always available (inference on our Jetson).
19. Per-frame metadata (timestamp, stall/channel ID, gain, clip flag, sample-rate) for the data contract.
20. **(CRITICAL)** **Disable AGC** in favour of fixed/manual gain (AGC distorts level-dependent cough/crib/respiratory features).
21. **(CRITICAL)** Local **store-and-forward** if link/4G drops; duration; back-fill without timestamp gaps.
22. **(CRITICAL)** **DPDP-2023:** mic records human speech — edge-only processing, **no raw-audio off-site**, configurable retention/auto-delete, on-device feature-only/redacted output, access logs, nothing requiring non-India cloud.
23. **(CRITICAL)** Encryption in transit (TLS/SRTP) + at rest; auth; per-tenant stream isolation.
24. Signed OTA firmware; support/warranty; India RMA turnaround.
25. **(CRITICAL)** Unit price at 10/50/200/1000; MOQ; lead time to India incl. customs/HSN; eval units now?
26. Eval units for a pilot; prior livestock/outdoor/noisy-industrial references.

---

## 6. Edge box, network & system integration — RFI (cross-cutting + compute)

> ⚠️ **PARTLY OBSOLETE — do not send this section.** Use **`RFI_EDGE_INFRA.md`** /
> `pdf/RFI_EDGE_INFRA.pdf`.
>
> Q3 (native SDK wrapper) is **no longer needed** — the camera speaks ISAPI (HTTP/JSON) +
> Modbus/TCP, so `sparsh_camera.py` is pure Python and ARM64-native. Q4 (frame↔temperature
> sync) is **partly solved** by the camera's timestamped `stream/meta` endpoint. Q7–Q9
> (data contract, identity, baselines) and much of Q10/Q26 are **already built** in
> `server/` + `edge/`. Quoting these to an integrator would pay for work that exists.

**Compute sizing**
1. **(CRITICAL)** Per stall: up to 3× RTSP@25fps@1080p (IR/visible/fusion) + 20 Hz thermal-ROI poll + CV-driven ROI steering + 1 BLE IMU + 1 audio mic, running concurrent CV (activity, vices, urination/excretion posture, gait/lameness) + thermal-nostril DSP. **How many stalls per ONE edge box at full frame rate, and exact Jetson tier (Orin Nano / NX 8–16 GB / AGX 32–64 GB) with GPU TFLOPs/CPU/RAM for 1, 4, 8, 16, 24 stalls?**
2. **(CRITICAL)** **Measured** inference budget: concurrent CV instances at what res/FPS while decoding 3× H.264/H.265 1080p@25fps per camera on NVDEC, sustaining 20 Hz poll, latency < target — show GPU%/NVDEC%/CPU%/RAM headroom.

**Integration ownership (the hard part)**
3. **(CRITICAL)** Camera SDK is **C/C++/C# only (no Python)** — who builds/maintains the native **wrapper** (RTSP, temp poll, PosX/PosY ROI, emissivity, ONVIF) bridging to our AI stack? Source + versioned IPC (gRPC/ZeroMQ/shared-mem)? Build cost + SDK-bump maintenance SLA.
4. **(CRITICAL)** No frame↔temperature sync + 50 ms poll latency — who designs the **multi-sensor time-sync** (visible + thermal + ROI temp + IMU + audio into one timeline)? Clock source (NTP/PTP/GPS/monotonic), per-sensor stamping point, max skew, latency/jitter compensation.
5. **(CRITICAL)** Who builds the **CV-driven ROI-tracking loop** (detect nostril/body → write PosX/PosY each frame)? Achievable update rate vs 20 Hz poll; behaviour when horse out-runs the ROI (dropout/confidence flag).
6. **(CRITICAL)** Who performs the **per-install thermal↔visible fusion-offset calibration** (map visible bbox → correct thermal ROI at the real working distance)? Tooling/target, time per stall, re-validation if bumped.

**Data contract, identity, baselines**
7. **(CRITICAL)** Edge stamps **every** reading with `{horseId, metric, value, unit, ts, source, confidence}` — how `source` is set per modality, how numeric `confidence` is computed, what confidence is emitted on degraded conditions (ROI lost, IMU offline, low night contrast, sensor down).
8. **(CRITICAL)** **Horse identity**: confirm stall→horse mapping primary + optional visual re-ID; how a stall reassignment propagates without misattribution; IMU MAC→horseId binding; behaviour if wrong horse in stall.
9. **(CRITICAL)** **Per-horse baselines** — learned on edge (so alerts work offline) or only cloud? Local store/format, days of history, survive reboot/replacement, represent calibration period (UI shows "74%").

**Resilience, storage, network, power**
10. **(CRITICAL)** Offline buffering during WAN/4G outage — raw vs derived vs clips, storage type/capacity, hours/days, exact **auto-resync** (ordering/dedup/backpressure/gap-fill) so nothing is lost or double-counted.
11. **(CRITICAL)** Storage sizing (camera has only 12 GB): GB/stall/day for derived readings + event clips + audit thermal frames; total disk per N stalls; retention/rotation; NVMe with power-loss protection.
12. **(CRITICAL)** **PoE switch** spec per barn (per-port + total budget +25% headroom, gigabit uplinks, VLAN/QoS for RTSP) for 4/8/16/24 cameras at ≤6 W each; ≤100 m runs.
13. **(CRITICAL)** Per-stall + aggregate **LAN bandwidth** (3× 1080p@25fps H.264 & H.265 + thermal + IMU + audio); switch backplane + edge NIC OK? Then **WAN/cloud-sync** steady + peak Mbps after edge filtering — fits Indian rural broadband/4G?
14. **(CRITICAL)** **4G/LTE failover** — dual-SIM industrial router (Indian carriers/bands), failover detection time, full local inference during WAN loss, monthly cellular GB/site after filtering, throttle-to-readings-only to cap cost.
15. **(CRITICAL)** **UPS sizing** — VA/Wh for target ride-through; clean storage-safe shutdown (no DB corruption); auto-restart + state recovery; total continuous wattage per barn for N stalls.
16. **(CRITICAL)** **Edge enclosure** in a barn (dust, ammonia, humidity, 45–50 °C, insects/rodents, vibration) — IP rating, operating temp, cooling (fanless/filtered); Jetson de-rated stall count at 45 °C vs 25 °C (thermal throttling).

**Ingestion of each modality**
17. **(CRITICAL)** **IMU**: tags per box/gateway, gateway hardware, BLE range across metal barn, reconnect on return, on-tag buffering on BLE drop.
18. **(CRITICAL)** **Audio**: interface (PoE/USB/I2S), per-stall→horse attribution, sample rate needed, audio model load included in the per-box stall count above.
19. **Feed/water**: ingest flow meter / load-cell / feeder (Modbus/RS-485/4-20 mA/pulse/BLE), inputs per box, timestamp+attribute; interim mode — fuse a manual log entry with camera-detected trough presence.

**Compliance, multi-tenant, fleet, security**
20. **(CRITICAL)** **DPDP-2023 residency**: all personal/biometric-adjacent data (staff video, audio) + derived data processed/stored in India, synced only to **GCP asia-south1**, no transit/processing outside India (incl. OTA/telemetry). Provide data-flow diagram with every egress point + region.
21. **(CRITICAL)** **Staff privacy**: on-box redaction (face blur/person mask) before any clip stored/synced; configurable retention for human-containing footage; consent-record support; data-subject access/erasure workflow; same for audio.
22. **(CRITICAL)** **Retention policy** enforced at edge + GCP for raw video / audio / thermal frames / derived readings, auto-delete, per-tenant configurable, verifiable deletion logs for audits.
23. **(CRITICAL)** **Multi-tenant isolation** — tenant tag on every reading, storage isolation model, per-site key/credential isolation, stolen edge box cannot read/write another tenant's data.
24. **(CRITICAL)** **Cloud sync to asia-south1** — managed ingress (Pub/Sub / HTTPS batch), message schema for the contract, exactly-once vs at-least-once, per-device mTLS / service-account-per-site, rate/cost at N stalls, clip path to region-locked GCS.
25. **(CRITICAL)** **Night operation (compute)** — CV confidence for vices/urination/excretion/activity under IR-only (no WDR); auto-flag/lower confidence at night; night-tuned model?; day-vs-night benchmarks; does night IR shift thermal ROI accuracy.
26. **(CRITICAL)** **Health/failure design** — detect dead camera, dropped IMU, stuck ROI, offline mic, full disk, throttling Jetson, stale clock; auto-flag affected readings with reduced confidence (no silent/wrong data); watchdog/auto-recovery.
27. **(CRITICAL)** **Fleet/OTA across sites** — platform (Balena/Mender/IoT), OTA for OS+CV models, staged/canary + auto-rollback, health telemetry, remote reboot, recover a bricked box without a site visit.
28. **(CRITICAL)** **Edge security** — full-disk encryption, secure boot, TPM/secure-element key storage, per-device certs; nothing recoverable in plaintext if box is stolen.
29. **(CRITICAL)** **Scalability/ops** — deployment unit (per barn vs per N stalls), zero-touch site commissioning, central config push (stall map/models/retention/tenant), per-site BoM + landed cost (box+switch+router+UPS+enclosure+cabling+install+calibration) at 8/16/24 stalls.
30. **(CRITICAL)** **Integration boundary & SLA** — exactly what the integrator delivers (wrapper, fusion service, ROI tracker, calibration tooling, fleet mgmt, cloud-sync agent) vs what BSV builds; documented API/contract; source ownership/escrow; per-stream acceptance tests; warranty; RMA in India; support SLA for remote barns.

---

## 7. Completeness confirmation

With the questions above answered, **every one of the 12 scope points and every cross-cutting requirement is closed by at least one concrete question**:

- **Points 2, 3, 4, 11, 12** and the optical side of **5, 6, 7, 8** → §2 Camera (sensor confirmed; remaining gaps = pixels-on-target, night IR wavelength, bitrate, fusion error, blackbody alternative).
- **Points 1, 5, 6, 7** (motion/lameness) → §3 IMU.
- **Points 9, 10** → §4 Feed/Water (incl. interim manual + camera-presence path).
- **Point 8** audio half → §5 Microphone.
- **All cross-cutting** (identity, time-sync fusion, offline resilience, baselines, night ops, data contract, DPDP/privacy/retention, multi-tenant, scalability, integration ownership) → §6 Edge/Integration.

**Explicitly parked (by decision, not omission):** true per-limb weight-bearing in kg (needs a force plate / instrumented mat — revisit only if a vet requires actual load); camera WDR (mitigate via mounting away from backlight, or evaluate a WDR camera if daytime vessel-corner glare proves to break presence CV).

**The two known hard constraints to keep designing around:** (1) thermal temperature is **screening-grade (±2 °C)** — treat as per-horse trend, not clinical, unless the blackbody/alternative model (Camera Q9) changes that; (2) **BSV owns the edge-side integration** — wrapper, time-sync, ROI tracking, fusion calibration — because the camera provides none of it (Edge Q3–Q6).
