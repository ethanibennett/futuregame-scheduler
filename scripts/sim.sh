#!/usr/bin/env bash
# Helpers for driving the iOS Simulator.
#
# Usage:
#   ./scripts/sim.sh build       # build web + sync + install on sim
#   ./scripts/sim.sh shot [name] # screenshot to /tmp/sim-shots/<name>.png
#   ./scripts/sim.sh open <url>  # openurl in the simulator (deep-link)
#   ./scripts/sim.sh launch      # launch the app
#   ./scripts/sim.sh restart     # kill + relaunch the app
#   ./scripts/sim.sh boot        # boot sim + open Simulator.app
#   ./scripts/sim.sh sync        # cap sync ios + rebuild iOS app + install

set -euo pipefail

SIMID="${SIMID:-4B6A3AE6-08EA-4AF3-9352-D48E0238AEA1}"   # iPhone 15 Pro (iOS 17.5)
APPID="app.futurega.me.beta"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_PATH="/tmp/sim-build/Build/Products/Debug-iphonesimulator/futurega.me.app"
SHOTS="/tmp/sim-shots"

mkdir -p "$SHOTS"

cmd="${1:-help}"
shift || true

# Click absolute (x,y) coordinates in the booted Simulator window.
# Uses AppleScript + cliclick if available, otherwise AppleScript-only.
# Coordinates are POINT space (the displayed simulator window), not pixel.
sim_click() {
  local x="$1" y="$2"
  if command -v cliclick >/dev/null 2>&1; then
    # Activate Simulator first, then click at window-relative coords
    osascript -e 'tell application "Simulator" to activate' >/dev/null
    sleep 0.2
    # Get Simulator window position
    read -r WX WY < <(osascript -e 'tell application "System Events" to tell process "Simulator" to get position of window 1' | tr ', ' '  ')
    cliclick "c:$((WX + x)),$((WY + y))"
  else
    osascript <<EOF >/dev/null
tell application "Simulator" to activate
delay 0.2
tell application "System Events"
  tell process "Simulator"
    set winPos to position of window 1
    set wx to item 1 of winPos
    set wy to item 2 of winPos
    click at {wx + ${x}, wy + ${y}}
  end tell
end tell
EOF
  fi
}

case "$cmd" in
  boot)
    xcrun simctl boot "$SIMID" 2>/dev/null || true
    open -a Simulator
    sleep 3
    ;;
  build)
    cd "$ROOT/vite-app" && npm run build >/dev/null
    cd "$ROOT" && npx cap sync ios >/dev/null
    xcodebuild -project "$ROOT/ios/App/App.xcodeproj" -scheme "futurega.me" \
      -configuration Debug -destination "platform=iOS Simulator,id=$SIMID" \
      -derivedDataPath /tmp/sim-build >/tmp/sim-build.log 2>&1 || { tail -20 /tmp/sim-build.log; exit 1; }
    xcrun simctl install "$SIMID" "$APP_PATH"
    xcrun simctl terminate "$SIMID" "$APPID" 2>/dev/null || true
    xcrun simctl launch "$SIMID" "$APPID" >/dev/null
    echo "built + installed + launched"
    ;;
  sync)
    cd "$ROOT" && npx cap sync ios >/dev/null
    xcodebuild -project "$ROOT/ios/App/App.xcodeproj" -scheme "futurega.me" \
      -configuration Debug -destination "platform=iOS Simulator,id=$SIMID" \
      -derivedDataPath /tmp/sim-build >/tmp/sim-build.log 2>&1 || { tail -20 /tmp/sim-build.log; exit 1; }
    xcrun simctl install "$SIMID" "$APP_PATH"
    xcrun simctl terminate "$SIMID" "$APPID" 2>/dev/null || true
    xcrun simctl launch "$SIMID" "$APPID" >/dev/null
    ;;
  shot)
    name="${1:-shot}"
    out="$SHOTS/$name.png"
    xcrun simctl io "$SIMID" screenshot "$out" >/dev/null 2>&1
    # Downsize for the image reader's size limit
    sips -Z 1600 "$out" --out "$SHOTS/$name-small.png" >/dev/null 2>&1
    echo "$SHOTS/$name-small.png"
    ;;
  open)
    url="${1:?need url}"
    xcrun simctl openurl "$SIMID" "$url"
    ;;
  launch)
    xcrun simctl launch "$SIMID" "$APPID" >/dev/null
    echo launched
    ;;
  restart)
    xcrun simctl terminate "$SIMID" "$APPID" 2>/dev/null || true
    xcrun simctl launch "$SIMID" "$APPID" >/dev/null
    echo restarted
    ;;
  tap)
    # ./sim.sh tap <x> <y>  — coords in the simulator window's POINT space
    sim_click "${1:?need x}" "${2:?need y}"
    ;;
  *)
    grep '^#' "$0" | head -12
    ;;
esac
