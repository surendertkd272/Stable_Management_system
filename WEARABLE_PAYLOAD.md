# EquiCare wearable data format (equicare-wearable/1)

**To:** Sparsh CCTV
**From:** Bharat Sports Venture — EquiCare engineering
**Date:** 29 September 2026
**Applies to:** the wearable set on each horse. That is the leg tag (device A), the halter hub with SIM (device B) and the pelvis sensor (device C) in *EquiCare — Sensor requirements for steps, lameness, watering and feeding*.

---

## 1. Summary

The halter hub sends everything for its horse, including the leg tag's and the pelvis sensor's
data, to our server over HTTPS. There are two kinds of message:

| Message | Endpoint | What it carries | When |
|---|---|---|---|
| **Live readings** | `POST /ingest/readings` | Small JSON summaries: steps, activity, lying minutes, battery and status, "sensor came off", GPS, exercise sessions | At least once a minute while the horse is active; alerts immediately; backfill after a gap |
| **Raw motion upload** | `POST /ingest/raw` | One sensor's raw accelerometer + gyroscope samples for one recording, as CSV | For every exercise session and trot-up (all three sensors), within hours |

Our software does all the analysis: step counting, gait, lameness. It works from the raw uploads.
**The hub does not need to compute any lameness figure.**

If your hub already has its own documented format, we can accept that instead (section 9).

---

## 2. Connection and authentication

- **Address:** we give you the server address for each site (for example
  `https://ingest.<site>.in`). It must be configurable on the hub. Use HTTPS only, TLS 1.2 or later.
- **Token:** every halter hub has its own **device token**. We issue it when we register the hub
  against a horse. Send it on every request:

  ```
  Authorization: Bearer <device token>
  ```

  Store the token securely on the hub. We can revoke it and issue a new one.
- **The token identifies the hub, and therefore the horse.** Do not send horse or stall IDs. If
  you send them, they are ignored.
- **Format header (optional):** `X-EquiCare-Format: equicare-wearable/1`. This format is the
  default, so you can leave the header out.

---

## 3. Timestamps

- **UTC, ISO 8601, with a `Z`:** `2026-09-29T06:15:00Z`. Milliseconds are allowed:
  `2026-09-29T06:15:00.250Z`. Do not send local time (IST) or an offset such as `+05:30`.
- A timestamp is **when the measurement was taken**, not when it was sent.
- The hub's clock must be set from network time (NTP or the mobile network). The three devices
  must agree to **≤ 10 ms** (requirement L3).
- **Values that cover a period** (steps in a minute, lying minutes in ten minutes) are stamped at
  the **start** of the period, and `meta.periodMin` gives the period's length in minutes.

---

## 4. Axis convention and units

Each device reports in its own frame **as mounted on a horse standing square**:

| Axis | Direction |
|---|---|
| **x** | forward, towards the horse's nose |
| **y** | to the **horse's left** |
| **z** | up |

This is a right-handed frame. Angular rates are positive by the right-hand rule about each axis.

