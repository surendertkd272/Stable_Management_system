# RFI — Edge compute, network & barn infrastructure (BSV EquiCare)

**To:** Edge-computing / systems-integration partner
**From:** Bharat Sports Venture — EquiCare engineering
**Covers:** cross-cutting compute, network, power, enclosure, installation and fleet management for all 12 monitoring points

---

## 0. How to reply — please read first

**Please answer all of this in ONE consolidated reply.** We are evaluating several suppliers in
parallel on a fixed timeline and will not be sending rounds of follow-up questions. In practice
that means:

1. **Answer every numbered question**, in the reply slots provided. If something is not
   supported, **write that plainly** — "not supported" is a perfectly good answer and costs you
   nothing. A blank or skipped item, however, we have to record as *not supported*, because we
   cannot tell the difference.
2. **Attach the documents and files listed in the checklist at the end.** Please send them with
   this reply, not "on request" — a claim we cannot verify counts as unverified.
3. **Send the actual artifact, not a description of it.** Our single worst experience with a
   previous supplier: they confirmed "Linux SDK — yes", and the package that arrived was x86-64
   only, with no ARM64 build available at all. That cost both sides weeks. So where we ask for a
   binary, driver, register map or protocol spec, please attach the real file (or a download
   link) — or state clearly that it does not exist.
4. If a question does not apply to your product, write **"N/A"** and one line saying why.

We would rather receive an honest reply with several "not supported" answers than an optimistic
one that unravels at integration.

---

## 1. What we are building, and what we are NOT asking you to build

A 24/7 monitoring system for stabled horses in India. Per stall: one dual thermal+optical
camera, one IMU leg tag, feed and water sensing, and a microphone. Per barn: an **edge
computer**, PoE network, 4G failover and UPS.

**Please read this before quoting — it defines the boundary.**

**BSV has already built, and is not procuring:**

- the **camera driver** (thermal ROI control, temperature polling, RTSP) — the camera exposes
  an HTTP/JSON API (ISAPI) plus Modbus/TCP, so this is done in Python and runs natively on
  ARM64. **No native SDK wrapper is required.** (An earlier version of this specification asked
  for one; that is now obsolete.)
- the **edge agent** — sensor ingestion, offline queue, backfill
- the **data contract** — every reading is `{horseId, metric, value, unit, ts, source, confidence}`
- the **backend and rollup engine** — clinical rules, per-horse learned baselines, alerting,
  monitoring-gap detection
- the **web application** — dashboard, per-horse detail, alerts, reports
- all **CV and DSP models** — activity, vices, gait, urination/excretion, thermal respiration

**What we need from you** is the hardware platform it runs on, the barn infrastructure around
it, and installation/commissioning. If you also offer software services, say so separately —
but please do not price the items listed above.

## 2. Hard requirements — please confirm these first

Pass/fail. If any cannot be met, say so plainly rather than leaving it blank.

| # | Requirement | Why |
|---|---|---|
| **H1** | **NVIDIA Jetson (ARM64) based edge platform**, Ubuntu 22.04+ / current JetPack. | Our entire stack is built and tested for aarch64. |
| **H2** | **All processing and storage on-premise in India**; cloud sync (if any) only to an **India region** (e.g. GCP asia-south1). No data transiting or processing outside India — including OTA and telemetry. | DPDP-2023. Please provide a data-flow diagram naming every egress point and its region. |
| **H3** | **Full local operation during WAN/4G loss** — inference, alerting and buffering continue with no internet. | Rural barns lose connectivity routinely. |
| **H4** | **Barn-rated enclosure** — dust, ammonia, humidity, **45–50 °C**, insects/rodents, vibration. | Indian barn conditions; a standard office mini-PC enclosure will not survive. |

**Reply (H1–H4):**

---

## 3. Compute sizing — the central question

1. **Per stall the load is:** up to 3 × RTSP 1080p @25 fps (IR / visible / fusion) decoded on
   NVDEC, thermal ROI temperature polling at 5–20 Hz over Modbus/HTTP, ROI repositioning over
   HTTP, one BLE IMU at 100–200 Hz raw, one audio channel at ≥16 kHz — plus **our** concurrent
   CV (activity, vices, urination/excretion posture, gait) and thermal-respiration DSP.

   **How many stalls per single edge box at full frame rate, and which exact Jetson tier**
   (Orin Nano / Orin NX 8–16 GB / AGX Orin 32–64 GB) for **1, 4, 8, 16 and 24 stalls**? State
   GPU TFLOPs, CPU cores and RAM for each.
   **Reply:**

2. **Measured, not theoretical.** Please provide a **benchmark** showing GPU %, NVDEC %, CPU %,
   RAM and thermal headroom while decoding 3 × 1080p @25 fps per camera and running concurrent
   inference. State the model(s) used for the benchmark so we can compare against our own.
   **Reply:**

3. **De-rating at temperature.** How many stalls per box at a **45 °C ambient** versus 25 °C,
   accounting for thermal throttling? This determines our real per-barn count.
   **Reply:**

4. **Storage** — NVMe capacity and endurance per box, with **power-loss protection**. Sizing
   guidance for derived readings + event clips + audit thermal frames at N stalls, plus
   retention/rotation. *(The camera itself has only 12 GB, so the edge box carries retention.)*
   **Reply:**

## 4. Network

5. **PoE switch** specification per barn — per-port and total power budget with **≥25 %
   headroom**, gigabit uplinks, VLAN/QoS for RTSP — for 4 / 8 / 16 / 24 cameras at ≤6 W each,
   with runs up to 100 m. Note mics and possibly feed/water sensors may also draw PoE.
   **Reply:**

