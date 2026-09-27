# Reading the 8 camera points from video: research and what was built

*27 September 2026 · BSV EquiCare · stall camera TPC-B3404-ILP (thermal 640×512, 25 mm lens; colour 1080p, 4 mm)*

We researched about 150 open-access sources on how to detect each of the eight camera points from stall video and turn them into alerts. This document summarises what that research found, what we built from it, and what can honestly be said at the demo.

## The short version

- **No published system does what EquiCare does.** No one has published thermal-camera behaviour detection for horses with measured accuracy. No video system has published colic accuracy; every colic detection figure comes from motion sensors worn by the horse. Nothing detects horse weaving, crib-biting, box walking, urination or defecation automatically. Vendors (StableGuard, Horcery, NOVOSTABLE, Nightwatch, HorseWise) claim these features but publish no validation.
- **The same methods are proven on other animals, so we copied them:**
  - dairy cows: lying down and getting up;
  - mice: urine and faeces on a thermal camera;
  - zoo animals: stereotypic pacing;
  - calves: breathing from a thermal camera.
- **The thermal picture sees only part of the horse.** With the 25 mm lens the thermal view is about 25° × 19°, which is **1.5 m × 1.2 m at 3.5 m**: one horse's head and neck. The colour lens sees the whole stall, day and night. So:
  - temperature and breathing come from the thermal view, aimed at the head;
  - activity, lying and vices come from the colour picture.
- **No published thresholds exist** for most alerts: rolls per hour, a lying time limit, weaving rhythm, urinations per day, "no manure for X hours", or an eye-temperature fever line. Every alert therefore compares the horse with its own normal, and each threshold is marked as our choice, to review with a vet.

## Point by point

### 1. Body temperature

**Research**
- Infrared eye temperature averages about 35 °C, roughly 2 °C below rectal. One study found no significant correlation with rectal temperature; another found it tracked rectal temperature and stress after transport.
- The camera needs a side-on view, with the eye covering at least 5×5 real pixels.
- Wind lowers the reading by 0.4–0.8 °C, and sun raises it by about 0.6 °C.
- There is a daily rhythm of about 1 °C.
- Stress raises eye temperature just as fever does.

**Built**
- Alerts compare the reading with the horse's own 7-day baseline: +1.0 °C gives a watch note, +1.5 °C an alert that says to confirm with a rectal thermometer.
- With no baseline, only a reading at the rectal fever line (38.6 °C) alerts, because the eye is cooler than the core.
- Before this change, a healthy 35 °C eye would have triggered a "Low body temperature" alarm all day.

**Not yet**
- Baselines split by time of day.
- Correction for ambient temperature (needs a stall temperature sensor).

### 2. Respiration pattern

**Research**
- Normal horse breathing already has two phases.
- Detecting heaves from nostril heat has not been validated anywhere.

**Built**
- Regularity is measured from breath-to-breath intervals.
- Fast breathing is labelled "fast" rather than folded into a normal-looking rate.

**Claim**: regular or irregular only. **Do not claim** detection of breathing disease.

### 3. Respiratory rate

**Research**
- A thermal camera on the nostril gets about 3% error in calves.
- Published methods agree on the approach:
  - use the mean over a tracked region, never the sum;
  - use 30–60 s windows;
  - apply a signal-quality check;
  - report nothing when quality is low.
- Horses pant at 60–120 breaths/min in heat stress.

**Built**
- The nostril box is compared against the skin around it, which cancels the camera's automatic brightness changes.
- Readings are taken only over 30 s or more with the head still.
- A rate is reported only when it agrees with a count of breaths.
- Panting is reported as "fast".
- An optional flank box on the colour picture gives a second estimate.

### 4. Activity and abnormal behaviour

**Research**
- Movement measurement is sound: a Japanese thermal foaling system caught 95% of 115 foalings using movement. It also alerted on 28–41% of mares in the days before foaling, so expect false alarms.
- No published video detector exists for rolling or for a horse stuck and unable to rise (cast).

**Built**
- Activity is read from the colour picture and compared with the horse's own week.
- Moments when the infrared lamp switches on are ignored.
- "Possible roll" and "possibly cast" are our own rules, shown as watch notes.

### 5. Resting pattern

**Research**
- Dairy research found lying down and getting up from how the animal's outline box changes over time: 92% of get-ups and 80–87% of lie-downs.
- Telling chest-lying from flat-on-the-side has worked only once, using high-resolution colour video and a graphics card.

**Built**
- The horse's box comes from the YOLOX-tiny detector (Apache-2.0 licence; one-time setup) and is tracked over time.
- Each stall learns its own standing and lying box shapes from its own data.
- It reports lying minutes, bouts, the longest bout, lying between midnight and 04:00, and nights with almost no lying.

**Detector test on 60 open photos, in greyscale**

| Photo type | Found |
|---|---|
| Whole horse standing in a stall | 7 of 7 |
| Lying on the chest | 13 of 14 |
| Flat on the side | **0 of 4** |

Because of that last result, a lying horse the detector loses is counted as "possibly flat on the side".

### 6. Stable vices

**Research**
- A zoo study detected stereotypic pacing by tracking position and checking for a rhythm: 96.7% precision.
- No verified weaving frequency exists. Weavers average 67 minutes a day, mostly at the door.
- Crib-biting makes one kind of colic about **67 times more likely**.
- Stable staff report vices in 5% of horses when 37% actually have them, which is the case for continuous monitoring.

**Built**
- **Weaving**: a regular, persistent, mostly sideways rhythm between 0.25 and 2 Hz.
- **Box walking**: repeated laps of the stall.
- **Head tossing**: a regular nodding rhythm while the horse stays in place. Irregular tossing is left out, because it points to discomfort or flies.
- Each vice is reported as minutes and episodes per day against the horse's own level, with a flag for a new vice.

