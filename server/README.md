# BSV EquiCare — software stack

Three layers, one data contract. The camera hardware is in hand; the rest of the
sensors are still being procured, so the software is built to run **fully today
on simulated + camera data** and light up each real sensor as it arrives — no
schema or API changes needed.

```
  ┌── edge box (Jetson, per barn) ──────────────┐        ┌── cloud (India region) ──┐        ┌── browser ──┐
  │  sparsh_camera.py   (ISAPI + Modbus + RTSP) │        │  server/ (Node)          │        │  React SPA  │
  │  edge/edge_agent.py  ── readings ──────────POST──▶  /ingest/readings           │        │  (Vite)     │
  │    • camera: pts 2,3,4 (temp/resp)          │        │  rollup → Horse/Alert    │◀──GET──│  store.tsx  │
  │    • simulate: all 12 pts (until hardware)  │        │  /api/horses|alerts|...  │        │             │
  │  offline queue (outbox.jsonl, ≥24h buffer)  │        └──────────────────────────┘        └─────────────┘
  └─────────────────────────────────────────────┘
```

## Run it (3 terminals)

```bash
# 1. backend
cd server && node index.mjs                       # http://127.0.0.1:8080

# 2. seed + stream data (no hardware needed)
python3 edge/edge_agent.py --simulate --backfill-days 14 --live --interval 10

# 3. frontend  (auto-uses the local API in dev; falls back to mock if it's down)
npm run dev                                        # http://localhost:5173
```

With a real camera instead of the simulator:
```bash
python3 edge/edge_agent.py --camera 192.168.1.102 --pass 'YourPass' --live
```

Deploy note: set `VITE_API_URL` at build time to point the SPA at the cloud
backend. Unset ⇒ the SPA runs on bundled mock data (the current Vercel demo).

## The 12 monitoring points → data model

Every point is just a `metric` in [`contract.mjs`](contract.mjs); the edge emits
readings, the backend stores them generically, `rollup.mjs` turns them into the
`Horse`/`Alert` shapes the UI already renders. `GET /api/coverage` reports which
are live vs. awaiting hardware.

| # | Point | metric(s) | Source | Status today |
|---|---|---|---|---|
| 1 | Steps / locomotion | `steps` | IMU tag | ⏳ sensor pending |
| 2 | Body temperature | `body_temp_c` | thermal camera | ✅ camera in hand |
| 3 | Respiration | `nostril_temp_c` | thermal camera | ✅ camera in hand |
| 4 | Respiratory rate | `respiratory_rate_bpm` | thermal camera (edge DSP) | ✅ camera in hand |
| 5 | Activity / abnormal | `activity_index` | IMU + optical | ⏳ IMU pending |
| 6 | Rest / lying · outside | `rest_minutes` · `outside_minutes` | IMU+optical · optical | ⏳ / ✅ optical |
| 7 | Lameness / gait | `gait_asymmetry` | IMU + optical | ⏳ IMU pending |
| 8 | Stable vices | `vice_event` | optical + mic | ⏳ mic pending |
| 9 | Watering | `water_ml` · `water_visit` | flow meter | ⏳ sensor pending |
| 10 | Feeding | `feed_intake_g` · `feed_refusal_g` | weigh feeder | ⏳ sensor pending |
| 11 | Urination | `urination_event` | optical CV | ✅ camera (needs model) |
| 12 | Excretion | `excretion_event` | optical CV | ✅ camera (needs model) |

## How each real sensor plugs in
- **Camera (now):** `edge_agent.py --camera` uses `sparsh_camera.py` for points 2–4.
  Optical-CV points (5,6,8,11,12) need our detection models on the RTSP streams —
  same `reading()` emit, no backend change.
- **IMU / feed / water / mic (later):** each gets a small reader in `edge/` that
  emits its metric(s) with `{source, confidence, ts}`. The backend and UI need
  no change — coverage flips from `pending` to `available` in `contract.mjs`.

## Endpoints
`GET /health` · `GET /api/coverage` · `POST /ingest/readings` ·
`GET /api/horses` · `GET /api/horses/:id` (vitals + charts) ·
`GET /api/alerts` · `POST /api/alerts/:id/ack` · `GET /api/series`

## Not production yet (deliberate for the prototype)
- Storage is a JSON file behind an interface in `store.mjs` → swap for Postgres/
  Timescale (India region, DPDP residency) with no caller changes.
- No auth on the API yet; add device tokens for `/ingest` and user auth for `/api`.
- Clinical thresholds in `rollup.mjs` are screening-grade defaults — replace with
  vet-reviewed ranges and per-horse learned baselines.
