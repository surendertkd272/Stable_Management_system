#!/bin/bash
# EquiCare demo on one Mac: the site server and the edge agent together, with
# the camera cabled to this machine. No internet needed.
#
#   scripts/demo.sh                   start (builds the app the first time)
#   scripts/demo.sh --build           rebuild first (after pulling new code)
#   scripts/demo.sh --setup-detector  once: lying-down detection (downloads
#                                     ~70 MB: numpy, onnxruntime, YOLOX-tiny)
#
# Everything the demo keeps — horses, devices, readings, the edge-box token —
# lives in ~/EquiCare-demo, outside the repository, so it survives restarts
# and code updates. Ctrl-C stops both processes.
set -u
cd "$(dirname "$0")/.."

HOME_DIR="${EQUICARE_DEMO_HOME:-$HOME/EquiCare-demo}"
DATA="$HOME_DIR/data"
LOGS="$HOME_DIR/logs"
TOKEN_FILE="$HOME_DIR/edge-token"
PORT_ASKED="${PORT:-}"
PORT="${PORT:-8080}"
mkdir -p "$DATA" "$LOGS"

say() { printf '\033[1m[demo]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[demo] %s\033[0m\n' "$*" >&2; exit 1; }

# ---- optional: the horse detector for lying down / getting up ---------------
# A Python environment of its own under ~/EquiCare-demo (nothing installed
# system-wide) and the YOLOX-tiny model (Megvii, Apache-2.0, COCO "horse").
VENV="$HOME_DIR/edge-venv"
MODEL="$HOME_DIR/models/yolox_tiny.onnx"
if [ "${1:-}" = "--setup-detector" ]; then
  command -v python3 >/dev/null || die "python3 is not installed."
  say "creating $VENV …"
  python3 -m venv "$VENV" || die "could not create the Python environment"
  "$VENV/bin/pip" -q install requests numpy onnxruntime || die "package install failed (needs internet)"
  mkdir -p "$HOME_DIR/models"
  say "downloading the YOLOX-tiny model …"
  curl -fsSL -o "$MODEL.part" https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.onnx \
    && mv "$MODEL.part" "$MODEL" || die "model download failed"
  "$VENV/bin/python" -c "import sys; sys.path.insert(0, 'edge'); from detector import load; d, why = load('$MODEL'); print(why or 'detector ready')"
  exit 0
fi
PY=python3
if [ -x "$VENV/bin/python" ] && [ -s "$MODEL" ]; then
  PY="$VENV/bin/python"
  export EQUICARE_DETECTOR_MODEL="$MODEL"
fi

command -v node >/dev/null || die "Node.js is not installed (need v22)."
command -v python3 >/dev/null || die "python3 is not installed."
"$PY" -c "import requests" 2>/dev/null || die "python3 is missing the 'requests' package: python3 -m pip install --user requests"

# One demo at a time on this data: two servers writing the same store would
# corrupt it.
PIDFILE="$HOME_DIR/demo.pid"
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  die "the demo is already running (pid $(cat "$PIDFILE"), $(cat "$HOME_DIR/demo.url" 2>/dev/null)). Stop it with Ctrl-C in its window, or: kill $(cat "$PIDFILE")"
fi
busy() { lsof -tiTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
if busy "$PORT"; then
  # Something else has the port (an editor's dev server keeps taking 8080):
  # use the next free one, unless a port was asked for.
  [ -n "$PORT_ASKED" ] && die "port $PORT is already in use. Stop what holds it (kill \$(lsof -tiTCP:$PORT -sTCP:LISTEN)) or choose another: PORT=8090 scripts/demo.sh"
  for p in 8090 8091 8092 8093 8094 8095; do busy "$p" || { PORT=$p; break; }; done
  busy "$PORT" && die "ports 8080 and 8090–8095 are all in use"
  say "port 8080 is taken by another program — using $PORT instead"
fi
URL="http://127.0.0.1:$PORT"
echo $$ > "$PIDFILE"
echo "$URL" > "$HOME_DIR/demo.url"

if [ ! -d .next ] || [ "${1:-}" = "--build" ]; then
  say "building the app (a minute, first time only)…"
  npm run build > "$LOGS/build.log" 2>&1 || die "build failed — see $LOGS/build.log"
fi

# ---- where is the camera? ---------------------------------------------------
# On a direct cable the Mac has no IPv4 route to the camera, but it can reach
# it over IPv6 link-local — an address that includes the adapter's name
# (e.g. %en8), which changes if the adapter moves to another port. Find the
# camera by its full MAC on every active interface and print what to use.
# The whole address, never just the maker's prefix: the stable's own network
# has other Sparsh devices (same 18:74:e2 prefix), and picking one of them
# would send our login to someone else's camera. ndp drops leading zeros
# ("1:da"), so both sides are normalised before comparing.
CAMERA_MAC="${CAMERA_MAC:-18:74:e2:dc:d5:d0}"
find_camera() {
  for ifc in $(ifconfig -l); do
    ifconfig "$ifc" 2>/dev/null | grep -q "status: active" || continue
    ping6 -c 1 -i 0.2 "ff02::1%$ifc" >/dev/null 2>&1
  done
  ndp -an 2>/dev/null | awk -v want="$CAMERA_MAC" '
    function norm(m,   a, n, i, o) { n = split(tolower(m), a, ":"); o = ""
      for (i = 1; i <= n; i++) o = o (i > 1 ? ":" : "") (length(a[i]) == 1 ? "0" a[i] : a[i]); return o }
    norm($2) == norm(want) { print $1; exit }'
}
CAM_ADDR="$(find_camera)"
if [ -n "$CAM_ADDR" ]; then
  say "camera found at $CAM_ADDR — use this as its IP address in the Hardware page"
else
  say "camera not found on any cable — check its power and the USB-Ethernet adapter (continuing anyway)"
fi

# ---- server ---------------------------------------------------------------
say "starting the server on $URL (data: $DATA)"
EQUICARE_DATA_DIR="$DATA" NEXT_TELEMETRY_DISABLED=1 PORT="$PORT" HOST=127.0.0.1 \
  npm start > "$LOGS/server.log" 2>&1 &
SERVER=$!
AGENT=""
TAIL=""
ARCHIVE=""
cleanup() {
  say "stopping…"
  [ -n "$TAIL" ] && pkill -P "$TAIL" 2>/dev/null; [ -n "$TAIL" ] && kill "$TAIL" 2>/dev/null
  [ -n "$AGENT" ] && kill "$AGENT" 2>/dev/null
  [ -n "$ARCHIVE" ] && kill "$ARCHIVE" 2>/dev/null
  kill "$SERVER" 2>/dev/null
  # Next.js renames its process, so also stop whatever holds the port.
  lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null
  rm -f "$PIDFILE" "$HOME_DIR/demo.url"
  exit 0
}
trap cleanup INT TERM

for _ in $(seq 1 60); do curl -s -o /dev/null "$URL/api/health" && break; sleep 0.5; done
curl -s -o /dev/null "$URL/api/health" || { cat "$LOGS/server.log"; die "the server did not start"; }

# First boot prints the admin password once. Keep it where the operator can
# find it again (mode 600, outside the repo).
if grep -q "password" "$LOGS/server.log" 2>/dev/null && [ ! -f "$HOME_DIR/admin-password.txt" ]; then
  grep -i "password" "$LOGS/server.log" > "$HOME_DIR/admin-password.txt"
  chmod 600 "$HOME_DIR/admin-password.txt"
  say "first start: the admin login is saved in $HOME_DIR/admin-password.txt"
fi

# ---- edge agent -----------------------------------------------------------
if [ ! -s "$TOKEN_FILE" ]; then
  say "no edge-box token yet. In the browser: Hardware → Add edge box, copy the token, paste it here."
  say "(or press Enter to skip for now — then stop with Ctrl-C and run this script again once you have it)"
  open "$URL/hardware" 2>/dev/null
  read -r -p "edge-box token: " TOKEN
  case "$TOKEN" in
    eqd_*) (umask 077; printf '%s\n' "$TOKEN" > "$TOKEN_FILE") ;;
    "") ;;
    *) say "that is not an edge-box token (they start with eqd_) — continuing without the edge agent" ;;
  esac