**Not yet**: crib-biting, which needs a trained model or a microphone.

### 7–8. Urination and excretion

**Research**
- A mouse thermal system (DeePosit) reached F1 0.88 for urine and 0.90 for faeces. It looks for a new warm spot that then cools, and ignores spots under the animal.
- Pig urine puddles cool to floor temperature in about 10 minutes.
- No data exists on how horse urine or manure cools on bedding.

**Built**
- A floor cell is flagged only when it rises sharply above its own recent temperature. The comparison waits until the horse has stepped off the cell.
- Urine and manure are told apart by how fast the patch cools.
- The detector ignores spills (never warm), sun patches (warm too slowly) and body prints (too big, where the horse lay).
- It flags manure under half the horse's usual daily count, and reminds staff to check feeding, because fasting alone cuts manure output by 55–63%.

**Calibration**: the floor cooling test (see below) measures cooling on the stable's own bedding with warm water and fresh manure.

**Limit**: the floor must be inside the thermal view. With the head filling that view, one camera usually cannot cover both.

## What we tested, and how

| What | Test | Result |
|---|---|---|
| Behaviour signals (synthetic video) | weaving vs irregular sway vs nodding; box walking; lamp switching; breathing with head movement; brightness steps; panting; noise | all pass |
| Posture tracker (synthetic box series) | learning, lie-down timing (±10 s), flat on the side, roll, cast, a long quiet lie that is *not* a cast | all pass |
| Floor detector (synthetic temperatures) | urine, manure, spill, sun patch, body print, a deposit hidden under the horse | all pass |
| Edge agent end to end (fake camera) | which readings, from which stream, with which flags; empty stall reports nothing | all pass |
| Horse detector | 60 openly licensed photos, greyscale | see point 5 |
| Server and alerts | 169 tests: watch notes fire when they should and stay quiet otherwise; prototype data never raises an alarm | all pass |

**None of this has been verified on a live horse.** At the demo it should be presented as a prototype that is honest about what it has and has not seen.

## What was fixed along the way

- **Eye temperature:** alerts used rectal limits on a reading taken at the eye's surface. This is now baseline-relative.
- **Wrong source label:** colour-video behaviour was being stored as a validated thermometry reading, which would have let it count towards the colic alarm. It now stays a prototype source.
- **Motion blind spot:** comparing each frame only with the frame one second earlier cannot see a one-per-second rhythm. Frames are now also compared with the one half a second earlier.
- **Baseline length:** a 3-day baseline was counted by calendar dates, so 41 hours of data could pass as three days. It is now counted in hours.

## At the stable

1. **Once, before the demo:** run `scripts/demo.sh --setup-detector` to turn on lying-down detection. It needs internet and downloads about 70 MB.
2. **Calibrate:** eye box, nostril box, and the breathing check against a hand count. Optionally add a flank box on the colour picture.
3. **Floor cooling test** (if the floor is in the thermal view):
   1. Press Start.
   2. Pour 1–3 L of water at about 38 °C, wait until it reads "measured", then save it as urine.
   3. Repeat with about 2 kg of fresh manure and save it as manure.
4. **Record and label footage.** Every horse model trained elsewhere failed on our stalls, including our own zebra model (24%). Real accuracy needs labelled footage from our own camera: plan on 5–10 nights per horse, across several horses.

## Main sources

- Giannone et al. 2026, *Veterinary Quarterly*: YOLOv8 stall monitoring. https://pmc.ncbi.nlm.nih.gov/articles/PMC13126938/
- Adriaens et al. 2022, Wageningen: lying down and getting up from box features. https://edepot.wur.nl/584493
- DeePosit 2025: thermal detection of urine and faeces deposits. https://pmc.ncbi.nlm.nih.gov/articles/PMC12393880/
- Umamori thermal foaling system 2026, *Animals*. https://pmc.ncbi.nlm.nih.gov/articles/PMC13406051/
- Yang et al. 2025: stereotypy detection by tracking and periodicity. https://doi.org/10.1002/ece3.72304
- Improved SlowFast 2024, *Sensors*: chest vs flat lying. https://pmc.ncbi.nlm.nih.gov/articles/PMC11645009/
- Na Lampang et al. 2023, *Vet World*: eye infrared vs rectal temperature. https://pmc.ncbi.nlm.nih.gov/articles/PMC10844792
- Lowe et al. 2019: infrared respiratory rate in calves. https://pmc.ncbi.nlm.nih.gov/articles/PMC6720651
- Kelemen et al. 2021: lying time, bouts and REM deprivation. https://pmc.ncbi.nlm.nih.gov/articles/PMC8614510/
- Zimmer et al. 2026: sleep architecture and lying (EEG). https://pmc.ncbi.nlm.nih.gov/articles/PMC13491436/
- Maskato et al. 2020: Equine Acute Abdominal Pain Scale. https://pmc.ncbi.nlm.nih.gov/articles/PMC7760242/
- Torcivia & McDonnell 2021: Equine Discomfort Ethogram. https://pmc.ncbi.nlm.nih.gov/articles/PMC7931104/
- Hausberger et al. 2009: stereotypy definitions. https://pmc.ncbi.nlm.nih.gov/articles/PMC2763287/
- Williams et al. 2015: pasture to stable, faecal output. https://pubmed.ncbi.nlm.nih.gov/24528106/
- Merck Veterinary Manual: colic, behaviour problems, urolithiasis, heaves.

The full source list for each point is in the app's **Behaviour guide** page and in `server/knowledge.mjs`.
