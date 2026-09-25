# Demo day — thermal camera on one Mac

Everything runs on the Mac: the site server, the edge agent, and the camera on
a cable. No internet is needed at the stable.

> **Still pending:** the camera's admin password (from Sparsh). Until then the
> camera cannot be added — this unit speaks a JSON-RPC protocol, not the ISAPI
> the vendor documented, and its driver is finished and tested once we can log
> in. Items marked ⏳ depend on that.

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

⏳ The lens is read from the camera once we can log in. Aim for about 3.5 m,
level with the head, out of direct sun (the camera's limit is 50 °C). The
infrared lamp is 850 nm and glows faintly red at night.

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

## Once, before the day ⏳

1. Hardware → **Add camera**: its IP address, `admin` and the password, stall,
   lens, distance, *Polled by* the edge box.
2. **Test connection** — every step green; the serial number is pinned.
3. Rehearse on a person: eye box on the inner corner of their eye (35–37 °C),
   nostril box under the nose, breathing check against a hand count.

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
8. Open the horse's page: body temperature and breathing arrive within a
   minute and update every minute.

## Saying it accurately

- Temperature is **±2 °C** (the datasheet): read it as a trend against the
  horse's own baseline, not as a rectal thermometer.
- Breathing rate comes from the nostril's warm/cool cycle. When there is no
  clear rhythm (head turned away) it reports nothing rather than a guess.
- Before calibration readings are greyed and never raise alerts.
- The camera covers temperature and breathing. Steps, feed, water and stable
  vices need the sensors in the RFIs — the dashboard shows them as not measured.

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
