#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Rebuild Capacitor.xcframework + Cordova.xcframework with a Mac Catalyst slice.
#
# Why this exists: the app links Capacitor through Swift Package Manager, and
# the official package (ionic-team/capacitor-swift-pm) is a pair of BINARY
# xcframeworks carrying only iOS device + simulator slices. Building the app for
# Mac Catalyst therefore fails with
#   "While building for Mac Catalyst, no library for this platform was found"
# before a single line of app code compiles. Capacitor's source, however,
# compiles for Catalyst without a change — so this script builds that slice
# from upstream's own Xcode project at the EXACT tag the app pins, and merges
# it with upstream's unmodified iOS slices. The result goes into
# ios/App/capacitor-swift-pm/, a local package with the same identity as the
# remote one, which Xcode uses in place of the remote for every dependant
# (CapApp-SPM and each plugin). The iOS binaries stay byte-identical to what
# a plain SPM resolve would have linked; only the Catalyst slice is new.
#
# Output is gitignored (15 MB of binaries). Run this after `npm install` on a
# fresh checkout, and again whenever the pinned capacitor-swift-pm version in
# ios/App/CapApp-SPM/Package.swift changes — the script is a no-op when its
# stamp already matches that version.
#
# Usage: ./scripts/build-capacitor-xcframeworks.sh [--force] [--ios-only]
#
# --ios-only (the iOS TestFlight build): upstream's xcframeworks exactly as Ionic signed them, no Catalyst slice.
# An iPhone upload then carries the vendor's own SDK signature, which App Store Connect checks (ITMS-91065).
#
# SIGNED (2026-11-19): Apple refused build 2234 for TestFlight review with ITMS-91065, "Missing signature",
# for Frameworks/Capacitor.framework and Frameworks/Cordova.framework: both are on Apple's list of commonly
# used third-party SDKs, which must carry a signature. Upstream's zips are signed by Ionic, but merging the
# Catalyst slice in makes a new xcframework, and that one was unsigned. Each merged xcframework is now signed
# with this Mac's own signing identity (Apple Distribution, else Apple Development; XCFRAMEWORK_SIGN_IDENTITY
# overrides), and an already-built pair that is not signed yet is signed on the next run.
# ─────────────────────────────────────────────────────────────────────────────

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/ios/App/capacitor-swift-pm"
MANIFEST="$ROOT/ios/App/CapApp-SPM/Package.swift"
STAMP="$OUT/.built-version"

die()  { echo "error: $*" >&2; exit 1; }
info() { echo "→ $*"; }

# The version is whatever CapApp-SPM pins — `cap sync` rewrites that file, so it
# is the single source of truth for which Capacitor the app links.
VERSION="$(sed -nE 's/.*capacitor-swift-pm\.git", exact: "([^"]+)".*/\1/p' "$MANIFEST" | head -1)"
[ -n "$VERSION" ] || die "could not read the pinned capacitor-swift-pm version from $MANIFEST"

# The SDK signature App Store Connect checks (ITMS-91065). No identity on this Mac: say so loudly, since an
# upload to TestFlight review would be refused, but do not stop a local build that is never uploaded.
sign_xcframeworks() {
  local id="${XCFRAMEWORK_SIGN_IDENTITY:-}"
  if [ -z "$id" ]; then
    local ids; ids="$(security find-identity -v -p codesigning 2>/dev/null || true)"
    id="$(printf '%s\n' "$ids" | grep -o '"Apple Distribution: [^"]*"' | head -1 | tr -d '"')"
    [ -n "$id" ] || id="$(printf '%s\n' "$ids" | grep -o '"Apple Development: [^"]*"' | head -1 | tr -d '"')"
  fi
  if [ -z "$id" ]; then
    echo "warning: no code-signing identity on this Mac: Capacitor/Cordova xcframeworks left unsigned (App Store Connect refuses them, ITMS-91065)" >&2
    return 0
  fi
  for n in Capacitor Cordova; do
    if codesign -v "$OUT/$n.xcframework" >/dev/null 2>&1; then
      info "$n.xcframework already signed"
      continue
    fi
    codesign --timestamp --force --sign "$id" "$OUT/$n.xcframework"
    codesign -v "$OUT/$n.xcframework" || die "$n.xcframework did not verify after signing"
    info "$n.xcframework signed ($id)"
  done
}

FORCE=false; IOS_ONLY=false
for a in "$@"; do case "$a" in --force) FORCE=true ;; --ios-only) IOS_ONLY=true ;; *) die "unknown flag: $a" ;; esac; done

