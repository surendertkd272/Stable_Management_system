# Demo day — thermal camera on one Mac

Everything runs on the Mac: the site server, the edge agent, and the camera on
a cable. No internet is needed at the stable.

> **The camera (checked 26 Sep):** Sparsh demo unit, hardware TPC-B3404-ILP,
> firmware V0.4.5, **25 mm thermal lens**. It runs a JSON-RPC firmware, not the
> ISAPI the vendor documented — EquiCare detects this and measures the eye
> and nostril boxes itself by sampling pixels. Set on the camera so far:
> **body-surface mode** (not the human "body temperature" correction) and the
> clock. Emissivity (0.95) and distance (1 m) are still the camera's own
> values — set them on the day if you want them changed. Login: `admin` and
> the password from Sparsh (not written here).

## Pack

- [ ] Mac + charger, **USB-Ethernet adapter** (the camera is on it today)
- [ ] Camera + **its power**: PoE injector or 12 V adapter — the Mac's port does not power it
- [ ] Ethernet cable long enough to reach from the mount to the Mac (≤100 m)
- [ ] Tape measure, bracket or tripod, extension lead
- [ ] Someone to count the horse's breaths during the check

## Where to mount it

The lens decides the distance from the camera to the horse's **head** (focus
is fixed at 3.5 m; figures from Sparsh):

| Lens | Sharp from | Nostril pixels at 3 m / 4 m |
|---|---|---|
| 13 mm | 2 – 11 m | 12–13 / 9–10 |
| 25 mm | **3.0 – 4.3 m only** | 24 / 18 |

