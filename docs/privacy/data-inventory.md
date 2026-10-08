# Personal-data inventory (source for the privacy drafts)

DRAFT, 2026-10-08. Built from the code at `f3bf3e2`, not from intentions or older docs.
Every row cites where the behaviour lives. `privacy-policy-draft.md`,
`app-store-privacy-labels.md` and `permission-strings.md` are derived from this file, so
when the code changes, update this file first.

"Gated" means who can reach a feature in the shipped UI. Several features are hidden
behind the `isAdmin` rollout flag (`vite-app/src/App.jsx:1345`, usernames
`ham`/`ham5`/`claude`), but most of their server endpoints are open to any registered
account. The App Store answers below assume the public-release gating stays as it is
today. If a gate opens, revisit the rows marked **gated**.

## 1. Account

| Data | Where stored | Code | Notes |
|---|---|---|---|
| Username (2–20 chars) | `users.username` | `server.js:1020-1027`, register `server.js:3535-3599` | Shown to other users (search, buddies, groups, share links). |
| Email | `users.email` | `server.js:1024`, `server.js:3557-3559` | Login identifier (`server.js:3605`), password reset. |
| Password | `users.password` (bcrypt hash, cost 10) | `server.js:3576`, `server.js:3739` | Plain text never stored. |
| Full name ("real name", required, ≤40 chars) | `users.real_name` | `server.js:1297`, `server.js:3540-3542`, edit `server.js:3648-3661` | Shown to other users; searchable (see §6). |
| Avatar image (JPEG/PNG/WebP ≤200 KB) | `users.avatar` as a base64 data URI | upload `server.js:4273-4293`, delete `server.js:4295-4304`, picker `vite-app/src/components/SettingsView.jsx:35` | **Public**: `GET /api/avatar/:userId` has no auth (`server.js:4306-4318`). |
| Account timestamps, flags | `users.created_at`, `last_seen_shares`, `last_seen_notifications`, `hand_replayer_access`, `trial_used_at` | `server.js:1025`, `1283`, `2065`, `1304`, `3326` | Functional state only. |
| Session token (JWT, 90 days) | Client `localStorage` (or `sessionStorage` when "keep me signed in" is off) + httpOnly cookie `fg_session` | `server.js:3623-3630`, cookie `server.js:226-237`, client `vite-app/src/App.jsx:82-83`, `App.jsx:815` | JWT carries user id + username only. |
| Guest session (JWT, 4 h, id 0) | Client only | `server.js:3640-3646` | Nothing stored server-side for guests. |
| Password-reset tokens | `password_resets` (1 h expiry, marked used, never deleted) | `server.js:1108-1117`, `server.js:3664-3705` | Reset email sent through SMTP (`server.js:145-183`). If `SMTP_HOST` is unset, the reset link and email address go to the server log instead (`server.js:181`). |
| New-registration alert | Push to the admin's devices: `"<username> (<real name>) just registered"` | `server.js:3588` | Goes through Apple/web-push services to the operator only. |
| Admin user lists | — | `server.js:9463-9481` (ADMIN_KEY), `server.js:9484-9498` (ham/ham5) | Operator can see id, username, email, real name, avatar, created_at. |

## 2. Location

| Data | Where | Code | Notes |
|---|---|---|---|
| Device coordinates ("Current Location") | Browser/WKWebView `navigator.geolocation`, `enableHighAccuracy: false` | `vite-app/src/components/LocationDropdown.jsx:128-131`, `vite-app/src/components/OnboardingWizard.jsx:47-57` | Only on a tap; no background location. |
| Saved location blob `{userLocation:{lat,lng}, maxDistance, locationRegion, locationLabel, jurisdiction}` | Client `localStorage.savedLocation` (`vite-app/src/utils/location-prefs.js:19,33`); for registered users also `users.saved_location` | `server.js:1315`, `server.js:4327-4353`, client push `location-prefs.js:66-70` | Coordinates are stored **unrounded**, so device-precision when the user picked Current Location. |
| Coordinates sent for reverse geocoding | Server → Nominatim `/reverse` (zoom=8, state level) | `LocationDropdown.jsx:60-62`, `OnboardingWizard.jsx:55`, `server.js:9860-9888` | Request leaves from the server's IP with UA `FutureGame-PokerScheduler/1.0`; no user identifier is forwarded. Not stored by us. |
| Typed place search ("Las Vegas") | Server → Nominatim `/search` | `server.js:9822-9853` | Same: server IP, no user id, not stored. |
| Venue coordinates for live clocks | Server → PokerAtlas websocket / Bravo | client `vite-app/src/components/DashboardView.jsx:450`, `CalendarEventRow.jsx:563`; server `server.js:3872-3909`, `lib/live-clocks.js:33,321-323` | The lat/lng are the **venue's** (`getVenueCoords`), never the user's. Payload is the event's clock id or casino id. **No user data.** |

