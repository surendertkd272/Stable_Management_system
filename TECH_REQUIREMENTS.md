# BSV EquiCare — Technical Requirements

**Remaining sensor and infrastructure scope (monitoring points 1, 5, 6, 7, 8, 9, 10)**

Bharat Sports Venture — EquiCare engineering · September 2026

---

## 1. What we are building

A 24/7 monitoring system for stabled horses in India. Each stall is instrumented; sensors
feed an **on-site edge computer (NVIDIA Jetson, ARM64)**, and our software turns raw data
into health and behaviour insight.

**We do our own analytics.** We are not buying algorithms, dashboards or scoring engines.
We need **raw, timestamped, per-sensor data** and a documented way to read it on our own
hardware. Where a device computes its own classifications, those must be **disableable**,
and the raw stream must remain available regardless.

Every reading, from every sensor, is normalised into one record shape:

```
{ horseId, stallId, metric, value, unit, ts, source, confidence, meta }
```

If a device can be mapped onto that, it integrates. If it can only emit a proprietary
summary score, it cannot.

## 2. Scope of this document

The thermal camera is procured and integrated. It measures body temperature and
respiratory rate directly today. This document covers **everything else**.

| Monitoring point | Sensor track |
|---|---|
| 1 — Steps / locomotion | IMU leg tag |
| 5 — Activity | IMU (fused with optical) |
| 6 — Rest / lying time | IMU (fused with optical) |
| 7 — Lameness / limb-favouring | IMU leg tag |
| 8 — Stable vices (weaving, crib-biting, wind-sucking) | Microphone (+ optical) |
| 9 — Watering: quantity, pattern, time | Water metering |
| 10 — Feeding: quantity, pattern, time | Feed metering |
| *all 12* | Edge compute, network, power, enclosure |

---

## 3. Requirements that apply to every supplier

These are pass/fail and precede any product-specific discussion. A supplier who cannot
meet them cannot be integrated, regardless of how good the sensor is.

| # | Requirement | Why |
|---|---|---|
| **G1** | **Linux ARM64 (aarch64) support.** Any SDK, driver or library must be *built and tested* for aarch64 — not x86-64 only, not Windows/.NET only. An open protocol (Modbus, BLE GATT, ALSA, MQTT, serial) makes this a non-issue. | Our edge box is a Jetson. A previous supplier confirmed "Linux SDK — yes" and shipped an x86-64-only package with no ARM64 build available. It cost both sides weeks. |
| **G2** | **Raw time-series accessible** — not only vendor-computed summaries or scores. | Our gait, behaviour and acoustic models need the underlying waveform. A closed device returning an "activity score" cannot be used. |
| **G3** | **Any on-device analytics can be fully disabled.** | We run inference ourselves and must not have firmware silently pre-filtering the input. |
| **G4** | **No mandatory vendor cloud.** All data must be readable on the local network, with the entire path capable of running on-premise. | India DPDP-2023 data residency, and barns with unreliable rural internet. |
| **G5** | **Documented open protocol or API, supplied as an actual file** — register map, protocol spec, API reference. | We integrate directly. A capability we cannot verify against a document counts as unverified. |
| **G6** | **Timestamping and clock discipline.** State whether records are stamped at the device or on receipt, the sync method (**PTP preferred, NTP acceptable**), and worst-case drift over 24 h. | IMU, video, thermal ROI temperatures and audio must align on one timeline. We are targeting tens of milliseconds. |
| **G7** | **≥24 h local buffering with automatic backfill using original timestamps**, and acknowledged delivery. | Barns lose power and connectivity routinely. Data replayed with the wrong timestamps is worse than no data. |
| **G8** | **Per-reading quality / confidence indicator** — validity, saturation, settled-vs-moving, clip flag, or equivalent. | It carries into our data model and stops a bad sample being treated as a clinical finding. |
| **G9** | **India regulatory compliance** — BIS, and WPC/ETA radio approval for anything that transmits. | Legal deployment requirement. |
| **G10** | **Stable, documented data schema with units**, versioned, with a real sample payload. | Field names and units must be mappable to the record shape in §1. |

---

## 4. IMU leg wearable — points 1, 5, 6, 7

A leg-mounted tag (cannon bone) streaming raw motion data to the edge box. All step
counting, gait analysis, lameness detection and lying detection are done by us.

### Sensing