| Device | Mounted | In that frame |
|---|---|---|
| **Leg tag** | Outside (lateral) face of the **left front cannon** | z along the cannon, pointing up towards the knee; x forward; y outward (to the horse's left) |
| **Halter hub** | Crown piece of the halter or bridle, just behind the ears | x towards the nose, y left, z up, with the head in its normal carriage |
| **Pelvis sensor** | Midline of the croup, over the sacrum | x towards the head, y left, z up |

- A **fixed tilt** caused by the mount, for example the hub following the slope of the poll, is
  acceptable: we measure the tilt from gravity. Keep it under about 30°. The device must **not**
  be turned about its vertical axis (x must point forward, not sideways), and it must not be
  mounted upside down.
- If the sensor chip's own axes differ, **rotate the data on the device** into this frame. Or tell
  us the exact mapping (for example "x = −chip Y") and we apply it.
- **Check:** on a horse standing still, every device should read about `az = +9.8`, `ax ≈ 0`,
  `ay ≈ 0`, and all three gyroscope axes should read about 0.

| Quantity | Unit | Note |
|---|---|---|
| Acceleration | **m/s²** | Including gravity. At rest the upward axis reads about +9.81. |
| Angular rate | **°/s** (degrees per second) | Not rad/s |
| Magnetic field (optional) | **µT** | All three axes or none |

---

## 5. Live readings — `POST /ingest/readings`

### 5.1 Request

```
POST /ingest/readings
Authorization: Bearer <device token>
Content-Type: application/json
```

The body is one JSON object with a list of readings. Up to **1 MB** per request (several thousand
readings). One request can carry readings from all three devices and from several minutes.

```json
{ "readings": [ { ... }, { ... } ] }
```

### 5.2 Fields of a reading

| Field | Type | Required | Meaning |
|---|---|---|---|
| `metric` | string | **yes** | What was measured. One of the names in 5.3. |
| `value` | number | **yes** | The measurement, in the unit shown in 5.3. A JSON number, not a string. |
| `unit` | string | no | If you send it, use exactly the unit shown in 5.3. |
| `ts` | string | **yes** | When it was measured (section 3). |
| `confidence` | number 0–1 | no | Your confidence in the value. 1 (the default) = a normal, valid measurement. |
| `meta` | object | **yes** | Details. See below and 5.3. |

Fields in `meta` that apply to every reading:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `meta.sensor` | `"leg"` \| `"head"` \| `"pelvis"` | **yes** for `device_status` and `device_detached`; recommended for all | Which device measured it: leg tag, halter hub, pelvis sensor |
| `meta.hardwareId` | string, up to 64 chars (`A–Z a–z 0–9 . _ : -`) | **yes** for `device_status`; recommended for all | The device's fixed, unique hardware ID (requirement C7) |
| `meta.seq` | integer | **yes** | A sequence number the device gives each reading when it creates it. It must stay the **same when the reading is re-sent** (section 6). A per-device counter that goes up by one for each reading is enough. |
| `meta.periodMin` | number | for period values | Length of the period in minutes |
| `meta.quality` | `"ok"` \| `"degraded"` \| `"saturated"` \| `"sensor_fault"` | no | Your per-reading status flag (requirement C6). Leave it out when the reading is normal. |
| `meta.method` | string | no | How the device computed the value, for example `"leg strikes x 4"` for steps |

**If something was not measured, leave the reading out.** Never send 0 as a stand-in: 0 steps
means the horse stood still, which is a different statement. Where a `meta` field below allows
`null`, use `null` for "not known".

### 5.3 The readings the hub sends

| `metric` | `value` | Unit | Send | `meta` (besides `sensor`, `hardwareId`, `seq`) |
|---|---|---|---|---|
| `steps` | Steps in the period | `count` | Every minute while the horse moves. A minute with no steps can be sent as 0 — it is measured. | `periodMin` (required); `method` recommended |
| `activity_index` | Fraction of the period the horse was moving: 0 = still or lying throughout, 1 = moving throughout | `0..1` | Every minute | `periodMin` (required) |
| `rest_minutes` | Minutes of the period spent **lying down** (not standing still) | `min` | Every 10 minutes, or every minute | `periodMin` (required) |
| `device_status` | Battery charge | `%` | For **each** of the three devices, at least every **10 minutes**, and at once when a device reconnects | `signalDbm`, `attached`, `firmware` (all three may be `null`) |
| `device_detached` | `1` | `event` | **Immediately** when a device comes off, or when the hub stops hearing it | `reason`: `"removed"` (the device detects it is off) or `"silent"` (the hub lost contact) |
| `gps_fix` | Ground speed | `m/s` | Every 5–15 s during exercise, only while GPS is on | `lat`, `lon` (decimal degrees, WGS-84), `accuracyM` (metres) |
| `exercise_session` | Duration of the session | `min` | Once, when a session ends (stamped at its start) | `start`, `end` (UTC ISO 8601), `steps` (count or `null`), `distanceM` (metres or `null`), `trotMin` (minutes of trot, or `null`) |

In `device_status`:

- `signalDbm`: for the hub, the mobile network signal (RSRP, dBm). For the leg tag and pelvis
  sensor, the Bluetooth signal strength received at the hub (RSSI, dBm).
- `attached`: `true` if the device detects it is being worn (strap closed, contact), `false` if it
  is off, `null` if it cannot tell.
- `firmware`: the firmware version string.

### 5.4 Examples

**Steps** — 112 steps in the minute from 06:15:00:

```json
{ "metric": "steps", "value": 112, "unit": "count", "ts": "2026-09-29T06:15:00Z",
  "meta": { "sensor": "leg", "hardwareId": "LT-00A1B2", "periodMin": 1, "seq": 48211, "method": "leg strikes x 4" } }
```

**Activity** — moving for 42 % of that minute:

```json
{ "metric": "activity_index", "value": 0.42, "unit": "0..1", "ts": "2026-09-29T06:15:00Z",
  "meta": { "sensor": "leg", "hardwareId": "LT-00A1B2", "periodMin": 1, "seq": 48212 } }
```

**Lying minutes** — lying down for 7 of the 10 minutes from 02:00 to 02:10:

```json
{ "metric": "rest_minutes", "value": 7, "unit": "min", "ts": "2026-09-29T02:00:00Z",
  "meta": { "sensor": "leg", "hardwareId": "LT-00A1B2", "periodMin": 10, "seq": 47020 } }
```

**Status** — one reading per device:

```json
{ "metric": "device_status", "value": 64, "unit": "%", "ts": "2026-09-29T06:20:00Z",
  "meta": { "sensor": "leg", "hardwareId": "LT-00A1B2", "signalDbm": -71, "attached": true, "firmware": "1.4.2", "seq": 48230 } }
{ "metric": "device_status", "value": 81, "unit": "%", "ts": "2026-09-29T06:20:00Z",
  "meta": { "sensor": "head", "hardwareId": "HB-7F0012", "signalDbm": -98, "attached": null, "firmware": "2.0.1", "seq": 48231 } }
{ "metric": "device_status", "value": 35, "unit": "%", "ts": "2026-09-29T06:20:00Z",
  "meta": { "sensor": "pelvis", "hardwareId": "PS-00C3D4", "signalDbm": null, "attached": false, "firmware": "1.4.2", "seq": 48232 } }
```

**Came off** — the hub stopped hearing the leg tag:

```json
{ "metric": "device_detached", "value": 1, "unit": "event", "ts": "2026-09-29T11:42:07Z",
  "meta": { "sensor": "leg", "hardwareId": "LT-00A1B2", "reason": "silent", "seq": 51377 } }
```

**GPS fix** during exercise:

```json
{ "metric": "gps_fix", "value": 3.4, "unit": "m/s", "ts": "2026-09-29T07:02:15Z",
  "meta": { "sensor": "head", "hardwareId": "HB-7F0012", "lat": 28.613940, "lon": 77.209020, "accuracyM": 4.5, "seq": 49810 } }
```

**Exercise session** — 62 minutes, sent when it ended:

```json
{ "metric": "exercise_session", "value": 62, "unit": "min", "ts": "2026-09-29T06:30:00Z",
  "meta": { "sensor": "head", "hardwareId": "HB-7F0012", "start": "2026-09-29T06:30:00Z", "end": "2026-09-29T07:32:00Z",
            "steps": 5210, "distanceM": 8400, "trotMin": 18, "seq": 50102 } }
```

**A whole request:**

```
curl -X POST "https://<server>/ingest/readings" \
  -H "Authorization: Bearer <device token>" \
  -H "Content-Type: application/json" \
  --data '{"readings":[
    {"metric":"steps","value":112,"unit":"count","ts":"2026-09-29T06:15:00Z","meta":{"sensor":"leg","hardwareId":"LT-00A1B2","periodMin":1,"seq":48211}},
    {"metric":"activity_index","value":0.42,"unit":"0..1","ts":"2026-09-29T06:15:00Z","meta":{"sensor":"leg","hardwareId":"LT-00A1B2","periodMin":1,"seq":48212}}
  ]}'
```

### 5.5 Response

| Status | Meaning | What the hub does |
|---|---|---|
| **200** or **202** | Received | Remove the batch from the buffer |
| **400** | The body is not valid JSON, or the format named in `X-EquiCare-Format` is unknown. The body says why. | Do not resend the same batch unchanged; log it for us |
| **401** | Token missing, wrong or revoked | Stop and report; do not retry in a loop |
| **413** | Request too large | Split the batch and resend |
| Other, or no answer | Network or server problem | Keep the batch and retry with back-off (for example 10 s, 30 s, 1 min, 5 min …) |

A 200 body looks like this:

```json
{ "accepted": 57, "duplicates": 3, "dropped": 0, "rejected": 1,
  "rejections": [ { "metric": "device_status", "reason": "meta.sensor must be leg, head, pelvis" } ] }
```

- `accepted`: stored.
- `duplicates`: already received earlier; ignored (section 6).
- `dropped`: the `metric` name is not one we know.
- `rejected`: individual readings refused, with the reason.

The rest of the batch is still stored when some readings are rejected. Please log rejections so
that we can fix them together.

---

## 6. Backfill after a gap

When the hub cannot reach the server (no coverage on a ride, a network outage), it keeps
everything it could not send, **for at least 24 hours** (requirement C5). When the connection
returns, it sends the stored readings:

- **In the same message** (`POST /ingest/readings`), with their **original `ts`**, oldest
  first, in batches of up to about 500 readings.
- **Unchanged.** Keep the original periods, values and `meta.seq`. Do not merge old minutes into
  new totals.
- Live readings may be sent in between backfill batches. The order does not matter.

**Duplicates are ignored.** From one hub, two readings are treated as the same reading when they
have the same `metric`, `ts`, `meta.sensor` and `meta.seq`. So:

- If a response was lost and the hub cannot tell whether a batch arrived, **send it again**. The
  copies are counted under `duplicates` and not stored twice.
- A reading that is re-sent must keep its **original `meta.seq`**. A new number would make it
  count as a new reading.
- Two different readings with the same `metric`, `ts` and `meta.sensor` must have different
  `meta.seq`.

Raw uploads (section 7) are backfilled the same way: send them later, unchanged. An upload
repeated for the same sensor with the same `X-Start` is recognised as the same recording and
stored once.

---

## 7. Raw motion upload — `POST /ingest/raw`

### 7.1 What to upload

Upload the raw samples of **all three devices for every exercise session and every trot-up**,
covering the same stretch of time. Lameness is measured on the straight trot using all three
devices together: the leg tag gives the timing of each stride, the hub gives head movement, and
the pelvis sensor gives pelvis movement.

- **One request = one device, one continuous recording.** Split long recordings into pieces of
  **one hour or less**.
- **Order:** upload the head and pelvis recordings of a session before, or together with, the leg
  tag's. Analysis starts when the leg tag's recording arrives with its partners, and waits at most
  10 minutes for them.
- Deliver within hours of the session (requirement L5). It can go over the mobile link, or
  over Bluetooth / Wi-Fi when the horse is back in the barn.

### 7.2 Request

```
POST /ingest/raw
Authorization: Bearer <device token>
X-Sensor: leg | head | pelvis
X-Start: 2026-09-29T06:30:00.000Z
X-Rate-Hz: 200
Content-Type: text/csv
Content-Encoding: gzip        (optional — only if the body is gzipped)
```

| Header | Required | Meaning |
|---|---|---|
| `X-Sensor` | **yes** | Which device recorded it: `leg`, `head` or `pelvis` |
| `X-Start` | **yes** | UTC time of the first sample (`t = 0`), ISO 8601 with `Z`, with milliseconds. It must not be in the future and not older than 30 days. |
| `X-Rate-Hz` | **yes** | The nominal sample rate, 1–2000 (we ask for 200 Hz for head and pelvis, and at least 100 Hz for the leg tag) |
| `Content-Encoding: gzip` | no | Send it when the body is gzip-compressed (recommended: raw CSV compresses about 3 times) |

**Size limit: 50 MB per request as sent** (after gzip), and 256 MB once unzipped. As a guide, one
hour of one device at 200 Hz is about 32 MB of CSV (about 42 MB with the magnetometer columns),
or roughly 11–15 MB gzipped.

### 7.3 Body — CSV

The first line is the header. It is exactly one of these two:

```
t,ax,ay,az,gx,gy,gz
t,ax,ay,az,gx,gy,gz,mx,my,mz
```

After the header comes one line per sample, with the columns in that order:

```
t,ax,ay,az,gx,gy,gz
0.000,0.412,-0.087,9.791,1.20,-0.35,0.08
0.005,0.398,-0.091,9.804,1.17,-0.41,0.06
0.010,0.405,-0.079,9.786,1.25,-0.38,0.11
```

| Column | Unit | Meaning |
|---|---|---|
| `t` | s | Seconds since `X-Start` (the first sample is 0). Give at least 3 decimals. It never goes backwards. |
| `ax`, `ay`, `az` | m/s² | Acceleration including gravity, in the frame of section 4 |
| `gx`, `gy`, `gz` | °/s | Angular rate, in the frame of section 4 |
| `mx`, `my`, `mz` | µT | Magnetic field. Optional: all three or none. |

- Use a plain decimal point: no thousands separators, no quotes, no units in the cells, no empty
  cells. Line ends can be LF or CRLF.
- **No other columns and no other lines.** If you need to flag samples (for example saturation),
  tell us and we will extend the format.
- `t` comes from the device's own sample clock. If samples are lost, **leave them out** (so `t`
  jumps). Do not repeat or invent samples to fill the gap.
