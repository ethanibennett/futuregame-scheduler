# Mac Catalyst — a native macOS app from the existing iOS project

A native macOS `.app` built from the **same** `ios/App` Xcode project — the iPad
app running as a real Mac app (its own window, menu bar, notarization). No second
codebase: it reuses the `public-vite` web bundle and the Capacitor iOS shell.
Everything below that touches Xcode / signing / archiving runs **on the Mac** (the
Xcode build node); Windows owns the web app and pushes changes through
`git pull` + `cap sync`, exactly as the iOS build already does.

## Already in place (why this is low-effort)
- **Single-size 1024 app icon** (`AppIcon-512@2x`, plus dark/tinted) — covers
  macOS/Catalyst automatically, no extra icon set needed.
- **Deployment target iOS 15.0** → Catalyst maps to **macOS 12**.
- **Camera + Photo Library usage strings** already in `Info.plist` (Catalyst maps
  them to the Mac's permission prompts) — the table scanner keeps working.
- **`aps-environment: production`** already in `App.entitlements` for push.
- Team `27TK6846H8`, automatic signing, bundle id `app.futurega.me.beta`.

## The one real blocker: Capacitor ships no Catalyst slice (solved, 2026-09-14)

Enabling the destination is not enough on its own. The app links Capacitor through
Swift Package Manager, and the official package (`ionic-team/capacitor-swift-pm`)
is a pair of **binary** xcframeworks carrying only `ios-arm64` and
`ios-arm64_x86_64-simulator`. A Catalyst build dies before any app code compiles:

```
Capacitor.xcframework: error: While building for Mac Catalyst, no library for this
platform was found in '.../capacitor-swift-pm/Capacitor/Capacitor.xcframework'
```

Capacitor's *source* compiles for Catalyst unmodified (verified at 8.2.0 — only
three pre-existing deprecation warnings), so the fix is to build that slice
ourselves and override the package locally:

- `scripts/build-capacitor-xcframeworks.sh` downloads upstream's xcframeworks for
  the version `ios/App/CapApp-SPM/Package.swift` pins (checksums verified against
  the upstream manifest, the same check SPM does), clones `ionic-team/capacitor`
  at that tag, archives `Capacitor` + `Cordova` for
  `generic/platform=macOS,variant=Mac Catalyst`, and merges the three slices into
  `ios/App/capacitor-swift-pm/{Capacitor,Cordova}.xcframework`. The iOS slices stay
  byte-identical to upstream's; only the Catalyst one is new.
- `ios/App/capacitor-swift-pm/Package.swift` (committed) declares those as binary
  targets under the **same package identity** as the remote. It is registered in
  the project as a local package, and Xcode uses a local package in place of a
  remote one of the same name for every dependant — `CapApp-SPM` and each plugin —
  so nothing in the Capacitor-managed manifests changes and `cap sync` keeps working.
- The xcframeworks themselves (~15 MB) are gitignored. **Run the script once after
  `npm install` on a fresh checkout**, and again when the pinned version changes
  (it is a no-op while its stamp matches). Until it has run, *every* build of the
  app — iOS included — fails with "no such package", because the override replaces
  the remote for all platforms. The ship script should call it first.

Not viable alternatives, for the record: a source Swift package over
`node_modules/@capacitor/ios` (Capacitor is mixed Swift + Objective-C, which SPM
forbids in one target); switching the project to CocoaPods (would rewrite the iOS
project into a workspace and the whole ship pipeline with it).

## Done in the project file (2026-09-14) — no Xcode clicking required
The destination is enabled in `project.pbxproj` directly, so a fresh clone needs
nothing from the Xcode UI: `SUPPORTS_MACCATALYST = YES`,
`SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD = NO` (real Catalyst, not "Designed for
iPad"), `DERIVE_MACCATALYST_PRODUCT_BUNDLE_IDENTIFIER = NO` (same bundle id on
Mac, so the same App Store Connect record), `TARGETED_DEVICE_FAMILY = "1,2"` with
no `6` (= "Scale Interface to Match iPad"). Entitlements are split per SDK:
`App/App.entitlements` stays iOS-only and
`"CODE_SIGN_ENTITLEMENTS[sdk=macosx*]" = App/App-macCatalyst.entitlements` adds
App Sandbox, outgoing network, camera and photo library for the Mac build, so the
iOS profile never sees sandbox keys it does not know. The steps below are what
those settings correspond to, kept for when Xcode is open anyway.

