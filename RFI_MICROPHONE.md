# RFI — Stall audio capture for equine monitoring (BSV EquiCare)

**To:** Industrial / network / bioacoustic audio vendor
**From:** Bharat Sports Venture — EquiCare engineering
**Covers client monitoring point:** 8 (stable vices — weaving, crib-biting, wind-sucking), plus respiratory sound (cough) supporting points 3–4

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
**on-site edge computer** (NVIDIA Jetson). We need **per-stall audio** so our models can
detect specific acoustic events:

- **crib-biting** — teeth on wood/metal: a sharp, broadband transient
- **wind-sucking** — a characteristic grunt/gulp
- **coughing** — respiratory irritation
- **weaving** — rhythmic footfall and rocking

**All detection runs on our edge box.** We need clean, uncompressed, timestamped audio — not
your sound-classification output.

## 2. Hard requirements — please confirm these first

Pass/fail for us. If any cannot be met, please say so plainly rather than leaving it blank.

| # | Requirement | Why |
|---|---|---|
| **H1** | **Uncompressed PCM (or lossless) audio available to us** — not only AAC / Opus / G.711. | This is the single most important item. Lossy voice codecs destroy exactly the transients — teeth-on-wood, cough onset — that our models depend on. |
| **H2** | **AGC, noise suppression, echo cancellation and any noise gate can be FULLY DISABLED**, in favour of fixed/manual gain. | AGC flattens the level information we use to separate a cough from distant noise; a noise gate would delete quiet breathing entirely. Voice-optimised DSP actively harms us. |
| **H3** | **Linux ARM64 (aarch64 / NVIDIA Jetson, Ubuntu 22.04+).** Either a standard **ALSA/PipeWire** device or a documented C/C++/**Python** API. | Our edge box is a Jetson. A previous vendor shipped x86-only binaries with no Python binding and could not rebuild — weeks lost. |
| **H4** | **No mandatory vendor cloud; no raw audio off-site.** | Stall audio can capture **staff speech**. Under India DPDP-2023 it must stay on-site with configurable retention and no undisableable phone-home. |
| **H5** | **Any on-device analytics can be disabled** — the raw stream must always be available. | We run inference ourselves. |

**Reply (H1–H5):**

---

## 3. Acoustic performance

Please answer with **specific values / part numbers**, not "yes — supported".

1. **Transducer type** — analog or PDM MEMS, electret, condenser — and which you recommend for
   an unattended Indian stall (0–50 °C, high humidity, dust, ammonia). **Part number +
   datasheet.**
   **Reply:**

2. **Full frequency response curve** with tolerance. We need usable response across
   **50–500 Hz** (respiration, grunt, crib wood-contact), **500 Hz–4 kHz** (cough, wind-suck
   gulp) and up to **8–12 kHz** (teeth-on-wood transients).
   **Reply:**

3. **Sensitivity and maximum SPL / Acoustic Overload Point.** The same channel must capture a
   quiet **~30 dB breath at 2–3 m** *and* a **>100 dB** crib-bite or whinny **without
   clipping**. Please state both ends.
   **Reply:**

4. **Self-noise (EIN, dB-A) and SNR** — for the realistic **mic + preamp + ADC** chain, not the
   capsule alone. A resting horse breathing at 2–3 m is a very low-level signal.
   **Reply:**

5. **Effective pickup radius** — will it reliably catch quiet breathing and crib-biting
   **anywhere in a ~3.5 × 3.5 m stall**? State the recommended mounting height and distance.
   **Reply:**

6. **Cross-talk between adjacent stalls.** State the polar pattern (omni / cardioid / shotgun /
   beamforming array) and **off-axis rejection figures in dB** — a cough from the next stall
   must not be misattributed to this horse.
   **Reply:**

7. **Sound-source localisation / direction-of-arrival**, if you offer a multi-mic array —
   angular resolution and capsule count.
   **Reply:**

8. **DSP in the signal path** — high-pass, compression, limiting, noise gate. Can **each** be
   disabled individually? Please be specific; a limiter left on will distort our peaks.
   **Reply:**

9. **Wind, vibration and structure-borne noise mitigation** — windscreen, shock mount,
   high-pass. Stall walls transmit impact noise, so this matters.
   **Reply:**

## 4. Digital audio and interfacing

10. **Sample rates and bit depths** available and configurable. We require **≥16 kHz** (32 or
    48 kHz preferred) at **16-bit or better**.
    **Reply:**

11. **How does PCM reach the edge box?** State the transport — analog line, **USB Audio (UAC)**,
    **I2S/PDM**, **PoE network mic (RTSP/RTP)**, ONVIF audio, Dante/AES67 — with cable type and
    maximum run for each. **Please attach the interface documentation.** If RTSP, confirm an
    **uncompressed/lossless (L16/PCM)** payload option.
    **Reply:**

12. **Channel count per device**, and whether **multiple mics can be captured synchronised on a
    common clock**. Is an aggregation box needed, or does each terminate at the Jetson?
    **Reply:**

13. **Per-packet metadata** — timestamp, stall/channel ID, gain setting, **clip flag**, sample
    rate. We want to carry these into our data contract.
    **Reply:**

14. **End-to-end latency and jitter**, and the buffering/packet size.
    **Reply:**

## 5. Time synchronisation

15. **Per-sample or per-packet timestamping** — is it done at the device? State **NTP and/or
    PTP** support with accuracy and jitter.
    *A detected cough must line up with the video frame that shows which horse coughed, and
    with the thermal respiration trace — we are targeting tens of milliseconds.*
    **Reply:**

16. **Local store-and-forward** if the link drops — how long, and is it backfilled **without
    timestamp gaps**?
    **Reply:**

## 6. Environment, power and mounting

17. **IP65+ and IK (impact) rating.** Confirm sealing against **ammonia/urine vapour**, dust and
    wash-down, and **chew/tamper resistance**. Critically: **how is the acoustic port protected
    without destroying high-frequency response?** Please explain the approach.
    **Reply:**

18. **Operating temperature and humidity; 24/7 rating; MTBF.** Include
    **anti-condensation/anti-fungal** provision for monsoon conditions.
    **Reply:**

19. **Power** — PoE (state class and watts), USB or DC, and draw per unit. *Note it shares the
    barn PoE + UPS budget with our cameras.*
    **Reply:**

20. **Mounting** for stall ceiling or wall at **2.5–3.5 m**, out of the horse's reach. Brackets
    available? Impact-resistant housing?
    **Reply:**

## 7. Security and privacy

21. **Encryption in transit** (TLS / SRTP) and at rest; authentication; per-stream isolation if
    you host anything. Signed OTA firmware?
    **Reply:**

22. **DPDP-2023 specifics** — confirm audio can be processed and retained **entirely on-site**,
    that retention is configurable with auto-delete, that access is logged, and that **nothing
    requires a non-India cloud** (including OTA and telemetry). If you support **on-device
    feature-only or redacted output**, please describe it.
    **Reply:**

## 8. Evaluation

We would like **2 evaluation microphones plus any required interface or PoE injector**, with
the **driver or interface documentation and sample code** for Linux/ARM64, so we can validate
real recording quality on our Jetson bench.

**Reply (availability + lead time for evaluation hardware):**

## 9. Optional — references and recommendation

If you have deployed audio in **livestock, veterinary, bioacoustic or noisy-industrial**
settings, we would welcome your recommendation on mic model and placement for a
3.5 × 3.5 m stall, plus any **sample recordings** from a comparable environment.

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
