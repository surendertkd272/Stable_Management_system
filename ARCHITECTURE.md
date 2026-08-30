# BSV EquiCare — system architecture & run guide

24/7 monitoring for stabled horses. Covers the **12 client monitoring points** as a
single data pipeline, so adding a sensor is a new *metric*, not a new subsystem.

```
  ┌──────────── per stall ────────────┐   ┌──── per barn ────┐   ┌──── cloud ────┐   ┌── browser ──┐
  │ Sparsh thermal+optical camera     │   │ edge box (Jetson)│   │ Node backend  │   │ React SPA   │
  │  · ISAPI (HTTP)  ROI set/move     │──▶│ edge_agent.py    │──▶│ ingest + roll │──▶│ dashboard   │
  │  · Modbus/TCP    temperatures     │   │  offline buffer  │   │ up + alerts   │   │ alerts, etc │
  │  · RTSP  IR/visible/fusion + meta │   │  sparsh_camera.py│   │ JSON | Postgres│  │             │
  │ (IMU · feed/water · mic — later)  │   │  ≥24h queue      │   │               │   │             │
  └───────────────────────────────────┘   └──────────────────┘   └───────────────┘   └─────────────┘
```

## Layout

| Path | What it is |
|---|---|
| [sparsh_camera.py](sparsh_camera.py) | Camera driver — ISAPI client, Modbus reader, `stream/meta` frame parser, `RoiController` (static ⇄ ISAPI-dynamic). ARM64-native, no vendor SDK. |
| [sparsh_camera_smoketest.py](sparsh_camera_smoketest.py) | One-shot bench diagnostic to run when an eval unit powers on. |
| [edge/edge_agent.py](edge/edge_agent.py) | Edge agent. `--simulate` generates all 12 metrics; real mode reads the camera. Offline-buffered (`edge/outbox.jsonl`). |
| [server/contract.mjs](server/contract.mjs) | **Metric taxonomy** — the 12 points as data. Single source of truth. |
| [server/rollup.mjs](server/rollup.mjs) | Raw readings → `Horse`/`Alert`/`series` shapes + the clinical rule engine. |
| [server/store.mjs](server/store.mjs) | Storage behind one interface; JSON file by default, Postgres when `DATABASE_URL` is set. |
| [server/schema.sql](server/schema.sql) | Postgres schema (+ optional TimescaleDB hypertable/retention). |
| [server/index.mjs](server/index.mjs) | HTTP API + auth. |
| [src/data/api.ts](src/data/api.ts) | SPA API client — **falls back to mock data** when no backend is reachable. |

## Run it

```bash
# 1. backend  (JSON store, auth open — fine for local)
cd server && node index.mjs                 # http://127.0.0.1:8080

# 2. seed 14 days of realistic data for all 12 points, 7 horses
python3 edge/edge_agent.py --simulate --backfill-days 14
python3 edge/edge_agent.py --simulate --live --interval 10   # + keep streaming

# 3. frontend
cp .env.example .env.local                  # set VITE_API_URL=http://127.0.0.1:8080
npm run dev
```

With `VITE_API_URL` unset the SPA behaves exactly as before (pure mock) — the
backend is strictly additive.

### Against a real camera
```bash
python3 sparsh_camera_smoketest.py 192.168.1.102 admin 'PASSWORD'   # verify unit
python3 edge/edge_agent.py --camera 192.168.1.102 --pass 'PASSWORD' \
        --horse zarina --stall A-04 --live
```

### Production posture
```bash
cd server && npm install pg
psql "$DATABASE_URL" -f schema.sql
DATABASE_URL=postgres://…  AUTH_API_TOKEN=…  AUTH_INGEST_TOKEN=…  node index.mjs
```
Host Postgres in-region (Mumbai / `ap-south-1`) for **DPDP-2023** residency.

## API

| Endpoint | Purpose |
|---|---|
| `POST /ingest/readings` | Edge → cloud batch. Unknown metrics are dropped, not stored. |
| `GET /api/horses` | Roster with rolled-up status (matches the SPA `Horse` type). |
| `GET /api/horses/:id` | + latest vitals per metric + 7-day charts. |
| `GET /api/alerts` | Rule-engine alerts (matches `Alert`). |
| `POST /api/alerts/:id/ack` | Acknowledge (persisted). |
| `GET /api/series` | Dashboard sparklines. |
| `GET /api/series?days=N` | Dashboard/report sparklines over N days (1–90, default 7). |
| `GET /api/coverage` | **Which of the 12 points are live vs pending hardware.** |
| `GET /api/notify/status` | Notification transport + delivery counters. |
| `GET /health` | Store backend, reading counts, record counts. Always open. |

