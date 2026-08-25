# Pending Requirements — Camera (Sparsh SC-IT6420-HB V2, 640×512 variant)

*For an equine monitoring deployment. The items below are NOT yet fulfilled or confirmed by your spec sheet or your earlier clarifications. Please confirm each can be met (with the value/spec), or state the limitation. Items marked (BLOCKING) gate our software design.*

> Already confirmed and accepted (not repeated here): dual thermal+optical sensor; 640×512 / NETD ≤0.04 °C / 8–14 µm; visible 1080p @25fps; thermal @25fps; IR to 30 m; lens options & FoV (4/6 mm visible, 13/25 mm thermal); coverage 4 mm=3.7 m@4 m; emissivity 0.01–1.0 per ROI; 10 points/10 areas/3 lines; ROI Max/Min/Avg via SDK; temperature poll up to 25 fps / 50 ms; SDK Win/Linux Ubuntu 22.04+ on ARM/Jetson, C/C++/C#; ONVIF S/G + per-stream RTSP; NTP; triple simultaneous RTSP @25fps; H.264; PoE 802.3af ≤6 W; IP66; −20…+50 °C; 100 m cable; bracket; 12 GB storage; HTTPS/802.1X/IP-filtering/access-logs; no onboard analytics on visible; no audio.

---

## A. Thermal-feature feasibility (BLOCKING — decides if temperature & respiration work)

- **R1 (BLOCKING) — Pixels-on-target.** State the number of thermal pixels covering a **5 cm target (horse nostril/eye) at 3 m and at 4 m** for the 640×512 sensor with each thermal lens. *Target: enough pixels for a stable ROI temperature and a respiration oscillation (we need this to confirm points 2/3/4 are viable at stall distance).* Status: **not stated.**
- **R2 (BLOCKING) — Minimum focus distance.** State minimum focus distance for the 13 mm thermal lens and for the 4 mm / 6 mm visible lenses. *Target: in-focus at 2.5–4 m stall mounting.* Status: **not stated.**
- **R3 (BLOCKING) — Per-pixel radiometric access.** Confirm whether the SDK can return **per-pixel radiometric temperature frames**, or only Max/Min/Avg per point/line/area. *We require a continuous Avg of a small nostril ROI (respiration) AND a Max of an eye ROI (temperature).* Status: **not confirmed.**
- **R4 (BLOCKING) — Simultaneous ROIs.** Confirm at least **2 ROIs per horse can be read simultaneously** (nostril for respiration + eye for temperature), and how each is queried. Status: **count known (10 areas), simultaneous read not confirmed.**
- **R5 — Temperature accuracy upgrade path.** Confirm whether a **higher-accuracy / blackbody-referenced model exists in the SAME SDK / RTSP / ONVIF family** (same ROI API, same dev=0/1/2 stream layout) for later drop-in. *±2 °C is screening-grade only; we need a clinical-accuracy option path.* Status: **±2 °C confirmed; alternative model not addressed.**

## B. ROI control, sync & integration (BLOCKING — gates the edge software)

- **R6 (BLOCKING) — Coordinate mapping.** Provide the mapping/transform from a **visible-RTSP pixel coordinate to the SDK thermal ROI PosX/PosY coordinate**, so our CV (which detects the nostril/eye on the visible frame) can steer the thermal ROI. Status: **not provided.**
- **R7 (BLOCKING) — ROI reposition rate.** State the **maximum sustained rate (updates/second) at which an ROI's PosX/PosY can be repositioned** via the API. *Target: ≥ camera frame rate, to chase a moving nostril.* Status: **not stated.**
- **R8 (BLOCKING) — Multi-camera poll rate.** State the **maximum sustained per-ROI temperature poll rate when polling several cameras from one host**, and whether the SDK throttles per device or per host. *Determines cameras-per-edge-box.* Status: **not stated.**
- **R9 (BLOCKING) — Frame↔temperature alignment.** Since there is no on-camera frame-to-temperature sync: confirm **PTP** support, whether **frame timestamps can be embedded in RTSP** (RTCP sender reports / OSD), and provide your **recommended method to align visible+IR+fusion frames with polled temperature**. Status: **NTP confirmed; PTP / embedded timestamps / method not stated.**
- **R10 — Event API schema.** Provide the **ONVIF Profile G event payload schema** (temperature alarm, person/vehicle) with field definitions and timestamps, so we can ingest events instead of polling. Status: **Profile G supported; payload schema not provided.**
- **R11 (BLOCKING) — SDK + dev unit now.** Deliver the **SDK package** (headers, libraries, C/C++ sample code for set-ROI, set-emissivity, poll-temperature, RTSP handling) and **1–2 evaluation 640×512 units** for development, with development licensing terms. Status: **not provided.**

