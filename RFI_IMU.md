# RFI — Equine motion sensors with live mobile data (LTE-M / NB-IoT) (BSV EquiCare)

**To:** IMU / wearable-sensor vendor
**From:** Bharat Sports Venture — EquiCare engineering
**Covers client monitoring points:** steps/locomotion · general activity/abnormalities · resting pattern and duration · lameness/limb-favoring

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

A 24/7 monitoring system for stabled horses in India. Our software turns raw motion data into
steps, activity, lying time and lameness measures. **All analytics are done by us** — we are not
buying your algorithms or dashboard. We need **raw, timestamped, per-axis data** and a documented
way to receive it.

The data must be **live both in the barn and when the horse leaves it** — for an hour or more of
exercise in an arena, on the lunge or out on a ride. So the horse's sensors must reach us over the
**mobile network (LTE-M and/or NB-IoT)**, sending **directly to our own server in India**, not
only to a gateway in the barn.

## 2. The sensor set we want quoted

We are asking for **three devices per horse**. The split keeps weight off the leg, and puts
sensors where lameness is measured: horses with a sore front leg **nod the head** when that leg
lands, and horses with a sore hind leg **hike the hip** on that side. Measuring head and pelvic
movement is the approach used by veterinary lameness systems.

| Device | Worn | When | What it does |
|---|---|---|---|
| **A. Leg tag** | One front **cannon bone** (strap or boot pocket) | 24/7 | Steps, activity, standing / lying, that leg's stride timing. Light: **target ≤50 g**. |
| **B. Halter hub with SIM** | On the **halter** (cheek piece or poll strap) | 24/7 | Relays A and C **live over LTE-M / NB-IoT**. Its own IMU measures **head movement** (front-leg lameness). **Target ≤150 g** (our target — state yours). |
| **C. Pelvis sensor** | Over the **sacrum** (croup), on a pad, roller/surcingle or adhesive mount | Exercise and trot-ups | **Pelvic movement** (hind-leg lameness). |

**Alternative:** if you offer an **all-in-one SIM leg tag**, please quote it as well, with its
weight and battery life; we will compare it with the set above.

**Reply (which devices you can supply, as-is or adapted):**

## 3. Hard requirements — please confirm these first

Pass/fail for us. If any cannot be met, please say so plainly rather than leaving it blank —
it saves us both time.

| # | Requirement | Why |
|---|---|---|
| **H1** | **Live data over LTE-M and/or NB-IoT on Indian networks**, with a fallback (e.g. LTE Cat-1 / Cat-1 bis) where those are not available. State the **networks and bands you have tested in India**. | The horse must stay monitored when it leaves the barn. LTE-M coverage in India is limited; NB-IoT and a fallback matter. |
| **H2** | **Direct to our server**: the device sends to an **endpoint we configure** (MQTT or HTTPS over TLS) using a **documented protocol** — no mandatory vendor cloud in the data path. | India DPDP-2023 residency; our data, our server. |
| **H3** | **Raw per-axis time-series accessible** — not only step counts or vendor-computed summaries. (Live summaries over the mobile link with raw uploaded later is acceptable — see section 6.) | Our gait / lameness models need the waveform. |
| **H4** | **India approvals**: **TEC (MTCTE)** where it applies to the cellular device, **WPC/ETA** for every radio (including the link between the devices), **BIS**. | Legal deployment requirement. |
| **H5** | Any SDK, driver or software for our on-site computer must be **built and tested for Linux ARM64 (NVIDIA Jetson)** — or use an open protocol. | A previous vendor shipped x86-only binaries and could not rebuild — it blocked us for weeks. |

**Reply (H1–H5):**

---

## 4. Sensing

Please answer with **specific values / part numbers**, not "yes — supported", for **each device
(A, B, C)** where they differ.

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

4. **Configurable output data rate (ODR).** We require **≥100 Hz; 200 Hz preferred for the head
   and pelvis during trot**. State supported rates, whether they can be changed **remotely**, and
   the achievable rate *while recording raw*.
   **Reply:**

