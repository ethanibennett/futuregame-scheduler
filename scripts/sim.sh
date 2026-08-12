#!/usr/bin/env bash
# Helpers for driving the iOS Simulator or a connected physical iPhone.
#
# Simulator usage:
#   ./scripts/sim.sh build       # build web + sync + install on sim
#   ./scripts/sim.sh shot [name] # screenshot to /tmp/sim-shots/<name>.png
#   ./scripts/sim.sh open <url>  # openurl in the simulator (deep-link)
#   ./scripts/sim.sh launch      # launch the app
#   ./scripts/sim.sh restart     # kill + relaunch the app
#   ./scripts/sim.sh boot        # boot sim + open Simulator.app
#   ./scripts/sim.sh sync        # cap sync ios + rebuild iOS app + install
#   ./scripts/sim.sh tap <x> <y> # click in the sim window (point space)
#
# Physical-device usage (auto-detects first paired iPhone via devicectl):
#   ./scripts/sim.sh device build    # build + install on phone
#   ./scripts/sim.sh device launch   # launch the app on the phone
#   ./scripts/sim.sh device restart  # terminate + relaunch on phone
#   ./scripts/sim.sh device sync     # cap sync + rebuild + reinstall on phone
#   ./scripts/sim.sh device id       # print detected device UDID

set -euo pipefail

SIMID="${SIMID:-06D18B32-59FB-4149-B1B0-8C2EB36449F4}"   # iPhone 17 Pro (iOS 26.5)
APPID="app.futurega.me.beta"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_PATH="/tmp/sim-build/Build/Products/Debug-iphonesimulator/futurega.me.app"
DEV_APP_PATH="/tmp/dev-build/Build/Products/Debug-iphoneos/futurega.me.app"
SHOTS="/tmp/sim-shots"

mkdir -p "$SHOTS"

# Resolve the connected device UDID. Honors $DEVID if set, otherwise auto-
# detects the first paired iPhone from `devicectl list devices`.
detect_devid() {
  if [[ -n "${DEVID:-}" ]]; then
    echo "$DEVID"
    return 0
  fi
  local id
  # Accept any usable state (`available (paired)` on older Xcode, `connected`
  # on newer). Pick the first device whose row has a UUID and looks usable.
  id=$(xcrun devicectl list devices 2>/dev/null \
    | awk '/connected|available \(paired\)/ {for(i=1;i<=NF;i++) if($i ~ /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/) {print $i; exit}}')
  if [[ -z "$id" ]]; then
    echo "no iPhone found via devicectl — connect & unlock the device" >&2
    exit 1
  fi
  echo "$id"
}

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
    # Move first, settle, THEN click. Single c:x,y can register as a drag if
    # the cursor was elsewhere — iOS sees long-press + move = text-select.
    local tx=$((WX + x)) ty=$((WY + y))
    cliclick "m:${tx},${ty}" "w:120" "c:${tx},${ty}"
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
    # `cap sync` overwrites ios/App/App/capacitor.config.json from the root
    # config, dropping any local-plugin entries. Reinsert InstagramStoriesPlugin
    # into packageClassList so the Capacitor bridge registers it.
    python3 - "$ROOT/ios/App/App/capacitor.config.json" <<'PYC'
import json, sys
p = sys.argv[1]
with open(p) as f: cfg = json.load(f)
lst = cfg.setdefault('packageClassList', [])
for name in ('InstagramStoriesPlugin', 'VideoComposerPlugin'):
    if name not in lst: lst.append(name)
with open(p, 'w') as f: json.dump(cfg, f, indent=2)
PYC
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
    # `cap sync` overwrites ios/App/App/capacitor.config.json from the root
    # config, dropping any local-plugin entries. Reinsert InstagramStoriesPlugin
    # into packageClassList so the Capacitor bridge registers it.
    python3 - "$ROOT/ios/App/App/capacitor.config.json" <<'PYC'
