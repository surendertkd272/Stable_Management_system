#!/bin/bash
# EquiCare demo on one Mac: the site server and the edge agent together, with
# the camera cabled to this machine. No internet needed.
#
#   scripts/demo.sh            start (builds the app the first time)
#   scripts/demo.sh --build    rebuild first (after pulling new code)
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
PORT="${PORT:-8080}"
URL="http://127.0.0.1:$PORT"
mkdir -p "$DATA" "$LOGS"

say() { printf '\033[1m[demo]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[demo] %s\033[0m\n' "$*" >&2; exit 1; }

command -v node >/dev/null || die "Node.js is not installed (need v22)."
command -v python3 >/dev/null || die "python3 is not installed."
python3 -c "import requests" 2>/dev/null || die "python3 is missing the 'requests' package: python3 -m pip install --user requests"

if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  die "port $PORT is already in use — another server is running. Stop it with: kill \$(lsof -tiTCP:$PORT -sTCP:LISTEN)"
fi

if [ ! -d .next ] || [ "${1:-}" = "--build" ]; then
  say "building the app (a minute, first time only)…"
  npm run build > "$LOGS/build.log" 2>&1 || die "build failed — see $LOGS/build.log"
fi

# ---- server ---------------------------------------------------------------
say "starting the server on $URL (data: $DATA)"
EQUICARE_DATA_DIR="$DATA" NEXT_TELEMETRY_DISABLED=1 PORT="$PORT" HOST=127.0.0.1 \
  npm start > "$LOGS/server.log" 2>&1 &
SERVER=$!
AGENT=""
TAIL=""
cleanup() {
  say "stopping…"
  [ -n "$TAIL" ] && pkill -P "$TAIL" 2>/dev/null; [ -n "$TAIL" ] && kill "$TAIL" 2>/dev/null
  [ -n "$AGENT" ] && kill "$AGENT" 2>/dev/null
  kill "$SERVER" 2>/dev/null
  # Next.js renames its process, so also stop whatever holds the port.
  lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null
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
if [ -s "$TOKEN_FILE" ]; then
  say "starting the edge agent (log: $LOGS/edge.log)"
  python3 -u edge/edge_agent.py --server "$URL" --token "$(cat "$TOKEN_FILE")" --refresh 15 \
    > "$LOGS/edge.log" 2>&1 &
  AGENT=$!
fi

say "ready → $URL   (Ctrl-C to stop)"
open "$URL/hardware" 2>/dev/null
# Show the edge agent's problems as they happen; a healthy agent is quiet.
if [ -n "$AGENT" ]; then
  ( tail -n 0 -F "$LOGS/edge.log" | grep --line-buffered -v "warnings.warn\|NotOpenSSLWarning" ) &
  TAIL=$!
fi
wait "$SERVER"
cleanup
