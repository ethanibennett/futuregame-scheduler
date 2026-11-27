#!/usr/bin/env bash
# A hand link opened in the iPhone APP, in the simulator (owner, 2026-11-27: a shared hand opened from Discord into
# the app with the table under the clock and the buttons on the home bar, "This kind of thing just can not happen").
#
# The guards on Windows emulate the safe area by setting it, so they can never see a page iOS reported it 0 for.
# This builds the app itself (Debug, for the simulator), launches it on each phone with a hand link the way a link
# tapped in another app arrives (cold: the app starts on it; warm: the app is open and the link comes in;
# FG_OPEN_URL / FG_OPEN_URL_LATER in SceneDelegate, Debug only), and reads the page's own report from the app's
# console (?probe=layout, vite-app/src/utils/layout-probe.js): every piece of the replay against the safe area the
# window gives. scripts/check-app-link-log.py fails a launch on any piece under the clock, on the home bar or off the
# screen, or a link that never opened. Screenshots and logs go to $OUT.
#
# Run by .github/workflows/app-link-check.yml (three phones, on demand) and by ios-testflight.yml before every upload
# (one phone), on the Mac runner. By hand on the Mac, from the repo root:
#   ./scripts/app-link-check.sh
# Env: LINK (a futurega.me/h/ link), DEVICES ("Name|Fallback;Next phone"), OUT (default out/).
set -uo pipefail

LINK="${LINK:-https://futurega.me/h/dSXeHmQt}"
DEVICES="${DEVICES:-iPhone 17 Pro|iPhone 16 Pro;iPhone 17 Pro Max|iPhone 16 Pro Max;iPhone Air|iPhone 17|iPhone 16e}"
APPID="app.futurega.me.beta"
OUT="${OUT:-out}"
BUILD_DIR="${RUNNER_TEMP:-/tmp}/alc-build"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ── The app, Debug, for the simulator ───────────────────────────────────────
build() {
  set -e
  echo "commit: $(git rev-parse --short HEAD)"
  [ -d node_modules ] || npm install
  # vite-app's deps, stamped as ios-testflight.sh stamps them, so the TestFlight build that follows skips its npm ci.
  local hash; hash=$(shasum vite-app/package-lock.json | cut -d' ' -f1)
  local stamp=vite-app/node_modules/.install-lock-hash
  if [ ! -f "$stamp" ] || [ "$(cat "$stamp")" != "$hash" ]; then (cd vite-app && npm ci); echo "$hash" > "$stamp"; fi
  node build.js
  [ -f public-vite/index.html ] || { echo "the web build produced nothing" >&2; return 1; }
  npx cap sync ios
  ./scripts/build-capacitor-xcframeworks.sh --ios-only
  rm -rf "$BUILD_DIR"
  # CAPACITOR_DEBUG: the page's console reaches the app's stdout (Info.plist reads it; unset, Capacitor logs nothing).
  xcodebuild -project ios/App/App.xcodeproj -scheme futurega.me -configuration Debug \
    -destination 'generic/platform=iOS Simulator' -derivedDataPath "$BUILD_DIR" \
    CODE_SIGNING_ALLOWED=NO CAPACITOR_DEBUG=true build > "${RUNNER_TEMP:-/tmp}/alc-xcodebuild.log" 2>&1 \
    || { tail -60 "${RUNNER_TEMP:-/tmp}/alc-xcodebuild.log"; return 1; }
  APP=$(find "$BUILD_DIR/Build/Products/Debug-iphonesimulator" -maxdepth 1 -name '*.app' | head -1)
  [ -n "$APP" ] || { echo "no .app built" >&2; return 1; }
  echo "built $APP"
  set +e
}

APP=""
( build ) || { echo "- FAIL: the app did not build for the simulator" >> "$SUMMARY"; exit 1; }
APP=$(find "$BUILD_DIR/Build/Products/Debug-iphonesimulator" -maxdepth 1 -name '*.app' | head -1)

# ── The link, on each phone, cold and warm ──────────────────────────────────
rm -rf "$OUT" && mkdir -p "$OUT"
echo "### Hand link in the app: $LINK" >> "$SUMMARY"
case "$LINK" in *\?*) URL="${LINK}&probe=layout" ;; *) URL="${LINK}?probe=layout" ;; esac
FAIL=0
RAN=0
IFS=';' read -ra PHONES <<< "$DEVICES"
for GROUP in "${PHONES[@]}"; do
  PICK=$(xcrun simctl list devices available -j | WANT="$GROUP" /usr/bin/python3 -c "
import json, os, sys
d = json.load(sys.stdin)['devices']
for want in os.environ['WANT'].split('|'):
    rows = [x for rt, xs in d.items() if 'iOS' in rt for x in xs if x['name'] == want.strip()]
    if rows:
        print(rows[-1]['udid'] + ' ' + want.strip()); break
")
  if [ -z "$PICK" ]; then echo "- SKIP $GROUP: no such simulator here" >> "$SUMMARY"; echo "skip $GROUP"; continue; fi
  UDID="${PICK%% *}"; NAME="${PICK#* }"; SLUG=$(echo "$NAME" | tr -c 'A-Za-z0-9' '-')
  xcrun simctl shutdown "$UDID" 2>/dev/null || true
  xcrun simctl erase "$UDID"
  xcrun simctl boot "$UDID" 2>/dev/null || true
  xcrun simctl bootstatus "$UDID" -b > /dev/null
  xcrun simctl install "$UDID" "$APP"
  for MODE in cold warm; do
    LOG="$OUT/${SLUG}${MODE}.log"
    # The page reports until the hand has been open 6 s ("final":true), or 150 s after it loads (the app asks for a
    # hand that long while futurega.me restarts); the warm link arrives 8 s after launch.
    if [ "$MODE" = cold ]; then VAR=SIMCTL_CHILD_FG_OPEN_URL; LIMIT=165; else VAR=SIMCTL_CHILD_FG_OPEN_URL_LATER; LIMIT=175; fi
    # --console-pty: on a pipe the app's stdout is block-buffered and lost when the app is ended.
    env "$VAR=$URL" xcrun simctl launch --console-pty --terminate-running-process "$UDID" "$APPID" > "$LOG" 2>&1 &
    LPID=$!
    T=0
    while [ "$T" -lt "$LIMIT" ] && ! grep -q '"final":true' "$LOG" 2>/dev/null; do sleep 3; T=$((T + 3)); done
    xcrun simctl io "$UDID" screenshot "$OUT/${SLUG}${MODE}.png" > /dev/null 2>&1 || true
    xcrun simctl terminate "$UDID" "$APPID" 2>/dev/null || true
    kill "$LPID" 2>/dev/null || true
    wait "$LPID" 2>/dev/null || true
    python3 scripts/check-app-link-log.py "$LOG" "$NAME, $MODE" "$SUMMARY" || FAIL=1
    RAN=$((RAN + 1))
  done
  xcrun simctl shutdown "$UDID" 2>/dev/null || true
done
if [ "$RAN" -eq 0 ]; then echo "- FAIL: none of the phones is installed here" >> "$SUMMARY"; echo "no phone ran" >&2; exit 1; fi
exit $FAIL
