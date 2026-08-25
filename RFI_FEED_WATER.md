# RFI — Feed & water intake sensing for equine monitoring (BSV EquiCare)

**To:** Feed / water metering vendor or systems integrator
**From:** Bharat Sports Venture — EquiCare engineering
**Covers client monitoring points:** 9 (watering — quantity, pattern, time), 10 (feeding — quantity, pattern, time)

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
**on-site edge computer** (NVIDIA Jetson). A change in water or feed intake is one of the
earliest indicators of illness, so we need **per-horse, timestamped consumption** — not daily
totals.

**All analytics and alerting are ours.** We need reliable measurement plus a documented way to
read it locally. We are open to either **inline flow metering** or **load-cell (weighed)
vessels** — and to buying **standard industrial components** rather than a packaged product,
if that gives us cleaner data access.

## 2. Hard requirements — please confirm these first

Pass/fail for us. If any cannot be met, please say so plainly rather than leaving it blank.

| # | Requirement | Why |
|---|---|---|
| **H1** | **Open, documented local protocol** — Modbus RTU/TCP, RS-485, pulse/dry-contact, 4–20 mA or MQTT — with the **register map / protocol document supplied with your reply**. | We integrate directly on our edge box. |
| **H2** | **Linux ARM64 (aarch64 / NVIDIA Jetson).** If you supply a driver or library it must be built and tested for aarch64 — **not Windows/.NET-only, not x86-64-only**. Open protocols make this a non-issue; tell us which applies. | A previous vendor shipped x86-only binaries and could not rebuild — weeks lost. |
| **H3** | **No mandatory vendor cloud.** All data readable on the local network. | India DPDP-2023 residency; unreliable rural internet. |
| **H4** | **Per-horse attribution** — a dedicated per-stall vessel, or RFID identification at a shared vessel. | Per-horse trends are the entire clinical value. A shared trough with no animal ID is unusable for us. |
| **H5** | **Wash-down rated with safe wetted materials** — **IP66/IP67** on housing *and* connectors/glands, corrosion-resistant, **food/potable-grade** parts in contact with water or feed. | Daily high-pressure wash-down; animal safety. |

**Reply (H1–H5):**

---

## 3. WATER — measurement

Answer with **specific values**, not "yes — supported". Please answer for whichever approach
you supply, and say which you would recommend for horses.

1. **Measurement principle** — electromagnetic / ultrasonic / hall-effect / turbine inline
   meter, or load-cell vessel? *We prefer no or low moving parts.*
   **Reply:**

2. **Resolution and accuracy.** Flow meter: **ml per pulse** and accuracy across
   **0.1–8 L/min**. Load cell: **resolution in grams**, capacity, and drift over 24 h.
   **Reply:**

3. **Minimum measurable flow / cut-off**, in L/min and ml/min. A horse taking slow sips must
   not read as zero — state the threshold below which nothing is reported.
   **Reply:**

4. **Indian water conditions** — tolerance to **high-TDS groundwater and scaling**, plus hay
   debris and bio-fouling. State the cleaning/service interval.
   **Reply:**

5. **Refill vs. consumption.** Can the device distinguish **water being drunk** from **the
   vessel being refilled**, and log them as **separate timestamped events**? This is essential
   — otherwise a refill looks like a horse drinking 20 L in one go.
   **Reply:**

6. **Load-cell option:** can it separate **drinking** from **spillage, evaporation and play**?
   If not, state the expected daily error from evaporation.
   **Reply:**

7. **Load-cell sampling rate and debounce** — horses nudge, lean on and bite buckets. How are
   those transient spikes rejected without losing genuine drinking events?
   **Reply:**

## 4. FEED — measurement

8. **Dose resolution and accuracy in grams**, stated separately for **pellets**, **textured /
   sweet feed** and **loose grain** if they differ. Does dosing hold accuracy in **monsoon
   humidity**?
   **Reply:**

9. **Weigh-back / refusal.** Can the system measure **what the horse actually ate** (offered
   minus leftover), or only what was dispensed? *Refusal is our single strongest early-illness
   signal, so a dispense-only feeder is of limited use to us.* State how leftovers are measured.
   **Reply:**

