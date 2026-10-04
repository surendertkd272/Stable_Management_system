# Clinical research on horses: what it says, and what it means for EquiCare

The behaviour research ([HORSE_BEHAVIOUR_RESEARCH.md](HORSE_BEHAVIOUR_RESEARCH.md)) covered what behaviours mean. This review goes deeper into the clinical studies: how often each problem happens, what predicts it, how accurate each sign is, and how well monitoring has been validated. It was done in October 2026 for the RVC deployment.

**Status: all 8 areas done.**

| Part | Area |
|---|---|
| A | Colic and the gut |
| B | Lameness, orthopaedic pain and laminitis |
| C | Vital signs and heat |
| D | Breathing and infectious disease, India first |
| E | Behaviour, sleep and welfare |
| F | Foaling and the newborn foal |
| G | How accurate monitoring technology is, and how to validate it |
| H | Nutrition, working horses and mules |
| I | **What all this means for EquiCare** (start here if short of time) |
| J | What nobody has published yet |

**How far to trust this:**
- **Sources:** veterinary and scientific journals, searched through Europe PMC, PubMed, Crossref and Semantic Scholar. Web searches were used only for Indian law, guidelines and grey literature.
- **Depth of reading:** most papers were read as abstracts. Full text is marked where the paper itself was read.
- **Checked:** 67 of the cited papers were checked against the Crossref DOI registry. All exist under the stated title and journal; a few years were corrected.
- **Grades:** each finding is graded **S** (strong: several good studies or a consensus statement), **M** (moderate) or **W** (weak: one small study, a secondary source or grey literature).
- **Our suggestions:** where this document says "EquiCare could…", that is our suggestion, not a published threshold.

### The twelve findings that matter most

1. **Eye temperature is not body temperature.**
   - It runs about 2 °C below rectal temperature. Two field studies found no correlation with it [V1, V2].
   - Season and farm alone shift a horse's eye reading by up to 2.4 °C.
   - It only means something as a change from the same horse's own normal [C, V].
2. **The "°F + humidity" heat index (130/150) has no traceable source.**
   - Resting, acclimatised horses tolerate much more heat than exercising ones.
   - In an Indian summer the 150 line will be crossed most days [V].
3. **No published study shows a horse's behaviour warning of illness days ahead.**
   - Dairy cattle show 1–5 days of warning; horses are unstudied [E].
   - Foaling is the only proven case, and its lead time is about 1–3 hours [F].
4. **Horses hide pain while people are present.**
   - Discomfort behaviour fell 77% during carer visits [A].
   - A camera that watches when nobody is there sees more than a stable check does.
5. **Combined signs beat any single sign.** This holds for colic, foaling and every monitoring study.
   - Single foaling behaviours were right only 3–13% of the times they fired [F].
6. **False alarms are the biggest practical risk.** At realistic event rates, even 99% specificity means most alerts are false [G].
7. **Weight shifting is the best stall sign of laminitis and limb pain.** EquiCare does not yet measure it [B].
8. **About 70–83% of sound horses exceed the standard 6 mm / 3 mm lameness-sensor thresholds** [B]. Only a change from the horse's own baseline means anything.
9. **India has scheduled (notifiable) equine diseases under the 2009 Act**, including glanders, surra, influenza, EHV and piroplasmosis [D].
   - On suspicion the law requires reporting and segregation.
   - Glanders is still present in India.
10. **Fever is the earliest sign of influenza, EHV-1 and strangles.** Strangles shedding starts 24–48 h after the fever.
    - New arrivals should be isolated for 3 weeks with daily temperatures [D].
11. **Long transport (over 20 h) brings shipping fever.** Fever peaks 20–49 h after departure.
    - A rectal thermometer alone missed 97% of horses with early inflammation after air transport [H].
12. **A 3-day "own normal" is too short.**
    - Horses take several nights to settle in a new stall, and day-to-day variation is large.
    - A rolling 7–14-day baseline is better supported [E].

---

## Part A. Colic and the gut

### How common it is

- **USA national survey** (21,820 horses):
  - 4.2 colic episodes per 100 horses per year.
  - 1.4% of episodes went to surgery; 11% ended in death [C1] **S**.
- **Prospective farm study** (1,427 horses):
  - 10.6 episodes per 100 horse-years.
  - Colic caused 28% of all deaths; 75% of episodes were mild [C2] **S**.
- **Michigan** (3,175 horses), 3.5 episodes per 100 horse-years [C3]:
  - Type: 64% non-specific, 17% impaction, 9% spasmodic, 5% sand, 3% gas.
  - Deaths: 31% of surgical cases, 10% of the rest.
- **British military working horses** (717 horses over 5 years) [C4] **M**:
  - 11.1 episodes per 100 horse-years, but only 3% went to surgery.
  - 23% of horses had at least one episode, and 35% of those had another.
- **What vets find at the first visit** (UK, 1,016 colic calls) [C5] **S**:
  - 24% of cases were "critical" (hospital, surgery or death). 70% of the critical horses were put down at that first visit.
  - 57% never got a definite diagnosis.
- **Surgery** (300 cases): 70% survived to discharge, and 83% of those that woke from anaesthesia [C7] **M**.

**For a 100-horse RVC unit:** expect roughly 4–11 colic episodes a year. Most will be mild; a few will be critical.

### What raises the risk

Odds ratios (OR) are mostly from the 2019 systematic review [C8]. An OR of 5 means about five times the odds. The confidence intervals are wide, so the size of each effect is uncertain, though the direction is not.

| Risk factor | Odds ratio |
|---|---|
| **Feed changes** | |
| New batch of hay in the last 2 weeks | 4.9–9.8 |
| Diet change in the last 2 weeks | 2.2–5.0 |
| Concentrate 2.5–5 kg a day | 4.8 |
| Concentrate over 5 kg a day | 6.3 |
| **Housing, work and transport** | |
| Change of housing in the last 1–2 weeks | 2.3–3.9 |
| Each extra hour stabled per day | 1.16 |
| Change in exercise | 9.3 |
| Transport in the last 24 h | 17.5 |
| **Water** | |
| No access to water | 2.2 |
| Drinking less than usual | 5.0 |
| **Weather** | |
| Weather change in the last 3 days | 3.2 (one UK study found no link) |
| **The horse itself** | |
| Crib-biting / wind-sucking: gut trapped in the abdomen | 67–72 |
| Crib-biting / wind-sucking: colon blockage | 89 |
| Crib-biting / wind-sucking: colic coming back | 10–12 [C8, C11] |
| Colic before | 3.6–5.7 |
| Severe dental disease | 6.8 |
| Tapeworm | about 15 |
| No regular worming | 2.2 |

**Moving from pasture into a stable** [C9] **M**:
- Drinking rose from 2.4 to 6.4 L per 100 kg a day.
- Dung output fell by about 60%, lowest on day 3, and was drier.
- Gut movement was lowest on day 2 and back to normal by day 5.

**Military horses in a hot, humid climate** (Brazil, 770 horses) [C12] **M**:

| Risk factor | Odds ratio |
|---|---|
| Kept confined | 3.6 |
| Concentrate over 6 kg a day | 2.6 |
| Age over 16 | 2.1 |

### Which signs predict a bad case

**Pain scales:**
- **EAAPS** (a 0–5 colic pain scale) [C13, C14] **M**:
  - Vets agree on it well (0.80).
  - It separates colic from no colic well (AUC 0.85; AUC runs from 0.5, a coin toss, to 1.0, perfect).
  - It only moderately predicts surgery (AUC 0.69).
  - Its levels: 1 looking at the flank; 2 stretching or restless; 3 pawing or kicking at the belly; 4 trying to lie down, crouching or lying flat; 5 rolling.
- **EQUUS-COMPASS / EQUUS-FAP** [C15, C16] **M** (small numbers):
  - Agreement between observers is high (0.98 and 0.93).
  - The whole-body score catches 87% of colics and correctly clears 71% of healthy horses.
  - The face-only score catches 77% and clears 100%.
- **Face-pain scales**: none has yet been tested on colic [C19, C20].

**What vets saw at the first visit, and how it related to a critical case** [C5] **S**:
- **Heart rate**: OR 1.06 per beat/min. This is the strongest physical sign.
- **Before adjusting for other signs:**

| Sign | Odds ratio for a critical case |
|---|---|
| Continuous attempts to lie down | 12 |
| Frequent attempts to lie down | 2.9 |
| Severe sweating | 20.7 |
| Severe kicking at the belly | 10.9 |
| Head held low | 5.7 |
| No droppings in 6 h | 2.8 |

- **Not linked to the outcome**: how long since the horse was last seen normal.

**Hospital measurements:**
- Heart rate in horses that died against those that survived: median 64–70 against 48–52 [C25, C26].
- Blood lactate predicts outcome only moderately (AUC 0.65) [C27].
- India: lactate 7.1 against 3.6 mmol/L in 20 surgical cases [C28] **W**.

**Horses hide pain when people are present** [C23] **M**:
- Discomfort behaviour fell by 77% while a carer was at the stall, and stopped completely in 30% of horses.
- A stall camera that watches when nobody is there sees more than a person checking the horse.

### Normal droppings and water

- **Droppings**: stabled horses pass 8–21 kg a day, roughly one pile every 2 hours, about 12 a day. More meals and hard exercise raise the count [C34, C35] **W–M**.
- **Water**: 5–7 L per 100 kg a day [C9].
  - Intake rises with heat. A secondary source attributed to the US nutrition standards (NRC 2007) gives about 48 L a day for an idle 500 kg horse at 30 °C, and about 82 L a day in moderate work at 35 °C [C36] **W**.

### Automatic colic detection

- **Leg sensors, 8 mares with colic induced by drug** [C37] **W–M**:
  - 91% accuracy, but never tested on natural colic.
  - No false-alarm rate reported.
- **Video foaling alarm, same group** [C38] **W**:
  - Lying/standing alone: only 11% of alarms were real (163 false against 20 true).
  - Adding behaviour and activity: 69% were real, and false alarms fell by 95%.
  - This is the clearest published lesson on false alarms.
- **Company claims**: one smart-halter maker reports 97.5% accuracy, but it is not peer-reviewed [C39].
- **No study** has measured how well continuous monitoring detects natural colic in a real stable. Being first to show it would be a real result for EquiCare.

### Gastric ulcers

- **How common** [C41, C42] **S**:
  - Squamous (upper stomach) ulcers: 80–100% of racehorses, 37–59% of leisure horses.
  - Glandular (lower stomach) ulcers: 47–65%.
- **Risks** [C43] **M**:
  - More than 6 h between forage feeds.
  - Straw as the only forage.
  - High-starch meals.
  - No water in the paddock.
- **Behaviour is a poor guide** [C41] **S**. The European specialists' consensus (ECEIM) calls the signs "nonspecific and poorly associated" with ulcers.
  - One small video study found nuzzling or gazing at the area behind the elbow around feeding in 24 of 26 horses with stomach disease [C45] **W**.

### India and hot climates

- **Indian Army / RVC**: no colic data found.
- **Brooke India, horse fairs**:
  - 13% of animals seen had colic.
  - 65% of those were impactions, blamed on dehydration and coarse feed after long journeys [C49] **W**.
- **Rajasthan**: 12 colics among 105 horses; 75% spasmodic, 17% died. Every colic horse was stabled without pasture [C50] **W**.
- **Indonesian working horses**: colic was linked to little water, no worming and hard work [C48] **W**.
- **No study** links colic risk to air temperature or humidity.

---

## Part B. Lameness, orthopaedic pain and laminitis

### How common it is

- **UK military horses** [L1] **M**:
  - 25 lameness cases per 100 horses per year.
  - Mostly cellulitis, wounds and foot/shoeing problems.
  - 88% returned to work.
- **"Sound" horses often are not** [L2–L4] **S**:
  - 46% of 506 sport horses in normal work were lame or had a gait abnormality.
  - 73% of 60 horses in work were lame.
- **Working horses in India and Pakistan**: all 227 were lame, with foot disease in every one [L6] **S**.
- **Laminitis** [L71–L73] **S**:
  - Vet-diagnosed: 0.5 cases per 100 horse-years. Owner-reported: 9.6.
  - Owners missed it in 45% of vet-confirmed cases.

### Judging lameness by eye is unreliable when it is mild

**Agreement between vets** [L9–L12] **S**. (Kappa measures agreement: 0 is chance, 1 is perfect.)
- Overall: kappa 0.31–0.45.
- Hind legs: 0.11.
- Agreeing that a horse is sound: 0.08.
- Mild cases: vets agree about 62% of the time.
- Obvious cases: 93% of the time.

**Bias**: knowing a nerve block had been given changed the grade vets gave [L13].

### Body-worn sensors (IMUs) and phone apps

**Thresholds and accuracy:**
- **Standard sensor thresholds** (Lameness Locator style: head and pelvis sensors plus one leg for stride timing) [L15–L20] **S**:
  - "Lame" means head asymmetry over 6 mm, or pelvis over 3 mm.
  - These cut-offs come from repeatability, not from proven pain.
  - Against a force plate, the sensors found the lame front leg 78–83% of the time.

**Two problems with fixed thresholds:**
- **Most "sound" horses exceed them** [L21–L25] **S**:
  - 70–83% of sound horses, foals and racehorses.
  - Four days of anti-inflammatory painkiller (meloxicam) did not reduce asymmetry.
- **Day-to-day variation is large** [L26–L28] **S**:
  - Between sessions, the same horse varies by about 13 mm at the head and 5 mm at the pelvis.
  - The pelvis is the most repeatable.
  - Judged against each horse's own normal range, false "side changes" fall from 30% to under 7%.

**What changes the numbers** [L29–L36] **M–S**:
- Circles, soft ground and speed all change the numbers.
- Hind lameness is hard to see at walk.
- A combined front-and-hind pattern was the commonest first sensor result (57%) but the rarest final diagnosis (11%).

**Sensor on one leg** [L37–L40] **W–M**:
- Stance timing is good.
- Detecting lameness this way is research only.
- One classifier recognised only 55% of sound horses as sound.

**Phone apps** [L41–L47] **M**. Most validation papers are by the app makers.
- **Sleip**:
  - Against motion capture: within about 2 mm on average.
  - Against body sensors: the error range is wider than the lameness thresholds themselves.
  - Against a vet on mild cases: kappa 0.13, i.e. no agreement.
- **RealHorse**: per-stride error 3.8–5.5 mm.

### Behaviour in the stall

