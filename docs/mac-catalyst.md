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

## One-time Xcode setup (Mac)
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
```
Then in Xcode select **My Mac (Mac Catalyst)** and Run (⌘R).

## Distribution
- **TestFlight / App Store (macOS):** Archive with destination
  **Any Mac (Mac Catalyst)** → Distribute App → App Store Connect. Same scheme
  (`App`), same App Store Connect record — a macOS build sits alongside the iOS one.
- **Outside the store:** Distribute App → **Developer ID** → notarize → DMG.
- `scripts/ios-testflight.sh` archives iOS only
  (`-destination generic/platform=iOS`). A Catalyst archive uses
  `-destination 'generic/platform=macOS,variant=Mac Catalyst'`. Once the
  destination is enabled and a manual archive succeeds, ping me and I'll add a
  `--catalyst` flag to that script so it's one command like the iOS ship.

## Optional polish (not needed to ship)
- **Minimum window size.** Catalyst windows drag arbitrarily small. Constrain it
  with `windowScene.sizeRestrictions?.minimumSize` (~480×720 keeps the phone
  layout usable). Capacitor uses an app-based `AppDelegate` (no `SceneDelegate`),
  so this needs a small scene hook — ask me and I'll wire it.
- **Content mode.** `capacitor.config.json` sets `ios.preferredContentMode:
  "mobile"`; the responsive layout renders fine in a Mac window. Switch to
  `"desktop"` only if you want the wide layout by default on Mac.
- **Camera / table scanner** uses the Mac camera + a Mac photo picker on Catalyst
  — worth a quick test.
- **Push on Mac** delivers via APNs to the Mac; test one real notification once signed.