| Parameter | Requirement |
|---|---|
| Axes | **6-axis minimum** (3-axis accel + 3-axis gyro); 9-axis preferred |
| Accelerometer range | **≥ ±16 g** — a horse kicking or striking the stall wall clips lower ranges and corrupts exactly the data we need |
| Gyroscope range | **≥ ±2000 °/s** — no clipping at trot, canter or kick |
| Output data rate | **≥100 Hz, target 100–200 Hz**, configurable, and achievable *while streaming raw* |
| Noise | Noise density / RMS noise for accel and gyro at target ODR; any on-chip filtering must be bypassable |
| Temperature stability | Gyro bias drift across **45–50 °C**, and field recalibration **without removing the tag** from the horse |

State sensor part numbers and attach datasheets. On-firmware activity classification
(standing / lying / walking / trotting), if offered, must be declared as equine-validated
or generic, and must be disableable. Step counting must be stated as equine-validated or
adapted from human/cattle, with error at walk and at trot.

### Data path

- Transport (BLE GATT, Wi-Fi, proprietary radio → gateway, USB, serial), with the protocol
  document or register map attached.
- **Continuous streaming at ≥100 Hz**, or batch upload — if batched, state interval, payload
  format and throughput.
- If BLE: version, **Coded-PHY / Long-Range** support, TX power, and realistic range
  **through masonry and steel barn structure** — not open-field figures.
- If a gateway is required: model, **tags per gateway at raw sample rate**, uplink
  (Ethernet/PoE preferred), and a confirmed local-only path to our edge box.

### Power, fit and welfare

- **Battery life** at each mode (lying-detection only vs 100–200 Hz raw streaming);
  chemistry, mAh, charge time, cycle life.
- Charging operations for a whole yard: multi-bay dock, hot-swap spares, how data gaps
  during a swap are handled, and how a replacement tag is **re-bound to the same horse**.
- **IP67 or better**, validated against wash-down, mud, urine/manure and sweat; operating
  range must cover 45 °C+ and monsoon humidity.
- Attachment to the cannon bone, size range **pony → draft**, strap service life.
- **Weight target ≤50 g**, with any 24/7 wear assessment showing no rub sores.
- **Tamper / detach alert**, and observed tag-loss rate per tag-year in the field.
- **Globally unique immutable hardware ID** in every record, and a queryable API to bind
  tag → horseId.

---

## 5. Feed and water metering — points 9 and 10

### Water measurement

- **Measurement principle** — electromagnetic, ultrasonic, hall-effect, turbine inline, or
  load cell — and which is recommended for equine use.
- **Resolution and accuracy** — flow meter: **ml per pulse** and accuracy across the range.
- **Minimum measurable flow / cut-off**, in L/min and ml/min. A horse taking slow sips must
  register; a cut-off tuned for plumbing will miss it entirely.
- **Indian water conditions** — tolerance to **high-TDS groundwater and scaling**, plus hay
  and chaff fouling the vessel.
- **Refill vs. consumption** — the device must distinguish water *drunk* from water *added*.
- If load-cell based: can it separate **drinking from spillage, evaporation and play**, and
  what is the sampling rate and debounce? Horses nudge, lean on and bite buckets.

### Feed measurement

- **Dose resolution and accuracy in grams**, stated separately for **pellets**, **textured /
  sweet feed**, and **mash**.
- **Weigh-back / refusal** — the system must measure what the horse **actually ate**
  (offered minus refused), not only what was dispensed.
- **Forage / hay** — is a load-cell manger or haynet offered? State resolution.
- **Programmable per-horse schedule** (morning / midday / evening / free-choice), updatable
  remotely.
- **Dispense confirmation** — each dispense should emit a record with scheduled vs. actual.
- **Fault reporting** — hopper empty, bridging / jam, and motor stall must be reported as
  data, not left silent.

### Attribution

**Per-horse attribution is mandatory (G-level).** Either a dedicated per-stall vessel, or
RFID identification at a shared vessel. Per-horse trends are the entire clinical value; a
shared trough with no animal ID is unusable to us.

If RFID: state the standard — **LF 134.2 kHz ISO equine microchip**, UHF, or BLE — and the
read range and reliability while the animal is drinking or eating.

### Integration and operations

- **Interfaces** — Modbus RTU/RS-485, Modbus TCP, pulse / dry-contact, 4–20 mA, BLE, MQTT.
- **Event model** — continuous totals, or discrete bouts with start and end times? We need
  pattern and timing, not only daily volume.
