# Stall-monitoring competitors: what they do, and what EquiCare can learn

*4 October 2026. Five research reports, one per product. Pricing is left out on purpose. Every claim was checked against the company's own pages, archived pages, app stores, press, or scientific databases. Links are at the end of each section.*

## The short version
- **Two of the five are gone.**
  - **StableGuard** (Magic AI) shut down in late 2019 when it could not raise more money.
  - **Nightwatch** halters have not been sold since December 2022. A "Gen 2.0" has no date.
- **Three are active:**
  - **NOVOSTABLE** (France; sold in Germany through VIDEOR)
  - **ACARiS Horse Protector** (Germany)
  - **Horcery** (USA)
- **None of the five publishes independent proof that its system works.** Every accuracy figure (95%, 97%, 97.5%, 98%) is the company's own, with no method given.
- **None is present in India.**
- **None claims EquiCare's core combination:**
  - temperature from a heat camera, judged against each horse's own normal
  - breathing rate from video
  - urine and droppings on the floor
  - stable vices
  - knowing which horse is in the stall
  - vet confirmation of each event
- **What they have that EquiCare does not yet:**
  - foaling alerts
  - phone-call alerts that escalate to the next person
  - named colic and "cast" (stuck against the wall) alerts
  - working with cameras a stable already owns
  - environment sensors

---

## 1. NOVOSTABLE (NOVO SENSO, Annecy, France), sold in Germany by VIDEOR
**Status:** active. VIDEOR (Rödermark, Germany) is a security-camera distributor that resells NOVOSTABLE licences; it does not make its own horse AI. NOVO SENSO was founded in 2019 and is a Hikvision technology partner.

**What it does:**
- Colic signs, cast or stuck horse, major behaviour change.
- Lying, rolling, eating, drinking, activity and sleep.
- Foaling alert about 30–10 minutes before birth.
- People and intruder detection; time-lapse.
- A clinic mode for watching horses after surgery and spotting a cast horse (AI model "TEO").
- A learned profile for each horse (an "AVATAR"), "active after 30 min".

**Alerts:** ranked by severity, sent to several people, by SMS, WhatsApp or phone call.

**Heat camera:** a "Thermal Care" full-body scan labelled early-adopter. Its own hardware page still says thermal is "coming soon".

**Hardware:**
- Works with most existing security cameras (Hikvision, Dahua, Axis, Bosch, Hanwha and others) through an on-site NOVOSTABLE box.
- Can also run its AI directly on certain Hikvision cameras.
- Cloud app on Amazon Web Services; iPhone/iPad app.
- "1-day installation, 7-day average deployment".

**Proof:** "98% accuracy", "+95%" and "90% foaling accuracy", with no method or data. Testimonials from studs (Stetchworth & Middle Park: "26 foals, not one missed") and French clinics. No independent study.

**Reach:** claims 2,000+ horses, 500+ users, 15+ countries (France, UK, Ireland, Gulf trade missions). Not in India.

**Weaknesses:** heat-camera claims are inconsistent; depends on the internet; no published validation.

Sources: videor.com company page and datasheets 240819/240820/240821/240825; tpp.hikvision.com (Solution 248); novostable.com (home, /smartstable, /foaling, /clinic, /thermal-care, /hardware); App Store id1558682973; teamfrance-export.fr.

## 2. ACARiS Horse Protector (ACARiS GmbH, Hamburg, Germany)
**Status:** active, with "HORSE PROTECTOR 2.0, new in 2026". Founded 2019 by physicist Dr Arne-Rasmus Dräger; 11–50 staff. Funded by public development banks (IFB Hamburg, BLE, Rentenbank). Research projects with German and Austrian universities. Also sells COW PROTECTOR.

**What it does:**
- Birth alert 15–30 minutes before birth, plus watching the foal afterwards.
- Colic, cast and abnormal-behaviour alarms.
- Daily time breakdown: hay, concentrate, water, lying, standing, out of the box. Claims deep (REM) sleep detection.
- **Rules staff set themselves** ("monitors"): e.g. minimum eating time, maximum lying, frequent lying down — for post-surgery and colic aftercare.
- Intruder alarm during set hours, with a snapshot.
- Daily PDF reports.
- View-only access for owners.

**Alerts — the best design found:**
- Each contact chooses phone call or push.
- Contact 1 is alerted at once.
- Contact 2 is called about 5 minutes later, unless someone has opened the horse's camera in the app (that counts as acknowledging).
- Every logged-in phone gets a push.
- Each number is called at most once an hour across all cameras.
- Separate sensitivity for colic, behaviour and birth.

**Hardware:**
- One wide-angle infrared camera per stall, on one network cable, mounted 3.5–4.5 m up in a corner to see the whole stall. No heat camera.
- A "Smartbox" adds its AI to an existing camera.
- A mobile kit (pole, battery pack, mobile internet) for clinics and shows.

