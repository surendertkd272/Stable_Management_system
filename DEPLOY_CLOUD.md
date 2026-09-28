# The relay for the SIM hubs — deploying it in India

The wearable set (leg tag + halter hub + pelvis sensor) sends over the mobile
network (LTE-M / NB-IoT SIM in the hub). The site server stays where it is —
on the stable's own network, with **no port open to the internet**. Between
them sits a small store-and-forward service, `server/relay.mjs`, on an
internet-facing machine in India:

```
  hub (SIM) ──LTE──▶ https://relay.<domain>/ingest/readings   ─┐
                     https://relay.<domain>/ingest/raw        ─┤  relay VM (India)
                                                               │  Caddy (TLS) → relay.mjs :8787
  site server ──────▶ GET  /relay/pull?max=500   (every 15 s) ◀┤  queue on disk, ≤ 7 days / 2 GB
  (at the stable)     POST /relay/ack {ids}                    ─┘
```

The site server only ever calls **out** (HTTPS to the relay), so the stable's
router needs no port forwarding. Everything the hubs send goes through the
same ingest path as a direct send: the registry decides which horse it belongs
to, the metrics a wearable may send are fixed, re-sent readings are stored once.

Files: [`deploy/Caddyfile`](deploy/Caddyfile),
[`deploy/equicare-relay.service`](deploy/equicare-relay.service),
[`deploy/relay.env.example`](deploy/relay.env.example) (relay VM);
[`deploy/equicare-site.service`](deploy/equicare-site.service),
[`deploy/site.env.example`](deploy/site.env.example) (site server).

## What the relay keeps, and what it does not