## 3. Camera, photos, images

| Feature | What happens to the image | Code | Gated |
|---|---|---|---|
| Live-update camera overlay, registration receipt + starting-stack flow | `getUserMedia` → drawn onto a canvas **on device** → user shares/saves via the share sheet. Never uploaded. | `vite-app/src/components/CameraOverlay.jsx:93`, `:275`, `:445-480`, `:566`; opened from `LiveUpdatePanel.jsx:400,784` | All users |
| Table Scanner | User takes/picks a photo or screenshot of a tournament seating list → `POST /api/scan-table` → server sends the image to **Anthropic** (Claude Haiku) → names, chip counts, seats returned. The image is not stored by us; extracted player names are written to the server log and to client `localStorage.tableScanPlayers`. | client `vite-app/src/components/TableScanner.jsx:365,427,468`; server `server.js:12729-12882`, log line `server.js:12872` | **Any signed-in session, guests included** (`authenticateToken` only, no `requireRegistered`). Rendered on the dashboard for everyone (`DashboardView.jsx:1128`). |
| Hendon Mob link from a scanned name | Tapping a scanned player opens `/api/hendon-redirect?name=…`; the server searches **DuckDuckGo** for the name and redirects the user's browser to **The Hendon Mob** (or DuckDuckGo). | `TableScanner.jsx:572`, `server.js:747-768`, `server.js:814-823` | All users. `POST /api/hendon-winnings` (`server.js:800`) has no caller in the app. |
| Avatar | Uploaded and stored (see §1). | | Registered |
| Instagram Story background | User picks a photo; it is composited on device and handed to Instagram via the pasteboard. | `vite-app/src/components/HandReplayerView.jsx:6537-6550`, `ios/App/App/AppDelegate.swift:151-205` | Hands tab (gated) |
| Staking "proof" image | Uploaded, stored as a data URI in `backer_event_status.proof_image`. | `server.js:5921-5928`, `server.js:6704-6751` | **Gated**: Staking tab is admin-only ("Coming Soon", `App.jsx:1756-1760`). |
| Saving exported images/videos | Only through the system share sheet (`navigator.share`) → "Save Image/Video". | `CameraOverlay.jsx:275`, `TableScanner.jsx:327`, `vite-app/src/utils/export.js:82`, `replay-gif-export.js:259`, `replay-video-export.js:261`, `LiveUpdatePanel.jsx:392`, `HandReplayerView.jsx:6418` | — |

No code reads the photo library directly (no `PHPhotoLibrary`, no `@capacitor/camera`). The app
has no microphone or speech use; quick-add sends `source: 'text'` (`QuickAddView.jsx:298`).

## 4. Poker activity (user content)