**Proof:**
- ">97% of births detected" and "over 4,000/6,000/7,500 cases" — the figures differ between pages, and all are the company's own.
- One magazine trial (2020, one mare) caught the birth, with one false alarm while learning.
- No independent study.

**Weaknesses (from its own manual):**
- Monitoring assumes one horse per stall; stops with more than one in view or in mare-and-foal mode.
- No automatic horse identification; a new horse needs a reset.
- Settings changes take the stream down for about 10 minutes.
- Support weekdays only.

**Reach:** mostly Germany; claims 9 countries, USA and UAE since 2023. Not in India.

Sources: eu.acaris.net (about, birth-alert, colic-alarm, health-monitoring, security, smartbox, mobile-clinic, faq, partner, references); App Manual 2023 (acaris.net/wp-content/uploads/2023/10/App_Manual.pdf.pdf); bayerns-pferde.de trial report (2020); eurodressage.com (2022).

## 3. Horcery (Horcery LLC, Florida, USA; owned by Tavistock Group)
**Status:** active. App updated September 2026. Second CEO this year.

**What it does:**
- Activity, rolling, lying (chest vs flat on the side, added Sept 2026), sleeping.
- Horse leaving the stall; people and visits; "unusual inactivity".
- Temperature, humidity, light, noise and pressure sensors with threshold alerts.
- Feed and water weighed by a separate bucket scale.
- Colic and cast detection are not claimed on the current product page; an independent reviewer says those models are trained on synthetic data and are "largely untested".

**Alerts and screens:**
- A clip with every alert.
- "Lying more than X within Y" alert windows.
- Routing by shift and role for up to 20 users.
- Stalls needing attention move to the top.
- Charts after 72 hours of learning.
- iOS, Android and web.

**Hardware:**
- 1080p ultra-wide night-vision camera with a microphone.
- AI runs on the camera; 60 days of video on the device; weatherproof (IP65).
- Wi-Fi or one network cable; one hub powers a whole barn.
- "Horcery Connect" adds its AI to existing cameras.
- Mounted at least 3 m up, opposite the door.

**Proof:** none published. "Trusted by" logos (Cornell, Kentucky Equine Research, racetracks) with no studies behind them.

**Weaknesses:**
- Few users: 3 App Store ratings, about 50 Android downloads, a "glitchy footage" review.
- Unfinished website.
- **Data terms:** stall video may be used to train its AI; data may go to "advertising partners"; the company takes a perpetual licence to user content; hosted in the US.

**Reach:** USA (racing, sport horses, rescues). Not in India.

Sources: horcery.com (home, stall-monitor, for-barns-facilities, about-us, terms, app-privacy, news, care-installation); installation PDFs on cdn.shopify.com; App Store id6478853253; Google Play com.horcery.app; thetechequestrian.com (Apr 2026); orchid.substack.com (Sept 2026).

## 4. Nightwatch Smart Halter (Protequus LLC, Austin, Texas, USA)
**Status:** not sold since 15 December 2022 in the US and Canada. The shop and both apps are gone. "Gen 2.0" is in development with no date. The company looks dormant.

**What it did:**
- A leather breakaway halter with a radar for heart rate and breathing, a motion sensor, altimeter and GPS.
- Flagged pawing, kicking, flank-watching, repeated getting up and lying down, long lying, rolling or thrashing.
- **Equine Distress Index:** a 1–10 score against each horse's own normal, after about 80 hours of learning; a manual mode with user-set limits worked from day one.
- Uses: colic, cast, foaling (30 days before to 90 days after the due date), post-surgery, crib-biting, weaving.

**Alerts:** text, call and email to every caretaker at once, repeated until someone acknowledges. A light on the halter turned red during an alert.

**Weaknesses:**
- About 12 hours of battery, so daily charging (users kept two halters per horse).
- Needed barn Wi-Fi; the horse had to wear a halter overnight.

**Proof:** "97.5% accuracy" was submitted to a journal in 2015 and never published. No check of heart rate against a medical heart monitor. A 2025 university study used it (one halter failed) but did not test its accuracy.

**Reach:** USA and Canada only.

Sources: protequus.com (home, about, equine-distress-index, product sheet); archived smarthalter.com FAQ, Gen 2 page, brochure; usef.org; ntra.com; cbinsights.com; PubMed 41096375 (Brauns et al. 2025).

## 5. StableGuard (Magic AI Corp., Seattle, USA)
**Status:** closed in late 2019 after failing to raise more venture money. Domains lapsed or parked; no app.