5. **Noise density / RMS noise** for accel and gyro at our target ODR. State any on-chip
   filtering and whether it can be bypassed.
   **Reply:**

6. **Gyro bias drift with temperature** (Indian barns reach 45–50 °C), and whether a device can
   be **recalibrated in the field without removing it** from the horse.
   **Reply:**

7. **On-firmware activity classification** (standing / lying / walking / trotting / restless) —
   do you provide it, is it **equine-validated or generic**, and **can it be disabled**? We
   classify ourselves, so we need raw data regardless; we do not want firmware quietly
   pre-filtering it.
   **Reply:**

8. **Step counting** — equine-validated or adapted from human/cattle? State error at walk and
   at trot.
   **Reply:**

9. **Per-reading quality / confidence flag** — any validity, saturation or signal-quality
   indicator per sample or per batch, that we can carry into our data model?
   **Reply:**

10. **On-device summaries for the live link.** NB-IoT is too slow for continuous raw data. Can
    the hub (or each device) compute and send, **live**, per-minute summaries — steps, activity,
    lying/standing — and **per-stride** measures during trot (head and pelvis vertical-movement
    asymmetry, stride duration)? Or does it only forward raw data? If summaries are fixed by
    you, list them; if programmable, say how.
    **Reply:**

## 5. The live mobile link

11. **Modem and networks.** Module part number; **LTE-M / NB-IoT / fallback** modes; **bands**;
    networks you have **tested in India**; behaviour when no network is available.
    **Reply:**

12. **What is sent live, and how often.** Our target: summaries at least **once a minute** while
    the horse is active, and an **alert immediately** (e.g. device removed, no movement for a long
    time outdoors). State achievable intervals and **end-to-end latency** to our server.
    **Reply:**

13. **Protocol to our server.** MQTT or HTTPS; **TLS** version; **configurable endpoint and
    credentials** (per device or per fleet); **attach the payload schema** and a sample. Confirm
    it can be mapped to our contract `{horseId, metric, value, unit, ts, source, confidence}`.
    Is the schema versioned?
    **Reply:**

14. **SIM.** Physical SIM or eSIM; can we use **our own SIM / operator**; multi-operator
    profiles; who manages SIM provisioning. If you offer a connectivity platform, confirm it
    **does not hold or relay our data**.
    **Reply:**

15. **Data volume and cost.** Expected **MB per horse per day** in each mode (in the barn, during
    exercise), and the data plan you recommend.
    **Reply:**

16. **Link between the devices** (A and C to the hub B): radio (BLE version, Coded-PHY?), range
    on the horse, and what happens when the hub loses a device.
    **Reply:**

17. **In the barn.** Is there an optional **local path** (BLE / Wi-Fi to a gateway or our
    on-site computer) that saves mobile data while the horse is in its stall? If so, how do the
    devices switch between the local path and mobile?
    **Reply:**

## 6. Raw data, gaps and buffering

18. **How raw data reaches us.** The raw 100–200 Hz waveforms (especially of exercise and
    trot-ups): sent over the mobile link, or **offloaded in the barn** over BLE / Wi-Fi? State the
    **delay** before we have the raw data of a session, and the data volume per hour of raw.
    **Reply:**

19. **On-device buffering** — we require **≥24 h on every device** with **automatic backfill
    using the original timestamps** and acknowledged delivery. State capacity in **hours at
    100 Hz raw**, and whether it stores **raw or only summaries** when it cannot send.
    **Reply:**

20. **The exercise scenario.** A horse leaves the barn for **1–2 hours** of exercise; mobile
    coverage in the arena or on a ride is **patchy**. State exactly: what is **sent live**, what
    is **stored**, how and when **gaps are filled**, and whether anything can be **lost**.
    **Reply:**

## 7. Time synchronisation

21. **Timestamps on the device** or on receipt? State the **time source** (network time, NTP
    over the mobile link, GNSS), worst-case **drift over 24 h** while out of coverage, and how
    closely the **three devices on one horse are aligned** with each other. *We relate head and
    pelvis movement to the leg's stride, so we are targeting ≤10 ms between devices, and tens of
    milliseconds against our camera video.*
    **Reply:**