- If a value reached the sensor's full-scale range (a kick against the wall), send the saturated
  value as it is.
- All three devices take `X-Start` from the same clock, agreed to ≤ 10 ms.

**Example:**

```
gzip -k leg-20260929T063000Z.csv
curl -X POST "https://<server>/ingest/raw" \
  -H "Authorization: Bearer <device token>" \
  -H "X-Sensor: leg" -H "X-Start: 2026-09-29T06:30:00.000Z" -H "X-Rate-Hz: 200" \
  -H "Content-Type: text/csv" -H "Content-Encoding: gzip" \
  --data-binary @leg-20260929T063000Z.csv.gz
```

### 7.4 Response

| Status | Meaning |
|---|---|
| **201** | Stored: `{ "id": "...", "sensor": "leg", "start": "2026-09-29T06:30:00.000Z", "samples": 720000, "bytes": 11104210, "processed": false }` |
| **200** | This recording had already been received (`"duplicate": true`). Nothing more to do. |
| **202** | Received for forwarding. Nothing more to do. |
| **400** | Something is wrong with the headers or the CSV. The body names the problem and the line, for example `line 3: "x" is not a number`. |
| **401** | Token missing, wrong or revoked |
| **413** | Over 50 MB: split the recording |
| Other, or no answer | Keep the file and retry later with back-off |