- **Devices per edge box** — RS-485 addressing limits and throughput when ingesting water
  and feed across a barn.
- **Calibration** — procedure, frequency, whether barn staff can do it in the field;
  documented drift spec (zero and span, over temperature and time) and auto-tare behaviour.
- **Mechanical abuse rating** — kick, lean, crib, rub. Is a guard or recessed mount offered?
- **Hygiene** — water- and feed-contact parts must be removable and safe for daily
  disinfectant wash-down; **IP66/IP67 on housing *and* connectors/glands**, corrosion
  resistant, **food/potable-grade wetted materials**.
- **Power** — wired DC, PoE (state class and watts), mains or battery. PoE shares the barn
  power budget in §7.
- **Vessel capacity** (litres / kg), and whether a manual refill can be logged as such.
- **Remote firmware and config update** from the edge, without a site visit.

---

## 6. Microphone — point 8, and cough detection supporting 3–4

Stall audio for stable-vice detection (weaving, crib-biting, wind-sucking) and respiratory
sound. All classification is ours.

### The two requirements that decide everything

| # | Requirement | Why |
|---|---|---|
| **M1** | **Uncompressed PCM (or lossless) audio available to us** — not only AAC, Opus or G.711. | This is the single most important item in this section. Lossy voice codecs destroy exactly the transients we classify on: teeth-on-wood contact, the onset of a wind-suck, the sharp front of a cough. |
| **M2** | **AGC, noise suppression, echo cancellation and any noise gate can be FULLY DISABLED**, in favour of fixed or manual gain. | AGC flattens the level information that separates a cough from a door bang, and a noise gate deletes quiet breathing entirely. |

### Acoustic performance

- **Transducer type** — analog or PDM MEMS, electret, condenser — and which is recommended
  for a 24/7 barn.
- **Full frequency response curve with tolerance.**
- **Sensitivity, maximum SPL and Acoustic Overload Point.** The same channel must capture
  quiet breathing *and* a loud impact without clipping into uselessness.
- **Self-noise (EIN, dB-A) and SNR** for the realistic **mic + preamp + ADC chain**, not the
  bare transducer datasheet figure.
- **Effective pickup radius** — will it reliably catch quiet breathing and crib-biting from
  the stall mounting position?
- **Cross-talk between adjacent stalls**, with the polar pattern stated (omni / cardioid /
  shotgun / array). Attributing one horse's vice to its neighbour is a clinical error.
- **Direction-of-arrival / localisation**, if a multi-mic array is offered.
- **Wind, vibration and structure-borne noise mitigation** — windscreen, shock mount.

### Digital audio and interfacing

- **Sample rates and bit depths**, configurable. We require **≥16 kHz**; 32 or 48 kHz
  preferred.
- **How PCM reaches the edge box** — analog line, **USB Audio (UAC)**, or network.
- **Channel count per device**, and whether multiple mics can be captured **synchronised on
  a single edge box**.
- **Per-packet metadata** — timestamp, stall/channel ID, gain setting, **clip flag**.
- **End-to-end latency and jitter**, and the buffering / packet size.

### Environment, power and privacy

- **IP65+ and an IK (impact) rating**, sealed against **ammonia and urine vapour**, dust and
  wash-down; operating temperature and humidity, 24/7 rating, MTBF.
- **Power** — PoE (state class and watts), USB or DC, draw per unit.
- **Mounting** for stall ceiling or wall at **2.5–3.5 m**, out of the horse's reach.
- **Encryption in transit (TLS / SRTP) and at rest**, with authentication.
- **DPDP-2023** — stall audio can capture **staff speech**. Confirm audio can be processed
  and retained **entirely on-site**, with configurable retention and **no undisableable
  off-site upload**.

---

## 7. Edge compute, network and installation — all 12 points

The platform everything else runs on. We supply the software; we need the box, the network,
the power and the enclosure specified and installed for Indian barn conditions.

### Compute sizing — the central question

Per stall the load is **up to 3 × RTSP 1080p @ 25 fps** (IR / visible / fusion) decoded on
NVDEC, plus our models, plus IMU, audio and feed/water ingestion.

- **How many stalls per box?** Answer with a **measured benchmark** — GPU %, NVDEC %, CPU %,
  RAM and thermals — not a theoretical figure.