## 8. Location (optional)

22. **GNSS in the hub** for position, speed and distance during exercise and rides: available?
    Accuracy, power cost, and can it be **switched off** (privacy)?
    **Reply:**

## 9. Power

23. **Battery life for each device in each mode** — hub with live reporting every 1 minute and
    every 5 minutes; power-saving (PSM / eDRX) support; leg tag and pelvis sensor at 100–200 Hz
    raw recording. Chemistry/mAh; rechargeable or replaceable; charge time and cycle life.
    **Reply:**

24. **Charging operations for a whole yard** — multi-bay dock, hot-swap spares, how data gaps
    during a swap are handled, and how a replacement device is **re-bound to the same horse**.
    **Reply:**

## 10. Fit, welfare and environment

25. **IP rating — we require IP67 or better** on all three devices, validated against
    wash-down, mud, urine/manure and sweat. State operating temperature and humidity range (we
    need 45 °C+ and monsoon).
    **Reply:**

26. **Attachment** — leg tag to the cannon bone (sizes **pony → draft**), hub to a standard
    halter, pelvis sensor over the sacrum (pad, roller or adhesive). Expected strap and mount
    service life.
    **Reply:**

27. **Welfare** — weight and dimensions of each device, and any 24/7 wear assessment showing no
    rub sores or skin damage (leg and halter). Please share equine field-trial or welfare data.
    **Reply:**

28. **Loss prevention** — **tamper / detach alert**, sent **live by the hub** when a leg tag or
    pelvis sensor goes silent or comes off; your observed **device-loss rate per device-year**.
    **Reply:**

## 11. Identity and fleet management

29. **Unique immutable hardware ID** in every record (plus IMEI/ICCID for the hub); how the three
    devices are **paired** and how the set is **bound to a horseId** via API.
    **Reply:**

30. **Fleet management** — firmware **OTA over the mobile link**, battery/health monitoring,
    remote configuration (sample rates, reporting interval), and what data (if any) passes
    through systems you host.
    **Reply:**

## 12. Evaluation

We would like **3–5 leg tags + 2 halter hubs (with SIMs or eSIM profiles that work in India) +
1–2 pelvis sensors + a charging dock**, together with the **protocol documentation, payload
schema and sample code**, so we can validate on real horses before committing to a design.

**Reply (availability + lead time for evaluation hardware):**

## 13. Optional — equine validation data

If you hold any **equine** reference or validation data — step counts, lying time, gait
asymmetry, or **lameness measures against a veterinarian's lameness grading** — please share it.
Most devices are validated on cattle or humans; equine gait differs, and this would materially
reduce our modelling risk.

**Reply:**

---

---

## Response checklist

Please confirm each item is attached or answered, so we can evaluate in a single pass:

| | Item |
|---|---|
| ☐ | Every numbered question answered (or marked "not supported" / "N/A") |
| ☐ | All hard requirements (H-numbers) explicitly confirmed or declined |
| ☐ | Sensor / component **datasheets** for each device, and the **modem module** datasheet |
| ☐ | **Protocol document and payload schema** for the live link — the actual file |
| ☐ | **Sample live payload** and sample raw data, showing real field names and units |
| ☐ | **Networks and bands tested in India**, and **TEC / WPC / BIS** certificates (or their status) |
| ☐ | Expected **mobile data per horse per day** |
| ☐ | **ARM64 (aarch64) build** of any on-site software, or a plain statement that none is needed / none exists |
| ☐ | Sample code, if you provide any |
| ☐ | Evaluation-unit availability and lead time |
| ☐ | A named technical contact we can reach directly with any single clarification |

*If anything on this list genuinely cannot be shared before an order, please say which item and
why, so we can factor it in rather than assume the worst.*

*Commercial terms are not part of this RFI — we will discuss those separately once the
technical fit is confirmed.*
