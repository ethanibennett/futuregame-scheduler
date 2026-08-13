#!/usr/bin/env bash
#
# Build the DashboardSaverHelper executable (universal, ad-hoc signed).
# Produces ./build/DashboardSaverHelper
#
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

PRODUCT="DashboardSaverHelper"
SDK="$(xcrun --sdk macosx --show-sdk-path)"

echo "==> Cleaning"
rm -rf build && mkdir -p build

for ARCH in arm64 x86_64; do
  echo "==> Compiling ${ARCH}"
  xcrun swiftc \
    -target "${ARCH}-apple-macos13.0" \
    -sdk "${SDK}" \
    -framework AppKit \
    -framework WebKit \
    -O \
    -o "build/${PRODUCT}-${ARCH}" \
    main.swift
done

echo "==> lipo → universal"
lipo -create "build/${PRODUCT}-arm64" "build/${PRODUCT}-x86_64" -output "build/${PRODUCT}"

echo "==> Ad-hoc codesign"
codesign -f -s - --timestamp=none "build/${PRODUCT}"

echo "==> Verifying"
lipo -info "build/${PRODUCT}" | sed 's/^/    /'
echo "Built build/${PRODUCT}"