### Record collections (CRUD)

`horses` · `diary` · `health` · `feed` · `invoices` · `coverings` · `stallions`

| Method | Path | |
|---|---|---|
| `GET` | `/api/<kind>` | list |
| `POST` | `/api/<kind>` | create (validates required fields → 400) |
| `PATCH` | `/api/<kind>/:id` | partial update |
| `DELETE` | `/api/<kind>/:id` | delete |

The SPA **supplies the id** on create. If the server minted its own, a later
patch/delete would reference an id the server never saw, 404, and the record would
reappear on reload.

**The roster is data, not a file.** `roster.json` seeds `horses` on first boot; after
that the store owns it. This is what makes a horse added in the UI actually monitored —
previously the rollup only ever saw the seed file, so a new horse got no alerts at all.

## Authentication

Earlier the SPA sent a shared `VITE_API_TOKEN`. Vite **compiles env vars into the
JS bundle**, so anyone opening devtools on the deployed site had full API access.
Verified and removed: real per-user sessions now.

| Endpoint | |
|---|---|
| `POST /auth/login` | `{username, password}` → `{token, user, expiresIn}` |
| `POST /auth/logout` | invalidates the session immediately |
| `GET /auth/me` | current user, or `authRequired:false` if the backend is open |

- Passwords: **scrypt** with a per-user salt (`node:crypto`, no dependency). The hash
  never leaves the server — `publicUser()` strips it on every response.
- Sessions: opaque 32-byte random tokens, held server-side, 12 h TTL (a barn shift).
  Unknown users are still verified against a dummy hash so response timing doesn't
  reveal whether a username exists.
- Roles: **admin** (full, may manage users) · **staff** (read/write) · **owner**
  (read-only — the Portal view; non-GET returns 403).
- `AUTH_API_TOKEN` still works for machine/server-to-server callers, and
  `AUTH_INGEST_TOKEN` for the edge agent — those are not browser-delivered.

First boot creates an admin and prints a generated password **once**; set
`ADMIN_USER` / `ADMIN_PASSWORD` to choose it.

**The backend is closed by default.** Because an admin always exists after first
boot, `/api/*` always requires a caller — there is no accidental open window. The
standalone prototype is unaffected: with `VITE_API_URL` unset the SPA never calls
the API at all and runs purely on mock data.

`/ingest/*` is separate — it is open unless `AUTH_INGEST_TOKEN` is set, so an edge
box can be brought up before credentials are distributed. **Set it before the
network is anything but a closed lab VLAN.**

### Owner scoping