import json, sys
p = sys.argv[1]
with open(p) as f: cfg = json.load(f)
lst = cfg.setdefault('packageClassList', [])
for name in ('InstagramStoriesPlugin', 'VideoComposerPlugin'):
    if name not in lst: lst.append(name)
with open(p, 'w') as f: json.dump(cfg, f, indent=2)
PYC
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
    # Downsize for Claude's image-read limit
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
  device)
    subcmd="${1:-help}"
    shift || true
    DID=$(detect_devid)
    case "$subcmd" in
      id)
        echo "$DID"
        ;;
      build)
        cd "$ROOT/vite-app" && npm run build >/dev/null
        cd "$ROOT" && npx cap sync ios >/dev/null
    # `cap sync` overwrites ios/App/App/capacitor.config.json from the root
    # config, dropping any local-plugin entries. Reinsert InstagramStoriesPlugin
    # into packageClassList so the Capacitor bridge registers it.
    python3 - "$ROOT/ios/App/App/capacitor.config.json" <<'PYC'
import json, sys
p = sys.argv[1]
with open(p) as f: cfg = json.load(f)
lst = cfg.setdefault('packageClassList', [])
for name in ('InstagramStoriesPlugin', 'VideoComposerPlugin'):
    if name not in lst: lst.append(name)
with open(p, 'w') as f: json.dump(cfg, f, indent=2)
PYC
        xcodebuild -project "$ROOT/ios/App/App.xcodeproj" -scheme "futurega.me" \
          -configuration Debug -destination "id=$DID" \
          -derivedDataPath /tmp/dev-build \
          -allowProvisioningUpdates >/tmp/dev-build.log 2>&1 \
          || { tail -25 /tmp/dev-build.log; exit 1; }
        xcrun devicectl device install app --device "$DID" "$DEV_APP_PATH"
        xcrun devicectl device process launch --device "$DID" "$APPID" 2>/dev/null \
          || echo "(installed — unlock the phone to launch)"
        echo "built + installed on device $DID"
        ;;
      sync)
        cd "$ROOT" && npx cap sync ios >/dev/null
    # `cap sync` overwrites ios/App/App/capacitor.config.json from the root
    # config, dropping any local-plugin entries. Reinsert InstagramStoriesPlugin
    # into packageClassList so the Capacitor bridge registers it.
    python3 - "$ROOT/ios/App/App/capacitor.config.json" <<'PYC'
import json, sys
p = sys.argv[1]
with open(p) as f: cfg = json.load(f)
lst = cfg.setdefault('packageClassList', [])
for name in ('InstagramStoriesPlugin', 'VideoComposerPlugin'):
    if name not in lst: lst.append(name)
with open(p, 'w') as f: json.dump(cfg, f, indent=2)
PYC
        xcodebuild -project "$ROOT/ios/App/App.xcodeproj" -scheme "futurega.me" \
          -configuration Debug -destination "id=$DID" \
          -derivedDataPath /tmp/dev-build \
          -allowProvisioningUpdates >/tmp/dev-build.log 2>&1 \
          || { tail -25 /tmp/dev-build.log; exit 1; }
        xcrun devicectl device install app --device "$DID" "$DEV_APP_PATH"
        xcrun devicectl device process launch --device "$DID" "$APPID" 2>/dev/null \
          || echo "(installed — unlock the phone to launch)"
        ;;
      launch)
        xcrun devicectl device process launch --device "$DID" "$APPID" 2>&1 | tail -3
        ;;
      restart)
        xcrun devicectl device process terminate --device "$DID" --process-identifier "$(xcrun devicectl device info processes --device "$DID" 2>/dev/null | awk -v app="$APPID" '$0 ~ app {print $1; exit}')" 2>/dev/null || true
        xcrun devicectl device process launch --device "$DID" "$APPID" 2>&1 | tail -3
        ;;
      *)
        grep '^# ' "$0" | head -22
        ;;
    esac
    ;;
  *)
    grep '^# ' "$0" | head -22
    ;;
esac
