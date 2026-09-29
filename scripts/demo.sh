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
# The demo's own server left over from an earlier run (the script itself was
# stopped hard): take its port back, rather than moving to another port and
# leaving the open browser tab on a server nothing looks after.
LEFT="$(cat "$HOME_DIR/server.pid" 2>/dev/null)"
if [ -n "$LEFT" ] && lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | grep -qx "$LEFT"; then
  say "stopping the demo's server left over from an earlier run (pid $LEFT)"
  kill "$LEFT" 2>/dev/null
  for _ in $(seq 1 20); do busy "$PORT" || break; sleep 0.5; done
fi
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
# it over IPv6 link-local: an address that includes the adapter's name
# (e.g. %en8), which changes if the adapter moves to another port. neighbours
# lists every device that answered on an active interface ("address mac
# interface"); scripts/sync-cameras.mjs matches them to the saved cameras by
# address (it comes from the camera's MAC) and only reports the others, so no
# login goes to a device nobody added, such as another Sparsh camera on the
# stable's network. Unanswered ("incomplete", "expired") and the Mac's own
# ("permanent") entries are left out.
WIFI_IF="$(networksetup -listallhardwareports 2>/dev/null | awk '/Hardware Port: Wi-Fi/ { getline; print $2; exit }')"
WIFI_IF="${WIFI_IF:-en0}"
neighbours() {
  for ifc in $(ifconfig -l); do
    ifconfig "$ifc" 2>/dev/null | grep -q "status: active" || continue
    ping6 -c 1 -i 0.2 "ff02::1%$ifc" >/dev/null 2>&1
  done
  ndp -an 2>/dev/null | awk 'NR > 1 && tolower($1) ~ /^fe80:/ && $2 != "(incomplete)" && $4 != "permanent" && $4 != "expired" { print $1, $2, $3 }'
}
# What changes when a cable is plugged or moved (Wi-Fi neighbours come and go).
wired() { awk -v w="$WIFI_IF" '$3 ~ /^en[0-9]+$/ && $3 != w' | sort; }

# ---- server ---------------------------------------------------------------
# Each part is started by a function so the watch loop at the end can start it
# again. Logs are appended within a run; the previous run's are kept as *.prev.
for f in server edge archive; do [ -f "$LOGS/$f.log" ] && mv -f "$LOGS/$f.log" "$LOGS/$f.prev.log"; done
start_server() {
  EQUICARE_DATA_DIR="$DATA" NEXT_TELEMETRY_DISABLED=1 PORT="$PORT" HOST=127.0.0.1 \
    npm start >> "$LOGS/server.log" 2>&1 &
  SERVER=$!
}
server_ready() {
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null "$URL/api/health"; then
      lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1 > "$HOME_DIR/server.pid"; return 0
    fi
    sleep 0.5
  done
  return 1
}
say "starting the server on $URL (data: $DATA)"
start_server
AGENT=""
TAIL=""
ARCHIVE=""
WATCH=""
cleanup() {
  say "stopping…"
  [ -n "$WATCH" ] && pkill -P "$WATCH" 2>/dev/null; [ -n "$WATCH" ] && kill "$WATCH" 2>/dev/null
  [ -n "$TAIL" ] && pkill -P "$TAIL" 2>/dev/null; [ -n "$TAIL" ] && kill "$TAIL" 2>/dev/null
  [ -n "$AGENT" ] && kill "$AGENT" 2>/dev/null
  [ -n "$ARCHIVE" ] && kill "$ARCHIVE" 2>/dev/null
  kill "$SERVER" 2>/dev/null
  # Next.js renames its process, so also stop whatever holds the port.
  lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null
  rm -f "$PIDFILE" "$HOME_DIR/demo.url" "$HOME_DIR/server.pid"
  exit 0
}
trap cleanup INT TERM

server_ready || { cat "$LOGS/server.log"; die "the server did not start"; }

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
# Keep each camera record on the adapter port its camera is on now.
sync_cameras() {  # $1: what neighbours printed
  [ -f "$HOME_DIR/admin-password.txt" ] || return 0
  NB="$1" WIFI_IF="$WIFI_IF" URL="$URL" ADMIN_PW="$(sed -n "s/.*password: //p" "$HOME_DIR/admin-password.txt" | head -1)" \
    node scripts/sync-cameras.mjs 2>/dev/null
}
NB_NOW="$(neighbours)"
sync_cameras "$NB_NOW"

