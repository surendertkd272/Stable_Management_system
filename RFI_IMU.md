# RFI — IMU leg wearable for equine monitoring (BSV EquiCare)

**To:** IMU / wearable-sensor vendor
**From:** Bharat Sports Venture — EquiCare engineering
**Covers client monitoring points:** 1 (steps / locomotion), 5 (activity), 6 (rest & lying), 7 (lameness / limb-favouring)

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

## 1. What we are building

A 24/7 monitoring system for stabled horses in India. Each stall has sensors feeding an
**on-site edge computer** (NVIDIA Jetson); our software turns raw data into health and
behaviour insights. We need a **leg-mounted IMU tag** (cannon bone) streaming **raw motion
data** to that edge box.

**All analytics — step counting, gait analysis, lameness, lying detection — are done by us.**
We are not buying your algorithms or dashboard. We need **raw, timestamped, per-axis data**
and a documented way to read it on our own hardware.

## 2. Hard requirements — please confirm these first

Pass/fail for us. If any cannot be met, please say so plainly rather than leaving it blank —
it saves us both time.

| # | Requirement | Why |
|---|---|---|
| **H1** | **Linux ARM64 (aarch64) support — NVIDIA Jetson.** Any SDK/driver must be *built and tested* for aarch64, not only x86-64. | Our edge box is a Jetson. A previous vendor shipped x86-only binaries and could not rebuild — it blocked us for weeks. If your tag speaks an open protocol (BLE GATT / serial / MQTT), say so and this is a non-issue. |
| **H2** | **Raw per-axis time-series accessible** — not only step counts or vendor-computed summaries. | Our gait/lameness models need the waveform. A closed product that only returns "activity score" cannot work for us. |
| **H3** | **No mandatory vendor cloud.** Data must reach our edge box over the local network. | India DPDP-2023 residency, and barns with unreliable internet. |
| **H4** | **India WPC/ETA radio approval + BIS.** | Legal deployment requirement. |

**Reply (H1–H4):**

---

## 3. Sensing

Please answer with **specific values / part numbers**, not "yes — supported".

1. **Sensor part number(s) + datasheet.** Is it **6-axis** (3-axis accel + 3-axis gyro) or
   **9-axis** (with magnetometer)? *6-axis is our minimum; 9-axis preferred.*
   **Reply:**

2. **Accelerometer full-scale range**, and whether it is selectable (±2/4/8/16 g). We require
   **≥ ±16 g** — a horse kicking or striking the stall wall will clip lower ranges and corrupt
   the very data we need.
   **Reply:**

3. **Gyroscope full-scale range** (selectable ±250–2000 °/s?). We require **≥ ±2000 °/s** — no
   clipping at trot, canter or kick.
   **Reply:**

4. **Configurable output data rate (ODR).** We require **≥100 Hz, target 100–200 Hz**. State
   supported rates, whether it is configurable **over the air**, and the achievable rate
   *while streaming raw*.
   **Reply:**

5. **Noise density / RMS noise** for accel and gyro at our target ODR. State any on-chip
   filtering and whether it can be bypassed.
   **Reply:**

6. **Gyro bias drift with temperature** (Indian barns reach 45–50 °C), and whether the tag can
   be **recalibrated in the field without removing it** from the horse.
   **Reply:**

7. **On-firmware activity classification** (standing / lying / walking / trotting / restless) —
   do you provide it, is it **equine-validated or generic**, and **can it be disabled**? We
   classify on our edge, so we need raw data regardless; we do not want firmware quietly
   pre-filtering it.
   **Reply:**

8. **Step counting** — equine-validated or adapted from human/cattle? State error at walk and
   at trot.
   **Reply:**

9. **Per-reading quality / confidence flag** — any validity, saturation or signal-quality
   indicator per sample or per batch, that we can carry into our data model?
   **Reply:**

## 4. Data access and integration

