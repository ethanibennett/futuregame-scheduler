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

# The principal class is the one thing that fails completely silently: if Info.plist names a
# class the Objective-C runtime does not have, the bundle still links, still passes codesign,
# and still installs -- principalClass() just returns nil, the engine instantiates nothing,
# and the screensaver is black with not a single line logged anywhere. That cost a long
# debugging session once. Check it here, where the answer is cheap.
#
# NSBundle looks the class up by its OBJECTIVE-C runtime name. A bare Swift class registers
# as "Module.Class" and is emitted under the mangled symbol _TtC<n><module><n><class>; an
# explicit @objc(Name) overrides that and emits a plain _OBJC_CLASS_$_<Name>. Accept either,
# so renaming the class or dropping the attribute is caught rather than shipped.
echo "==> Verifying principal class"
DECLARED="$(/usr/libexec/PlistBuddy -c 'Print :NSPrincipalClass' "${BUNDLE}/Contents/Info.plist")"
if [[ "${DECLARED}" == *.* ]]; then
  MODULE="${DECLARED%%.*}"
  CLASS="${DECLARED#*.}"
  EXPECTED="_OBJC_CLASS_\$__TtC${#MODULE}${MODULE}${#CLASS}${CLASS}"
else
  EXPECTED="_OBJC_CLASS_\$_${DECLARED}"
fi
if nm -gU "${BUNDLE}/Contents/MacOS/${PRODUCT}" | grep -qF -- "${EXPECTED}"; then
  echo "    ${DECLARED} -> ${EXPECTED}"
else
  echo "" >&2
  echo "ERROR: Info.plist declares NSPrincipalClass '${DECLARED}', which is not a class in" >&2
  echo "       the built binary. Expected the symbol ${EXPECTED}." >&2
  echo "       Objective-C classes actually present:" >&2
  nm -gU "${BUNDLE}/Contents/MacOS/${PRODUCT}"     | sed -n 's/.*_OBJC_CLASS_\$_//p' | sort -u | sed 's/^/         /' >&2
  exit 1
fi

echo ""
echo "Built ${BUNDLE}"
echo "Install:  cp -R \"${BUNDLE}\" ~/Library/Screen\\ Savers/"