6. **Bandwidth.** Per-stall and aggregate LAN load (3 × 1080p @25 fps, H.264 and H.265, plus
   thermal, IMU and audio) — confirm switch backplane and edge NIC are adequate. Then the
   **WAN/cloud-sync** steady and peak Mbps *after* edge filtering; does that fit typical Indian
   rural broadband?
   **Reply:**

7. **4G/LTE failover** — dual-SIM industrial router (Indian carriers and bands), failover
   detection time, and expected **monthly cellular GB per site** after edge filtering. Can it be
   throttled to readings-only to cap cost during an outage?
   **Reply:**

8. **UPS sizing** — VA/Wh for a stated ride-through, **clean storage-safe shutdown** (no
   database corruption), automatic restart and state recovery. State total continuous wattage per
   barn at N stalls.
   **Reply:**

## 5. Physical install and commissioning

9. **Enclosure** — IP rating, operating temperature, cooling approach (fanless vs filtered), and
   protection against insects/rodents. Where is it mounted relative to the stalls?
   **Reply:**

10. **Camera mounting** — we need the horse's head in frame at **~3.5 m** with a fixed-focus
    thermal lens whose in-focus band is roughly **3.0–4.3 m**. Can you survey and mount to hold
    that geometry, and provide **impact-protected or recessed mounts** (horses will contact the
    camera; the camera has no published IK rating)?
    **Reply:**

11. **Thermal↔visible alignment.** The camera vendor does **not** expose a visible→thermal
    coordinate mapping, and reports the fusion overlay as approximate. We therefore detect on the
    thermal/fusion stream ourselves. Do you offer any **per-install alignment or calibration
    tooling** — and if so, time per stall and what happens after a knock?
    **Reply:**

12. **Zero-touch commissioning** — how is a new site brought up: stall→camera→horse mapping,
    network config, credentials? What is the per-stall install and commissioning time?
    **Reply:**

## 6. Ingestion of each modality

13. **IMU** — BLE gateway hardware, tags per box/gateway at 100–200 Hz raw, realistic range
    across a metal/masonry barn, and reconnect behaviour when a horse returns from turnout.
    **Reply:**

14. **Audio** — which interface do you recommend into the Jetson (PoE network mic / USB / I2S)?
    Include the audio channel in the per-box stall count in Q1.
    **Reply:**

15. **Feed/water** — RS-485/Modbus, 4–20 mA, pulse and BLE inputs available per box; how many
    devices per bus; and any gateway needed.
    **Reply:**

## 7. Fleet, resilience and security

16. **Health and failure detection at the platform level** — dead camera, dropped BLE gateway,
    offline mic, full disk, throttling SoC, **stale clock**. *Our software already flags stale or
    missing data and refuses to report a blind stall as healthy; we want the hardware layer to
    surface faults too.*
    **Reply:**

17. **Time discipline** — how is the box's clock kept accurate (NTP source, PTP grandmaster,
    GPS?), and can it act as an **NTP/PTP server for the cameras and sensors** on the barn LAN?
    *All cross-sensor fusion depends on this.*
    **Reply:**

18. **Fleet management / OTA across sites** — platform (Balena / Mender / other), OS and
    container updates, staged or canary rollout with **automatic rollback**, health telemetry,
    remote reboot, and recovery of a bricked box **without a site visit**.
    **Reply:**

19. **Edge security** — full-disk encryption, secure boot, TPM or secure-element key storage,
    per-device certificates. Nothing recoverable in plaintext if a box is stolen from a barn.
    **Reply:**

20. **Multi-tenant isolation** — we will run multiple client sites. Per-site credential and key
    isolation, such that a stolen or compromised box cannot read or write another site's data.
    **Reply:**

## 8. Deployment model and boundary

21. **Deployment unit** — per barn, or per N stalls? Provide a **per-site bill of materials**
    (edge box + switch + router + UPS + enclosure + cabling + mounts) at **8, 16 and 24 stalls**.
    **Reply:**

22. **Integration boundary and support** — state precisely what you deliver versus what BSV
    builds (see §1), the documented handover interface, per-stream acceptance tests, **RMA
    turnaround in India**, and your support SLA for remote barn sites.
    **Reply:**

## 9. Evaluation

We would like **one edge unit configured for the pilot** (with switch, router and UPS
recommendations), so we can deploy our existing stack on it and measure real stall capacity
before scaling.

**Reply (availability + lead time):**

---

---

## Response checklist

Please confirm each item is attached or answered, so we can evaluate in a single pass:

| | Item |
|---|---|
| ☐ | Every numbered question answered (or marked "not supported" / "N/A") |
| ☐ | All hard requirements (H-numbers) explicitly confirmed or declined |
| ☐ | Sensor / component **datasheets** |
| ☐ | **Protocol document, register map or API reference** — the actual file |
| ☐ | **ARM64 (aarch64) build** attached or download link — *or* a plain statement that none exists |
| ☐ | **Sample data payload** showing real field names and units |
| ☐ | Sample code, if you provide any |
| ☐ | Evaluation-unit availability and lead time |
| ☐ | A named technical contact we can reach directly with any single clarification |

*If anything on this list genuinely cannot be shared before an order, please say which item and
why, so we can factor it in rather than assume the worst.*

*Commercial terms are not part of this RFI — we will discuss those separately once the
technical fit is confirmed. Note that our software stack is already built and running; we are
looking for the platform and infrastructure to deploy it on, not a software rebuild.*
