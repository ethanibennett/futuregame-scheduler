#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Ship the iOS app to TestFlight. Mac-only.
#
# This is the iOS half of the old deploy.sh, extracted so the Mac can ship the
# app WITHOUT doing any of the things deploy.sh also does — deploy.sh requires a
# Render API key, starts a local server, syncs the production database, and runs
# `git push origin master` (which auto-deploys futurega.me). None of that is the
# Mac's job any more (see docs/mac-build.md), and coupling an app build to a web
# deploy means you cannot ship one without the other.
#
# What this does, in order:
#   git pull → web build → verify output → bump build number → cap sync →
#   archive → upload to App Store Connect
#
# What it deliberately never does: touch Render, touch the database, or push to
# master. The build-number bump is the only file it changes; commit that
# yourself, or pass --commit.
#
# Usage:
#   ./scripts/ios-testflight.sh              # pull, build, archive, upload
#   ./scripts/ios-testflight.sh --dry-run    # everything up to archive, then stop
#   ./scripts/ios-testflight.sh --no-pull    # build what is in the tree already
#   ./scripts/ios-testflight.sh --commit     # also commit the build-number bump
#   ./scripts/ios-testflight.sh --build 42   # force a specific build number
# ─────────────────────────────────────────────────────────────────────────────

DO_PULL=true
DRY_RUN=false
DO_COMMIT=false
FORCE_BUILD=""

while [ $# -gt 0 ]; do
  case "$1" in
    --no-pull) DO_PULL=false ;;
    --dry-run) DRY_RUN=true ;;
    --commit)  DO_COMMIT=true ;;
    --build)   FORCE_BUILD="${2:-}"; shift ;;
    -h|--help) sed -n '3,30p' "$0"; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# App Store Connect. The key ID and issuer ID are identifiers, not secrets; the
# .p8 private key is the secret and lives outside the repo, in the location
# Apple's tools already look in. Override any of these via the environment.
ASC_KEY_ID="${ASC_KEY_ID:-UCFMFW9636}"
ASC_ISSUER_ID="${ASC_ISSUER_ID:-764173fa-5f16-4c11-a782-a2e8e153e929}"
ASC_KEY_PATH="${ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8}"

IOS_PROJECT="$PROJECT_ROOT/ios/App/App.xcodeproj"
IOS_SCHEME="${IOS_SCHEME:-futurega.me}"
EXPORT_OPTIONS="$PROJECT_ROOT/ios/ExportOptions.plist"
ARCHIVE_PATH="${TMPDIR:-/tmp}/futuregame.xcarchive"
EXPORT_PATH="${TMPDIR:-/tmp}/futuregame-export"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info() { echo -e "${GREEN}▸${NC} $*"; }
warn() { echo -e "${YELLOW}▸${NC} $*"; }
die()  { echo -e "${RED}✕${NC} $*" >&2; exit 1; }

# ── Preflight ───────────────────────────────────────────────────────────────
# Every one of these is a failure that would otherwise surface deep inside a
# five-minute xcodebuild run, or worse, ship a broken app.
[ "$(uname -s)" = "Darwin" ] || die "macOS only — this needs Xcode."
command -v xcodebuild >/dev/null || die "xcodebuild not found. Install Xcode and run: sudo xcode-select -s /Applications/Xcode.app"
command -v node >/dev/null || die "node not found."
[ -d "$IOS_PROJECT" ] || die "missing $IOS_PROJECT"
[ -f "$EXPORT_OPTIONS" ] || die "missing $EXPORT_OPTIONS"
[ -f "$ASC_KEY_PATH" ] || die "App Store Connect key not found at:
    $ASC_KEY_PATH
  Create one at appstoreconnect.apple.com → Users and Access → Integrations →
  App Store Connect API (role: App Manager), then save the downloaded .p8 there.
  Apple lets you download it exactly once. Never commit it."

# The scheme lives in xcuserdata (gitignored) unless it has been shared, so a
# fresh clone can fail here even though the project is fine.
if ! xcodebuild -project "$IOS_PROJECT" -list 2>/dev/null | grep -qx "        $IOS_SCHEME"; then
  warn "Scheme '$IOS_SCHEME' not visible to xcodebuild."
  warn "Open Xcode → Product → Scheme → Manage Schemes → tick 'Shared' for '$IOS_SCHEME', then commit"
  warn "ios/App/App.xcodeproj/xcshareddata/. Continuing — Xcode may autocreate it."
fi

if $DO_PULL; then
  if [ -n "$(git status --porcelain -- ':!ios/App/App.xcodeproj/project.pbxproj')" ]; then
    warn "working tree has changes; pulling anyway with --ff-only"
  fi
  info "Pulling origin/master..."
  git pull --ff-only origin master
fi
info "Building from $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)"