## One-time Xcode setup (Mac) — equivalent to the above
1. Open `ios/App/App.xcodeproj`.
2. Target **App → General → Supported Destinations → ＋ → Mac (Mac Catalyst)**.
   - Interface prompt: choose **"Scale Interface to Match iPad"** — recommended
     for this webview app; it keeps the responsive React layout identical to iPad.
     ("Optimize for Mac" swaps in AppKit control metrics we don't need.)
3. **Signing & Capabilities** → pick the **Mac Catalyst** destination in the bar → confirm:
   - Team `27TK6846H8`, **Automatic** signing.
   - **Push Notifications** capability carries over from iOS — leave it on.
   - Xcode adds **App Sandbox** for Catalyst. Under it enable
     **Outgoing Connections (Client)** (`com.apple.security.network.client`) so the
     webview reaches the internet, plus **Camera** and **Photo Library** if the
     table scanner is used on Mac.
4. Developer portal: ensure App ID `app.futurega.me.beta` has the **macOS** platform
   with **Push Notifications** enabled. Automatic signing usually handles this; if
   push registration fails on Mac, enable it there and regenerate the profile.

## Build & run
```bash
cd vite-app && npm run build && cd ..
npx cap sync ios          # copies the current web bundle into the iOS project
./scripts/build-capacitor-xcframeworks.sh   # once per Capacitor version (see above)
```
Then in Xcode select **My Mac (Mac Catalyst)** and Run (⌘R), or from a shell:
```bash
xcodebuild -project ios/App/App.xcodeproj -scheme futurega.me -configuration Debug \
  -destination 'platform=macOS,variant=Mac Catalyst' -derivedDataPath /tmp/dd \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_<ADMIN>.p8 \
  -authenticationKeyID <ADMIN> -authenticationKeyIssuerID <issuer> build
open /tmp/dd/Build/Products/Debug-maccatalyst/futurega.me.app
```

### Signing: the App Manager key is not enough for the first Catalyst build
A Mac Catalyst *development* profile has to name the Mac it runs on, and this Mac
was not registered in the portal. With the App Manager key (`UCFMFW9636`) the
build fails twice over:
```
error: Device "Ethan's MacBook Pro" isn't registered in your developer account.
error: No profiles for 'app.futurega.me.beta' were found: Xcode couldn't find any
       Mac Catalyst App Development provisioning profiles matching 'app.futurega.me.beta'.
```
Only an **Admin** key can register a device and mint profiles — the same
limitation `ios-testflight.yml` documents for `ASC_ADMIN_*`. The Admin key on this
Mac (`AuthKey_AXP57ABRUD.p8`, added 2026-09-01) plus
`-allowProvisioningDeviceRegistration` registered the Mac and created "Mac Catalyst
Team Provisioning Profile: app.futurega.me.beta" in one go. The App Store profile
was created the same way at export. After that first run the profiles are cached
and the App Manager key works again for routine builds. The portal already had the
macOS platform + Push on the App ID; nothing was changed by hand.

Verified 2026-09-14 on macOS 26.6.2 / Xcode 26.6: Debug build runs, sandboxed
(`app-sandbox`, `network.client`, `device.camera`, `photos-library`,
`aps-environment`), guest mode loads the live schedule from futurega.me (117
events), and the window floor holds at 370×555 screen points — that is 480×720
UIKit points under the iPad scale factor of 0.77, so do not be alarmed that the
numbers in `AppDelegate.swift` and the window do not match.

## Distribution
- **TestFlight / App Store (macOS):** Archive with destination
  **Any Mac (Mac Catalyst)** → Distribute App → App Store Connect. Same scheme
  (`App`), same App Store Connect record — a macOS build sits alongside the iOS one.
- **Outside the store:** Distribute App → **Developer ID** → notarize → DMG.
- `scripts/ios-testflight.sh` archives iOS only
  (`-destination generic/platform=iOS`); it now runs
  `build-capacitor-xcframeworks.sh` before archiving so the override does not
  break the iOS ship. A Catalyst archive uses
  `-destination 'generic/platform=macOS,variant=Mac Catalyst'`. **Verified
  2026-09-14:** a manual archive and an App Store export (`destination: export`,
  the same `ios/ExportOptions.plist` otherwise) both succeed with the Admin key,
  producing a signed `futurega.me.pkg` (arm64 + x86_64). Nothing was uploaded.
  Next step is the `--catalyst` flag in that script so it ships in one command.

## Optional polish (not needed to ship)
- **Minimum window size — wired and verified.** `AppDelegate.swift` pins the
  Catalyst window to a 480×720 minimum (`windowScene.sizeRestrictions?.minimumSize`,
  `#if targetEnvironment(macCatalyst)` so it's inert on iPad). It is applied on
  scene *connect*, scene *activate* and `applicationDidBecomeActive` — the first cut
  observed only activation and the window could still be dragged to 515×319.
  Adjust the `CGSize` there for a different floor; remember the window shows
  0.77× those numbers.
- **Content mode.** `capacitor.config.json` sets `ios.preferredContentMode:
  "mobile"`; the responsive layout renders fine in a Mac window. Switch to
  `"desktop"` only if you want the wide layout by default on Mac.
- **Camera / table scanner** uses the Mac camera + a Mac photo picker on Catalyst
  — worth a quick test.
- **Push on Mac** delivers via APNs to the Mac; test one real notification once signed.