- **De-rating at temperature** — stalls per box at **45 °C ambient** versus 25 °C.
- **Storage** — NVMe capacity and endurance per box, with **power-loss protection**.
- Platform must be **NVIDIA Jetson (ARM64)**, Ubuntu 22.04+ / current JetPack.

### Network and power

- **PoE switch** per barn — per-port and total power budget with **≥25 % headroom**. Cameras,
  network microphones and any PoE feed/water device all draw from it.
- **Bandwidth** — per-stall and aggregate LAN load at 3 × 1080p @ 25 fps, for H.264 and H.265.
- **4G/LTE failover** — dual-SIM industrial router, Indian carriers and bands, with stated
  failover behaviour.
- **UPS sizing** — VA/Wh for a stated ride-through, and **clean storage-safe shutdown** with
  no NVMe corruption.
- **Full local operation during WAN/4G loss** — inference, alerting and buffering must
  continue with no internet.

### Physical install and commissioning

- **Enclosure** — IP rating, operating temperature, cooling approach (fanless vs filtered),
  rated for dust, **ammonia**, humidity, **45–50 °C**, insects/rodents and vibration. A
  standard office mini-PC enclosure will not survive.
- **Camera mounting** — the horse's head must be in frame at **~3.5 m** with a fixed-focus
  lens. Mounting geometry, brackets and sight lines.
- **Thermal ↔ visible alignment.** The camera vendor does **not** expose a visible→thermal
  coordinate mapping. State how you propose to establish and hold that alignment
  mechanically, since we must relate an ROI in one stream to a region in the other.
- **Zero-touch commissioning** — how a new site is brought up, including stall → camera →
  horse mapping.

### Ingestion of each modality

- **IMU** — BLE gateway hardware, tags per box and per gateway at 100–200 Hz raw, and
  realistic range through barn structure.
- **Audio** — recommended interface into the Jetson (PoE network mic / USB / I2S).
- **Feed / water** — RS-485 / Modbus, 4–20 mA, pulse and BLE inputs available per box, and
  how many devices each supports.

### Fleet, resilience and security

- **Platform-level health and failure detection** — dead camera, dropped BLE gateway, failed
  sensor. Silence must be detectable as silence.
- **Time discipline** — NTP source or PTP grandmaster, and how the box's clock is held
  accurate for the cross-modality alignment in G6.
- **Remote update and recovery** — how OS and firmware are updated and how a bricked box is
  recovered, for a handful of boxes at one site.
- **Edge security** — full-disk encryption, secure boot, TPM or secure-element key storage;
  how per-device credentials are provisioned and rotated.
- **Data residency** — all processing and storage on-premise in India. Any cloud sync only
  to an **India region** (e.g. GCP asia-south1), including OTA and telemetry.

### Deployment boundary

- **Deployment unit** — per barn, or per N stalls? Provide a **per-site bill of materials**.
- **Integration boundary** — state precisely what you deliver versus what BSV delivers, and
  what support looks like after handover.

---

## 8. Evaluation hardware

We validate on our own bench before committing to a design. For each track we would like
evaluation units together with the **SDK/driver, protocol documentation and sample code**
for Linux/ARM64:

| Track | Evaluation units requested |
|---|---|
| IMU | 3–5 tags + 1 gateway + charging dock |
| Feed / water | 1 water sensor + 1 weigh-back feeder |
| Microphone | 2 microphones + any required interface or PoE injector |
| Edge infrastructure | 1 edge unit configured for the pilot, with switch, router and UPS |

Please state availability and lead time.

---

## 9. What we need attached with a reply

So that we can evaluate in a single pass, without rounds of follow-up:

- Every requirement explicitly **confirmed or declined** — "not supported" is a perfectly
  good answer and costs nothing. A blank or skipped item we have to record as *not
  supported*, because we cannot tell the difference.
- Sensor and component **datasheets**.
- The **protocol document, register map or API reference** — the actual file.
- An **ARM64 (aarch64) build**, attached or as a download link — *or* a plain statement that
  none exists.
- A **sample data payload** showing real field names and units.
- Sample code, if any is provided.
- Evaluation-unit availability and lead time.
- A named technical contact we can reach directly.

We would far rather receive an honest reply with several "not supported" answers than an
optimistic one that unravels at integration.

*Commercial terms are not part of this document — those are discussed separately once
technical fit is confirmed.*
