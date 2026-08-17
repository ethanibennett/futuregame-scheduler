#!/usr/bin/env bash
#
# Build DashboardSaver.saver as a universal (arm64 + x86_64) bundle with swiftc + lipo,
# then ad-hoc codesign it. No Xcode project required (Command Line Tools / Xcode toolchain
# is enough). Produces ./build/DashboardSaver.saver
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

PRODUCT="DashboardSaver"
BUNDLE="build/${PRODUCT}.saver"
MACOSX_DEPLOYMENT_TARGET="14.0"

# Collect Swift sources. NativeFallbackRenderer.swift is optional and only compiled if present.
SOURCES=( "DashboardSaverView.swift" )
[[ -f "NativeFallbackRenderer.swift" ]] && SOURCES+=( "NativeFallbackRenderer.swift" )

SDK="$(xcrun --sdk macosx --show-sdk-path)"

echo "==> Cleaning"
rm -rf build
mkdir -p "${BUNDLE}/Contents/MacOS"
mkdir -p "${BUNDLE}/Contents/Resources"

# A .saver is a loadable bundle; the Mach-O type MUST be a bundle (-Xlinker -bundle).
echo "==> Compiling + linking as bundle (MH_BUNDLE)"
for ARCH in arm64 x86_64; do
  OUT="build/${PRODUCT}-${ARCH}"
  echo "    ${ARCH}"
  xcrun swiftc \
    -target "${ARCH}-apple-macos${MACOSX_DEPLOYMENT_TARGET}" \
    -sdk "${SDK}" \
    -module-name "${PRODUCT}" \
    -o "${OUT}" \
    -framework ScreenSaver \
    -framework AppKit \
    -O \
    -Xlinker -bundle \
    "${SOURCES[@]}"
done

echo "==> lipo → universal"
lipo -create "build/${PRODUCT}-arm64" "build/${PRODUCT}-x86_64" \
  -output "${BUNDLE}/Contents/MacOS/${PRODUCT}"

echo "==> Bundling Info.plist"
cp Info.plist "${BUNDLE}/Contents/Info.plist"

echo "==> Ad-hoc codesign"
codesign -f -s - --timestamp=none "${BUNDLE}"

echo "==> Verifying"
codesign -dv --verbose=2 "${BUNDLE}" 2>&1 | sed 's/^/    /'
lipo -info "${BUNDLE}/Contents/MacOS/${PRODUCT}" | sed 's/^/    /'

echo ""
echo "Built ${BUNDLE}"
echo "Install:  cp -R \"${BUNDLE}\" ~/Library/Screen\\ Savers/"