---

## 8. Checklist

1. HTTPS to the configured address, with `Authorization: Bearer <device token>`.
2. Timestamps in UTC ISO 8601 with `Z`, taken from network time, with the three devices agreed
   to ≤ 10 ms.
3. Every live reading has `metric`, numeric `value`, `ts` and `meta.seq`, plus `meta.sensor` and
   `meta.hardwareId`.
4. `device_status` for each device at least every 10 minutes; `device_detached` immediately.
5. Nothing that was not measured is sent as 0.
6. At least 24 h kept while offline, then sent unchanged with the original `ts` and `meta.seq`.
7. Raw CSV from all three devices for every exercise session and trot-up, in the axis frame of
   section 4 (x forward, y to the horse's left, z up; leg tag on the left front cannon), in m/s²
   and °/s.

---

## 9. Using your own format instead

If your hub already sends a documented format of its own (JSON with different field names,
CBOR, a binary frame, an MQTT topic layout), we can accept it through an **adapter** on our side
instead of this format. Please send:

- The **specification**: every field, its type, unit and meaning. For binary formats, the byte
  layout, byte order, framing and checksum. Also how timestamps, sequence numbers, the device
  position (leg / head / pelvis) and the hardware ID are carried.
- The **raw-data layout**, if your waveform files differ from section 7. Include the sample rate,
  the scaling to physical units and the axis orientation.
- **Sample payloads and files recorded from the exact model and firmware** you would supply,
  including a short recording of a horse standing still (to check the axes).

We then give you a format name to put in the `X-EquiCare-Format` header. The rest of this
document stays the same: the token, the address, UTC timestamps, the rule that nothing unmeasured
is sent as 0, and backfill with duplicates ignored.

Whatever the format, it must carry, for every record: the device's hardware ID, its position on
the horse, a UTC timestamp, a sequence number, and the units.
