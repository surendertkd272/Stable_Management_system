# SDK Delivery Review — Technical Gaps & Requests (Sparsh SC-IT6420-HB V2, 640×512)

*Thank you for the SDK package (received). We have reviewed it against our development requirements. The core toolkit is largely in order — headers, C/C++ and C# samples, and working API calls for set-ROI, set-emissivity, poll-temperature, and RTSP address retrieval. However, we cannot begin edge development on our target hardware until the two BLOCKING items below are resolved, and a set of technical confirmations is still outstanding.*

*Package identified as: OEM toolkit "DMS/DALI", module `VD641`, v1.0.0.3, dated 2026-03-20. Linux only.*

---

## A. BLOCKING — we cannot start until these are resolved

### 1. ARM64 / Jetson build of the SDK libraries **(BLOCKING)**
Every shared library shipped (`libVD641Module.so` and its dependencies — libssl, libcrypto, libcurl, libssh2, libjsoncpp, libevent, libz) is compiled for **x86-64**, across all three provided folders (Ubuntu 22.04 / Debian 13 / Deepin 25). The bundled .NET runtime is `linux-x64`.

Our edge platform is **NVIDIA Jetson (ARM64 / aarch64)**, as stated in our requirements. None of the delivered binaries will run on it.

**Request:** Deliver **aarch64 (ARM64) builds** of `libVD641Module.so` and all dependent libraries. For the C# path, also confirm a **linux-arm64** runtime is supported. Please confirm the Jetson/JetPack (Ubuntu) versions you have validated against.

### 2. Factory visible↔thermal calibration / coordinate mapping **(BLOCKING — critical-path)**
The SDK's measurement coordinates map *image-encoding resolution → sensor resolution within the thermal channel only*. We found **no API or data that maps a visible-image pixel coordinate to the matching thermal ROI coordinate**, and no calibration file for that transform. A fusion (`STREAM_MSX`) stream exists, which implies hardware alignment, but the transform is not exposed to us.

Our software detects the nostril/eye on the **visible** frame and must steer the **thermal** ROI to that location. We require the factory visible↔thermal mapping.

**Request:**
- Provide the **visible→thermal coordinate transform**, exposed via the SDK (or as calibration data per unit).
- State the **achievable mapping accuracy (pixels / mm) at 3 m and 4 m**.
- Confirm whether **re-calibration is needed after re-mounting**.

---

## B. Technical confirmations still outstanding
*(These are spec/test confirmations, not code — they were not included with the SDK. R-numbers reference our earlier Pending Requirements list.)*

### Streaming & codecs
- **R13 — H.265:** The API exposes only container formats (AVI/MP4); codec selection is not visible. Confirm **H.265 (HEVC) on all three streams (IR / visible / fusion) at 25 fps**.
- **R12 — Bitrate:** State **encoded bitrate (Mbps) per stream** and the **aggregate** with all three streams + temperature polling active (CBR and VBR).
- **R15 — Fusion resolution:** State the fusion stream resolution.

### Timing & sync
- **R9 — PTP / frame-to-temperature sync:** The SDK exposes **NTP only** (`QueryTimeNtp`); we found no PTP support. Confirm whether **PTP** is available, whether **frame timestamps can be embedded** (RTCP sender reports / OSD), and provide your **recommended method to align visible + IR + fusion frames with polled temperature**.

### ROI performance & concurrency
- **R7 — ROI reposition rate:** State the **maximum sustained rate (updates/second)** at which an ROI's coordinates can be repositioned via the API (we need ≥ frame rate to chase a moving nostril).
- **R8 — Poll rate & throttling:** State the **maximum sustained per-ROI temperature poll rate**, and whether the SDK throttles **per device or per host** (this decides cameras-per-edge-box).
- **R14 — Concurrency:** State the **max simultaneous SDK/ONVIF clients + RTSP pulls**, and whether ~20 Hz temperature polling contends with triple-RTSP @25 fps.

### Optics & imaging
- **R1 — Pixels-on-target:** Thermal pixels covering a **5 cm target at 3 m and 4 m** for the **25 mm** and **13 mm** thermal lenses (please confirm/lock: 25 mm = 24/18 px, 13 mm = 12/9 px).
- **R2 — Focus:** State **minimum focus distance**, and confirm **fixed focus factory-set to 3.5 m** on the eval units.
- **R16 — Shutter & distortion:** Confirm the visible sensor is **global-shutter**, give the **sensor model/part number**, and state **lens geometric distortion (%)** for the 4/6 mm visible lenses.
- **R18 — IR illuminator:** Confirm **940 nm** (not 850 nm), and that IR can be **scheduled/disabled while the thermal stream and ROI temperature remain fully functional in total darkness**.
- **R19 — Registration error:** Quantify the fusion registration/parallax error (px or mm) at 3 m and 4 m.

### Accuracy upgrade path
- **R5 — Blackbody / higher-accuracy model:** The header shows `SUPPORT_BLACKBODY` and an in-family model with a built-in small blackbody, which suggests an upgrade path exists. Please **confirm a higher-accuracy / blackbody-referenced model in the same SDK / RTSP / ONVIF family** (same ROI API, same stream layout) for later drop-in.

### Events & resilience
- **R10 — ONVIF Profile G event schema** (temperature alarm, person/vehicle) with field definitions and timestamps.
- **R22 — IK (impact) rating** and horse/vandal-resistant / recessed mount option.
- **R23 — Power-loss recovery:** auto-reboot, auto-resume all three RTSP streams, restore ROIs + temperature settings without manual intervention, stream watchdog, cold-boot-to-streaming time.
- **R24 — Worst-case power:** confirm ≤6 W is worst-case (IR + thermal + all three streams + polling), or advise if 802.3at is recommended.
- **R25 — Security hardening:** signed firmware / secure boot, SRTP or RTSP-over-TLS, isolated-VLAN operation with no mandatory cloud/phone-home, no default/backdoor accounts, ability to disable telnet/UPnP/discovery, firmware-update mechanism and patch cadence.

### Windows SDK
- Only the **Linux** SDK was shared. Not required for our deployment, but please confirm availability if a Windows build exists.

---

## C. Hardware config — please confirm
- **2 evaluation units:** confirm they are built as ordered — one **25 mm** thermal + one **13 mm** thermal, both **4 mm visible**, **fixed focus factory-set to 3.5 m**.

---

## Priority summary
- **Blocking (need now to start):** A1 (ARM64 build), A2 (visible↔thermal calibration).
- **Needed early:** R13, R12, R9, R7, R8, R16, R18, R5.
- **Can run in parallel:** R1, R2, R14, R15, R19, R10, R22–R25, Windows SDK, eval-unit build config.

---

### What is confirmed working in the delivered SDK (for reference)
Headers ✅ · C/C++ and C# samples ✅ · set-ROI (`SetPoint/Line/AreaMeasure` + `…Ex`, by coordinate at runtime) ✅ · per-ROI emissivity (`FPara100`) ✅ · poll-temperature Max/Avg/Min (`QueryThermometryPoint/Line/Area`) ✅ · ≥2 simultaneous ROIs per camera (indexed, up to 10 each) ✅ · RTSP address retrieval (`QueryRtspStreamAddress`) ✅ · per-pixel radiometric via RAW-JPEG snapshot ✅ · NTP ✅ · Modbus TCP protocol doc ✅.