- **Resting a hind leg** [L52] **M** (overnight leg sensors, 30 horses):
  - Sound horses rest each hind leg about equally (15% against 17% of the time).
  - Lame horses put 62% of hind resting on the lame leg.
  - Lame horses lay down 13% of the night, against 3% for sound horses.
- **Weight shifting** [L53–L55] **M**:
  - It separated painful from pain-free hospital horses and fell after pain relief.
  - In laminitis it fell with anti-inflammatory treatment.
  - Laminitic horses lift their front feet more and stand at the back of the stall.
- **Lying time: studies disagree** [L52, L56] **W–M**:
  - Lame horses lay more overnight in one study.
  - In 83 sanctuary horses with chronic lameness, lying time did not change (67 ± 62 min a day, range 0–319).
- **Leg sensors in the stall** [L58–L60] **M**:
  - Lying/standing over 98% correct; stepping 85–89%.
  - Weight shifting only 54–62%.
  - Healthy stabled horses take a median of 128 front-leg steps an hour.
- **Pain scores at rest** [L61–L66] **M**:
  - The Musculoskeletal Pain Scale, scored in the stall, predicted when a horse needed vet treatment.
  - Face scores are weak for mild lameness.
  - The Ridden Horse Pain Ethogram works only when the horse is ridden.

### Laminitis