10. **How does raw data leave the tag?** State the transport (BLE GATT, Wi-Fi, proprietary
    radio → gateway, USB, serial) and **attach the protocol/API documentation or register map
    with this reply**, not later.
    **Reply:**

11. **Streaming vs. batch.** Can the tag **stream continuously** at ≥100 Hz, or only upload
    periodic batches? If batched, state interval, payload format and throughput.
    **Reply:**

12. **Documented output schema and units** — exact field names and units for accel (g or m/s²)
    and gyro (°/s or rad/s). Confirm it can be mapped to our contract:
    `{horseId, metric, value, unit, ts, source, confidence}`. Is the schema versioned?
    Sample payload welcome.
    **Reply:**

13. **BLE specifics** (if BLE): version (4.2 / 5.x), **Coded-PHY / Long-Range** support, TX
    power, and **realistic range through masonry and steel barn structure** — not open-field
    figures.
    **Reply:**

14. **Gateway** (if required): model, **how many tags per gateway at our raw sample rate**,
    uplink (Ethernet/PoE preferred, Wi-Fi, 4G), and confirmation of a **local-only path to our
    edge box**.
    **Reply:**

15. **Any vendor cloud in the data path** — and if so, where are those servers located? Can
    the entire path be **edge-only / on-premise with no data leaving India**?
    **Reply:**

## 5. Time synchronisation

16. **Are samples timestamped on the tag** or on receipt? State the **clock-sync method
    (PTP preferred, NTP acceptable)**, worst-case **drift/skew between tags over 24 h**, and
    whether the gateway can discipline tag clocks.
    *We must align IMU data with video frames, thermal ROI temperatures and audio on one
    timeline — we are targeting tens of milliseconds.*
    **Reply:**

## 6. Resilience and power

17. **On-tag buffering** — we require **≥24 h** with **automatic backfill using the original
    timestamps** and acknowledged delivery (barns lose power and connectivity). State capacity
    in hours **at 100 Hz raw**.
    **Reply:**

18. **Battery life** at each mode (lying-detection only vs 100–200 Hz raw streaming);
    chemistry/mAh; rechargeable or replaceable; charge time and cycle life.
    **Reply:**

19. **Charging operations for a whole yard** — multi-bay dock, hot-swap spares, how data gaps
    during a swap are handled, and how a replacement tag is **re-bound to the same horse**.
    **Reply:**

## 7. Fit, welfare and environment

20. **IP rating — we require IP67 or better**, validated against wash-down, mud, urine/manure
    and sweat. State operating temperature and humidity range (we need 45 °C+ and monsoon).
    **Reply:**

21. **Attachment** to the cannon bone (strap / boot pocket), size range **pony → draft**, and
    expected strap service life.
    **Reply:**

22. **Welfare** — tag weight and dimensions (*target ≤50 g*), and any 24/7 wear assessment
    showing no rub sores or skin damage. Please share equine field-trial or welfare data.
    **Reply:**

23. **Loss prevention** — **tamper/detach alert**, and your observed **tag-loss rate per
    tag-year** in field deployments.
    **Reply:**

## 8. Identity and fleet management

24. **Globally unique immutable hardware ID** present in every record, and how we **bind
    tag → horseId** via API (queryable mapping).
    **Reply:**

25. **Fleet management** — firmware OTA, battery/health monitoring, remote configuration, and
    and what data (if any) passes through systems you host.
    **Reply:**

## 9. Evaluation

We would like **3–5 evaluation tags + 1 gateway + charging dock**, together with the
**SDK/driver, protocol documentation and sample code** for Linux/ARM64, so we can validate on
our Jetson bench before committing to a design.

**Reply (availability + lead time for evaluation hardware):**

## 10. Optional — equine validation data

If you hold any **equine** reference or validation data (step counts, lying time, gait
asymmetry against a gold standard), please share it. Most tags are validated on cattle or
humans; equine gait differs, and this would materially reduce our modelling risk.

**Reply:**

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
technical fit is confirmed.*
