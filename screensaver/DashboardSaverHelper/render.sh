#!/bin/bash
# DashboardSaver refresh — render the token-gated dashboard page to a PNG that the
# DashboardSaver .saver blits. Uses Chrome headless (no window-server dependency,
# so it runs from cron/launchd), atomic replace. Cadence is owned by the scheduler
# (cron/LaunchAgent) that invokes this every ~60s.
set -u
SUPPORT="$HOME/Library/Application Support/DashboardSaver"
LOGDIR="$HOME/Library/Logs/DashboardSaver"
mkdir -p "$SUPPORT" "$LOGDIR"
LOG="$LOGDIR/helper.log"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CFG="$SUPPORT/config.json"

ts() { date '+%Y-%m-%d %H:%M:%S'; }

[ -x "$CHROME" ] || { echo "$(ts) ERROR chrome not found at $CHROME" >>"$LOG"; exit 1; }
[ -f "$CFG" ]    || { echo "$(ts) ERROR no config.json"           >>"$LOG"; exit 1; }

URL=$(/usr/bin/python3 -c "import json;d=json.load(open('$CFG'));print(d['url'].rstrip('/')+'/d/'+d['token'])" 2>>"$LOG")
[ -n "$URL" ] || { echo "$(ts) ERROR bad config.json" >>"$LOG"; exit 1; }

TMP="$SUPPORT/.render.$$.png"
rm -f "$TMP"
# TZ pins the page's displayed clock/dateline to Eastern regardless of the laptop's
# physical location. Chrome's own (verbose) output is discarded.
TZ="America/New_York" "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --no-first-run --no-default-browser-check --disable-extensions --mute-audio \
  --disable-background-networking --disable-component-update --disable-sync \
  --disable-default-apps --no-service-autorun \
  --user-data-dir="$SUPPORT/chrome-profile" \
  --force-device-scale-factor=2 --window-size=1600,1000 \
  --virtual-time-budget=6000 \
  --screenshot="$TMP" "$URL" >/dev/null 2>&1 &
CPID=$!

# headless-new can leave lingering updater/helper procs and never exit on its own;
# wait for the screenshot to appear (up to 25s), then hard-kill the whole tree so
# this invocation returns promptly and nothing piles up across 60s cycles.
for _ in $(seq 1 25); do [ -s "$TMP" ] && break; sleep 1; done
sleep 1 # let the PNG finish flushing to disk
kill "$CPID" 2>/dev/null
pkill -P "$CPID" 2>/dev/null
pkill -f "user-data-dir=$SUPPORT/chrome-profile" 2>/dev/null

if [ -s "$TMP" ]; then
  mv -f "$TMP" "$SUPPORT/dashboard.png"
  date +%s > "$SUPPORT/dashboard.png.timestamp"
  echo "$(ts) wrote frame $(/usr/bin/stat -f%z "$SUPPORT/dashboard.png") bytes" >>"$LOG"
else
  rm -f "$TMP"
  echo "$(ts) ERROR render produced no image" >>"$LOG"
fi
