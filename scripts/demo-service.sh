#!/usr/bin/env bash
# Run the demo (scripts/demo.sh) as a macOS background service. It then keeps
# running when the terminal, the editor or Claude closes; it starts again by
# itself if it ever stops; and it comes back after the Mac restarts, once you
# log in. There is no time limit: it runs until you stop it.
#
#   scripts/demo-service.sh start    start it and keep it running
#   scripts/demo-service.sh stop     stop it (and stop keeping it running)
#   scripts/demo-service.sh status   is it running, and where?
#
# Its messages go to ~/EquiCare-demo/logs/demo-service.log.
set -u
LABEL=com.equicare.demo
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOME_DIR="$HOME/EquiCare-demo"
LOGS="$HOME_DIR/logs"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"
loaded() { launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; }

case "${1:-status}" in
  start)
    PID="$(cat "$HOME_DIR/demo.pid" 2>/dev/null)"
    if ! loaded && [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
      echo "the demo is already running outside the service (pid $PID) — stop it first: kill $PID"; exit 1
    fi
    mkdir -p "$LOGS" "$(dirname "$PLIST")"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$ROOT/scripts/demo.sh</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>LANG</key><string>en_US.UTF-8</string>
    <key>PYTHONIOENCODING</key><string>utf-8</string>
    <key>NO_OPEN</key><string>1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardInPath</key><string>/dev/null</string>
  <key>StandardOutPath</key><string>$LOGS/demo-service.log</string>
  <key>StandardErrorPath</key><string>$LOGS/demo-service.log</string>
</dict>
</plist>
EOF
    loaded && launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
    launchctl bootstrap "$DOMAIN" "$PLIST" || { echo "could not start the service"; exit 1; }
    for _ in $(seq 1 90); do
      URL="$(cat "$HOME_DIR/demo.url" 2>/dev/null)"
      [ -n "$URL" ] && curl -s -o /dev/null "$URL/api/health" && { echo "running → $URL (live view: $URL/live)"; exit 0; }
      sleep 1
    done
    echo "started, but not answering yet — see $LOGS/demo-service.log"; exit 1
    ;;
  stop)
    loaded && launchctl bootout "$DOMAIN/$LABEL"
    rm -f "$PLIST"
    echo "stopped"
    ;;
  status)
    if loaded; then
      launchctl print "$DOMAIN/$LABEL" | awk '/^\tstate =|^\tpid =|last exit code|runs =/ { sub(/^\t+/, ""); print }'
    else
      echo "the service is not running"
    fi
    URL="$(cat "$HOME_DIR/demo.url" 2>/dev/null)"
    [ -n "$URL" ] && echo "$URL: $(curl -s -m 5 -o /dev/null -w '%{http_code}' "$URL/api/health" 2>/dev/null | sed 's/^200$/answering/')"
    ;;
  *) echo "usage: $0 start|stop|status"; exit 2 ;;
esac