| Data | Table | Code | Visible to |
|---|---|---|---|
| Schedule (events added, anchor flag, planned bullets) | `user_schedules` | `server.js:1060-1070`, `1192-1199`, routes `3985-4113` | Self; accepted buddies (`server.js:5329-5376`); group members (`server.js:4947`); anyone with the share link (§6). |
| Conditional plans ("if I bust/bag…", profit thresholds, public flag) | `schedule_conditions` | `server.js:1120-1135`, `4033-4122` | As schedule. |
| Personal calendar items (Travel Day / Day Off + free-text notes) | stored as `tournaments` rows with `venue='Personal'`, `uploaded_by=user` | `server.js:4126-4235` | As schedule (the share link returns `t.*`, notes included). |
| Results (entries, cashed, finish place, cash amount, notes) | `tracking_entries` | `server.js:3179-3193`, `5541-5658` | Self; group leaderboard when the group turns it on (`server.js:5008-5068`). Buddies are told an entry was logged (`server.js:5584,5592`). |
| Live updates (stack, blinds, ITM, bubble, final table, deal and payout, bust, bag, play start) | `live_updates` | `server.js:3196-3205`, `1819-1848`, `2006`, `5662-5865` | Self, buddies and group members in real time (`server.js:5711,5741`). |
| Crowd-sourced field size | `tournaments.total_entries` | `server.js:5503` | Everyone. |
| Admin event corrections | `admin_overrides.updated_by` (username) | `server.js:3156-3166` | Operator. |
| Hand histories (may include other players' names, stacks, cards, notes; public flag) | `saved_hands` | `server.js:3209-3220`, `7562-7805`, `7881-7978` | Self; `is_public` hands at `/api/hands/public` (`server.js:7603`). **Gated** (Hands tab: admin or admin-granted `hand_replayer_access`, `App.jsx:1471,1675`). |
| Shared hand short links | `shared_hands` (shorthand, title, uploaded_by) | `server.js:1140-1146`, `7824-7880` | **Anyone with the link**, no auth. |
| Custom replayer games | `replayer_games` | `server.js:3224-3232`, `7981-8030` | Self. Gated. |
| Trainer graded hands | `trainer_hands` | `server.js:3241-3252`, `9334-9420` | Self. Admin-only UI (`App.jsx:1681-1689`). |
| Quick-add hand text | Sent to **Anthropic**; usernames, character counts and parse notes logged | `lib/quick-add.js:120,233-251`; mounted `server.js:11469-11484` | **Admins only**, enforced server-side (`lib/quick-add.js:218-221`). |
| Schedule PDFs/images/URLs for import | Sent to **Anthropic**; a copy of the file is archived on the server's disk under `schedule-docs/` | `server.js:11488-11560`, `11968`, `12107`; archive `server.js:25-41`; PDF upload `server.js:3750-3835` | Endpoints are open to any registered account, but **no shipped UI calls them** (`ImportSchedulePanel` in `TournamentsView.jsx:674` is never rendered). Tournament schedules, not personal data. |

## 5. Social

| Data | Table | Code |
|---|---|---|
| Buddy requests / connections | `share_requests` (`schedule_permissions` legacy) | `server.js:1072-1094`, `4385-4615` |
| Groups, membership, roles, invites, leaderboard toggle | `groups`, `group_members`, `group_invites` | `server.js:2013-2077`, `4619-5210` |
| Group chat messages (1–500 chars) | `group_messages` | `server.js:2033-2041`, `4904-4944` |
| Swap/crossbook suggestions between users (percentages) | `swap_suggestions` | `server.js:1985-1999`, `9727-9820` |
| Real-time delivery | Server-Sent Events to connected buddies/group members; in memory only | `server.js:3420-3480` |

Social tab is open to all registered users (`App.jsx:1767-1769`).

## 6. What is visible to other people

- **Any registered user** can find any other user by username or real-name prefix and see their
  username, real name and avatar (`server.js:4356-4381`).
- **Anyone** (no login) can fetch any avatar by user id (`server.js:4306`).
- **Anyone with a schedule share link** sees the username, avatar and full schedule, including
  conditions and personal-event notes (`server.js:5378-5413`). The user can revoke the link
  (`server.js:5452`).
- **Anyone with a hand link** sees that hand (`server.js:7847-7880`); public hands are listed
  unauthenticated (`server.js:7603`).
- **Buddies / group members**: see §4–§5.
- **Backers** (gated staking feature): `/api/backer/:token` shows the backer's name, the
  player's username and the deal (`server.js:7106-7220`).

## 7. Staking (gated: admin-only UI)

Tables `staking_series`, `backers` (**name, email, phone, notes** of a third party, optional link
to an app user), `backer_agreements`, `backer_event_overrides`, `backer_event_status` (buy-ins,
cashes, proof images, tips), `backer_settlements`, `backer_tokens`, `staking_sell_params`,
`staking_markup_settings` (`server.js:1867-1985`, `2104-2130`; routes `6007-7560`). The endpoints
accept any registered account (`requireRegistered`) but the UI shows "Coming Soon" to non-admins
(`App.jsx:1756-1760`).

## 8. The operator's own backer program (not an app feature)

Separate from §7. The operator's personal backers are synced hourly from the operator's
dashboard (`syncBackerRoster`, `server.js:10664-10700`, store `console_records`
`server.js:2283-2291`). Each has a private page `/b/:token` (`server.js:464-590`) showing their
name and session results (`backer_public`, `backer_events`, `server.js:2303-2330`), with optional
web push (`backer_push_subs`), a per-session **Twilio SMS** to their phone
(`server.js:660-666`, `10892-10918`), and a Sunday **email digest** (`server.js:10922-10970`,
cron `server.js:13028`). The backer page loads fonts from **Google Fonts**
(`server.js:10974-10975`), so backers' browsers contact Google. Only the operator can write to it
(`requireHamBasic`, `server.js:281-327`).

## 9. Notifications

| Data | Table | Code | Gated |
|---|---|---|---|
| Web-push subscription (endpoint + keys) | `push_subscriptions` | `server.js:2265-2275`, `9896-9951` | Registration UI is admin-only (`App.jsx:1232,1311,1533`); endpoint open to registered. |
| APNs device token + env | `apns_tokens` | `server.js:3113-3122`, `9919-9935`; client `App.jsx:1260-1282`; native `AppDelegate.swift:61-67` | Same: admin-only UI today. |
| Payloads sent today | Admin alerts only (new user, new events, new series), via APNs or web push | `server.js:10008-10100`, `12437`, `12572`, `12718` | — |

## 10. Subscriptions and payments

- `subscriptions` table (`server.js:3306-3322`): tier, status, source, dates. Rows today come
  only from the free 14-day trial (`server.js:12946-12972`) and manual admin grants
  (`server.js:12975-12998`).
- Apple and Stripe webhooks are **stubs** that log and return OK (`server.js:13001-13016`); the
  Apple stub logs the first 500 characters of the notification body (`server.js:13006`).
- No StoreKit or Stripe code in the client. **No payment data is collected.**

## 11. Device storage (no cookies besides the session cookie)

- Cookie: `fg_session` only, httpOnly, Secure, SameSite=Lax, 90 days (`server.js:226-237`).
  No third-party cookies.
- `localStorage`: `token`, `username`, `realName`, `avatar`, `isGuest`, `handReplayerAccess`,
  `sessionOnly`, `savedLocation`, `savedFilters`, `tableScanPlayers`, `quickadd_draft`,
  `replayer_game_history`, trainer session state, and display preferences (`theme`, `contrast`,
  `serifFont`, felt colours, etc.). Found by grep across `vite-app/src`.
- `sessionStorage`: the token/username when not kept signed in (`App.jsx:815`), chunk-reload flags.

## 12. Third parties and outbound requests

| Recipient | What it receives | Code |
|---|---|---|
| **Render** (hosting) | Everything in this document (database file, uploads, logs). | CLAUDE.md "Deploy"; DB path `server.js:831` |
| **Anthropic** (Claude API) | Table Scanner images; quick-add text (admins); schedule documents (no UI). | `server.js:12738-12850`, `lib/quick-add.js:120`, `server.js:11488+` |
| **OpenStreetMap Nominatim** | Typed place queries; coordinates for reverse lookup. From the server's IP, no user id. | `server.js:9827`, `9867` |
| **DuckDuckGo**, **The Hendon Mob** | Player names the user taps in the Table Scanner (server-side search, then the user's browser is redirected). | `server.js:751`, `821` |
| **Apple Push Notification service**, browser push services | Device token / push endpoint and notification text (admin alerts today). | `server.js:9978-10005`, `10036+` |
| **SMTP provider** (unknown, `SMTP_HOST`) | Email address and reset link. | `server.js:145-183` |
| **Twilio** | The operator's backers' phone numbers and session results (§8). | `server.js:10892-10918` |
| **Google Fonts** | Backer-page visitors' IP (§8). | `server.js:10974-10975` |
| **jsDelivr** | The user's device fetches two font files when exporting a PDF (IP only). | `vite-app/src/utils/export.js:125-128` |
| **Instagram (Meta)** | Only what the user chooses to share to Stories; the app identifies itself with its Facebook App ID. No Facebook SDK. | `AppDelegate.swift:151-270`, `Info.plist` `FacebookAppID` |
| **PokerAtlas, Bravo Poker Live** | Event clock ids / casino ids derived from venue coordinates. **No user data.** | `lib/live-clocks.js:33`, `321-323` |
| **open.er-api.com** | Nothing about the user (server fetches USD rates). | `server.js:68` |
| **cashwatcher.futurega.me**, **dashboard.futurega.me** | The operator's own services; admin-only cash data and the operator's own schedule/backer roster. | `server.js:343-460`, `593-605`, `10606-10700` |

**Not present**: no analytics, no advertising SDK, no crash reporting, no IDFA/ATT, no
fingerprinting, no data sale. A grep for Sentry, PostHog, Mixpanel, gtag, Firebase,
Crashlytics, Amplitude, Segment, Bugsnag, Datadog, Hotjar and Clarity across the client,
server and iOS project finds nothing. The only Capacitor plugins are push-notifications,
splash-screen and status-bar (`vite-app/package.json`).

## 13. Logs and transient data

- Express keeps no access log of its own, but Render records request logs (IP addresses) on its
  side. [CHECK]
- Rate limiters hold client IPs in memory for 15 minutes (`server.js:128-142`, `5931`).
- Application logs contain usernames (quick-add), scanned player names (`server.js:12872`), CORS
  origins (`server.js:120`) and, if SMTP is unset, reset links with email addresses
  (`server.js:181`).

## 14. Retention and deletion today

- **No automated deletion of user data anywhere.** Live updates, results, messages and
  password-reset rows persist indefinitely. The only automatic deletes are push tokens or
  endpoints that Apple or the push service reports dead (`server.js:10024`, `10082`, `10851`).
- User-initiated deletes exist per item: avatar, schedule entries, tracking (one or all),
  live updates, hands, games, share link, buddy, group, push subscription.
- **No account-deletion route exists yet.** `DELETE /api/account` is being built (grep finds no
  `/api/account` in `server.js` or `vite-app/src`).