## C. Streaming & imaging quality

- **R12 (BLOCKING) — Per-stream bitrate.** State the **encoded bitrate (Mbps) per stream** (IR / visible / fusion) at 25 fps and the **aggregate** with all three pulled plus temperature polling (CBR and VBR). *For network/edge/storage sizing.* Status: **not stated.**
- **R13 — H.265 support.** Confirm whether **H.265 (HEVC)** is available on all three streams at 25 fps (in addition to H.264). Status: **H.264 confirmed; H.265 not stated.**
- **R14 — Concurrency limit.** State the **maximum simultaneous SDK/ONVIF clients and RTSP pulls**, and whether 20 Hz temperature polling contends with triple-RTSP @25fps on the camera. Status: **not stated.**
- **R15 — Fusion stream resolution.** State the **resolution of the fusion stream** (fps confirmed 25). Status: **not stated.**
- **R16 (BLOCKING) — Shutter & distortion.** Confirm the visible sensor is **global-shutter (preferred) or rolling-shutter**, and the lens geometric distortion (% at edges). *Rolling-shutter skew/distortion corrupts gait/lameness analysis (point 7).* Status: **not stated.**
- **R17 — Low-light rating.** State the **minimum illumination (lux) for a usable visible image with IR OFF** (colour and B/W) and confirm a usable image at **0 lux with IR ON**. Status: **only "IR to 30 m" given.**
- **R18 (BLOCKING) — IR wavelength & control.** State the **IR illuminator wavelength (850 nm or 940 nm)**; 850 nm emits a visible red glow that disturbs horses at night and corrupts our resting/behaviour data — confirm a **940 nm option**. Confirm IR can be **scheduled/disabled while the thermal stream and ROI temperature remain fully functional in total darkness**. Status: **not stated.**
- **R19 — Thermal↔visible registration error.** **Quantify** the registration/parallax error of the fusion stream (in pixels or mm) at 3 m and 4 m. Status: **stated "approximate"; not quantified.**

## D. Unmet capability gaps (confirmed limitations — need resolution or written confirmation)

- **R20 — WDR.** WDR is **not supported**. Confirm there is no WDR/HDR or backlight-compensation mode; we will mitigate via mounting, but confirm any available exposure/backlight options for bright/shadowed stall corners. Status: **unmet (confirmed not supported).**
- **R21 — Capability confirmation (in writing).** Confirm these limitations so we design around them, and whether any is addressable via firmware or an alternative model: no on-camera target tracking; no frame-to-temperature time sync; no Python SDK; ±2 °C with no blackbody; visible stream has no analytics; 12 GB onboard storage only. Status: **individually answered; need consolidated written confirmation.**

## E. Environment, resilience & security

- **R22 — Impact rating.** State the **IK (impact) rating** and confirm a **horse/vandal-resistant housing or recessed mount option** (horses will contact the camera). Status: **IP66 confirmed; IK not stated.**
- **R23 — Power-loss recovery.** Confirm behaviour after power loss / UPS cutover: **auto-reboot, auto-resume all three RTSP streams, restore configured ROIs and temperature settings without manual intervention**, stream watchdog, and cold-boot-to-streaming time. Status: **not stated.**
- **R24 — Worst-case power.** Confirm the **≤6 W figure is worst-case** (IR + thermal + all three streams + polling active), or advise whether **802.3at** is recommended for headroom. Status: **≤6 W stated; worst-case basis unconfirmed.**
- **R25 — Security hardening.** Beyond the confirmed HTTPS/802.1X/IP-filtering/access-logs, confirm: **signed firmware / secure boot, SRTP or RTSP-over-TLS for media, operation on an isolated VLAN with no mandatory cloud/phone-home, no default/backdoor accounts, ability to disable telnet/UPnP/discovery**, plus the **firmware-update mechanism and security-patch cadence**. Status: **partially confirmed; the rest not stated.**

## F. Commercial & supply

- **R26 — Supply.** State **bulk lead time and MOQ for the 640×512 variant beyond current stock**, unit price at 10/25/50/100+ units, and whether stock is reserved on PO. Status: **only "few in stock."**
- **R27 — Support.** State **warranty term, India RMA turnaround, loaner/spare availability**, and the **SDK developer-support SLA and version-update policy**. Status: **not stated.**

---

### Priority for our software start
**Must have to begin edge development:** R1, R2, R3, R4, R6, R7, R8, R9, R11, R12, R16, R18.
**Strongly needed early:** R5, R10, R13, R14, R15, R17, R19, R25.
**Can run in parallel (procurement):** R20, R21, R22, R23, R24, R26, R27.