# ── Web build ───────────────────────────────────────────────────────────────
[ -d node_modules ] || { info "Installing root deps..."; npm install; }
info "Building web assets (vite → public-vite/)..."
node build.js

# The app bundles public-vite/. Shipping an empty or stale one produces a build
# that installs fine and shows a blank screen, so check before spending five
# minutes archiving it.
[ -f "$PROJECT_ROOT/public-vite/index.html" ] || die "public-vite/index.html missing — the web build did not produce output."
ASSET_COUNT=$(find "$PROJECT_ROOT/public-vite/assets" -type f 2>/dev/null | wc -l | tr -d ' ')
[ "${ASSET_COUNT:-0}" -gt 0 ] || die "public-vite/assets is empty — refusing to ship a blank app."
info "Web build OK ($ASSET_COUNT asset files)"

# ── Build number ────────────────────────────────────────────────────────────
# ExportOptions.plist sets manageAppVersionAndBuildNumber, which lets Apple
# silently bump past a conflict — that made the committed pbxproj drift from the
# number actually on TestFlight. So ask App Store Connect what it already has and
# go one past max(local, apple); the committed number then matches reality.
BUNDLE_ID=$(node -e "console.log(require('./capacitor.config.json').appId)")
CURRENT_BUILD=$(grep -m1 'CURRENT_PROJECT_VERSION' "$IOS_PROJECT/project.pbxproj" | sed 's/.*= //;s/;.*//')

if [ -n "$FORCE_BUILD" ]; then
  NEW_BUILD="$FORCE_BUILD"
  info "iOS build number: $CURRENT_BUILD → $NEW_BUILD (forced)"
else
  APPLE_LATEST=$(node "$PROJECT_ROOT/scripts/asc-latest-build.js" \
    "$ASC_KEY_PATH" "$ASC_KEY_ID" "$ASC_ISSUER_ID" "$BUNDLE_ID" 2>/dev/null || echo "0")
  if [ -z "$APPLE_LATEST" ] || [ "$APPLE_LATEST" = "0" ] || [ "$APPLE_LATEST" -lt "$CURRENT_BUILD" ]; then
    NEW_BUILD=$((CURRENT_BUILD + 1))
    warn "App Store Connect reported '$APPLE_LATEST' — using local counter."
    info "iOS build number: $CURRENT_BUILD → $NEW_BUILD"
  else
    NEW_BUILD=$((APPLE_LATEST + 1))
    info "iOS build number: $CURRENT_BUILD → $NEW_BUILD (past ASC latest $APPLE_LATEST for $BUNDLE_ID)"
  fi
fi
sed -i '' "s/CURRENT_PROJECT_VERSION = $CURRENT_BUILD;/CURRENT_PROJECT_VERSION = $NEW_BUILD;/g" "$IOS_PROJECT/project.pbxproj"

# ── Sync web assets into the iOS project ────────────────────────────────────
info "Syncing web build into ios/App (npx cap sync ios)..."
npx cap sync ios

if $DRY_RUN; then
  info "--dry-run: stopping before archive."
  info "Build number staged at $NEW_BUILD in project.pbxproj (revert with: git checkout -- $IOS_PROJECT/project.pbxproj)"
  exit 0
fi

# ── Archive ─────────────────────────────────────────────────────────────────
info "Archiving (this takes a few minutes)..."
rm -rf "$ARCHIVE_PATH"
xcodebuild -project "$IOS_PROJECT" \
  -scheme "$IOS_SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE_PATH" \
  archive \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$ASC_KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"

[ -d "$ARCHIVE_PATH" ] || die "archive failed — no .xcarchive produced."
info "Archive succeeded"

# ── Upload ──────────────────────────────────────────────────────────────────
# ExportOptions.plist has destination=upload, so exportArchive uploads straight
# to App Store Connect rather than writing an .ipa to disk.
info "Uploading to TestFlight..."
rm -rf "$EXPORT_PATH"
if xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  -exportPath "$EXPORT_PATH" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$ASC_KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"; then
  info "Upload complete — build $NEW_BUILD is processing."
  info "It appears in TestFlight after Apple finishes processing (usually 5–15 min)."
else
  die "Upload failed. The archive is kept at $ARCHIVE_PATH —
  open Xcode → Window → Organizer → Archives and retry 'Distribute App' from there."
fi

# ── Record the build number ─────────────────────────────────────────────────
if $DO_COMMIT; then
  git add "$IOS_PROJECT/project.pbxproj"
  git commit -m "iOS build $NEW_BUILD to TestFlight"
  info "Committed the build-number bump. Push when ready (this does not push for you)."
else
  warn "project.pbxproj now records build $NEW_BUILD but is uncommitted."
  warn "Commit it so the repo matches TestFlight:  git commit -am 'iOS build $NEW_BUILD'"
fi