10. **Forage / hay.** Do you offer a **load-cell manger or haynet**? State resolution and
    capacity, and whether consumption can be separated from wastage. *Horses eat mostly forage,
    so a concentrate-only feeder covers the minority of intake.*
    **Reply:**

11. **Programmable schedule per horse** (morning / midday / evening / free-choice), updatable
    **via the local API** — not only a front panel or cloud portal.
    **Reply:**

12. **Dispense confirmation** — does each dispense emit a record with scheduled vs. actual
    time, grams delivered and status?
    **Reply:**

13. **Fault reporting** — are **hopper empty**, **bridging/jam**, **motor stall** and
    **under/over-run** reported as **distinct alarms** over the protocol? Please list the fault
    codes.
    **Reply:**

## 5. Attribution

14. **Dedicated per-stall vessel, or shared?** If shared, how is intake attributed to an
    individual animal?
    **Reply:**

15. **If RFID:** which standard — **LF 134.2 kHz ISO equine microchip**, UHF, or BLE? State
    read reliability *while the animal is actually feeding* (head down, moving), and confirm the
    animal ID is emitted with **every** event.
    **Reply:**

## 6. Integration

16. **Interfaces available** — Modbus RTU/RS-485, Modbus TCP, pulse/dry-contact, 4–20 mA, BLE,
    Wi-Fi, Ethernet, MQTT. **Please attach the full register map**, baud rates and
    devices-per-bus limit.
    **Reply:**

17. **Event model.** Do you output **continuous totals**, or **discrete bouts** with start,
    end, duration and volume/grams? *We need timestamped bouts to analyse pattern and timing,
    not just a daily counter.*
    **Reply:**

18. **Timestamping** — onboard RTC or edge-stamped? State RTC sync method (**PTP preferred,
    NTP acceptable**) and drift over 24 h. *We fuse this with video, thermal and audio.*
    **Reply:**

19. **Local buffering and backfill** — **≥24 h** onboard, replayed with original timestamps
    after a network or power outage. State onboard depth.
    **Reply:**

20. **Per-reading status/confidence flag** — in-range, settled vs. in-motion, dispense
    verified, sensor fault?
    **Reply:**

21. **Devices per edge box** — RS-485 addressing limits and throughput when ingesting water +
    feed from multiple stalls on one bus.
    **Reply:**

## 7. Calibration, environment and operations

22. **Calibration** procedure and frequency; can barn staff do it in the field; is it
    accessible from Linux over the protocol?
    **Reply:**

23. **Documented drift spec** (zero and span, over temperature and time), **auto-tare between
    fills**, and temperature effect across **5–50 °C** with any onboard compensation.
    **Reply:**

24. **Mechanical abuse rating** — kick, lean, crib, rub. Is a **guard or recessed mount**
    available, with electronics out of the kick/chew/wash zone?
    **Reply:**

25. **Hygiene** — are water/feed-contact parts **removable and disinfectant-safe daily
    without re-calibration**?
    **Reply:**

26. **Power** — wired DC, PoE (state class and watts), mains or battery? *If PoE, note it
    shares the barn switch budget with our cameras.*
    **Reply:**

27. **Vessel capacity** (litres of water / kg of feed), and can a **manual refill be logged as
    an event** with operator identity and time?
    **Reply:**

28. **Remote firmware/config update** from the edge (schedules, recalibration) without
    per-stall physical access; does it work offline?
    **Reply:**

## 8. Interim manual logging

29. Sensors will not be installed on day one. Can manually-entered feed/water amounts be
    recorded through the same interface, carrying the same schema
    (`{…, source:'manual', confidence}`), so the eventual sensor upgrade is seamless?
    *If not, we will handle this in our own software — just confirm.*
    **Reply:**

## 9. Evaluation

We would like **1 water sensor + 1 weigh-back feeder** as evaluation units, with the
**protocol documentation / register map and sample code**, so we can validate on our Jetson
bench before committing to a design.

**Reply (availability + lead time for evaluation hardware):**

## 10. Optional — field validation

Any **field-validation data with horses or comparable livestock** (real-world accuracy
sustained over weeks, not a lab figure) would be valuable to us.

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