**What it did (2017–2019 claims):**
- Cast horse; colic signs (not eating or drinking, on its back against the wall, looking at the stomach); foal watch.
- Water bucket filled vs drunk; food delivered and eaten; urine and droppings log.
- Horse leaving the stall; known staff vs strangers.
- Blanket off or straps loose; stall temperature alerts.
- Live stream.
- Alerts graded by severity and escalated, each with a short clip.

**Hardware:** one camera per stall wired to a local computer, with internet. Trained on NVIDIA GPUs and run partly on cloud GPUs. No heat camera.

**Proof:** none; "extremely accurate" was marketing only. Installed at the founder's family barn and Thunderbird Show Park (Canada).

**Data terms:** the company owned all data and could use it "in any way".

**Lesson:** it failed on funding and market (scattered premium barns), not on any documented technical fault.

Sources: geekwire.com (2017, 2018 ×2, 2021); prnewswire.com (2017); NVIDIA developer blog; archived mystableguard.com (home 2017/2019, private-stables, horseshowsecurity, support, service-agreement, legal, news, team).

## Complements, not competitors
- **RealHorse** (Denmark) and **Sleip** (Sweden): phone trot-up lameness apps.
- **Equinosis Lameness Locator**, **EquiMoves**, **StrideSafe**: sensor lameness systems for vets.
- **Equisense Motion One**, **Seaver**, **Equimetre**: riding and fitness wearables.
- **Foalert**: a foaling sensor stitched to the mare.
- **Animalinks COHO** (France): a mobile 4G stall camera used by the French equestrian team in 2024.

---

## Side by side

| | NOVOSTABLE | ACARiS | Horcery | Nightwatch | StableGuard | **EquiCare** |
|---|---|---|---|---|---|---|
| Status | active | active | active | withdrawn 2022 | closed 2019 | active |
| Sensing | existing CCTV or Hikvision | own IR camera | own IR camera + sensors | halter (radar, IMU) | own camera | colour + **thermal** camera, edge box |
| Foaling alert | ✓ | ✓ | – | ✓ | claimed | – |
| Colic / cast alert | ✓ | ✓ | not claimed now | ✓ | claimed | events exist; no named alert yet |
| Lying / eating / activity | ✓ | ✓ | ✓ (no eating from video) | activity, posture | ✓ | ✓ |
| Breathing rate | – | – | – | ✓ (radar) | – | **✓ (video)** |
| Temperature | "thermal scan" (early) | – | room only | – | room only | **✓ eye, against own normal** |
| Urine / droppings | – | – | – | – | claimed log | **✓** |
| Stable vices | – | – | – | listed use | – | **✓** |
| Which horse is in the stall | – | – (reset per horse) | – | follows the horse | – | **✓ recognition** |
| Own-normal comparison | ✓ | ✓ | 72 h start-up | ✓ (1–10 index) | – | **✓** |
| Phone-call escalation | ✓ | **✓ best** | push only | ✓ | ✓ | – |
| Vet confirms events | – | – | – | – | – | **✓** |
| Night reports | – | daily PDF | – | – | – | **✓** |
| Published validation | – | – | – | unpublished | – | accuracy kit built |
| Data stays on site | cloud | cloud | US cloud | cloud | company owned data | **✓ on site** |
| India | – | – | – | – | – | **RVC** |

## Ideas to adopt, in order of value to RVC
1. **Alert chain:** stall staff, then the duty vet, then the officer in charge.
   - Call or WhatsApp; next person only if nobody acknowledges within N minutes.
   - Each number called at most once an hour.
   - A clip with every alert; graded by severity.
   - A red status light at the stall.
2. **Foaling alert** for RVC breeding studs, as a seasonal mode (30 days before to 90 days after the due date).
3. **Named colic and cast alerts** built from what EquiCare already measures (repeated lying down, rolling, flat on the side while awake, eating less, fewer droppings).
4. **Rules staff set themselves** ("lying more than 2 h", "eating less than 3 h a day"), plus a post-surgery mode and a mare-and-foal mode.
5. **One 0–10 "how unusual tonight" score** per horse against its own normal.
6. **Work with cameras RVC already owns** (an RTSP camera through the edge box).
7. **Stall temperature and humidity alerts** for summer heat.
8. **Setup:**
   - QR pairing of camera to stall.
   - A "learning your horse" message for the first days.
   - One network hub per barn.
   - A mounting checklist: corner, 3.5–4.5 m high, whole stall in view.
9. **A mobile kit** (pole, battery, 4G) for field hospitals, transport and events.

## Selling points the research supports
- EquiCare is the only one of these measuring temperature, breathing, urine and droppings, vices and horse identity together.
- No competitor publishes proof that its system works. EquiCare's accuracy kit can produce a published result.
- **Data stays on the Army's premises.** Competitors use clouds, and some keep rights to customers' video.
- Nothing worn by the horse and nothing to charge (the lesson from Nightwatch).
- One large buyer with many stalls — the market StableGuard could not reach.