if [ -s "$TOKEN_FILE" ]; then
  if [ "$PY" = python3 ]; then
    say "lying-down detection is off (run scripts/demo.sh --setup-detector once to turn it on)"
  fi
  say "starting the edge agent (log: $LOGS/edge.log)"
fi
start_agent() {
  [ -s "$TOKEN_FILE" ] || return 0
  "$PY" -u edge/edge_agent.py --server "$URL" --token "$(cat "$TOKEN_FILE")" --refresh 15 \
    >> "$LOGS/edge.log" 2>&1 &
  AGENT=$!
}
start_agent

# The live store keeps 21 days; every reading is also copied, every 5 minutes,
# into a permanent research archive ($HOME_DIR/research/readings/*.jsonl).
start_archive() {
  python3 -u tools/archive_readings.py --store "$DATA/state.json" --out "$HOME_DIR/research" --every 300 \
    >> "$LOGS/archive.log" 2>&1 &
  ARCHIVE=$!
}
start_archive

# Keep the Mac awake while the demo runs (a sleeping Mac records nothing).
# Closing the lid still sleeps it: keep it open and on the charger.
caffeinate -ims -w $$ &
# The camera plugged in after the start, or its adapter moved to another port:
# look again every 20 s and keep the camera record in step, no restart needed.
( last="$(printf '%s\n' "$NB_NOW" | wired)"
  while sleep 20; do
    nb="$(neighbours)"; now="$(printf '%s\n' "$nb" | wired)"
    if [ "$now" != "$last" ]; then sync_cameras "$nb"; last="$now"; fi
  done ) &
WATCH=$!
say "ready → $URL   (Ctrl-C to stop) — keep the lid open and the charger in; live view: $URL/live"
say "admin login: $HOME_DIR/admin-password.txt · research archive: $HOME_DIR/research"
if [ -z "${NO_OPEN:-}" ]; then open "$URL/hardware" 2>/dev/null; fi
# Show the edge agent's problems as they happen; a healthy agent is quiet.
if [ -n "$AGENT" ]; then
  ( tail -n 0 -F "$LOGS/edge.log" | grep --line-buffered -v "warnings.warn\|NotOpenSSLWarning" ) &
  TAIL=$!
fi

# ---- keep everything running ------------------------------------------------
# For as long as the demo runs, with no time limit: a part that stops is
# started again, and so is a server that stops answering for ~30 s.
restart_server() {
  kill "$SERVER" 2>/dev/null
  lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null
  for _ in $(seq 1 20); do busy "$PORT" || break; sleep 0.5; done
  busy "$PORT" && lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null
  start_server
  if server_ready; then say "the server is back on $URL"; else say "the server did not come back yet — trying again"; fi
}
misses=0
while :; do
  sleep 10 & wait $!
  if ! kill -0 "$SERVER" 2>/dev/null; then
    say "$(date +%H:%M:%S) the server stopped — starting it again (log: $LOGS/server.log)"; restart_server; misses=0
  elif curl -s -m 10 -o /dev/null "$URL/api/health"; then misses=0
  elif [ $((misses += 1)) -ge 3 ]; then
    say "$(date +%H:%M:%S) the server stopped answering — starting it again"; restart_server; misses=0
  fi
  if [ -n "$AGENT" ] && ! kill -0 "$AGENT" 2>/dev/null; then
    say "$(date +%H:%M:%S) the edge agent stopped — starting it again (log: $LOGS/edge.log)"
    # Its video readers end on their own once it is gone; make sure no
    # leftover still holds one of the camera's few streams.
    ps -axo pid=,ppid=,command= | awk '$2 == 1 && /ffmpeg/ && /media\/live/ { print $1 }' | xargs kill 2>/dev/null
    start_agent
  fi
  if ! kill -0 "$ARCHIVE" 2>/dev/null; then
    say "$(date +%H:%M:%S) the research archive stopped — starting it again"; start_archive
  fi
done