| | |
|---|---|
| Per item | `{ id, kind, tokenHash, headers, body, receivedAt }` — `kind` is `readings` or `raw`; headers are only the `X-*` and `Content-*` ones (not the hub's IP address, not `X-Forwarded-*`) |
| The hub's token | **never stored** — only `sha256(token)`. The site server finds the device by that hash |
| How long | until the site server pulls and acks it; at most **7 days**, and the oldest go first beyond **2 GB** in all (logged: `dropped N item(s) …`) |
| Per request | **1 MB** of readings, **50 MB** per raw upload (413 above) |
| Answer | `202` — queued, not yet accepted: whether a reading is valid is decided at the site |

It is a buffer, not a database: nothing needs backing up. Horse data sits on
it only until pulled (seconds when the site is online). Keep the VM in an
Indian region for DPDP residency.

## 1. The machine

- A small Linux VM in an Indian region — e.g. AWS `ap-south-1` (Mumbai) /
  `ap-south-2` (Hyderabad), Azure Central India, GCP `asia-south1`. 1 vCPU,
  1 GB RAM and 20 GB disk are plenty (the queue is capped at 2 GB). Ubuntu
  24.04 LTS is assumed below.
- A DNS name for it, e.g. `relay.example.in` → an `A` record to its public IP.
- Firewall / security group: **443** and **80** (80 only for the certificate
  challenge) from anywhere; **22** from your own address only. Nothing else —
  the relay listens on 127.0.0.1.
- Unattended security updates on (`sudo apt install unattended-upgrades`),
  SSH keys only.

## 2. Node and the relay

```bash
# Node 22 (the version the site server runs)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# relay.mjs has no dependencies — copy the one file
sudo mkdir -p /opt/equicare-relay
sudo cp server/relay.mjs /opt/equicare-relay/relay.mjs

# the key the site server will use to pull
sudo mkdir -p /etc/equicare
echo "RELAY_KEY=$(openssl rand -base64 32)" | sudo tee /etc/equicare/relay.env >/dev/null
sudo chmod 600 /etc/equicare/relay.env
sudo cat /etc/equicare/relay.env        # note the value for step 4

sudo cp deploy/equicare-relay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now equicare-relay
journalctl -u equicare-relay -n 20      # "[relay] listening on 127.0.0.1:8787 …"
```

The unit runs it as a throwaway user (`DynamicUser`) with its queue in
`/var/lib/equicare-relay` (mode 700) and most of the system read-only.

## 3. TLS in front: Caddy

```bash
sudo apt install -y caddy
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/relay.example.in/relay.YOUR-DOMAIN/' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy fetches and renews the certificate itself. It passes only the five
paths the relay serves and refuses bodies over 51 MB at the door. Its access
log redacts `Authorization` (hub tokens, the relay key) — do not turn on
`log_credentials`.

Check from anywhere:

```bash
curl https://relay.YOUR-DOMAIN/relay/health
# {"ok":true,"items":0,"bytes":0,"oldest":null}
curl -i https://relay.YOUR-DOMAIN/relay/pull            # 401 without the key
```

## 4. The site server pulls

On the stable's site server, add to its environment (`/etc/equicare/site.env`,
see `deploy/site.env.example`) and restart it:

```bash
EQUICARE_RELAY_URL=https://relay.YOUR-DOMAIN
EQUICARE_RELAY_KEY=<the RELAY_KEY from step 2>
```

With both set it pulls every 15 s (`EQUICARE_SENSOR_TICK_MS`), ingests each
item as the device whose token hash it carries, then acks. `GET /api/health`
then shows a `relay` block: `lastPullAt`, `lastOkAt`, `lastError`,
`received`, `rejected`. An item from an unknown or revoked token is acked
(so it does not block the queue) and logged as rejected. An item the site
could not store (a server error) is left on the relay and retried.

The site needs outbound HTTPS to the relay's name — nothing inbound.

## 5. The hubs

For each hub, on the Hardware page: **Add → Wearable**, choose the horse,
enter the leg tag and pelvis sensor IDs and the IMEI. The token is shown
**once** — it goes into the hub's configuration with these endpoints:

| | |
|---|---|
| Readings | `POST https://relay.YOUR-DOMAIN/ingest/readings` · `Authorization: Bearer eqd_…` · JSON (our `equicare-wearable/1`, or the vendor's with `X-EquiCare-Format`) · `Content-Encoding: gzip` welcome |
| Raw motion | `POST https://relay.YOUR-DOMAIN/ingest/raw` · same token · `X-Sensor: leg\|head\|pelvis`, `X-Start: <ISO time of the first sample>`, `X-Rate-Hz` · CSV `t,ax,ay,az,gx,gy,gz[,mx,my,mz]`, gzip welcome |

The hub cannot choose the horse: whatever it puts in `horseId` is ignored —
readings go to the horse it is registered on. Moving the hub to another horse
is an edit on the Hardware page.

## Running it

- **Health:** watch `https://relay.YOUR-DOMAIN/relay/health` from your
  uptime monitor; `items` growing, or `oldest` more than a few minutes old,
  means the site server is not pulling (site offline, key mismatch — see its
  `/api/health` → `relay.lastError`).
- **Logs:** `journalctl -u equicare-relay` — drops past 7 days / 2 GB are
  logged there. A site server offline for a week loses the oldest data.
- **Rotating the relay key:** new value in `/etc/equicare/relay.env` and in
  the site's `EQUICARE_RELAY_KEY`, restart both. Queued items are kept.
- **Rotating a hub's token** (Hardware page): the old one stops at once;
  anything still queued under it is rejected at the next pull (logged).
- **Upgrading:** copy the new `relay.mjs`, `sudo systemctl restart
  equicare-relay`. The queue on disk survives restarts.

## What to know about its security

- The relay cannot tell a real device token from an invented one — only the
  site's registry can. Anyone can queue junk with an `eqd_…`-shaped token; it
  is rejected at the site, but it takes room on the relay, and a flood could
  push real items out past the 2 GB cap. Watch the logs; if it happens, rate
  limit at the cloud firewall.
- The relay holds each sending hub's token hash, and the site identifies
  hubs by that hash. So whoever controls the relay VM could forge readings for
  those hubs. Treat the VM and `RELAY_KEY` as part of the system: SSH keys
  only, updates on, key file mode 600.
- Nothing here is a medical record on its own, but it is the horse's data:
  keep the VM in India, and do not add logging of request bodies.

## Not verified yet

The relay and the site's pull are tested end to end in `server/relay.test.mjs`
(in-process, over HTTP). **Not yet run on a real VM, behind a real Caddy, or
with a real hub** — the hardware is not bought. Check on first deployment:
the certificate is issued, a hub's first readings arrive (Hardware page →
the wearable shows "online"), and a raw upload of a real session size goes
through the mobile network within the hub's timeout.
