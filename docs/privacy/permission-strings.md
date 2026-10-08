# iOS permission strings: review and proposed rewrites (DRAFT)

DRAFT, 2026-10-08. Reviews every `NS*UsageDescription` in `ios/App/App/Info.plist`.
**Nothing here has been applied.** Editing Info.plist and pushing under `ios/` triggers a
TestFlight build, so the owner should make these changes deliberately, or with `[skip ci]` until
a build is wanted.

Apple's review standard (Guideline 5.1.1): say what the data is used for, specifically, in the
user's terms. App Review rejects vague strings like "uses the camera for features". Each string
below names the feature and says where the data goes.

## NSLocationWhenInUseUsageDescription

**Current:** "futurega.me uses your location to find tournaments near you"

**Still used: yes.** WKWebView routes `navigator.geolocation` through CoreLocation:

- *Current Location* in the location picker: `vite-app/src/components/LocationDropdown.jsx:128-131`
- Onboarding "Use my location": `vite-app/src/components/OnboardingWizard.jsx:47-57`

The coordinates drive the distance filter. A reverse lookup turns them into a US state, which
decides which online sites are shown as available (`server.js:9860-9888`). For signed-in users
they are saved to the account (`server.js:4342-4353`).

**Assessment:** accurate but incomplete. It leaves out the state/online-availability use and the
fact that the location is saved to the account.

**Proposed:**
> futurega.me uses your location when you tap Current Location to show tournaments within your
> chosen distance and which online poker sites are available in your state. It's saved to your
> account so your other devices use it too.

Shorter alternative if you prefer not to mention saving (the privacy policy covers it):
> futurega.me uses your location when you tap Current Location to show tournaments near you and
> which online poker sites are available in your state.

**Mac Catalyst gap [CHECK]:** `App-macCatalyst.entitlements` has camera and photos-library
sandbox entitlements but not `com.apple.security.personal-information.location`. Under the App
Sandbox, Current Location will probably fail on the Mac app. Add the entitlement if location
should work there.

## NSCameraUsageDescription

**Current:** "futurega.me uses the camera for table scanning and registration photos"

**Still used: yes**, in two places:

1. `getUserMedia` camera overlays: the live-update photo overlays (`CameraOverlay.jsx:93`, opened
   from `LiveUpdatePanel.jsx:400,784`) and the registration receipt + starting-stack flow
   (`CameraOverlay.jsx:445-483`). These photos are composed **on the device** and leave it only
   through the share sheet.
2. The Table Scanner and the other `<input type="file" accept="image/*">` pickers
   (`TableScanner.jsx:468`, `CameraOverlay.jsx:308,433,589,627`) offer **Take Photo** in the iOS
   picker, which needs camera permission. A Table Scanner photo **is uploaded** and read by
   Anthropic's API (`server.js:12731-12850`).

**Assessment:** "table scanning" means nothing to a new user. "Registration photos" is
ambiguous. The string also omits the overlays, which are the main camera feature, and does not
say that a scanned photo is uploaded.

**Proposed:**
> futurega.me uses the camera so you can photograph your registration receipt, starting stack or
> table and add tournament stats to share. If you photograph a seating chart for the Table
> Scanner, that photo is sent to our server to read the player names.

Shorter alternative:
> futurega.me uses the camera for stat-overlay photos you can share, and to photograph seating
> charts for the Table Scanner.

## NSPhotoLibraryUsageDescription (read access)

**Current:** "futurega.me saves table scanner exports and schedule images to your photo library"

**Still used: probably not [CHECK].** No code reads the library directly: no `PHPhotoLibrary`,
no `@capacitor/camera`, nothing in `AppDelegate.swift`. Photo choosing goes through
`<input type="file" accept="image/*">`:

- `SettingsView.jsx:35` (avatar)
- `TableScanner.jsx:468`
- `CameraOverlay.jsx` galleries
- `HandReplayerView.jsx:6537` (Instagram Story background)

On iOS 14+, WKWebView presents these through the out-of-process picker, which needs no
photo-library permission. The Mac Catalyst entitlement
`com.apple.security.personal-information.photos-library` is in the same position.

**Assessment:** the text is also **wrong for this key**. It describes *saving*, which is what
the separate Add key below covers, not *reading*. App Review flags a string that doesn't match
its key.

**Options:**
- **Remove the key** (preferred if a device test confirms the avatar, Table Scanner and
  Instagram-background pickers still open the library with the key absent). Removing an unused
  permission also simplifies review.
- **Or keep it with an accurate string:**
  > futurega.me lets you pick photos from your library: a profile picture, a screenshot of a
  > seating chart for the Table Scanner, or a background for an Instagram Story. Only the photos
  > you choose are used.

## NSPhotoLibraryAddUsageDescription (add-only)

**Current:** "futurega.me saves table scanner exports and schedule images to your photo library"

**Still used: yes**, indirectly. Every export goes through the share sheet (`navigator.share`),
and choosing **Save Image / Save Video** there writes to Photos as this app, which needs this
key. Call sites:

- `CameraOverlay.jsx:275,566`
- `TableScanner.jsx:327`
- `vite-app/src/utils/export.js:82` (schedule PNG/PDF)
- `replay-gif-export.js:259,266`
- `replay-video-export.js:261`
- `LiveUpdatePanel.jsx:392`
- `HandReplayerView.jsx:6418`

**Assessment:** the right idea, but it names only two of the export types and omits hand-replay
GIFs and videos and the overlay photos.

**Proposed:**
> futurega.me saves the images and videos you choose to export, such as schedules, hand replays
> and stat overlays, to your photo library.

## Keys that are not needed (confirming absence)

| Key | Needed? | Why |
|---|---|---|
| NSMicrophoneUsageDescription | No | No audio capture. Camera streams request `video` only (`CameraOverlay.jsx:93-95,480-482`). Video export renders from canvas. |
| NSSpeechRecognitionUsageDescription | No | Quick-add sends `source: 'text'` (`QuickAddView.jsx:298`). The server accepts `'speech'` (`lib/quick-add.js:48`), so if voice input is ever built, both this key and the microphone key become required. |
| NSUserTrackingUsageDescription | No, and do not add it | No tracking (see `app-store-privacy-labels.md`). |
| NSContactsUsageDescription | No | Address book never read. |
| NSLocationAlwaysAndWhenInUseUsageDescription | No | No background location. |
| NSFaceIDUsageDescription | No | No biometric login. |

## Related Info.plist and config notes (not permission strings)

- `FacebookAppID` + `LSApplicationQueriesSchemes` (`instagram`, `instagram-stories`) are for
  Instagram Story sharing (`AppDelegate.swift:151-270`). They are not a permission and are not
  data collection. No Facebook SDK is linked.
- `capacitor.config.json` sets `"webContentsDebuggingEnabled": true`. That makes the WebView,
  including the stored sign-in token, inspectable from Safari on a Mac connected to the device.
  [CHECK: set it to false, or tie it to debug builds, for App Store release.]
- There is no app-level `PrivacyInfo.xcprivacy`. See the last item in `app-store-privacy-labels.md`.