fetch_upstream() {
  info "fetching upstream xcframeworks + manifest"
  curl -fsSL "https://raw.githubusercontent.com/ionic-team/capacitor-swift-pm/$VERSION/Package.swift" -o "$WORK/upstream-Package.swift"
  for n in Capacitor Cordova; do
    curl -fsSL "https://github.com/ionic-team/capacitor-swift-pm/releases/download/$VERSION/$n.xcframework.zip" -o "$WORK/$n.zip"
    want="$(awk -v n="$n" '/binaryTarget/ {bt=1; f=0} bt && $0 ~ "name: \""n"\"" {f=1} f && /checksum:/ {gsub(/[^a-f0-9]/,"",$2); print $2; exit}' "$WORK/upstream-Package.swift")"
    have="$(shasum -a 256 "$WORK/$n.zip" | cut -d' ' -f1)"
    [ "$have" = "$want" ] || die "$n.xcframework.zip checksum mismatch (have $have, manifest says $want)"
    mkdir -p "$WORK/up/$n" && unzip -q "$WORK/$n.zip" -d "$WORK/up/$n"
  done
}

if $IOS_ONLY; then
  if ! $FORCE && [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$VERSION-ios" ] \
     && [ -d "$OUT/Capacitor.xcframework" ] && [ -d "$OUT/Cordova.xcframework" ]; then
    info "capacitor-swift-pm $VERSION upstream (signed) xcframeworks already in place"
    exit 0
  fi
  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT
  fetch_upstream
  mkdir -p "$OUT"
  for n in Capacitor Cordova; do
    rm -rf "$OUT/$n.xcframework"
    cp -R "$WORK/up/$n/$n.xcframework" "$OUT/$n.xcframework"
    codesign -dv "$OUT/$n.xcframework" 2>&1 | grep -E "^(Authority|TeamIdentifier)=" | head -2 | sed "s/^/  $n: /" || true
  done
  echo "$VERSION-ios" > "$STAMP"
  info "done — upstream xcframeworks, as signed, in $OUT"
  exit 0
fi

if ! $FORCE && [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$VERSION" ] \
   && [ -d "$OUT/Capacitor.xcframework" ] && [ -d "$OUT/Cordova.xcframework" ]; then
  info "capacitor-swift-pm $VERSION xcframeworks already built (pass --force to rebuild)"
  sign_xcframeworks
  exit 0
fi

command -v xcodebuild >/dev/null || die "xcodebuild not found"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
info "building Mac Catalyst slices for capacitor-swift-pm $VERSION (work dir $WORK)"

# 1. Upstream's iOS slices, verified against the checksums the remote package
#    manifest pins — the same check SPM performs.
# Match the binaryTarget's name line, not the identically named .library product above it (fetch_upstream).
fetch_upstream

# 2. The Catalyst slice, from upstream's Xcode project at the same tag. Neither
#    framework project opts into Catalyst, so it is passed as an override; the
#    source needs no patch.
info "cloning ionic-team/capacitor @ $VERSION (ios/ only)"
git -c advice.detachedHead=false clone -q --depth 1 --branch "$VERSION" --filter=blob:none --sparse \
  https://github.com/ionic-team/capacitor.git "$WORK/src"
git -C "$WORK/src" sparse-checkout set ios >/dev/null
info "archiving Capacitor + Cordova for Mac Catalyst"
xcodebuild archive \
  -workspace "$WORK/src/ios/Capacitor/Capacitor.xcworkspace" \
  -scheme Capacitor -configuration Release \
  -destination 'generic/platform=macOS,variant=Mac Catalyst' \
  -archivePath "$WORK/catalyst.xcarchive" -derivedDataPath "$WORK/dd" \
  SUPPORTS_MACCATALYST=YES SKIP_INSTALL=NO BUILD_LIBRARY_FOR_DISTRIBUTION=YES \
  CODE_SIGNING_ALLOWED=NO -quiet

# 3. Merge: upstream device + upstream simulator + our Catalyst.
mkdir -p "$OUT"
for n in Capacitor Cordova; do
  up="$WORK/up/$n/$n.xcframework"
  rm -rf "$OUT/$n.xcframework"
  xcodebuild -create-xcframework \
    -framework "$up/ios-arm64/$n.framework" \
    -framework "$up/ios-arm64_x86_64-simulator/$n.framework" \
    -framework "$WORK/catalyst.xcarchive/Products/Library/Frameworks/$n.framework" \
    -output "$OUT/$n.xcframework" >/dev/null
  info "$n.xcframework: $(plutil -extract AvailableLibraries json -o - "$OUT/$n.xcframework/Info.plist" | grep -o '"LibraryIdentifier":"[^"]*"' | cut -d'"' -f4 | tr '\n' ' ')"
done
sign_xcframeworks
echo "$VERSION" > "$STAMP"
info "done — $OUT"
