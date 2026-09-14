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

# Signing: ad-hoc does NOT work for a screensaver, however well it builds.
#
# legacyScreenSaver loads the bundle through AMFI, which rejects it outright:
#
#   amfid: .../DashboardSaver not valid: AppleMobileFileIntegrityError Code=-423
#          "The file is adhoc signed or signed by an unknown certificate chain"
#
# and the failure is invisible from every angle that looks reasonable. The bundle
# links, codesign verifies it, System Settings lists and selects it, the log even
# says `Setting module "DashboardSaver"` -- and then the principal class is never
# instantiated, so the screen is black and the saver's own logging never runs to
# report anything. Only amfid says why, in a subsystem nobody thinks to read.
#
# A real certificate chain fixes it. Notarization is NOT needed: that gates
# Gatekeeper on quarantined downloads, and this bundle is built locally.
echo "==> Codesign"
IDENTITY="${CODESIGN_IDENTITY:-}"
if [[ -z "${IDENTITY}" ]]; then
  # Prefer Developer ID; an Apple Development cert chains to Apple's WWDR too and
  # is what a Mac set up for TestFlight already has.
  for PREFIX in "Developer ID Application" "Apple Development" "Mac Developer"; do
    IDENTITY="$(security find-identity -v -p codesigning | awk -F'"' -v p="${PREFIX}: " 'index($2, p) == 1 { print $2; exit }')"
    [[ -n "${IDENTITY}" ]] && break
  done
fi
if [[ -z "${IDENTITY}" ]]; then
  echo "ERROR: no codesigning identity found, and ad-hoc signing will not load." >&2
  echo "       Available identities:" >&2
  security find-identity -v -p codesigning | sed 's/^/         /' >&2
  echo "       Set CODESIGN_IDENTITY to one of them and rebuild." >&2
  exit 1
fi
echo "    ${IDENTITY}"
codesign -f -s "${IDENTITY}" --timestamp=none "${BUNDLE}"

echo "==> Verifying"
codesign -dv --verbose=2 "${BUNDLE}" 2>&1 | sed 's/^/    /'
lipo -info "${BUNDLE}/Contents/MacOS/${PRODUCT}" | sed 's/^/    /'

# Catch a signature AMFI will reject, here rather than as a black screen.
echo "==> Verifying signature is loadable"
if codesign -dv --verbose=2 "${BUNDLE}" 2>&1 | grep -q "flags=.*adhoc"; then
  echo "ERROR: bundle is ad-hoc signed. AMFI will refuse to load it into" >&2
  echo "       legacyScreenSaver and the screensaver will be black." >&2
  exit 1
fi
TEAM="$(codesign -dv --verbose=2 "${BUNDLE}" 2>&1 | sed -n 's/^TeamIdentifier=//p')"
echo "    TeamIdentifier=${TEAM:-none}"

# The principal class is the one thing that fails completely silently: if Info.plist names a
# class the Objective-C runtime does not have, the bundle still links, still passes codesign,
# and still installs -- principalClass just returns nil, the engine instantiates nothing, and
# the screensaver is black with not a single line logged anywhere. That cost a long debugging
# session once.
#
# Ask the runtime rather than the symbol table. An earlier version of this check grepped nm
# for _OBJC_CLASS_$_<name> and found nothing at all, because a non-public Swift class emits
# that symbol with local visibility and `nm -g` only lists global ones -- so it reported a
# failure it could not actually see either way. Loading the bundle and reading principalClass
# back is exactly what NSBundle does for the screensaver engine, so it cannot disagree with
# what happens at runtime.
echo "==> Verifying principal class"
DECLARED="$(/usr/libexec/PlistBuddy -c 'Print :NSPrincipalClass' "${BUNDLE}/Contents/Info.plist")"
RESOLVED="$(/usr/bin/xcrun swift - <<SWIFT 2>/dev/null
import Foundation
guard let b = Bundle(path: "${HERE}/${BUNDLE}"), b.load(), let c = b.principalClass else { exit(0) }
print(NSStringFromClass(c))
SWIFT
)" || true   # set -e must not kill the build before we can report what went wrong

if [[ "${RESOLVED}" == "${DECLARED}" ]]; then
  echo "    ${DECLARED} resolves"
else
  echo "" >&2
  echo "ERROR: Info.plist declares NSPrincipalClass '${DECLARED}', but loading the bundle" >&2
  if [[ -z "${RESOLVED}" ]]; then
    echo "       resolves no principal class at all." >&2
  else
    echo "       resolves '${RESOLVED}' instead." >&2
  fi
  echo "" >&2
  echo "       An explicit @objc(Name) sets the Objective-C runtime name to the unqualified" >&2
  echo "       Name; without it a Swift class registers as Module.Class. Info.plist must" >&2
  echo "       match whichever one the source uses." >&2
  echo "" >&2
  echo "       Objective-C class symbols in the binary:" >&2
  nm -U "${BUNDLE}/Contents/MacOS/${PRODUCT}" 2>/dev/null     | sed -n 's/.*_OBJC_CLASS_\$_//p' | sort -u | sed 's/^/         /' >&2
  exit 1
fi

echo ""
echo "Built ${BUNDLE}"
echo "Install:  cp -R \"${BUNDLE}\" ~/Library/Screen\\ Savers/"