An `owner` account sees **only its own horses**, and this is enforced
**server-side** — `/api/horses`, `/api/horses/:id`, `/api/alerts` and every record
collection filter by owner. The Portal page also hides its owner switcher for an
owner account, but that is presentation; the API is the access control. (That
switcher's own comment described it as "standing in for owner login" — once owner
accounts existed, leaving it live would have let one owner read another's data.)

Requesting another owner's horse returns **404, not 403**, so the response does not
confirm the horse exists. A record row carrying neither an `owner` nor a `horse`
field is withheld rather than leaked by default.

## Notifications

Settings offers WhatsApp/digest/escalation toggles; [notify.mjs](server/notify.mjs)
delivers them. Alerts are dispatched **once each** (alert ids are day-scoped, so a
condition doesn't re-notify on every poll).

```bash
NOTIFY_WEBHOOK_URL=https://…   # POST alert JSON (Slack, n8n, WhatsApp gateway)
NOTIFY_MIN_SEVERITY=alert      # alert (default) | warn | ok
NOTIFY_DISABLED=1              # log only
```

No WhatsApp Business or SMS vendor is hardcoded — that needs an account, verified
sender and message template, which is a commercial decision. The webhook points at
whatever you procure.

Auth: set `AUTH_API_TOKEN` / `AUTH_INGEST_TOKEN` → `Authorization: Bearer <token>`.
Unset ⇒ open. On a rejected flush the edge agent **keeps readings queued** (verified).

## The 12 points

| # | Point | Metric(s) | Source | Status |
|---|---|---|---|---|
| 1 | Steps / locomotion | `steps` | IMU | pending sensor |
| 2 | Body temperature | `body_temp_c` | thermal camera | **available** |
| 3 | Respiration pattern | `nostril_temp_c` | thermal camera | **available** |
| 4 | Respiratory rate | `respiratory_rate_bpm` | thermal (autocorrelation) | **available** |
| 5 | Activity / abnormal | `activity_index` | IMU + optical | pending sensor |
| 6 | Rest / time outside | `rest_minutes`, `outside_minutes` | IMU + optical | partly available |
| 7 | Lameness | `gait_asymmetry` | IMU + optical | pending sensor |
| 8 | Stable vices | `vice_event` | optical + mic | pending mic |
| 9 | Watering | `water_ml`, `water_visit` | flow meter | pending sensor |
| 10 | Feeding | `feed_intake_g`, `feed_refusal_g` | feeder | pending sensor |
| 11 | Urination | `urination_event` | optical CV | **available** (needs model) |
| 12 | Excretion | `excretion_event` | optical CV | **available** (needs model) |

`/api/coverage` reports this live, so the UI can show honest per-point state.

## Accepted hardware constraints
- **±2 °C screening-grade** body temperature — no blackbody variant exists on this SDK. Good for fever *trends*, not clinical readings; alert copy says so.
- **850 nm IR** illuminator (not 940 nm) — add **external 940 nm floodlights**; thermal is passive and unaffected.
- **Rolling-shutter** visible sensor (IMX290) — IMU is primary for gait; optical gait is supporting only.
- **No visible↔thermal mapping** exposed — detect on the thermal/fusion stream, not by mapping from visible.
- **ROI moves are config writes** (a few Hz, not 25 Hz) — fine for a resting horse.

## Camera protocol

The camera is driven entirely over documented network protocols — ISAPI (HTTP/JSON),
Modbus/TCP and RTSP — with no vendor SDK in the path. Endpoints, the Modbus register
map, the `stream/meta` frame layout and the known limitations are captured in
[SDK/PROTOCOL_REFERENCE.md](SDK/PROTOCOL_REFERENCE.md) so the driver does not depend
on a vendor PDF sitting in someone's inbox.

## Monitoring-gap safety net

A 24/7 monitor that goes blind must **say so** — stale data must never render as "calm".
[rollup.mjs](server/rollup.mjs) checks freshness *before* any clinical rule:

| Gap since last reading | Result |
|---|---|
| < 2 h | `monitoring: "live"` — rules evaluated normally |
| ≥ 2 h | `"stale"` → **warn** "Monitoring gap"; rules still evaluated |
| ≥ 6 h | `"offline"` → **alert** "Monitoring offline"; downstream rules **suppressed** (they'd be judging stale data) |
| never any data | `"no-data"` → **warn**; horse is never reported calm |

`/api/horses` exposes `monitoring` and `lastSeen` per horse, and the UI renders it
distinctly: a blind horse shows a **"Monitoring offline" / "No sensor data" badge instead
of its clinical status pill**, so a dead camera can never be mistaken for a healthy — or a
sick — animal. `MonitoringPill` / `isBlind()` live in [ui.tsx](src/components/ui.tsx).

Settings also carries a **Monitoring coverage** card driven by `/api/coverage` — an honest
"N of 12 points sourced" breakdown, so the UI can't overclaim what the hardware supports.

## Tests

```bash
cd server && npm test        # 40 tests (rules + records + notify + auth), no deps
```

They pin the **clinical** behaviour (fever/hypothermia/resp/colic/lameness/water
thresholds, severity precedence, staleness) and the **SPA contract** (every field of
`Horse`/`Alert`, 7-point series). If a vet retunes a threshold, these say exactly which
conclusions changed.

## Verified

- **Postgres path** — schema migrates; 14,114 readings persisted and read back; API served
  from Postgres; **cold-restart cache reload confirmed**; acks survive restart. Both
  backends produce identical API behaviour.
- **Auth** — 401 without/with wrong token, 200 with; `/health` always open.
- **Offline resilience** — on a rejected flush the edge agent kept 2,476 readings queued; none lost.
- **Same-timestamp collision** — two readings of one metric sharing a timestamp: the later
  value wins. (This was a real bug: with strict `>` a fever arriving in the same
  second/minute as a normal reading was silently dropped. Edge timestamps are only
  second-precision — minute-precision in `--live` — so collisions are routine.)

## Still open
- Rule thresholds are screening defaults — **have a vet review them**; learned per-horse
  baselines should progressively take over as data accrues.
- Points 11/12 (and optical 5/6/8) need **labelled footage + trained CV models**; the
  pipeline carries the events, the models are still to be built.
- 8 of 12 points await sensor procurement (IMU, feed/water, mic) — `/api/coverage` reports
  this honestly, so nothing is overclaimed in the UI.