fi
# The camera's link-local address includes the adapter's name (%en8), which
# changes if the adapter moves to another port: keep the camera record in step.
if [ -n "$CAM_ADDR" ] && [ -f "$HOME_DIR/admin-password.txt" ]; then
  ADMIN_PW="$(sed -n "s/.*password: //p" "$HOME_DIR/admin-password.txt" | head -1)"
  CAM_ADDR="$CAM_ADDR" ADMIN_PW="$ADMIN_PW" URL="$URL" node -e '
    const { URL: u, ADMIN_PW: pw, CAM_ADDR: addr } = process.env;
    (async () => {
      const login = await (await fetch(u + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: pw }) })).json();
      if (!login.token) return;
      const h = { Authorization: "Bearer " + login.token, "Content-Type": "application/json" };
      const cams = (await (await fetch(u + "/api/devices", { headers: h })).json()).filter((d) => d.kind === "thermal_camera");
      for (const c of cams) if (c.host !== addr && c.host.startsWith("fe80::")) {
        await fetch(u + "/api/devices/" + c.id, { method: "PATCH", headers: h, body: JSON.stringify({ host: addr }) });
        console.log("[demo] camera \"" + c.name + "\" now at " + addr + " (re-aim it in Calibrate if the boxes are off)");
      }
    })().catch(() => {});' 2>/dev/null
fi

if [ -s "$TOKEN_FILE" ]; then
  if [ "$PY" = python3 ]; then
    say "lying-down detection is off (run scripts/demo.sh --setup-detector once to turn it on)"
  fi
  say "starting the edge agent (log: $LOGS/edge.log)"
  "$PY" -u edge/edge_agent.py --server "$URL" --token "$(cat "$TOKEN_FILE")" --refresh 15 \
    > "$LOGS/edge.log" 2>&1 &
  AGENT=$!
fi

# The live store keeps 21 days; every reading is also copied, every 5 minutes,
# into a permanent research archive ($HOME_DIR/research/readings/*.jsonl).
python3 -u tools/archive_readings.py --store "$DATA/state.json" --out "$HOME_DIR/research" --every 300 \
  > "$LOGS/archive.log" 2>&1 &
ARCHIVE=$!

# Keep the Mac awake while the demo runs (a sleeping Mac records nothing).
# Closing the lid still sleeps it: keep it open and on the charger.
caffeinate -ims -w $$ &
say "ready → $URL   (Ctrl-C to stop) — keep the lid open and the charger in; live view: $URL/live"
say "admin login: $HOME_DIR/admin-password.txt · research archive: $HOME_DIR/research"
open "$URL/hardware" 2>/dev/null
# Show the edge agent's problems as they happen; a healthy agent is quiet.
if [ -n "$AGENT" ]; then
  ( tail -n 0 -F "$LOGS/edge.log" | grep --line-buffered -v "warnings.warn\|NotOpenSSLWarning" ) &
  TAIL=$!
fi
wait "$SERVER"
cleanup