**This unit has the 25 mm lens: mount it 3.0–4.3 m from the head** (aim for
3.5 m), level with the head, out of direct sun (the camera's limit is 50 °C).
The infrared lamp is 850 nm and glows faintly red at night.

**What each picture sees.** The 25 mm thermal view is only ~25° × 19°:
about **1.5 m × 1.2 m at 3.5 m** — one horse's head and neck. The colour
lens (4 mm) sees the whole stall. So temperature and breathing come from the
thermal view aimed at the head, while activity, lying down and vices are read
from the colour picture (Hardware → edit camera → *Read behaviour from*).
Urination/manure need **floor inside the thermal view** — with the head
filling it that is usually not possible with one camera; say so, or aim a
second camera at the floor.

## Start

```bash
cd ~/Stable_Management_system
scripts/demo.sh
```

It opens the Hardware page. First start only: the admin login is saved in
`~/EquiCare-demo/admin-password.txt`, and the script asks for the edge-box
token (Hardware → **Add edge box** → copy the token → paste). After that it
starts with no questions. **Ctrl-C** stops everything. Horses, devices and
readings persist in `~/EquiCare-demo`.

## Once, before the day

1. Hardware → **Add camera**: as IP address use what `scripts/demo.sh` prints
   ("camera found at fe80::…%en8" — on a direct cable the Mac reaches it this
   way, no network settings needed), `admin` and the password, stall, variant
   640, lens 25 mm, *Polled by* the edge box, protocol *Detect automatically*.
2. **Test connection** — every step green; the serial number is pinned.
3. Rehearse on a person: eye box on the inner corner of their eye (35–37 °C),
   nostril box under the nose, breathing check against a hand count.
4. **Lying-down detection** (optional, needs internet once, ~70 MB):
   `scripts/demo.sh --setup-detector`. It puts numpy, onnxruntime and the
   YOLOX-tiny model (Apache-2.0) in `~/EquiCare-demo`; from then on the edge
   agent uses it. Without it, lying is shown as "not measured".

## At the stall (5–10 minutes)

1. Mount, connect, power the camera, run `scripts/demo.sh`.
2. Make sure the horse's stall number on its profile matches the camera's stall.
3. Hardware → **Calibrate ROIs**. Wait until the horse stands still in the live view.
4. **1 · Eye box** — drag a small box around the eye. The camera reads the
   hottest pixel inside it; the red dot shows where. It need not be exact.
5. **2 · Nostril box** — drag a tight box over the nostril.
6. **Push ROIs to camera** — it reads them back to confirm.
7. **Breathing check (60 s)** — meanwhile someone counts flank rises for the
   same 60 s. Enter the count; it should say *agrees*. **Save this check.**
8. Optional: **4 · Flank** — on the colour picture, a box over the flank
   behind the ribs: breathing is also read from the flank's rise and fall.
9. Optional: **3 · Floor** + **Floor cooling test** — if the floor is in the
   thermal view: box the floor, push, press *Start*, pour 1–3 L of ~38 °C
   water inside the box, wait until it says *measured*, **Save as urine**.
   Repeat with ~2 kg of fresh manure → **Save as manure**. This sets how the
   camera tells the two apart on this bedding (no published data exists).
10. Open the horse's page: body temperature and breathing arrive within a
   minute and update every minute. Lying down needs a few hours of the horse
   both standing and lying before it is learned for that stall.

## Recording footage for training

To teach real behaviour models (lying down, rolling, urinating…) we need
footage from this camera at real stalls, with events marked.

1. Hardware → edit the camera → tick **Record video for training**. The edge
   agent keeps thermal + visible video in 10-minute clips in
   `~/EquiCare-demo/recordings` (~0.4 GB an hour; the oldest are deleted past
   100 GB). Recording does not need the camera to be calibrated.
2. **Footage & labels** (sidebar): pick a clip, watch both streams side by
   side (up to 16× speed), and press a key when something happens —
   `l` lying (press again where it ends), `s` standing still, `e` eating,
   `d` drinking, `w` weaving, `p` pawing, `r` rolling, `u` urinating,
   `m` defecating, `1`/`2` lies down / gets up. Colic signs from the pain
   scale: `f` flank watching, `k` kicks at belly, `t` stretches as if to
   urinate, `3` lying flat on side. Vices: `c` crib-biting, `a` box walking,
   `h` head tossing. Hover a button for its definition (from the published
   ethograms); **Behaviour guide** in the sidebar has the full reference.
   Space plays and pauses, ←/→ jump 5 s.
3. **To label** tab: the moments worth checking — movement bursts, the start
   and end of long stillness, warm floor patches, weaving, plus one random
   moment per hour. Open one (it starts 15 s before), label, press **Done**;
   the next one opens.
4. **Boxes**: press `b` and drag over each animal (horse / foal / person),
   on a few frames per clip — this teaches the detector where the horse is.
5. **Export labels (CSV)** and **Export boxes (JSON)** when you have a batch —
   those files plus the clips are the training set.

Ask the stable's permission before recording, and switch it off when not needed.

## What the behaviour models can and cannot do (tested 26 Sep)

- **Activity (movement) is sound.** Checked against zoologists' labels on
  4.5 h of zebra video (KABR, CC0): our movement measure separates moving
  from grazing/standing on 80 % of frames. It also ignored sunlight moving
  over an empty stall in a real stable recording.
- **An empty stall is not a resting horse.** In that recording the pen was
  empty 87 of 133 minutes; stillness alone would have counted those as rest.
  The edge agent now reports nothing unless a warm body is in view.
- **No posture model is deployed.** A posture model trained on the zebras
  (75 % right on zebras) got 24 % on horses in a stall and called an empty
  pen "moving" at 98 % confidence. Models trained elsewhere are confidently
  wrong here — posture (head down eating / head up / lying) needs hours of
  labelled footage from OUR camera: record at the demos and label it.

## How each of the 8 points is read (built 27 Sep, from the research)

Nothing published does thermal-camera behaviour for horses with measured
accuracy, and no video system has published colic accuracy — every colic
figure comes from worn sensors. We copied methods proven elsewhere:

| Point | How | Proven where |
|---|---|---|
| Body temperature | Eye box hottest pixel, vs the horse's own 7-day baseline | Eye IR ≈ 2 °C below rectal, trend only |
| Respiration pattern | Breath-to-breath regularity; "fast" when panting | — (heaves detection NOT claimed) |
| Respiratory rate | Nostril box vs the skin around it, only 30 s+ with the head still, rate must agree with a breath count; optional flank box | Calves/cattle thermal (≈3 % error) |
| Activity | Movement on the colour picture vs own 7-day level | Our zebra check: 80 % |
| Resting / lying | Horse box shape over time, learned per stall (detector) | Dairy cows: 92 % get-ups, 80–87 % lie-downs |
| Stable vices | Regular sideways sway (weaving), laps (box walking), regular nodding | Zoo pacing detector: 96.7 % precision |
| Urination / excretion | New warm floor patch, confirmed after the horse steps off, split by cooling | Mouse thermal system: F1 0.88 / 0.90 |

**Detector test on 60 open photos (greyscale, 27 Sep):** YOLOX-tiny found
whole horses standing in stalls 7/7, lying on the chest 13/14, **flat on the
side 0/4**. So a lying horse the detector loses is counted as "possibly flat
on the side". All of it is untested on a live horse at night — label footage.

**All the new watch notes are ours** (no published thresholds): 3+ lie-downs
in an hour, possibly cast (down 10+ min with repeated struggling), possible
rolling, 60 min flat on the side, <10 min lying on 3 nights, a new vice, a
vice up 1.5× on its usual, manure under half its usual count. They are
watch notes, never alarms, and each says why it matters.

## What behaviour patterns mean (Behaviour guide)

The **Behaviour guide** page lists 37 patterns from 48 open-access sources
(Merck Veterinary Manual, peer-reviewed studies, university extension): what
each looks like, what it may mean, how strong a sign it is, what not to
confuse it with, and whether EquiCare observes it today. Points worth saying:

- **Colic:** rolling, kicking at the belly, repeated flank watching and going
  down and up again are strong signs; pawing, sweating and not eating mean
  little alone. The Equine Acute Abdominal Pain Scale scores the worst sign
  seen (flank watching 1 … rolling 5) — behaviour only, so it suits a camera.
- **No source gives** rolls per hour, a lying time limit, a weaving rhythm,
  a normal urination count or a "no manure for X h" threshold. Where
  EquiCare needs one, it compares the horse with its own normal, and the
  number is ours to set with a vet.
- **Normal, not alarming:** busy in the 20 min before a feed; little lying
  for the first 1–4 nights in a new stall; foals lying half the day.
- **Eye temperature is ~2 °C below rectal** and does not reliably track it,
  so alerts compare each horse with its own 7-day baseline (+1.0 °C watch,
  +1.5 °C alert). A healthy 35 °C eye no longer reads as hypothermia.

## Saying it accurately

- Temperature is **±2 °C** (the datasheet): read it as a trend against the
  horse's own baseline, not as a rectal thermometer.
- Breathing rate comes from the nostril's warm/cool cycle. When there is no
  clear rhythm (head turned away) it reports nothing rather than a guess.
- Before calibration readings are greyed and never raise alerts.
- The camera measures temperature and breathing; activity, lying, vices and
  floor events are **prototype** camera measures (shown, used for watch notes,
  never alarms). Steps, feed and water need the sensors in the RFIs — the
  dashboard shows them as not measured.

## If something is wrong

| You see | Do |
|---|---|
| Camera *Error — cannot reach* | Power and cable; the adapter's light should be on |
| *Needs calibration* | The camera lost its ROIs (e.g. power cut) — calibrate again |
| *Edge box offline* | The script was stopped — run `scripts/demo.sh` |
| Breathing check: *no rhythm* | Nostril box off the nostril, or the horse moved — re-aim, run again |
| Check *disagrees* with the hand count | Re-aim the nostril box tighter and repeat |
| Eye reads below 33 °C | The eye box is on coat or background — move it onto the eye |
| Port 8080 in use | `kill $(lsof -tiTCP:8080 -sTCP:LISTEN)` then start again |
| *Camera not found on any cable* | Power the camera, check the adapter; if the adapter moved to another port, the address printed changes — edit the camera's IP in the Hardware page |
| Test: *body-temperature mode* | Switch the camera to body-surface mode (its web page → Measurement → Global) |