- **Causes** [L67–L70] **S**:
  - 89% of hospital cases had a hormonal disorder: two-thirds equine metabolic syndrome (EMS), one-third PPID (Cushing's).
  - 20% of horses with colitis developed laminitis; laminitis after diarrhoea clustered in summer.
  - Other risks: box rest in the previous week, weight gain, new grass.
- **Earliest signs** (588 laminitic against 201 otherwise-lame horses) [L75] **S**:

| Sign | Odds ratio for laminitis |
|---|---|
| Weight shifting | 17.7 |
| Difficulty turning | 16.9 |
| Stronger pulse at the foot | 13.2 |
| Short, stilted walk | 9.4 |

  - When both front legs were lame, 92% had laminitis; 99% if foot pulses were also raised.
- **Modified Obel score** [L76, L77] **S**:
  - Stage 1 is judged at rest: weight shifting, abnormal time lying down, front feet placed forward.
  - Two experts agreed 100% on weight shifting.
  - In treated horses, weight shifting was back to normal by about day 4. Gait on a circle took until about day 25.
- **Prognosis by Obel grade** (referral cases) [L78] **M**: odds of death 3.0 at grade II, 9.6 at grade III, 20.5 at grade IV.
- **Hoof temperature** (laboratory models only) [L80, L81] **W**: the feet warmed 16–40 h before laminitis appeared.
- **Supporting-limb laminitis** [L82–L86] **M**:
  - Laminitis in the leg carrying the extra weight when another leg is badly injured: 0.02% of horses, 4–100 days after the injury.
  - Cause: the foot is lifted and rested less often, so its blood supply suffers. Walking helps.
  - No trial shows that monitoring prevents it.

### Tendons, thermal imaging, back pain

- **Thermal imaging of the legs** [L88–L91] **W–M**:
  - A 1.25 °C left–right difference marked inflammation before it showed in racehorses. The normal difference is 0.3 ± 0.3 °C.
  - Air temperature strongly drives leg temperature, so in Indian heat it needs shade and a strict protocol.
- **Back pain**: 74% of horses with back pain were also lame [L93].

### India, working and military horses

- **RVC / Indian Army**: no lameness study found.
- **Closest evidence**: UK military horses [L1]; India/Pakistan working horses [L6]; a Jaipur owner programme that reduced lameness [L98].

---

## Part C. Vital signs and heat

### Normal values

**Adult horse** [V24 (Equine Guelph), V25]:
- Rectal temperature: 37.0–38.5 °C (37.5–38.5 °C at 5–25 °C air temperature).
- Heart rate: 28–44 a minute.
- Breathing: 10–14 a minute.

**Foal** [V24]:
- Temperature: 37.2–38.6 °C.
- Heart rate: 60–110 a minute.
- Breathing: 25–60 a minute.

**Donkey** [V24]:
- Temperature runs lower: 36.2–37.8 °C.
- Heart rate: 36–68 a minute.
- Breathing range is wider: 12–44 a minute.

**Mule**:
- No published resting table was found.
- Over 24 h, mule heart rate averaged 36 ± 3 [N47].
- Mule blood values differ from both horse and donkey ranges [N51].

**Your own yard's normal may be lower.** One yard's measured normal rectal range was 36.0–38.0 °C (652 readings, 41 horses), below the textbook range [D20] **M**.

**Daily rhythm** [V16, V45–V47] **S**: temperature is lowest before dawn and highest late afternoon or evening. In stalled yearlings it swung about 1 °C a day. Compare readings at the same time of day.

**Fever cut-off**: the AAEP uses 38.6 °C rectal. Outbreak monitoring takes it twice a day, early morning and late evening [V50] **M**.

### Eye temperature (the thermal camera)

**How it compares with rectal temperature** **M**:
- 14 horses: about 2 °C below rectal (95% CI 0.7–3.9), with no significant correlation [V1].
- 32 horses over a year (791 readings) [V2]:
  - Individual normals ranged from 29.4 to 37.6 °C.
  - Month shifted readings by up to 2.4 °C, farm by 2.3 °C, indoors against outdoors by 0.8 °C.
  - No correlation with rectal temperature.
- 101 afebrile horses: correlation only r = 0.37; indoor eye range 35.7–37.1 °C. Febrile horses and warm weather were not tested [V3].
- Skin temperature is no better a stand-in for core temperature: 30 °C on the skin against 39 °C inside during endurance exercise [V13].

**As a stress sign** **M**: eye temperature responds to stress (transport, tight nosebands, hard work), but weakly and inconsistently [V6–V11].

**Measuring it properly** **S**: there is no horse thermal-imaging standard. Emissivity was not even reported in 45 of 109 livestock studies. The general guidance [G3]:
- a camera of at least 640×480;
- at least 3×3 pixels on the target;
- no sun or draught;
- a calibration reference (blackbody).

EquiCare's 640×512 camera meets the resolution guidance. The Indian stall conditions do not meet the ambient guidance.

**Better ways to get a true temperature** **M**:
- Microchip temperature transponders caught 87% of fevers in warm weather but only 53–58% in cool weather [V14].
- Chips implanted in muscle tracked core temperature closely during exercise (r 0.85–0.92) [V15].

### Heat

**The "temperature °F + humidity %" rule** (EquiCare's 130/150 lines):
- It is quoted by the AAEP, USEF and US extension services, but **none cites a primary study** **W**.
- The published indices are WBGT (wet-bulb globe temperature) and THI (temperature–humidity index). WBGT 32.5 °C was proposed as the upper limit for fit, acclimatised horses at work [V17].

**What real data show (all exercising horses)** **M**:
- **Japan, 194 heat-illness cases**: WBGT above 28 °C raised the odds 28-fold against WBGT below 20 °C [V18].
- **Britain**: WBGT, race distance and the previous 5 days' temperature predicted heat illness (AUC 0.88), with many false positives [V19].
- **Australia**: humidity and still air mattered most [V21].
- **Treadmill test** (non-acclimatised horses) [V23]:
  - Peak rectal temperature was 39.5 °C at 20 °C/40% humidity, 40.6 °C at 30 °C/40%, and 41.5 °C at 30 °C/80%.
  - Only 1 of 4 horses finished the test in the hot, humid condition.
  - On the °F + humidity scale these conditions are about 108, 126 and 166. They do fit the 130/150 bands, for horses at work.

**Resting, stabled horses are far more tolerant** **M**:
- Rested, watered horses in an Arizona summer and in a hot, humid climate kept resting temperature and heart rate steady. Breathing rate and sweating rose [V26, V27].
- Acclimatisation takes about 2 weeks [V28].

**What this means for the 150 line**: a 95 °F, 60%-humidity Indian afternoon scores 155. EquiCare's "Dangerous heat" would fire most summer days for horses that are coping.

**Mules may not show heat strain the way horses do**:
- Army mules carrying 20–42% of body weight at 32–39 °C had rising temperature, cortisol and lactate, but **unchanged heart and breathing rates** [N37].
- Watching breathing alone can miss a hot mule.

**Anhidrosis (unable to sweat)** **M**:
- 2% of horses in Florida, 11% of farms [V29]; more common in imported horses.
- No Indian figure was found.
- Signs: little or no sweat, fast breathing at rest, raised resting temperature.

**Dehydration** **M**:
- In working horses at 30–44 °C, the skin-pinch test and dry gums did not match blood measures [V31, V32].
- Drinking behaviour (how much, how often, for how long) was the best field guide.

### Breathing rate by camera

**No validation in horses** **W**:
- In cows, nostril thermal imaging matched counted breaths within about 3.5 a minute [V33].
- Across zoo species, thermal video was within about 2 a minute, but failed with movement and thick skin [V34].
- In humans, nostril thermal imaging was within about ±3 a minute of a reference [G8].

EquiCare's nostril and flank breathing methods are plausible but must be checked against counted breaths in RVC stalls before any alert relies on them.

### Heart rate and heart-rate variability

- **Chest-strap monitors** match ECG closely at rest and in groundwork [V38, V39] **M**.
- **Heart-rate variability (HRV)**:
  - In colic, it was higher in survivors than non-survivors [V40].
  - In laminitis, it tracked pain [V41].
  - No cut-offs exist for stall monitoring **W**.
- **Recovery heart rate**: it related to resting heart rate in only 16 of 35 comparisons, so a fixed recovery limit is unfair to some horses [V44] **W**.

---

## Part D. Breathing and infectious disease, India first

### Equine asthma

**How common** **S** (Europe and North America; no Indian figure):
- Severe asthma ("heaves"): about 14–17% of horses.
- Mild-moderate asthma: 68–80% of stabled sport and leisure horses (by airway-wash cell counts) [D1, D3].

**Causes and triggers** **S/M**:
- It is driven by stable air: hay and bedding dust [D1, D8].
- Heat worsens severe asthma. In 14 horses, the daily clinical score tracked barn temperature (r 0.58), and lung function was worse at 25 °C than at 18 °C [D4].

**What resting breathing can tell** **S**:
- Severe asthma shows increased effort at rest.
- **Mild-moderate asthma has normal breathing at rest by definition**, so a stall monitor cannot see it [D2].
- In one small study, the *variability* of breathing fell within 8 hours of a flare while the average rate did not change [D6] **M**.
- Asthmatic horses took over 15 minutes to recover their breathing rate after lunging [D7].

**Cough** **M/W**:
- A halter audio recorder counted coughs in stabled horses as accurately as video [D14].
- In calves, a cough monitor caught 50% of sick animals with few false alarms, and cough bursts preceded treatment [D15].
- Only 3 of 23 livestock respiratory monitors met a 90% field standard [D16].
- Use cough counts as a barn-level trend, not as a diagnosis.

### Fever and contagious disease

**EHV-1 (equine herpesvirus)** [D43, the 2024 ACVIM consensus statement, full text] **S**:
- Virus spreads within 24–48 h, and nasal shedding ends 10–14 days after infection.
- **Most fevers are not EHV-1**: only 9–15% of feverish horses with breathing signs tested PCR-positive.
- Risk of the neurological form (EHM) rises with age, fever and female sex, and after large gatherings, mixing and transport.
- Control:
  - Stop movement.
  - Lift quarantine 28 days after the last new case. Alternatively: 14 days of quarantine, then nasal PCR on several days plus twice-daily temperatures.

**EHV-1 in real outbreaks** **S/M**:
- In a US outbreak of 31 horses, 26 had fever (median 39.3 °C, lasting a median 2.5 days). Most had fever and nothing else [D10].
- In a group of aged working equids, the first neurological case came 15 days after outside horses arrived, and 42% developed neurological signs [D11].

**Strangles** [D13, consensus, full text] **S**:
- Fever with dullness is the first sign, 3–14 days after exposure, and comes **before** the horse is contagious.
- Shedding starts 24–48 h after the fever and lasts 2–3 weeks.
- Daily temperature checks let horses be isolated early.
- New arrivals: isolate for at least 3 weeks; blood tests at arrival and 2 weeks later show exposure.

**Equine influenza** **M**:
- Incubation 1–3 days; shedding up to 10 days [D18].
- India's 2008–09 epidemic began in Katra (J&K), spread to 10 more states within a year, and 23% of 4,740 tested horses were positive [D33].
- In Gujarat, the death rate among cases was 11% [D34].

### Indian law

**Under the Prevention and Control of Infectious and Contagious Diseases in Animals Act, 2009**, the Schedule lists these equine diseases [D41, full text] **S**:
- African horse sickness
- Contagious equine metritis
- Dourine
- Eastern, Western and Venezuelan equine encephalomyelitis
- Equine infectious anaemia
- Equine influenza
- Equine piroplasmosis
- Equine rhinopneumonitis (EHV)
- Equine viral arteritis
- Glanders
- Surra

Its multi-species list adds anthrax, Japanese encephalitis, rabies and West Nile fever. Strangles and tetanus are **not** scheduled.

**What the Act requires on suspicion**:
- **Report it** (section 4).
- **Segregate the animal** from healthy ones, and keep it away from common grazing and water (section 5).

**Glanders** [D22–D26, D42] **S/M**:
- The DAHD National Action Plan sets testing and screening rules.
- For Army animals, the Army carries out elimination, and the Central Military Veterinary Laboratory, Meerut is the recognised testing laboratory [D42].
- Still present in India: 0.25–1.1% of tested horses were positive in 2015–2023, about 60% of them in Uttar Pradesh.
- Mules and donkeys get the acute form; horses usually the chronic form, with intermittent fever, cough and weight loss.
- Owners often hide it.

### Other Indian diseases

**Surra (Trypanosoma evansi)** [D27, D48] **M**:
- 5–11% of equids in north India test positive, with a peak after the monsoon (September–November).
- Signs: intermittent fever, anaemia, swelling, weight loss.

**Piroplasmosis** [D30, D31, D49] **M**:
- 64% of equids test positive, and **92% of mules**.
- Risk is driven by ticks and summer heat.

**Japanese encephalitis** [D35, D47] **M**:
- 19% of Indian horses test positive, and horses are not vaccinated.
- Usually no signs; sometimes fever and neurological signs.

**Rabies** (experimental, 21 horses) [D44] **M**:
- Muzzle tremor was the first sign in 81%.
- Other signs: throat spasm, wobbliness, dullness.
- Average incubation was 12 days.

### Transport

**Shipping fever** **M** [D36–D39, N40, N43]:
- Head tied high for long journeys raises the bacterial load in the airways; head position matters more than distance.
- After 36–61 h journeys, fever peaked 20–49 h after departure, and 47% of young horses got shipping fever [N40].
- **Rectal temperature is not a sensitive check after transport.** After air transport, a blood marker (serum amyloid A) caught 93% of horses with early inflammation. Rectal temperature caught 3% [N43].

---

## Part E. Behaviour, sleep and welfare

### Lying and sleep

**How much horses lie down** **M**:
- Lying is short and differs hugely between horses: 67 ± 62 minutes a day, range 0–319 (83 horses with sensors) [E2].
- Riding-school horses lay 23–25 minutes a day [E5].
- Across 12 studies, lying took 2.7–27% of the day [E1].

**Normal night bouts** (12-hour night, by bedding) [E30] **W/M**:

| Behaviour | Time per night | Bouts | Mean bout length |
|---|---|---|---|
| Standing rest | 380–444 min | 17–27 | 15–27 min |
| Lying on the chest (sternal) | 19–70 min | 2–6 | 11–14 min |
| Lying flat on the side (lateral) | 0–10 min | 0–3 | — |

- Sawdust bedding almost removed flat lying (0.02 min against 4–10 min on straw or husk) [E30].

**Sleep needs** **M**:
- The quoted minimum is about 30 minutes lying a day [E6].
- Deep (REM) sleep averaged 46 minutes, but 10 of 16 horses had under 30 minutes [E18].
- REM happens lying on the chest as well as flat, so "time flat on the side" is a stand-in, not the sleep requirement itself [E11].

**Sleep deprivation**:
- Horses that will not lie down collapse while standing: up to 199 times a day in one series, with injuries to knees and fetlocks in over 90%.
- The cause was lack of lying-down sleep: too little space, a management change or pain [E16, E17].
- This comes from a conference report, so it is grade **W/M**.

**Signs of sleep problems** (owner survey of 1,749 horses) [E12] **W/M**:

| Sign | Odds ratio |
|---|---|
| Falls or loss of balance | 40 |
| Never seen lying down | 28 |
| Trouble lying down or getting up | 16 |
| Night-time injuries | 9 |

**New surroundings** **W/M**:
- Horses lie and sleep differently on the first night in a new place, and adapt over about 4 nights in a new stall [E7, E10].
- A bigger box and more bedded space increase lying [E6, E29, E32].

### Stereotypies (stable vices)

**How common** **M**:
- 6.9% of 737 British racehorses [E24].
- 4–5% for each type in non-racing horses [E35].
- No military or Indian figure was found.

**Causes** **M**:
- Little forage: risk rose below 6.8 kg a day [E26].
- Concentrate-heavy diets, isolation and certain kinds of work [E25, E26, E38, E39].
- Guidance: at least 1.5% of body weight as forage and 8 h a day of foraging [E29b].

**Links to illness** **M**:
- Crib-biters have more colic [A, E23, E40].
- Young crib-biters had more stomach ulceration [E28]; adult crib-biters on pasture did not [E27]. The studies disagree.

**Coping** **M**:
- Crib-biting may calm the horse [E42, E43].
- Collars reduced it without a clear stress rise in a small trial [E44].
- Stopping it does not treat the cause.

### Stress and welfare measures

**Cortisol** **M**:
- It is hard to read: it follows a daily cycle, and saliva and blood agree poorly [E46].
- Horses in poor welfare (withdrawn posture, back pain) had *lower* cortisol, not higher [E21, E47].

**The "withdrawn" horse** [E21] **M**:
- 24% of 59 working horses stood with a fixed gaze and unresponsive head and ears.
- Cortisol would have missed them; they are worth flagging for a vet.

**Welfare and pain scales** **M**:
- The AWIN welfare protocol is mostly reliable between observers [E52, E53].
- Untrained observers agree only weakly on the Horse Grimace Scale [E22].
- Automated face-pain recognition is research only (see Part G).

### Does behaviour warn of illness?

- **Horses**: no prospective study shows activity, lying or eating changing *days* before infection, colic or laminitis. Sensors detect pain once it shows. **This is a real gap.**
- **Foaling**: activity and temperature rise 1.5–3 h before birth [E15, F16].
- **Dairy cattle (the model)** [E18b, E19, E20] **M**:
  - Rumination fell 5 days before diagnosis, and activity 3 days before.
  - Lying rose the day before.
  - In calves with respiratory disease, a lying-time model caught 54% of cases at 95% specificity.
- For horses, days-ahead warning is a hypothesis to test, not a claim to make.

### How long should a horse's "own normal" take?

**No horse study gives a number of days.** The evidence available:
- In cattle, repeatability of daily lying and feeding is only 0.34–0.62, and some animals are much more variable than others [E57, E58] **M**.
- Horses vary a lot day to day [E4] and settle over several nights in a new stall [E7].

**A defensible design** (design judgement, not proven):
- Provisional scoring from day 3.
- A rolling 7–14-day baseline.
- Skip the first one or two nights after a move.
- Score changes relative to each horse's own day-to-day spread.

---

## Part F. Foaling and the newborn foal

### Gestation length

**The range is huge** **S**:
- Mean about 340–350 days.
- Normal range 315–388 days in UK Thoroughbreds [F10]; 296–429 days in New Zealand [F29].
- Marwari mares in India: mean 342 days, range 259–388 [F33] (figures from a search snippet; abstract not read).

**What shifts it** **S/M**:
- Colts are carried 2–4 days longer than fillies [F10, F30].
- The month of foaling matters most: shortest in January, longest in April [F10, F14].
- **The mare herself is the biggest factor**: she tends to repeat her own length [F11].

**What this means for due dates**: a calculated due date can be 4–5 weeks out.

### Predicting foaling

**Milk tests** (positive means "within 1–3 days"; negative means "not tonight") **S/M**:
- **Calcium of 200 ppm or more**:
  - If positive: 51% foal within 24 h, 84% within 48 h, 97% within 72 h.
  - If negative: 99.6% did not foal within 24 h [F2].
- **pH of 6.4 or below**: similar accuracy [F4].
- **Conductivity of 4.8 mS/cm or below**: the best single test in 241 mares — 82% sensitivity, 91% specificity [F3].
- Electrolyte formulas are unreliable [F5].

**Mare temperature**: it dips 0.3–0.5 °C about 12 h before foaling (neck microchip) [F8] **W**. This has not been tested with eye temperature.

### Behaviour before foaling

- **Normal nights before foaling are quiet**: 67% standing, 27% eating, 6% lying [F7].
- **Signs that do occur** **M**:
  - On the foaling night, walking and lying both rise [F7].
  - In the last 4 hours: pawing, tail lifting, rolling, kicking at the belly, flank watching [F20].
- **Eating less is not an early sign**: eating did not change on the foaling night [F7].
- **Commercial-farm camera study** (115 mares) [F16] **M**:
  - Movement and surface temperature rose 70–90 min before foaling.
  - Posture changes and tail raising rose 25–45 min before.
  - Together they gave 95% detection with about 1.5 h warning (80% detection with about 3 h warning from movement and temperature alone).
  - False-alarm rates were not reported.
- **Time of day** **S**: 50–86% of foalings happen at night, but 22–41% happen in daylight [F7, F24, F29, F30].

### Foaling alarms

| Device | Detection | Warning | False alarms | Source |
|---|---|---|---|---|
| Vulva transponder | Sens. 96%, spec. 91% | At birth (stage 2) | 9–11% | [F19, F1] |
| Accelerometer alarm | 94% | ~33 min | — | [F6] |
| Foalert | 94% | ~9 min | — | [F6] |
| Tail sensor, any single sign | Sens. 100% | within 1 h | Only 3–13% of alarms real | [F17] |
| Tail sensor, combined signs | — | within 1 h | 32–100% of alarms real | [F17] |

### Labour time limits

- **Stage 2** (waters break to foal out) **S**:
  - Median 12–20 minutes.
  - Call the vet if there is no progress by 20–30 minutes.
  - Foal deaths rise beyond 40 minutes [F24, F25, F27].
- **Placenta**: should pass within 3 h. 95% pass it by 4 h. Retained placenta led to other disease in 41% of mares (laminitis in 14%) [F13, F28, F29].
- **After-birth bleeding** [F21]:
  - Shows as colic, paleness, sweating or collapse.
  - 86% of cases happen after foaling.
  - 84% of mares survived.

### The newborn foal

**Milestones and call-the-vet limits**:

| Milestone | Normal | Call the vet if |
|---|---|---|
| Lying on the chest | 1–2 min | — |
| Suckle reflex | within 20 min | — |
| Standing | 40–80 min | not standing by 1–2 h |
| Nursing | 70–120 min | not nursing by 2–3 h |
| Meconium (first dung) | within about 3 h | — |

- Sources: the "1-2-3" rule from textbooks; Marwari foals filmed at ICAR-NRCE Bikaner (preprint); mule foals [F35, F36].
- Colts are 13–17 minutes slower than fillies.

**Antibody transfer**: failure of passive transfer (IgG below 8 g/L) affected 10% of foals on one farm [F37].

**Sepsis** **M**:
- It is hard to spot even in hospital: the sepsis score caught 56% of cases [F39, F40].
- No study validates camera signs for it.

**Rejection** [F41, F42] **W/M**:
- Most often in first-time mothers, who took a median 38 h to accept their foal.
- More common in Arabian mares.

**Placentitis**: early udder development or milk dripping is a warning sign — a vet call, not a foaling alert [F43, F44].

---

## Part G. How accurate monitoring technology is, and how to validate it

### Thermal imaging

See Part C. In summary: use per-horse trends, control the conditions, and do not set absolute fever lines.

**Camera artefacts**: no literature was found on the "ghost" artefact of scene-based self-calibration (the 13 mm camera's fault). EquiCare's own measurements are the evidence there.

### Camera AI

**Lying and standing from video** [G12] **M/W**:
- The best published result is one horse, one stall, daytime only.
- Standing: 98% precision, 89% recall.
- Lying: 93% precision, **63% recall**. A third of lying episodes were missed.
- **Expect EquiCare to under-count lying until it is checked at night in RVC stalls.**

**Body-point tracking** [G13–G18]:
- Tracking nose, withers and tail in stall video worked over 80% of the time.
- The pose datasets (Horse-10, AP-10K, APT-36K) are not stall-like, and none tests night infrared.

**Automatic pain recognition from the face and body** [G19–G25] **W**:
- Research only: 60–76% accuracy in the lab, on 6–8 horses with induced pain.
- Vets did about as badly on the same tasks.
- Not ready to be a clinical alarm.

**Identifying individual horses** [G26, G27]:
- Published methods use the iris or muzzle print.
- **Nothing tests a DINOv2 gallery on stall CCTV.** EquiCare's own tests are the only evidence there.

### Wearables, feed and sound

**Leg sensors**: lying and standing over 98% correct [B, E14b]. A chest sensor was over 95% correct, but in a preprint whose test was probably not split by horse [G29].

**Commercial devices**:
- No independent validation was found for NIGHTWATCH, Equisense, Seaver, Alogo or EquiLab.
- NIGHTWATCH publishes no sensitivity or false-alarm figures.
- Validated field products are mainly ECG and heart-rate belts [G7].

**Feeding by sound**: halter sound recorders matched observed grazing time within about 2% [G31] **M**.

**Load cells and water meters**: no horse validation was found. Calibrate them against weighed amounts.

**Coughs**: calf and pig cough detectors reach 72–92%, and calf coughs preceded clinical signs by 1–2 days [G32–G34]. **No horse cough detector exists**; one would need a labelled RVC recording set.

### False alarms: the lesson from hospitals and farms

**Hospitals** **S**:
- In intensive care, 89% of heart-rhythm alarms were false — 187 audible alarms per bed per day [G37].
- In a children's hospital, 87–99% of alarms needed no action, and nurses responded more slowly as non-actionable alarms piled up [G38].

**Farms** [G35, G36] **M**:
- Livestock alarm systems rarely rank their alerts.
- No accepted false-alarm target exists for animals.

**The arithmetic** (worked example):
- Take 1 real event per 1,000 horse-days, 90% sensitivity and 99% specificity.
- That gives about 1 true alert and 10 false ones, so only 8% of alerts are real.
- In a 1,000-horse unit, that is about 10 false alarms a day.
- **High specificity matters more than high sensitivity.**

### Regulation

The US FDA has no specific pre-market rules for veterinary AI, and no Indian framework was found [G39]. For RVC the sensible path is an internal validation record (Part I).

---

## Part H. Nutrition, working horses and mules

### Hormone disorders

**PPID (Cushing's)** **S/M**:
- Common and missed: 21% of horses aged 15 or over had it on blood tests, though owners rarely reported it [N1, N2].
- The best sign is a long coat or late shedding [N1, N3].
- Weight loss and dullness track age, not PPID.
- Drinking more is a weak sign, and **no study tests water intake as a PPID screen** [N4].

**Equine metabolic syndrome (EMS)**: defined by blood tests. The visible flags are obesity, a cresty neck and laminitis [N7] **S**. Sport-type horses are not exempt [N10].

### Body condition and weight

- **Body condition scoring is subjective** **M**:
  - Trained scorers agree; owners agree poorly with vets (kappa 0.24).
  - Even among 5–8 trained scorers, only 58–65% of scores fell within 0.5 of the median [N11–N14].
- **Weight formulas and tapes are rough** [N15, N16].
- **No validated camera body-score or weight estimator exists** [N14].

### Water and feed

**Water** **M**:
- Stabling more than doubles drinking: 2.4 L per 100 kg a day at pasture against 6.4 L stabled [N17].
- Horses prefer buckets: they drank 98% from the bucket when offered both [N18].
- A slow automatic waterer cut daily intake by about a quarter [N18].
- **The type of waterer changes the baseline.**
- Heat raises water need by 30–75%, and up to double above about 32 °C (NRC figures, via secondary sources) **W**.

**Eating time** **M**:
- 48% of the day at pasture against 35% stabled [N19].
- Old and chronically lame horses ate as much as healthy ones, so less activity alone is not a sign of age [N19].

**Dehydration in heat** [N22, N23] **M**: watch drinking behaviour, not the skin pinch.

### Teeth

- **Dental disease is almost universal in older horses**: 95% of horses aged 15 or over at a vet exam, but owners reported only 25% [N13] **S**.
- **There is no evidence** that quidding, slow eating or head tilt reliably indicate dental disease [N30]. "Eating slowly" means *check the mouth and the horse*, not "dental disease".

### Exercise

- **Tying-up** (exertional rhabdomyolysis): 4% of endurance horses in one study [N34]. High-grain rations are a trigger.
- **Recovery heart rate**: judge it against the horse's own resting rate [N32].
- **Endurance vet-gate rule**: pulse 64 or below within 20 minutes (FEI rule, via secondary sources) **W**.

### Transport

- **Water**: in 30 h of transport, horses lost 10% of body weight without water against 4% with it [N38].
- **Recovery after flying**: weight took about 7 days to return [N39].
- **Long road journeys**: problems rise sharply after about 20 h [N41, N42].
- **Fever**: see Part D — rectal temperature misses most early post-transport inflammation [N43].

### Mules and donkeys

- **Normal values differ** from horses [N47, N48, N51]:
  - Donkey temperature runs lower.
  - Mule blood ranges are their own.
- **Donkeys hide pain**, but validated donkey pain scales exist: specificity 91–99%, though they miss some types of pain [N49]. **No mule pain scale exists.**
- **Hyperlipaemia** (a feeding-related emergency) killed 48% of affected donkeys [N31].
- **Mules carrying heavy loads in heat** show strain in temperature and blood markers, not in heart or breathing rate [N37].

### India and working equids

- **Working horses in India**: 90–100% lame [B, N52].
- **Working donkeys in Tamil Nadu**: 39% had skin wounds [N54].
- **Brick-kiln equids**: 5% were heat-stressed (Brooke India, grey literature) [N58].
- **Donkeys dying of heat stress** in India are documented [N55].
- **No published health study of Indian Army remount horses, Marwari or Kathiawari horses was found.**

---

## Part I. What all this means for EquiCare

Nothing below is built yet. These are evidence-based suggestions for the next round of work, grouped by how urgent they are.

### 1. Things EquiCare says today that the evidence says to change

1. **"Body temperature" should read "Eye temperature".**
   - The eye is about 2 °C below core temperature and does not correlate with it [C].
   - Fever alerts should be a rise against the horse's own normal *at the same time of day* (suggested start: a sustained rise of about 1 °C — our figure).
   - They should prompt a rectal check (38.6 °C or above), never declare a fever.
2. **The heat index (130/150) should be called a rule of thumb, and tied to the horse.**
   - "Dangerous heat" should need the index above 150 *plus* a sign from the horse: faster breathing, or eye temperature above its own normal. Otherwise it will fire most Indian summer days.
   - Consider WBGT or an airflow input.
   - For mules, do not rely on breathing rate [C, H].
3. **"No droppings for 8 h" should become 6 h, or the horse's own longest normal gap** [A].
4. **The 3-day "own normal" should be provisional.**
   - Use a rolling 7–14-day baseline.
   - Skip the first one or two nights after a move.
   - Score against each horse's own day-to-day spread [E].
5. **The foaling watch should follow the mare, not a fixed due date** [F]:
   - Start it from about day 310–320 of pregnancy, and keep it on until she foals.
   - Use the mare's past pregnancy lengths.
   - Drop "eating less" as a foaling sign: the evidence does not support it.
   - Say the warning is about 1.5–3 hours, and require two or more signs together.
6. **Breathing rate and lying time need a confidence label until checked against hand counts and video at RVC, including at night.**
   - Lying detection missed a third of episodes in the best published study [C, G].
7. **Phone-app gait results should read "movement asymmetry", never "lameness"** [B].

### 2. New alerts the evidence supports

| Alert | Evidence | Strength |
|---|---|---|
| "Quiet colic": low activity + eating less + fewer droppings | [A] | M |
| Strongest colic signs alone: ≥5 lie-downs in 1 h, or ≥3 rolls in 30 min | [A] | M |
| Colic risk windows (new hay, transport, weather change, move into a stable) | [A] | M |
| Weight shifting (laminitis, limb pain) — needs building | [B] | S for the sign |
| New arrival: 3-week isolation reminder + daily temperature | [D] | S |
| Outbreak mode: movement stop, 14/28-day countdown, twice-daily temperatures | [D] | M |
| Several horses with fever or cough at once (herd view) | [D] | M |
| Scheduled-disease prompt: "segregate, call the vet, report through the Army vet chain" | [D] Act 2009 | S (legal duty) |
| Post-transport watch for 7 days after journeys over 20 h; recommend a vet check at 24 h | [D, H] | M |
| Water intake below about 70% of own 7-day median for 2 days (needs water sensors; same waterer type) | [H] | M |
| Eating slowly or leaving feed: "check mouth, teeth and health" | [H] | M |
| Horses aged 15 or over: periodic prompt for teeth, coat (PPID) and body condition | [H] | S |
| Almost no lying for days, or collapses while standing: human check | [E] | M |
| Mare and foal: foal standing (by 1–2 h) and nursing (by 2–3 h); placenta out by 3 h (staff entry); mare colic, bleeding or rejection | [F] | S/M |
| New or rising stable vice: welfare flag (check forage), not an illness warning | [E] | M |
| Withdrawn, fixed posture: log for a vet | [E] | M |

### 3. How to prove EquiCare works at RVC

**Before alerting anyone:**
1. **Write a one-page "intended use".** For each output, say whether it is a trend, an alert or context, and what a person does next.
2. **Set a reference for every measure**:
   - weighed feed and water;
   - rectal thermometer;
   - breaths counted by two people;
   - lying, standing and behaviour scored from video by two people.
3. **Test on horses and stalls the system has not learned from.** Split by horse and stall, never by video frame.
4. **Cover the hard conditions**: day, night infrared, a sun-heated afternoon, monsoon humidity, a camera that has been moved.
5. **Run silently for 4–8 weeks** before any alert reaches staff.

**What to measure:**
- **Measurements**: bias and limits of agreement, from at least 100 paired readings across 10 or more horses.
- **Alerts**:
  - sensitivity per true event;
  - false alarms per horse per week;
  - share of alerts that were real;
  - time from onset to alert.
- **Rare events such as colic**: showing 90% sensitivity needs 30–40 true events. One site will not reach that quickly, so say so plainly.

**Targets** (our design goals; no published standard exists):
- Two alert tiers: urgent, and a daily digest.
- On the urgent tier: at least 30–50% of alerts real, and at most about 1 false alarm per stable per night.
- Two independent signals before escalating.
- Report the hit rate monthly, and retire alerts that never lead to action.

### 4. What EquiCare must never claim

- That eye temperature is body temperature, or that one reading is a fever.
- That it diagnoses any disease: colic type, asthma, strangles, EHV, glanders, surra, laminitis, PPID, dental disease or lameness.
- That a normal reading rules disease out. Silent EHV-1 infection, glanders carriers and mild asthma all look normal.
- That it predicts illness days ahead. That is unproven in horses.
- That breathing rate, lying time, cough counts, body condition or pain-from-the-face are validated in horses, until RVC's own checks say so.
- That an alert fulfils the legal duty to report a scheduled disease.
- That 130/150, 6 mm/3 mm or any of our own thresholds are published standards.
- Anything specific to Indian breeds or Army horses, since no such data exist yet.

---

## Part J. What nobody has published yet

These gaps are where RVC data would be new evidence:

1. How well continuous monitoring detects **natural** colic, foaling and illness in real stables: hit rate, false alarms per horse-month, warning time.
2. Eye temperature against rectal temperature in **feverish** horses and in 30–45 °C stalls.
3. Camera breathing rate in horses, against counted breaths.
4. Night-time infrared accuracy of lying and behaviour detection in a new stable.
5. How many days a horse's personal baseline needs.
6. Whether behaviour changes days before infection, laminitis or colic in horses.
7. Normal values (vital signs, drinking, eating, lying, gait) for Indian Army horses, Marwari, Kathiawari and mules in Indian heat. Equine asthma prevalence in India.
8. A validated stall heat threshold for resting horses and mules.
9. Weight-shift detection from stall video.
10. Mule pain recognition.
11. A horse cough detector.

---

## References

Years checked against Crossref where a DOI is given. [abstract] = only the abstract was read; [FT] = full text read; [2°] = seen only in a secondary source.

### Colic and the gut (C)

1. Traub-Dargatz JL et al. 2001. JAVMA 219:67–71. doi:10.2460/javma.2001.219.67
2. Tinker MK et al. 1997. Prospective study of equine colic incidence and mortality. Equine Vet J [abstract]
3. Kaneene JB et al. 1997. Prev Vet Med. doi:10.1016/s0167-5877(96)01102-6
4. Tannahill VJ, Cardwell JM, Witte TH. 2019. Vet Rec 184:24. doi:10.1136/vr.104956
5. Curtis L et al. 2015. Acta Vet Scand 57:69. doi:10.1186/s13028-015-0160-9 [FT]
6. Bowden A et al. 2020. Vet Rec. Indicators of "critical" outcomes in 941 horses seen out-of-hours for colic [abstract]
7. Mair TS, Smith LJ. 2005. Equine Vet J. doi:10.2746/0425164054529409
8. Curtis L, Burford JH, England GCW, Freeman SL. 2019. PLoS One 14:e0219307. doi:10.1371/journal.pone.0219307 [FT] (odds ratios from its tables: Cohen 1995/1996/1999, Hudson 2001, Hillyer 2002, Reeves 1996, Kaya 2009, Malamed 2010, Archer, Scantlebury, Salem, Proudman, Back, Hassanpour)
9. Williams S et al. 2014. Equine Vet J. doi:10.1111/evj.12238 [FT]
10. Archer DC et al. 2006. BMC Vet Res 2:27. doi:10.1186/1746-6148-2-27
11. Escalona EE, Okell CN, Archer DC. 2014. BMC Vet Res 10(S1):S3. doi:10.1186/1746-6148-10-S1-S3 [FT]
12. Laranjeira PVEH et al. 2009. Ciência Rural. doi:10.1590/S0103-84782009000600024
13. Sutton GA et al. 2013. Vet J 197:646–650 [abstract]
14. Maskato Y et al. 2020. Animals 10:2242. PMC7760242 [FT]
15. van Loon JPAM, Van Dierendonck MC. 2015. Vet J. doi:10.1016/j.tvjl.2015.08.023
16. Van Dierendonck MC, van Loon JPAM. 2016. Vet J. doi:10.1016/j.tvjl.2016.08.004
17. Bussières G et al. 2008. Res Vet Sci. doi:10.1016/j.rvsc.2007.10.011
18. van Loon JPAM et al. 2014. Vet J 200:109–115 [abstract]
19. Dalla Costa E et al. 2014. PLoS One. doi:10.1371/journal.pone.0092281
20. Gleerup KB et al. 2015. Vet Anaesth Analg. doi:10.1111/vaa.12212
21. Taffarel MO et al. 2015. BMC Vet Res. doi:10.1186/s12917-015-0395-8 [2°]
22. Raspa F et al. 2026. Appl Anim Behav Sci, systematic review [2°]
23. Torcivia C, McDonnell S. 2020. Animals 10:210. doi:10.3390/ani10020210
24. Torcivia C, McDonnell S. 2021. Animals 11:580. doi:10.3390/ani11020580
25. Straticò P et al. 2022. Vet Sci 9:545. doi:10.3390/vetsci9100545 [FT]
26. Nocera I et al. 2026. Animals 16:496. doi:10.3390/ani16030496 [FT]
27. Crosby CE, O'Connor A, Munsterman AS. 2025. Front Vet Sci. doi:10.3389/fvets.2025.1618304 [FT]
28. Khosa JS et al. 2021. Indian J Anim Res. doi:10.18805/IJAR.B-4359
29. Biondi et al. 2026. Front Vet Sci. doi:10.3389/fvets.2026.1822426
30. Erwin SJ et al. 2022. Animals 12:1374. doi:10.3390/ani12111374 [FT]
31. Torfs S et al. 2009. J Vet Intern Med. doi:10.1111/j.1939-1676.2009.0311.x
32. Pritchett LC et al. 2003. Appl Anim Behav Sci 80:31–43 [abstract]
33. Kil N, Ertelt K, Auer U. 2020. Animals 10:2258. doi:10.3390/ani10122258 [FT]
34. Fernandes KA et al. 2022. Anim Prod Sci 62:1192. doi:10.1071/AN20695
35. Hackland J et al. 2007. MSc thesis, University of KwaZulu-Natal [abstract]
36. Mad Barn, "How much water should horses drink" (cites NRC 2007) [2°]
37. Eerdekens A et al. 2024. Equine Vet J 56:1229–1242. doi:10.1111/evj.14069
38. Eerdekens A et al. 2025. EAAP AI4AS conference slides
39. NIGHTWATCH press release (company claim)
40. Broomé S et al. 2019. CVPR. arXiv:1901.02106
41. Sykes BW et al. 2015. J Vet Intern Med 29:1288–1299. PMC4858038 [FT]
42. Vokes J, Lovett A, Sykes B. 2023. Animals 13:1261. doi:10.3390/ani13071261 [FT]
43. Luthersson N et al. 2009. Equine Vet J 41:625–630. doi:10.2746/042516409x441929
44. Nicol CJ et al. 2002. Vet Rec [abstract]
45. Torcivia C, McDonnell SM. 2025. Animals 15:88. doi:10.3390/ani15010088
46. REACT campaign (BHS / University of Nottingham)
47. Bowden A et al. 2020. Equine Vet J. doi:10.1111/evj.13173
48. Fikri F et al. 2024. Vet World. doi:10.14202/vetworld.2024.963-972 [FT]
49. Mohite DS, Zaman SF. Brooke India poster: equine fair colic
50. Sharma SK, Nagar JK, Joshi M. 2022. Indian J Anim Res 56:489. doi:10.18805/IJAR.B-4540

### Lameness, orthopaedic pain and laminitis (L)

1. Putnam JR et al. 2013. Equine Vet J. doi:10.1111/evj.12084
2. Greve L, Dyson SJ. 2014. Equine Vet J. doi:10.1111/evj.12222
3. Dyson S, Greve L. 2016. J Equine Vet Sci. doi:10.1016/j.jevs.2015.12.012
4. Dyson S, Pollard D. 2020. Animals. doi:10.3390/ani10061044
5. Merridale-Punter MS et al. 2022. Animals. doi:10.3390/ani12223100
6. Broster CE et al. 2009. Equine Vet J. doi:10.2746/042516409x373907
7. Bonow S et al. 2025. Prev Vet Med. doi:10.1016/j.prevetmed.2025.106596
8. Pollard D et al. 2020. Prev Vet Med. doi:10.1016/j.prevetmed.2019.104833
9. Keegan KG et al. 2010. Equine Vet J. doi:10.2746/042516409x479568
10. Keegan KG et al. 2013. Am J Vet Res. doi:10.2460/ajvr.74.1.17
11. Hammarberg M et al. 2016. Equine Vet J. doi:10.1111/evj.12385
12. Starke SD, Oosterlinck M. 2019. Vet Rec. doi:10.1136/vr.105058
13. Arkell M et al. 2006. Vet Rec. doi:10.1136/vr.159.11.346
14. Hardeman AM et al. 2022. Equine Vet J. doi:10.1111/evj.13545
15. Keegan KG et al. 2011. Am J Vet Res. doi:10.2460/ajvr.72.9.1156
16. McCracken MJ et al. 2012. Equine Vet J. doi:10.1111/j.2042-3306.2012.00571.x
17. Macaire C et al. 2023. Animals. doi:10.3390/ani13213319 [FT]
18. Valle AP et al. 2024. BMC Vet Res. doi:10.1186/s12917-024-04032-9 [FT]
19. Keegan KG et al. 2012. Am J Vet Res. doi:10.2460/ajvr.73.3.368
20. Bell RP et al. 2016. Am J Vet Res. doi:10.2460/ajvr.77.4.337
21. Rhodin M et al. 2017. PLoS One 12:e0176253 [2°]
22. Zetterberg E et al. 2024. PLoS One. doi:10.1371/journal.pone.0308061
23. Zetterberg E et al. 2023. PLoS One. doi:10.1371/journal.pone.0284105
24. Meistro F et al. 2025. Animals. doi:10.3390/ani15121797 [FT]
25. Persson-Sjodin E et al. 2019. PLoS One. doi:10.1371/journal.pone.0221117
26. Hardeman AM et al. 2019. Equine Vet J. doi:10.1111/evj.13075
27. Sepulveda Caviedes MF et al. 2018. Equine Vet J. doi:10.1111/evj.12802
28. Pfau T et al. 2025. Animals. doi:10.3390/ani15162449
29. Rhodin M et al. 2016. Equine Vet J. doi:10.1111/evj.12446
30. Pfau T et al. 2016. Equine Vet J. doi:10.1111/evj.12374
31. Marunova E et al. 2024. PLoS One. doi:10.1371/journal.pone.0308996
32. Starke SD et al. 2013. Vet J. doi:10.1016/j.tvjl.2013.03.006
33. Lopes MA et al. 2016. Am J Vet Res. doi:10.2460/ajvr.77.10.1121
34. Smit IH et al. 2024. Equine Vet J. doi:10.1111/evj.13998
35. Rhodin M et al. 2025. Equine Vet J. doi:10.1111/evj.14525
36. Reed SK et al. 2020. JAVMA. doi:10.2460/javma.256.5.590
37. Bragança FM et al. 2017. Equine Vet J. doi:10.1111/evj.12651
38. Moorman VJ et al. 2014. Am J Vet Res. doi:10.2460/ajvr.75.9.800
39. Parmentier JIM et al. 2023. Sci Rep. doi:10.1038/s41598-023-27899-4
40. Poizat E et al. 2025. Sensors. doi:10.3390/s25041095
41. Lawin FJ et al. 2023. Animals. doi:10.3390/ani13030390 (app makers co-authored)
42. Pfau T et al. 2023. Sensors. doi:10.3390/s23208414
43. Kallerud AS et al. 2025. Equine Vet J. doi:10.1111/evj.14089
44. de Chiara M et al. 2025. Equine Vet J. doi:10.1111/evj.14516 [FT]
45. McPeek JL et al. 2026. Equine Vet J. doi:10.1111/evj.70116
46. Key K et al. 2026. Equine Vet J. doi:10.1002/evj.70149 (app makers)
47. Key K et al. 2026. Equine Vet J. doi:10.1111/evj.70109 (app makers)
48. Feuser AK et al. 2022. Animals. doi:10.3390/ani12202804
49. Macaire C et al. 2022. Animals. doi:10.3390/ani12243498
50. Pfau T et al. 2020. Equine Vet Educ. doi:10.1111/eve.12914 [2°]
51. Anderson KA et al. 2023. Animals. doi:10.3390/ani13111727
52. Uellendahl A et al. 2024. Sensors. doi:10.3390/s24227203
53. Nowak M et al. 2024. Front Pain Res. doi:10.3389/fpain.2024.1410302
54. Rietmann TR et al. 2004. J Vet Med A. doi:10.1111/j.1439-0442.2004.00627.x
55. Jones E et al. 2007. Pain. doi:10.1016/j.pain.2007.08.035
56. Kelemen Z et al. 2021. Animals. doi:10.3390/ani11113189
57. Kelemen Z et al. 2025. Geroscience. doi:10.1007/s11357-025-01738-y
58. Anderson K et al. 2023. Equine Vet J. doi:10.1111/evj.13909
59. Steinke SL et al. 2021. Front Vet Sci. doi:10.3389/fvets.2021.681213
60. Hobbs K et al. 2023. J Vet Intern Med. doi:10.1111/jvim.16821
61. Auer U et al. 2023. Front Pain Res. doi:10.3389/fpain.2023.1292299
62. van Loon JPAM, Macri L. 2021. Animals. doi:10.3390/ani11061826
63. Ask K et al. 2024. Sci Rep. doi:10.1038/s41598-023-50383-y
64. Dalla Costa E et al. 2016. Animals. doi:10.3390/ani6080047
65. Dyson S et al. 2018. J Vet Behav 23:47. doi:10.1016/j.jveb.2017.10.008 [2°]
66. Dyson S, Pollard D. 2023. Animals. doi:10.3390/ani13121940
67. Karikoski NP et al. 2011. Domest Anim Endocrinol. doi:10.1016/j.domaniend.2011.05.004
68. Luethy D et al. 2021. J Vet Intern Med. doi:10.1111/jvim.16147
69. Gomez DE et al. 2024. Equine Vet J. doi:10.1111/evj.14032
70. Wylie CE et al. 2013. Vet J. doi:10.1016/j.tvjl.2013.08.028
71. Wylie CE et al. 2013. Equine Vet J. doi:10.1111/evj.12047
72. Pollard D et al. 2019. Equine Vet J. doi:10.1111/evj.13059
73. Pollard D et al. 2017. Equine Vet J. doi:10.1111/evj.12704
74. de Laat MA et al. 2019. J Vet Intern Med. doi:10.1111/jvim.15497
75. Wylie CE et al. 2016. Vet Rec. doi:10.1136/vr.103588
76. Meier A et al. 2019. PeerJ. doi:10.7717/peerj.7084 [FT]
77. Meier A et al. 2021. BMC Vet Res. doi:10.1186/s12917-020-02715-7 [FT]
78. Orsini JA et al. 2010. Can Vet J. PMID 20808574
79. Menzies-Gow NJ et al. 2010. Vet Rec. doi:10.1136/vr.c3206
80. Pollitt CC, Davies CT. 1998. Equine Vet J Suppl. doi:10.1111/j.2042-3306.1998.tb05131.x [2°]
81. Brown H. 2019. Veterinary Evidence. doi:10.18849/ve.v4i4.253
82. Wylie CE et al. 2015. Vet Rec. doi:10.1136/vr.102426
83. van Eps A et al. 2021. Vet Clin N Am Equine. doi:10.1016/j.cveq.2021.08.002
84. van Eps AW et al. 2021. Equine Vet J. doi:10.1111/evj.13356
85. Medina-Torres CE et al. 2016. Equine Vet J. doi:10.1111/evj.12377
86. Engiles JB et al. 2025. Am J Vet Res. doi:10.2460/ajvr.24.09.0268
87. Turner TA. 1991. Vet Clin N Am Equine. doi:10.1016/s0749-0739(17)30502-3
88. Soroko M et al. 2013. J Equine Vet Sci. doi:10.1016/j.jevs.2012.11.009
89. Westermann S et al. 2013. JAVMA. doi:10.2460/javma.242.3.388
90. Soroko M et al. 2017. J Therm Biol. doi:10.1016/j.jtherbio.2017.03.018
91. Soroko M, Howell K. 2018. J Equine Vet Sci. doi:10.1016/j.jevs.2016.11.002
92. da Silva BBM et al. 2026. J Equine Vet Sci. doi:10.1016/j.jevs.2026.106149
93. Landman MA et al. 2004. Vet Rec. doi:10.1136/vr.155.6.165
94. Horan K et al. 2026. BMC Vet Res. doi:10.1186/s12917-026-05804-1
95. Hitchens PL et al. 2019. Vet J. doi:10.1016/j.tvjl.2018.11.014
96. Wong ASM et al. 2023. Equine Vet J. doi:10.1111/evj.13581
97. Bogossian PM et al. 2024. Sci Rep. doi:10.1038/s41598-024-79071-1
98. Reix CE et al. 2015. PLoS One. doi:10.1371/journal.pone.0124342

### Vital signs and heat (V)

1. Lampang KN, Isawirodom A, Rungsri P. 2023. Correlation and agreement between infrared thermography and a thermometer for equine body temperature. Vet World. doi:10.14202/vetworld.2023.2464-2470
2. Jansson A, Lindgren G, Velie BD, Solé M. 2021. Factors influencing basal eye temperature in the domestic horse (infrared thermography). Physiol Behav. doi:10.1016/j.physbeh.2020.113218
3. Zobrist C et al. 2024. Noncontact infrared thermometer measurements offer a reasonable alternative to rectal temperature in afebrile horses. JAVMA. doi:10.2460/javma.23.12.0714
4. Zakari FO, Ayo JO. 2021. Body temperature in donkeys with rectal, infrared and mercury thermometers, hot-dry season. Int J Biometeorol. doi:10.1007/s00484-021-02087-z
5. Rushton JO, Tichy A, Nell B. 2015. Thermography and thermometry in the diagnosis of uveitis in horses. Vet Rec Open. doi:10.1136/vetreco-2014-000089
6. Aragona F et al. 2024. Eye temperature by infrared thermography to assess stress responses to road transport in horses. Animals. doi:10.3390/ani14131877
7. Redaelli V et al. 2019. Infrared thermography as stress indicator in horses trained for endurance. Animals. doi:10.3390/ani9030084
8. Fenner K et al. 2016. The effect of noseband tightening on horses' behaviour, eye temperature and cardiac responses. PLoS One. doi:10.1371/journal.pone.0154179
9. Soroko M et al. 2021. Maximum eye temperature and plasma cortisol in racehorses during intensive training. Pol J Vet Sci. doi:10.24425/pjvs.2021.138730
10. Martins CF et al. 2022. Infrared thermography of body temperature as a stress indicator in ridden and lunged horses. Animals. doi:10.3390/ani12233255
11. Esteves Trindade PH et al. 2019. Eye surface temperature as an indicator of physical fitness in ranch horses. J Equine Vet Sci. doi:10.1016/j.jevs.2018.11.015
12. McManus R et al. 2022. Thermography for disease detection in livestock: a scoping review. Front Vet Sci. doi:10.3389/fvets.2022.965622 [full text]
13. Verdegaal EJMM et al. 2022. Is skin surface temperature a reliable proxy for thermoregulation in endurance horses? Front Vet Sci. doi:10.3389/fvets.2022.894146
14. Robinson JA et al. 2008. Percutaneous thermal sensing microchip vs digital rectal thermometer. JAVMA. doi:10.2460/javma.233.4.613
15. Kang H et al. 2022. Thermal sensing microchips to measure body temperature in horses during and after exercise. Animals. doi:10.3390/ani12101267
16. Auclair-Ronzaud J et al. 2020. No-contact microchip monitoring of body temperature in yearling horses. J Equine Vet Sci. doi:10.1016/j.jevs.2019.102892
17. Schroter RC, Marlin DJ. 1995. An index of the environmental thermal load on exercising horses and riders. Equine Vet J Suppl. doi:10.1111/j.2042-3306.1995.tb05003.x
18. Takahashi Y, Takahashi T. 2019. Risk factors for exertional heat illness in Thoroughbred racehorses in Japan. Equine Vet J. doi:10.1111/evj.13179
19. Trigg L et al. 2023. Risk factors for and prediction of exertional heat illness at British racecourses. Sci Rep. doi:10.1038/s41598-023-27892-x
20. Santana ML, Bignardi AB. 2026. Thermal thresholds in barrel racing performance across temperature-humidity indices. J Anim Breed Genet. doi:10.1111/jbg.70056
21. Brownlow MA, Brotherhood JR. 2021. Environmental variables influencing post-race exertional heat illness. Aust Vet J. doi:10.1111/avj.13108
22. Brownlow MA, Dart AJ, Jeffcott LB. 2016. Exertional heat illness in racing Thoroughbreds in hot and humid climates (review). Aust Vet J. doi:10.1111/avj.12454
23. Marlin DJ et al. 1996. Non-heat-acclimated horses on a treadmill in cool, hot-dry and hot-humid conditions. Equine Vet J Suppl. PMID 8894553
24. Equine Guelph. Appendix C: Vital signs in horses and donkeys (Code of Practice) [web summary]
25. Kang H et al. 2023. Heat stress in horses: a literature review. Int J Biometeorol. doi:10.1007/s00484-023-02467-7
26. Marlin DJ et al. 2001. Recovery from transport and acclimatisation of competition horses in a hot humid environment. Equine Vet J. doi:10.2746/042516401776249507
27. Honstein RB, Monty DE. 1977. Physiologic responses of the horse to a hot, arid environment. Am J Vet Res. PMID 883712
28. Marlin DJ et al. 1999. Treadmill tests in heat and humidity before and after humid-heat acclimation. Equine Vet J. doi:10.1111/j.2042-3306.1999.tb03788.x
29. Johnson PJ et al. 2010. An epidemiologic study of anhidrosis in horses in Florida. JAVMA. doi:10.2460/javma.236.10.1091
30. Jenkinson DM, Elder HY, Bovell DL. 2007. Equine sweating and anhidrosis, part 2. Vet Dermatol. doi:10.1111/j.1365-3164.2007.00571.x [listed only]
31. Pritchard JC, Barr ARS, Whay HR. 2006. Behavioural measure of heat stress and skin tent test in working horses and donkeys. Equine Vet J. doi:10.2746/042516406778400646
32. Pritchard JC et al. 2008. Validity of indicators of dehydration in working horses. Equine Vet J. doi:10.2746/042516408x297462
33. Chen J et al. 2025. Respiratory rate of dairy cows from infrared thermography with head movement. J Therm Biol. doi:10.1016/j.jtherbio.2025.104154
34. Rzucidlo CL et al. 2023. Respiration and heart rate across wildlife species by Eulerian video magnification of thermal imagery. BMC Biol. doi:10.1186/s12915-023-01555-9
35. Zhao X et al. 2025. Remote vital sensing in clinical veterinary medicine (review). Animals. doi:10.3390/ani15071033
36. Hodgson DR, Davis RE, McConaghy FF. 1994. Thermoregulation in the horse in response to exercise. Br Vet J. PMID 8044664
37. Geor RJ et al. 2000. Heat storage in horses before and after humid heat acclimation. J Appl Physiol. doi:10.1152/jappl.2000.89.6.2283 [listed only]
38. Kapteijn CM et al. 2022. Heart rate variability with a heart rate monitor in horses during groundwork. Front Vet Sci. doi:10.3389/fvets.2022.939534
39. Frippiat T et al. 2021. Accuracy of a heart rate monitor for HRV in exercising horses. J Equine Vet Sci. doi:10.1016/j.jevs.2021.103716
40. Vitale V et al. 2020. Prognostic value of HRV at admission in horses with colic. Am J Vet Res. doi:10.2460/ajvr.81.2.147
41. Rietmann TR et al. 2004. Heart rate, HRV, endocrine and behavioural pain measures in laminitic horses. J Vet Med A. doi:10.1111/j.1439-0442.2004.00627.x
42. Gehlen H et al. 2020. Disease severity, HRV and serum cortisol in horses with acute abdominal disease. Animals. doi:10.3390/ani10091563
43. McConachie E et al. 2016. HRV in horses with acute GI disease requiring laparotomy. J Vet Emerg Crit Care. doi:10.1111/vec.12362 [listed only]
44. Lindner A et al. 2020. Relationship between resting and recovery heart rate in horses. Animals. doi:10.3390/ani10010120
45. Piccione G et al. 2009. Time of day and body temperature, heart rate and blood pressure in exercising horses. Chronobiol Int. doi:10.1080/07420520802689772
46. Giannetto C et al. 2022. Diurnal variation in rectal and cutaneous temperatures under different management. Int J Biometeorol. doi:10.1007/s00484-022-02304-3
47. Ayo JO et al. 2014. Diurnal and seasonal fluctuations in vital signs of pack donkeys, tropical savannah. J Equine Sci. doi:10.1294/jes.25.1
48. Pusterla N et al. 2025. Management of an EHV-1 outbreak during a multi-week equestrian event. Viruses. doi:10.3390/v17050608
49. Lunn DP et al. 2024. Updated ACVIM consensus statement on EHV-1. J Vet Intern Med. doi:10.1111/jvim.17047
50. AAEP General Biosecurity Guidelines; The Horse, "Equine (rectal) temperature monitoring" [web summaries]
51. Tadich T et al. 2025. Working like a mule? The physiological toll of heavy loads on mules. Front Vet Sci. doi:10.3389/fvets.2025.1725279
52. Ali ABA et al. 2015. Are mules or donkeys better adapted for Egyptian brick-kiln work? J Vet Behav. doi:10.1016/j.jveb.2014.12.003 [title only]
53. Olaifa F et al. 2019. Pack donkeys in the hot-dry season, northern Nigeria. Trop Anim Health Prod. doi:10.1007/s11250-018-1702-8
54. Castanheira M et al. 2010. Heat-tolerance characteristics of horses in Brazil. Trop Anim Health Prod. doi:10.1007/s11250-009-9404-x
55. Priyanka M et al. 2020. Ashwagandha root extract in an equine model (Kathiawari). Front Vet Sci. doi:10.3389/fvets.2020.541112
56. Brooke India. Heat stress in brick-kiln equids [grey literature]
57. Heat-index rule sources: USPolo, University of Georgia, Horse Illustrated [grey literature; none cites a study]
58. Srinivasan P et al. 2023. Kathiawari horse exercise physiology (preprint). doi:10.22541/au.170057387.74422839/v1 [title only]
59. Arfuso F et al. 2025. Ambient temperature, humidity and THI on stress and inflammation in Standardbreds. Animals. doi:10.3390/ani15101436 [listed only]

### Breathing and infectious disease (D)

1. Couëtil L et al. 2020. Equine asthma: current understanding and future directions. Front Vet Sci. doi:10.3389/fvets.2020.00450 [full text]
2. Couëtil LL et al. 2016. Inflammatory airway disease of horses — revised consensus statement. J Vet Intern Med. doi:10.1111/jvim.13824 [full text]
3. Hotchkiss JW, Reid SW, Christley RM. 2007. Owner survey, risk factors for RAO. Equine Vet J. doi:10.2746/042516407x180129
4. Bullone M, Murcia RY, Lavoie JP. 2016. Environmental heat and pollen and asthma severity in horses. Equine Vet J. doi:10.1111/evj.12559
5. Rettmer H et al. 2014. Owner-reported coughing and nasal discharge in RAO horses. Equine Vet J. doi:10.1111/evj.12286
6. Behan AL, Hauptman JG, Robinson NE. 2013. Telemetric breathing-pattern variability in RAO-affected horses. Am J Vet Res. PMID 23718662
7. Röschmann J et al. 2025. Respiratory rate recovery after lunging is delayed in asthmatic horses. Animals. doi:10.3390/ani15050713
8. Clements JM, Pirie RS. 2007. Respirable dust concentrations in equine stables, part 2. Res Vet Sci. doi:10.1016/j.rvsc.2006.12.003
9. Lunn DP et al. 2009. EHV-1 consensus statement. J Vet Intern Med. doi:10.1111/j.1939-1676.2009.0304.x
10. Pusterla N et al. 2021. An EHV-1 outbreak caused by a new H752 genotype. Pathogens. doi:10.3390/pathogens10060747 [full text]
11. Pusterla N et al. 2024. Outbreak of EHM in aged working equids. Viruses. doi:10.3390/v16121963
12. Stokes A, Corteyn AH, Murray PK. 1991. Clinical signs after EHV-1 infection. Res Vet Sci. doi:10.1016/0034-5288(91)90004-8
13. Boyle AG et al. 2018. Streptococcus equi infections — revised strangles consensus statement. J Vet Intern Med. doi:10.1111/jvim.15043 [full text]
14. Duz M et al. 2010. A digital audio recording method for cough in the horse. Res Vet Sci. doi:10.1016/j.rvsc.2010.03.005
15. Vandermeulen J et al. 2016. Bovine respiratory disease by continuous cough-sound monitoring. Comput Electron Agric. doi:10.1016/j.compag.2016.07.014 [full text]
16. Garrido LFC et al. 2023. Can we reliably detect respiratory diseases through precision farming? (systematic review). Animals. doi:10.3390/ani13071273
17. AAEP. EHV-1 and EHV-4 guidelines (2021) [search summary only]
18. Singh RK et al. 2018. A comprehensive review on equine influenza virus. Front Microbiol. PMID 30237788 [full text]
19. (= V2) Jansson A et al. 2021. Basal eye temperature in horses. Physiol Behav. doi:10.1016/j.physbeh.2020.113218
20. Hall EJ et al. 2019. A yard-specific normal rectal temperature range for horses. J Equine Vet Sci. doi:10.1016/j.jevs.2018.12.023
21. (= V12) McManus R et al. 2022. Thermography for disease detection in livestock. Front Vet Sci. doi:10.3389/fvets.2022.965622
22. Singha H et al. 2020. Glanders surveillance among indigenous equines in India, 2015–2018. Transbound Emerg Dis. doi:10.1111/tbed.13475
23. Singha H et al. 2026. Surveillance of equine glanders in India (2019–2023). Microb Pathog. doi:10.1016/j.micpath.2026.108597
24. Singha H. Glanders control status in India (ICAR-NRCE slides, WOAH Asia) [slides]
25. Torres AG. 2025. Glanders: an ancient and emergent disease. PLoS Negl Trop Dis. doi:10.1371/journal.pntd.0013160 [full text]
26. Raj A et al. 2024. Awareness of equine glanders among veterinarians and physicians in India. Front Vet Sci. doi:10.3389/fvets.2024.1334485
27. Kumar R et al. 2013. T. evansi seroprevalence in equids of north and north-western India. Vet Parasitol. doi:10.1016/j.vetpar.2013.04.018
28. Raftery AG et al. 2025. Equine trypanosomiasis: systematic review and meta-analyses. Equine Vet J. doi:10.1111/evj.70101
29. Javanshir A et al. 2023. T. evansi in horses of Iran. Parasitol Res. doi:10.1007/s00436-023-07888-2
30. Dahiya R et al. 2018. Risk factors for Theileria equi in semi-arid and sub-humid zones. Vet Parasitol Reg Stud Rep. doi:10.1016/j.vprsr.2018.01.005
31. Sumbria D et al. 2015. T. equi and B. caballi in equids of Punjab. Trop Anim Health Prod. doi:10.1007/s11250-015-0917-1
32. Maharana BR et al. 2024. Theileria equi genotype in northern India. Res Vet Sci. doi:10.1016/j.rvsc.2024.105277
33. Virmani N et al. 2010. Descriptive epidemiology of equine influenza in India (2008–2009). Rev Sci Tech. PMID 21120800
34. Mavadiya SV et al. 2012. Epidemiological survey of equine influenza in India. Rev Sci Tech. doi:10.20506/rst.31.3.2164
35. Kapdi A et al. 2022. Japanese encephalitis seropositivity in Indian equines. J Equine Vet Sci. doi:10.1016/j.jevs.2021.103809
36. Takahashi Y et al. 2024. Freedom of head movement, stress and airway bacteria during transport. Front Vet Sci. doi:10.3389/fvets.2024.1477653
37. EFSA AHAW Panel. 2022. Welfare of equidae during transport. EFSA J. doi:10.2903/j.efsa.2022.7444
38. Oikawa M et al. 2005. Orientation, rest and vehicle cleaning and transport-related respiratory disease. J Comp Pathol. doi:10.1016/j.jcpa.2004.09.006
39. Padalino B et al. 2025. Transport-related respiratory pathogens in long-distance horses. Res Vet Sci. doi:10.1016/j.rvsc.2024.105498
40. Malik P et al. 2013. Sero-surveillance of equine infectious anaemia in India (1999–2012). VirusDis. doi:10.1007/s13337-013-0142-3
41. Government of India. The Prevention and Control of Infectious and Contagious Diseases in Animals Act, 2009 (Act 27 of 2009). PRS India copy [full text: Schedule, sections 4, 5, 45]
42. DAHD, Government of India. National Action Plan on Glanders [read relevant sections]
43. Lunn DP et al. 2024. Updated ACVIM consensus statement on EHV-1. J Vet Intern Med. doi:10.1111/jvim.17047 [full text]
44. Hudson LC et al. 1996. Clinical presentation of experimentally induced rabies in horses. Zentralbl Veterinarmed B. doi:10.1111/j.1439-0450.1996.tb00315.x
45. de Melo UP, Ferreira C. 2022. 17 cases of tetanus in horses. Braz J Vet Med. doi:10.29374/2527-2179.bjvm005321
46. Bertram FM et al. 2020. West Nile virus in horses in South Africa, 2016–2017. Pathogens. doi:10.3390/pathogens10010020
47. Morita K et al. 2015. Japanese encephalitis. Rev Sci Tech. doi:10.20506/rst.34.2.2370
48. Yadav SC et al. 2019. T. evansi seroprevalence in north and north-western India. J Equine Vet Sci. doi:10.1016/j.jevs.2019.05.019
49. Maharana BR et al. 2026. Molecular characterisation and risk factors of Theileria equi. Exp Parasitol. doi:10.1016/j.exppara.2026.109135
50. Sumbria D et al. 2017. Molecular survey of T. equi in Punjab. Vet Parasitol Reg Stud Rep. doi:10.1016/j.vprsr.2017.01.009
51. Malik P et al. 2012. Emergence and re-emergence of glanders in India, 2006–2011. Rev Sci Tech. PMID 22718333

### Behaviour, sleep and welfare (E)

Numbers follow the research notes; a few carry letters (14b, 17b, 18b, 24b, 29b) and some numbers are unused.

1. Auer U et al. 2021. Activity time budgets, a potential tool to monitor equine welfare? Animals. doi:10.3390/ani11030850
2. Kelemen Z et al. 2021. Recumbency as an equine welfare indicator in geriatric and chronically lame horses. Animals. doi:10.3390/ani11113189
4. Helmerich P, Bachmann I, Gygax L. 2024. Lying behaviour of young horses in a box, a paddock alone or in pairs. Equine Vet J. doi:10.1111/evj.14041
5. Gobbo E et al. 2025. Housing routine and lying behaviour (triaxial accelerometer). Front Vet Sci. doi:10.3389/fvets.2025.1572051
6. Burla JB et al. 2017. Space allowance of the littered area and lying in group-housed horses. Front Vet Sci. doi:10.3389/fvets.2017.00023
7. Zimmer L et al. 2026. Sleep architecture and lying across ages and two housing systems. Front Vet Sci. doi:10.3389/fvets.2026.1898580
8. Outouil M et al. 2026. Short-term stall size and horse behaviour and welfare. J Am Assoc Lab Anim Sci. doi:10.30802/aalas-jaalas-25-152
9. Greening L et al. 2025. Lighting and sleep behaviour in stabled riding-school horses. PLoS One. doi:10.1371/journal.pone.0326567
10. Bergeler J et al. 2025. First night effect alters brain connectivity in horses. Sci Rep. doi:10.1038/s41598-025-14830-2
11. Greening L, McBride S. 2022. A review of equine sleep. Front Vet Sci. doi:10.3389/fvets.2022.916737
12. Suomala H et al. 2025. Owner-reported sleep disturbances in Nordic horses. Equine Vet J. doi:10.1111/evj.14560
13. Giannone C et al. 2026. Monitoring horse behaviour with deep learning models. Vet Q. doi:10.1080/01652176.2026.2665442
14. Eerdekens A et al. 2024. Automatic early detection of induced colic (accelerometers). Equine Vet J. doi:10.1111/evj.14069
14b. Anderson K et al. 2023. Inertial measurement units to detect horse behaviour while stabled. Equine Vet J. doi:10.1111/evj.13909
15. Nabenishi H et al. 2026. Two-phase foaling prediction with thermal imaging and AI behaviour analysis. Animals. doi:10.3390/ani16142221
16. Fuchs C et al. ISES 2018 conference report via "Sleep deprivation in horses", Horses and People [secondary]. Also Nabenishi H et al. 2025. Prediction of parturition by camera image analysis. J Equine Vet Sci. doi:10.1016/j.jevs.2025.105572
17. Bertone JJ. 2006. Excessive drowsiness secondary to recumbent sleep deprivation in two horses. Vet Clin N Am Equine. doi:10.1016/j.cveq.2005.12.020 [title only]
17b. Aoki T et al. 2023. Foaling detection with a tail-attached thermistor and accelerometer. PLoS One. doi:10.1371/journal.pone.0286807
18. Hämäläinen MJ et al. 2026. Horse sleep behaviour and a reversal-learning test. Sci Rep. doi:10.1038/s41598-025-34463-9
18b. Rial C et al. 2023. Metritis and mastitis and rumination, activity and lying in dairy cows. J Dairy Sci. doi:10.3168/jds.2022-23157
19. Gusterer E et al. 2020. Rumination and activity for early identification of disease in cows. Theriogenology. doi:10.1016/j.theriogenology.2020.07.028
20. Bowen JM et al. 2021. Early prediction of respiratory disease in calves from feeding and activity. J Dairy Sci. doi:10.3168/jds.2021-20373
21. Fureix C et al. 2012. Towards an ethological animal model of depression? A study on horses. PLoS One. doi:10.1371/journal.pone.0039280
22. Dai F et al. 2020. Does 30-minute training improve inter-observer reliability of the Horse Grimace Scale? Animals. doi:10.3390/ani10050781
23. (= C11) Escalona EE et al. 2014. Colic in crib-biting horses. BMC Vet Res. doi:10.1186/1746-6148-10-S1-S3
24. Annan R et al. 2025. Welfare assessment of racehorses: a baseline. Equine Vet J. doi:10.1111/evj.14510
24b. Hildebrand WH, Zaleśny G. 2025. Do stereotypies help or harm? Cortisol and abnormal behaviours. Front Zool. doi:10.1186/s12983-025-00576-0
25. Lewis K et al. 2022. Risk factors for stereotypic behaviour in captive ungulates. Proc R Soc B. doi:10.1098/rspb.2022.1311
26. McGreevy PD et al. 1995. Management factors and stereotypic behaviour in Thoroughbreds. Equine Vet J. doi:10.1111/j.2042-3306.1995.tb03041.x
27. Wickens CL et al. 2013. Gastric ulceration and gastrin in crib-biting horses. J Equine Vet Sci. doi:10.1016/j.jevs.2012.12.004
28. Nicol CJ et al. 2002. Crib-biting and gastric inflammation and ulceration in young horses. Vet Rec. doi:10.1136/vr.151.22.658
29. Raabymagle P, Ladewig J. 2006. Lying behaviour and box size. J Equine Vet Sci. doi:10.1016/j.jevs.2005.11.015
29b. Ermers C et al. 2023. The fibre requirements of horses and the consequences of not meeting them. Animals. doi:10.3390/ani13081414
30. Ninomiya S et al. 2008. Bedding material and lying behaviour in stabled horses. J Equine Sci. doi:10.1294/jes.19.53 [full text]
31. Dallaire A, Ruckebusch Y. 1974. Sleep and wakefulness in the housed pony. Can J Comp Med. PMID 4272959
32. Kjellberg L et al. 2021. Use of lying halls and time budget vs available lying area. Animals. doi:10.3390/ani11113214
33. (= N19) Kelemen Z et al. 2021. Equine activity time budgets: geriatric and chronically lame horses. Animals. doi:10.3390/ani11071867
34. Carvalho Seabra J et al. 2023. Time budget and welfare in three stall architectures. J Equine Vet Sci. doi:10.1016/j.jevs.2023.104936
35. Christie JL et al. 2006. Stereotypies and body condition in non-racing horses, Prince Edward Island. Can Vet J. PMID 16579039
36. McBride SD, Long L. 2001. Management of horses showing stereotypic behaviour. Vet Rec. doi:10.1136/vr.148.26.799
37. Schork IG et al. 2018. Personality, abnormal behaviour and health in police horses. PLoS One. doi:10.1371/journal.pone.0202750
38. Bachmann I et al. 2003. Risk factors for crib-biting, weaving and box-walking in Swiss horses. Equine Vet J. doi:10.2746/042516403776114216
39. Hausberger M et al. 2009. Could work be a source of behavioural disorders? PLoS One. doi:10.1371/journal.pone.0007625
40. Malamed R et al. 2010. Crib-biting and windsucking as risk factors for colic. Equine Vet J. doi:10.1111/j.2042-3306.2010.00096.x
41. Hemmann K et al. 2012. Ghrelin and stress hormones in crib-biting horses. Vet J. doi:10.1016/j.tvjl.2011.09.027
42. Minero M et al. 1999. Heart rate and behaviour of crib-biting horses under stress. Vet Rec. doi:10.1136/vr.145.15.430
43. Lebelt D, Zanella AJ, Unshelm J. 1998. Physiological correlates of cribbing. Equine Vet J Suppl. PMID 10484999
44. Albright JD et al. 2015. Anti-crib devices: behaviour and physiology. Equine Vet J. doi:10.1111/evj.12534
45. McGreevy P, Nicol C. 1998. Short-term prevention of crib-biting. Physiol Behav. doi:10.1016/s0031-9384(98)00070-5
46. Bohák Z et al. 2013. Circadian rhythm of serum and salivary cortisol in the horse. Domest Anim Endocrinol. doi:10.1016/j.domaniend.2013.04.001
47. Pawluski J et al. 2017. Low cortisol as an indicator of compromised welfare in horses. PLoS One. doi:10.1371/journal.pone.0182257
48. Bazzano M et al. 2024. Competition, stereotypies and salivary stress markers in Thoroughbreds. PLoS One. doi:10.1371/journal.pone.0311697
49. (= V6) Aragona F et al. 2024. Eye temperature and road transport stress. Animals. doi:10.3390/ani14131877
50. (= V42) Gehlen H et al. 2020. HRV and cortisol in acute abdominal pain. Animals. doi:10.3390/ani10091563
51. (= V41) Rietmann TR et al. 2004. HRV and pain in laminitis. J Vet Med A. doi:10.1111/j.1439-0442.2004.00627.x
52. Czycholl I et al. 2019. Inter-observer reliability of the AWIN horse protocol. J Equine Vet Sci. doi:10.1016/j.jevs.2019.02.005
53. Czycholl I et al. 2018. Reliability of the AWIN two-level approach. Animals. doi:10.3390/ani8010007
54. Wathan J et al. 2015. EquiFACS: the Equine Facial Action Coding System. PLoS One. doi:10.1371/journal.pone.0131738
55. Rashid M et al. 2020. EquiFACS for pain-related facial responses in videos. PLoS One. doi:10.1371/journal.pone.0231608
56. (= G22) Lencioni GC et al. 2021. Automatic facial expression pain recognition. PLoS One. doi:10.1371/journal.pone.0258672
57. Thomas M et al. 2024. Repeatability and predictability of lying and feeding in dairy cattle. Prev Vet Med. doi:10.1016/j.prevetmed.2024.106357
58. Müller R, Schrader L. 2005. Individual consistency of dairy cows' activity. J Dairy Sci. doi:10.3168/jds.s0022-0302(05)72675-8

### Foaling and the newborn foal (F)

1. Diel de Amorim M et al. 2019. Comparison of foaling prediction technologies in Standardbred mares. J Equine Vet Sci. doi:10.1016/j.jevs.2019.02.015
2. Ley WB, Bowen JM, Purswell BJ. 1993. Calcium carbonate in prepartum mammary secretions. Theriogenology. doi:10.1016/0093-691x(93)90352-6
3. Magalhaes HB et al. 2024. Conductivity of mammary secretions predicts parturition. Equine Vet J. doi:10.1111/evj.14070
4. Korosue K et al. 2013. pH and refractometry vs calcium in preparturient mammary secretions. JAVMA. doi:10.2460/javma.242.2.242
5. Brown-Douglas CG et al. 2002. Prediction of foaling using mammary secretion constituents. N Z Vet J. PMID 16032219
6. Jung Y, Chang H, Yoon M. 2022. A foaling alarm system using an accelerometer. J Anim Sci Technol. doi:10.5187/jast.2022.e75
7. Shaw EB, Houpt KA, Holmes DF. 1988. Body temperature and behaviour of mares in the last two weeks of pregnancy. Equine Vet J. doi:10.1111/j.2042-3306.1988.tb01499.x
8. Auclair-Ronzaud J et al. 2020. Microchip temperature and behaviour before foaling. Theriogenology. doi:10.1016/j.theriogenology.2020.08.004
9. Hartmann C et al. 2018. Detecting foaling by accelerometer: a pilot study. Reprod Domest Anim. doi:10.1111/rda.13250
10. Davies Morel MCG, Newcombe JR, Holland SJ. 2002. Factors affecting gestation length in the Thoroughbred. Anim Reprod Sci. doi:10.1016/s0378-4320(02)00171-9
11. Valera M et al. 2006. Genetics of gestation length in Andalusian and Arabian mares. Anim Reprod Sci. doi:10.1016/j.anireprosci.2005.09.008
12. Satué K et al. 2011. Gestation length in Carthusian broodmares. Pol J Vet Sci. doi:10.2478/v10181-011-0027-6
13. Sevinga M et al. 2004. Retained placenta in Friesian mares. Theriogenology. doi:10.1016/s0093-691x(03)00260-7
14. Silva et al. 2025. Gestation length of Thoroughbreds in tropical and subtropical climates. Theriogenology. doi:10.1016/j.theriogenology.2024.12.017
15. Malinska J et al. 2019. Gestation length in the Old Kladruber horse. Theriogenology. doi:10.1016/j.theriogenology.2019.02.013
16. Nabenishi H et al. 2026. Two-phase foaling prediction with thermal imaging and AI behaviour analysis. Animals. doi:10.3390/ani16142221
17. Aoki T et al. 2023. Foaling detection with a tail-attached device. PLoS One. doi:10.1371/journal.pone.0286807
18. Aoki T et al. 2026. Predicting nocturnal foaling from tail-base surface temperature. Animals. doi:10.3390/ani16020199
19. Lindinger H, Wehrend A. 2023. A transponder birth-monitoring system attached to the vulva. Vet World. doi:10.14202/vetworld.2023.2451-2456 [full text]
20. Lindinger H, Wehrend A. 2024. Behaviour of mares in the opening phase of parturition. Animals. doi:10.3390/ani14071036
21. Arnold CE et al. 2008. Periparturient haemorrhage in mares: 73 cases. JAVMA. doi:10.2460/javma.232.9.1345
22. Wang B et al. 2025. Detecting mare parturition with an improved Libra-RCNN. PLoS One. doi:10.1371/journal.pone.0318498
23. Ellerbrock RE, Wehrend A. 2023. Dystocia in horses: a literature review. Tierarztl Prax Grosstiere. doi:10.1055/a-2006-9248
24. McCue PM, Ferris RA. 2012. Parturition, dystocia and foal survival: 1,047 births. Equine Vet J Suppl. doi:10.1111/j.2042-3306.2011.00476.x
25. Lanci A et al. 2022. Dystocia in the Standardbred mare, 2004–2020. Animals. doi:10.3390/ani12121486
26. Ousey JC, Delclaux M, Rossdale PD. 1989. Strip tests for electrolytes in prepartum mammary secretions. Equine Vet J. doi:10.1111/j.2042-3306.1989.tb02143.x
27. Norton JL et al. 2007. Dystocia at a referral hospital. Equine Vet J. doi:10.2746/042516407x165414
28. Schurmann S et al. 2019. Retained placenta in mares: 121 cases. Tierarztl Prax Grosstiere. doi:10.1055/a-1019-7345 (foal "1-2-3" and vital-sign figures in Part F come from web pages, not this paper)
29. Rosales Jimenez Y et al. 2017. Periparturient characteristics on a New Zealand Thoroughbred stud. N Z Vet J. doi:10.1080/00480169.2016.1244021
30. Dicken M et al. 2012. Gestation length and daytime foaling of Standardbreds in New Zealand. N Z Vet J. doi:10.1080/00480169.2011.632340
31. Nagel C et al. 2020. Road transport of late-pregnant mares advances foaling. J Equine Vet Sci. PMID 32067658
32. Canisso IF et al. 2024. Storage temperature and pH of mammary secretions. Animals. doi:10.3390/ani14172598
33. Factors affecting gestation length in artificially inseminated Marwari mares of India. 2016. Asian Pac J Reprod. doi:10.1016/j.apjr.2016.10.004 (figures from a search snippet)
34. Suchitra BR et al. 2022. Gestation length in Thoroughbreds bred at foal heat in India. Indian J Anim Sci. doi:10.56093/ijans.v92i3.122260
35. Joshi G et al. 2024. Neonatal behaviour of Marwari foals (preprint). doi:10.22541/au.172471990.02937839/v1
36. Bindi R et al. 2023. Apgar score and clinical parameters in newborn mule foals. J Equine Vet Sci. doi:10.1016/j.jevs.2023.104917
37. Raidal SL. 1996. Failure of passive transfer on a Thoroughbred farm. Aust Vet J. doi:10.1111/j.1751-0813.1996.tb10035.x
38. Magalhaes HB, Canisso IF. 2025. Colostrum conductivity, pH and Brix as predictors of passive transfer. Equine Vet J. doi:10.1111/evj.14421
39. Weber EJ, Sanchez LC, Giguère S. 2015. Re-evaluation of the sepsis score in equine neonates. Equine Vet J. doi:10.1111/evj.12279
40. Wilkins PA et al. 2025. SIRS and predictors of infection and death in 1,068 newborn foals. J Vet Intern Med. doi:10.1111/jvim.70004
41. Nistor P et al. 2026. Maternal rejection in mares: 27 cases. Vet Sci. doi:10.3390/vetsci13090846
42. Juarbe-Diaz SV, Houpt KA, Kusunose R. 1998. Foal rejection in Arabian mares. Equine Vet J. doi:10.1111/j.2042-3306.1998.tb04513.x
43. Orellana-Guerrero D et al. 2019. Fungal placentitis in a mare (case report). J Equine Vet Sci. doi:10.1016/j.jevs.2019.102799
44. Hemberg E, Morrell JM. 2025. Equine ascending placentitis: 17 case reports. Front Vet Sci. doi:10.3389/fvets.2025.1591452
45. Kimura et al. 2018. Combined thickness of uterus and placenta in heavy draft horses. J Equine Sci. doi:10.1294/jes.29.1
46. Canton GJ et al. 2023. Equine abortion and stillbirth in California: 1,774 cases. J Vet Diagn Invest. doi:10.1177/10406387231152788

### Monitoring technology (G)

1. (= V2) Jansson A et al. 2021. Physiol Behav. doi:10.1016/j.physbeh.2020.113218
2. (= V1) Lampang KN et al. 2023. Vet World. doi:10.14202/vetworld.2023.2464-2470
3. McManus R et al. 2022. Thermography for disease detection in livestock. Front Vet Sci. doi:10.3389/fvets.2022.965622 [full text]
4. Soroko M, Howell K. 2018. Infrared thermography in equine medicine. J Equine Vet Sci. doi:10.1016/j.jevs.2016.11.002
5. Wang Q et al. 2021. Infrared thermography for elevated body temperature: accuracy and calibration. Sensors. doi:10.3390/s22010215 [full text]
6. Bhattacharjee D, Mason MA, McElligott AG. 2026. Reliability and precision of thermal imaging measurements. PeerJ. doi:10.7717/peerj.20861
7. Aarts RM et al. 2025. Technologies for equine welfare and performance monitoring under field conditions. Equine Vet J. doi:10.1111/evj.70092 [full text]
8. Kwon HM et al. 2020. Non-contact thermography-based respiratory rate monitoring after anaesthesia. J Clin Monit Comput. doi:10.1007/s10877-020-00595-8 [full text]
9. Parmentier JIM et al. 2026. Detecting respiratory events in exercising horses with a microphone. BMC Vet Res. doi:10.1186/s12917-026-05614-5
10. Hu R et al. 2024. Contactless heart rate from pet facial videos. Front Vet Sci. doi:10.3389/fvets.2024.1495109
11. (= V35) Zhao X et al. 2025. Remote vital sensing in clinical veterinary medicine. Animals. doi:10.3390/ani15071033 [full text]
12. Giannone C et al. 2026. Monitoring horse behaviour with deep learning models. Vet Q. doi:10.1080/01652176.2026.2665442
13. Kil N, Ertelt K, Auer U. 2020. An automated video tracking model for stabled horses. Animals. doi:10.3390/ani10122258
14. Mathis A et al. 2019. Pretraining boosts out-of-domain robustness for pose estimation (Horse-10). arXiv:1909.11229
15. Yu H et al. 2021. AP-10K: animal pose estimation benchmark. arXiv:2108.12617
16. Yang Y et al. 2022. APT-36K. arXiv:2206.05683
17. Xu Y et al. 2022. ViTPose. arXiv:2204.12484
18. Pokropek E et al. 2023. Equine activity budgets from a 3D skeleton reconstructed from surveillance recordings. arXiv:2306.05311
19. Broomé S et al. 2019. Dynamics are important for the recognition of equine pain in video. arXiv:1901.02106 [full text]
20. Broomé S et al. 2021. Sharing pain: video recognition of low-grade orthopaedic pain in horses. arXiv:2105.10313 [full text]
21. Rashid M et al. 2021. Equine pain behaviour classification via self-supervised pose representation. arXiv:2108.13258 [full text]
22. Lencioni GC et al. 2021. Pain assessment in horses by automatic facial expression recognition. PLoS One. doi:10.1371/journal.pone.0258672 [full text]
23. Feighelstein M et al. 2024. Automated recognition of emotional states of horses from faces. PLoS One. doi:10.1371/journal.pone.0302893
24. Andersen PH et al. 2021. Towards machine recognition of facial expressions of pain in horses. Animals. doi:10.3390/ani11061643
25. Chiavaccini L et al. 2024. Animal pain recognition technologies (review). Front Vet Sci. doi:10.3389/fvets.2024.1436795
26. Trokielewicz M et al. 2018. Iris and periocular recognition in Arabian horses. arXiv:1809.00213
27. Taha A et al. 2017. Arabian horse identification benchmark dataset. arXiv:1706.04870
28. Gavojdian D et al. 2023. BovineTalk (cattle vocal identification). arXiv:2307.13994
29. Vanden Eynde R et al. 2025. The Nordic Thingy:53 for equine behaviour with edge AI (bioRxiv preprint). doi:10.64898/2025.12.05.692598
30. (= E5) Gobbo E et al. 2025. Front Vet Sci. doi:10.3389/fvets.2025.1572051
31. Taylor DEF et al. 2025. Sound recorders to measure grazing behaviour in horses. Animals. doi:10.3390/ani15152273
32. Mach N et al. 2026. AI acoustic surveillance for calf respiratory disease. Animal. doi:10.1016/j.animal.2026.101928
33. Yamsakul P et al. 2025. Machine-learning detection of pig coughs. Vet Sci. doi:10.3390/vetsci12090818
34. Sharifuzzaman M et al. 2026. Room-level acoustic monitoring of respiratory disturbance in pigs. Vet Sci. doi:10.3390/vetsci13060550
35. Dominiak KN, Kristensen AR. 2017. Prioritising alarms from sensor-based detection models in livestock. Comput Electron Agric. doi:10.1016/j.compag.2016.12.008
36. Sani MI et al. 2026. Precision livestock farming: challenges and opportunities. Anim Biosci. doi:10.5713/ab.250895 [full text]
37. Drew BJ et al. 2014. Insights into the problem of alarm fatigue with physiologic monitors. PLoS One. doi:10.1371/journal.pone.0110274
38. Bonafide CP et al. 2015. Non-actionable alarms and nurse response time in a children's hospital. J Hosp Med. doi:10.1002/jhm.2331
39. Web and company sources (not peer-reviewed): NIGHTWATCH pages; FDA "How FDA regulates animal devices"; AASV 2025 regulatory abstract; Soroko & Davies Morel, "Equine Thermography in Practice" (summary)

### Nutrition, working horses and mules (N)

1. McGowan TW, Pinchbeck GP, McGowan CM. 2012. Prevalence, risk factors and signs of PPID in aged horses. Equine Vet J. doi:10.1111/j.2042-3306.2012.00578.x
2. Carmalt JL, Waldner CL, Allen AL. 2017. International survey of vets on PPID. PMID 29081583
3. Billmann P et al. 2026. Beta-endorphin, ACTH, cortisol, age and signs of PPID. J Vet Intern Med. doi:10.1093/jvimsj/aalag023
4. Menzies-Gow NJ. 2025. Equine pituitary pars intermedia dysfunction. Vet Sci. doi:10.3390/vetsci12080780
5. Kirkwood NC et al. 2022. Seven horses transitioning to PPID. Vet Sci. doi:10.3390/vetsci9100572
6. Copas VE, Durham AE. 2012. Circannual variation in plasma ACTH. Equine Vet J. doi:10.1111/j.2042-3306.2011.00444.x
7. Durham AE et al. 2019. ECEIM consensus statement on equine metabolic syndrome. J Vet Intern Med. doi:10.1111/jvim.15423 [full text]
8. Morgan RA et al. 2014. Hyperinsulinaemia in ponies in Queensland. Aust Vet J. doi:10.1111/avj.12159
9. Bamford NJ et al. 2014. Breed differences in insulin sensitivity. Domest Anim Endocrinol. doi:10.1016/j.domaniend.2013.11.001
10. Davis EL et al. 2025. ACTH, insulin and adiponectin in sport horses. Animals. doi:10.3390/ani15091316
11. Pyrek P et al. 2023. Reproducibility of body condition scoring in Silesian horses. Vet Res Commun. doi:10.1007/s11259-022-09916-5
12. Busechian S et al. 2022. Can owners estimate body condition and cresty neck? Vet Sci. doi:10.3390/vetsci9100544
13. Ireland JL et al. 2011. Owner-reported vs veterinary-assessed health of geriatric horses. Equine Vet J. doi:10.1111/j.2042-3306.2011.00394.x
14. Webster AP et al. 2025. Thermal imaging to body-condition score horses and cows. Transl Anim Sci. doi:10.1093/tas/txaf121
15. Carroll CL, Huntington PJ. 1988. Body condition scoring and weight estimation of horses. Equine Vet J. doi:10.1111/j.2042-3306.1988.tb01451.x
16. Grimwood K et al. 2023. Factors affecting weigh-tape readings. Animals. doi:10.3390/ani13081330
17. (= C9) Williams S et al. 2014. Water intake, faecal output and motility from pasture to stable. Equine Vet J. doi:10.1111/evj.12238
18. Nyman S, Dahlborn K. 2001. Water supply method, flow rate and drinking. Physiol Behav. doi:10.1016/s0031-9384(00)00432-7
19. Kelemen Z et al. 2021. Activity time budgets of geriatric and chronically lame horses. Animals. doi:10.3390/ani11071867 [full text]
20. Leishman EM et al. 2024. Predicting voluntary forage intake: a meta-analysis. Animal. doi:10.1016/j.animal.2024.101266
21. Giannetto C et al. 2025. Seasonal climate, feed intake and body weight. Int J Biometeorol. doi:10.1007/s00484-025-02881-z
22. (= V32) Pritchard JC et al. 2008. Indicators of dehydration in working horses. Equine Vet J. doi:10.2746/042516408x297462
23. (= V31) Pritchard JC et al. 2006. Heat-stress behaviour and skin tent. Equine Vet J. doi:10.2746/042516406778400646
24. Dusterdieck KF et al. 1999. Electrolyte and glycerol supplements and water intake in a simulated ride. Equine Vet J. doi:10.1111/j.2042-3306.1999.tb05258.x
25. Butudom P et al. 2002. Salt water enhances rehydration. Equine Vet J. PMID 12405743
26. Sampieri F et al. 2006. Oral electrolytes in 80 km endurance rides. Equine Vet J. doi:10.1111/j.2042-3306.2006.tb05507.x [title only]
27. Chinkangsadarn T et al. 2015. Abattoir survey of dental abnormalities, Queensland. Aust Vet J. doi:10.1111/avj.12327
28. Vemming DC et al. 2015. Dental disorders in South African abattoir horses. Vet J. doi:10.1016/j.tvjl.2015.03.021
29. Herbst AC et al. 2024. Owner-reported health of US senior horses. Equine Vet J. doi:10.1111/evj.14200
30. Sidwell AE et al. 2025. The Horse Grimace Scale in dental disease. Vet Rec. doi:10.1002/vetr.4800
31. Burden FA et al. 2011. Hyperlipaemia in aged donkeys. J Vet Intern Med. doi:10.1111/j.1939-1676.2011.00798.x
32. (= V44) Lindner A et al. 2020. Resting and recovery heart rate. Animals. doi:10.3390/ani10010120
33. Bitschnau C et al. 2010. Heart-rate recovery in Warmblood sport horses. Equine Vet J. doi:10.1111/j.2042-3306.2010.00260.x
34. Wilberger MS et al. 2014. Exertional rhabdomyolysis in endurance horses. Equine Vet J. doi:10.1111/evj.12255
35. Isgren CM et al. 2010. Exertional rhabdomyolysis in Standardbreds. PLoS One. doi:10.1371/journal.pone.0011594
36. McKenzie EC et al. 2003. Dietary starch, fat and bicarbonate in recurrent exertional rhabdomyolysis. J Vet Intern Med. PMID 14529137 [title only]
37. (= V51) Tadich T et al. 2025. The physiological toll of heavy loads on mules. Front Vet Sci. doi:10.3389/fvets.2025.1725279
38. Friend TH. 2000. Dehydration, stress and water during long-distance transport. J Anim Sci. doi:10.2527/2000.78102568x
39. (= V26) Marlin DJ et al. 2001. Recovery from transport in a hot humid environment. Equine Vet J. doi:10.2746/042516401776249507
40. Maeda Y, Oikawa MA. 2019. Rectal temperature and shipping fever after long transport. Front Vet Sci. doi:10.3389/fvets.2019.00027
41. Padalino B et al. 2015. Health problems in long-haul transport in Australia. Animals. PMID 26690482
42. Padalino B et al. 2016. Risk factors in transport-related health problems. Equine Vet J. doi:10.1111/evj.12631
43. Oertly M et al. 2021. Serum amyloid A for early inflammation after air transport. J Equine Vet Sci. doi:10.1016/j.jevs.2020.103337
44. Schmidt A et al. 2010. Cortisol and HRV during road transport. Horm Behav. doi:10.1016/j.yhbeh.2009.11.003
45. Lertratanachai S et al. 2024. Repeated road transport in a tropical environment. PLoS One. doi:10.1371/journal.pone.0301885
46. Raidal SL et al. 1997. Lower airway contamination in horses confined with head elevation. Aust Vet J. doi:10.1111/j.1751-0813.1997.tb14172.x
47. Maas LT et al. 2025. Heart rate and HRV in mules by 24-hour ECG. Animals. doi:10.3390/ani15162438
48. (= V47) Ayo JO et al. 2014. Pack donkeys' vital signs. J Equine Sci. doi:10.1294/jes.25.1
49. van Dierendonck MC et al. 2020. EQUUS-DONKEY-COMPASS and -FAP pain scales. Animals. doi:10.3390/ani10020354
50. van Loon JPAM et al. 2021. The Donkey Chronic Pain Scale. Vet J. doi:10.1016/j.tvjl.2020.105580
51. Lagos J, Tadich TA. 2019. Haematological and biochemical reference intervals for mules in Chile. Front Vet Sci. doi:10.3389/fvets.2019.00400
52. (= L98) Reix CE et al. 2015. Participatory project to reduce lameness in working horses in Jaipur. PLoS One. doi:10.1371/journal.pone.0124342
53. Whay HR et al. 2015. Changes in equine care and limb abnormalities in Jaipur. PLoS One. doi:10.1371/journal.pone.0126160
54. Rayner EL et al. 2018. Mutilations and skin wounds in working donkeys in Tamil Nadu. Vet Rec. doi:10.1136/vr.104863
55. Dey S et al. 2010. Mortality associated with heat stress in donkeys in India. Vet Rec. doi:10.1136/vr.c504 [title only]
56. Corrales-Hernandez A et al. 2018. Horses, donkeys and mules at livestock markets. Int J Vet Sci Med. doi:10.1016/j.ijvsm.2018.03.002
57. (= V25) Kang H et al. 2023. Heat stress in horses (review). Int J Biometeorol. doi:10.1007/s00484-023-02467-7
58. Brooke India. Heat stress in brick-kiln equids [grey literature]
59. NRC. 2007. Nutrient Requirements of Horses [via secondary summaries]
60. FEI Endurance Rules, 64 bpm vet gate [via secondary summaries]
61. Wikivet, donkey vital signs [grey literature]
