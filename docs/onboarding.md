# First-run setup ("onboarding")

Built 2026-10-13 on branch `feat/onboarding-refine`. Code: `vite-app/src/components/OnboardingWizard.jsx`
(the screens), `vite-app/src/utils/onboarding.js` (everything the answers read and write),
`vite-app/src/utils/location-prefs.js` (the stores), `server.js` (`users.onboarding`). Tests:
`npm run test:onboarding`. Guards: the `onboarding` and `real-name-prompt` views of
`npm run check:controls`, and the "first-run setup" section of `npm run check:clipping`.

## 1. Purpose

A new account used to answer four required questions, and every new browser (and the iOS app)
asked them again. Setup now asks three optional questions, each preset to a sensible default and
each earning its place by what it changes in the list. It does not ask what the app can work out:
your location when you have already allowed it, your state from your location or region, your name
from registration. A running count under every step shows what the answers do to the list. Setup
is finished once per account, not once per browser, and every answer an older setup stored is read
back as it was.

## 2. Before and after: the questions, word for word

These are the shipped strings. The owner reviews the wording here; change it in
`utils/onboarding.js` (titles, leads, error lines) or `OnboardingWizard.jsx` (everything else),
then here.

### BEFORE

**Register:** Full Name · Username · Email · Password ("Min. 6 characters"). Then "Account
created! Please sign in." and a second sign-in.

**Legacy accounts with no name, at password login:**
- "What's your name?" / "Your connections and group members will see this."
- Input placeholder: "Your real name". Buttons: [Later] [Save].

**Wizard.** Four dots and Skip at the top. Skip throws away every answer.

1. **"Where do you play?"**
   - Lead: "We'll show live events near you. You can change this anytime from the location button."
   - Options: Las Vegas | Texas / Florida | Europe / Northeast US. Then "📍 Use my location"
     ("within 100 miles" once found) and "Everywhere / I travel" ("no location filter").
   - An answer is required.
2. **"Do you play online?"**
   - Lead: "Online events have no location, so they're shown separately."
   - Options: Yes / No.
   - Yes requires "Which state are you in? (so we can show which sites are available to you)".
3. **"What do you play?"**
   - Lead: "Sets your game filter — loosen it anytime."
   - One of: Hold'em only (NLH) · Hold'em + PLO (NLH and Omaha) · Mixed games (HORSE, 8-Game, …) ·
     Everything (no game filter).
   - Required.
4. **"Typical buy-in?"**
   - Lead: "We'll focus the list on your range."
   - One of: Under $500 · $500 – $1,500 · $1,500 – $5,000 · High roller ($5K+) · Any buy-in.
   - Required.

Last button: "Show my schedule" (it stays on Home).

### AFTER

**Register:** the same four fields.
- Password placeholder: "At least 8 characters"; `minLength` 8. (Sign in keeps its 6, so it never
  refuses a password the server accepts.)
- Create Account signs you straight in (D1). An older server that returns no session: "Account
  created. Sign in to continue."

**Legacy name prompt:**
- "What's your name?" / "Buddies and groups see this instead of your username."
- Placeholder: "Your real name". Buttons: [Later] [Save].
- From Settings' new "Edit name" pill (D9) the same dialog is titled "Your name", opens on the
  current name, and its buttons are [Cancel] [Save].

**Setup.** Three steps, every one optional and preset to a default.
- Top of every step: "STEP n OF 3", a three-segment progress bar, and Skip.
- Above the footer on every step: a live count line.

**Step 1 — "Where do you play live?"**
- Lead: "We'll show the events near you. Change it anytime from the location button on the
  Schedule."
- **Use my location tile** (pin icon):
  - "Use my location" / "Events within 100 miles of you" (the distance chosen below, 100 by default)
  - while locating: "Finding you…"
  - once found: "Near Philadelphia, Pennsylvania" / "Within 100 miles" ("Near you" when the
    reverse lookup gives no place name; the lookup works at county level, so it often reads
    "Near Philadelphia County, Pennsylvania")
- **Search field:** "Or search a city or postal code". Up to four places; the one picked stays
  as a single ticked row.
- **Distance** (shown once a point is set, under the search): "DISTANCE" with chips
  50 mi · 100 mi · 250 mi. A distance set in the location menu that is none of those shows as
  "DISTANCE · Now: 30 mi" with no chip on, and is kept unless a chip is tapped.
- **Regions:** caption "OR PICK A REGION", then Las Vegas | Texas / Florida | Northeast US /
  Europe | Everywhere
- **Errors** (under the search):
  - permission off: "Location is off for futurega.me. Search a city or pick a region instead."
  - no fix: "Couldn't get a location fix. Search a city or pick a region instead."
  - timeout: "Finding you took too long. Try again, or search a city."
  - not a secure page: "Location needs a secure page (it works in the app). Search a city instead."
  - unsupported: "This device can't share its location. Search a city instead."
  - search failed: "Couldn't search right now. Pick a region instead."

**Step 2 — "Do you play online too?"**
- Lead: "Online tournaments show in your list next to live ones."
- Tiles:
  - "Yes, show online events" / "ACR, GGPoker, WSOP.com, Phenom and ClubWPT Gold"
  - "No, live only" / "The Online switch on the Schedule brings them back"
- With Yes, and a US or unknown location:
  - caption "YOUR STATE", plus " · from your location" when the state was worked out rather
    than picked
  - select: "Not set" + the US states
  - help: "Online sites are licensed state by state."
- With Yes and a state set: checkbox "Only sites open in Pennsylvania", caption "Sites that
  publish no state list always show."
- With Yes and a non-US location: caption "Site availability is checked for US states only."

**Step 3 — "What do you play?"**
- Lead: "Pick any that apply. Leave a row empty to see everything."
- Games: caption "GAMES"; chips NLH · PLO · Mixed; caption "Mixed is every other game: Omaha
  Hi-Lo, Stud, Draw, HORSE and more." When the filter sheet holds other variants (Razz, O8, …)
  and the row is untouched: "+2 more set in Filters".
- Buy-ins: caption "BUY-INS"; chips Under $500 · $500–1.5K · $1.5K–5K · $5K+

**Count line** (every step):
- "1,204 live events near you · 890 online"
- without a location: "3,410 live events · 890 online"
- with online off: "1,204 live events near you"
- singular: "1 live event"
- nothing matching: "Nothing upcoming matches all of this. Loosen a choice."
- empty, but still taking its height, until tournaments have loaded

**Footer:**
- Back (hidden on step 1).
- Next on steps 1–2.
- On step 3: "Show 2,094 events" ("Show 1 event"), or "Show events" when the count is unknown or 0.

**Location menu item:** "Re-run filter setup" becomes "Run setup again".

**What was removed:**
- the required answers
- "Typical buy-in?" as a step of its own (now part of step 3)
- the state question when the app can work the state out
- the single-choice game and buy-in lists (now multi-select chips that match the filter sheet)

## 3. What each answer changes in the app

| Answer | Stored in | Read by |
|---|---|---|
| Location (a point + distance, or a region) | `localStorage.savedLocation`; for an account also `users.saved_location` (`PUT /api/user/location`) | the Schedule list (`TournamentsView` → `matchesLocation`), `CalendarView`, Home's "N events this week near you" (`HomeNothingNext`), the Cash tab's default poll point (`CashLocationPicker`; a point only, not a region) |
| State (`jurisdiction`, `jurisdictionManual`) | the same `savedLocation` blob | which online sites `matchesOnline` treats as available (when "Only sites open in…" is on), and the Online menu's "Available in <state>" label |
| Online yes/no | `savedFilters.showOnline` (stored only when false) | the Schedule and the Calendar |
| Only sites open in <state> | `savedFilters.onlyAvailableOnline` (stored only when true) | the Schedule and the Calendar (`matchesOnline`) |
| Games | `savedFilters.selectedGames`, `savedFilters.mixedOnly` | the Schedule list only (the Calendar starts with no game filter) |
| Buy-ins | `savedFilters.buyinRanges` | the Schedule list only |
| Real name | `users.real_name` | names shown to buddies and groups, user search (`LIKE` on `real_name`), the replayer's `heroName`, the admin "New User" push |

The bankroll beta (admins only) takes nothing from setup, and setup asks nothing about it: those
questions would be asked of everyone for a feature only admins can see.

## 4. What the app works out on its own

- **Location already allowed.** When step 1 opens with nothing saved and
  `navigator.permissions.query({ name: 'geolocation' })` says `granted`, setup locates at once
  and pre-selects the tile. It never raises the system prompt without a tap. Where the
  Permissions API is missing (older WebKit) the tile waits for a tap.
- **The location tile** asks `getCurrentPosition({ enableHighAccuracy: false, timeout: 10000 })`,
  then `GET /api/geocode/reverse`: the place name from `short`; in the US the state from
  `stateCodeFrom(region)`; abroad no state. It stores `locationLabel: 'Current Location'`, the
  location menu's own label, so the menu's tick shows on it.
- **City search** is `GET /api/geocode?q=`, from 2 characters, 400 ms after the last keystroke
  (as the location menu). A US result gives its state.
- **Regions** imply a state (`REGION_JURISDICTION` in `utils/utils.js`: Las Vegas → NV, Texas →
  TX, Florida → FL). Northeast US and Europe imply none, and Europe is non-US (step 2 shows no
  state select).
- **Precedence.** A worked-out state never overwrites one picked by hand (the location menu's
  `learnJurisdiction` rule). Choosing Everywhere, Northeast US or Europe clears a worked-out state
  and keeps a picked one. Picking in step 2's select makes it manual; "Not set" clears it.
- **The location menu** now does the same for a region (D10): picking Las Vegas there also
  answers the state, unless one was picked by hand.
- **Repair (B1).** `readLocalLocation()` and `fetchServerLocation()` run `jurisdiction` through
  `stateCodeFrom`. A value that needed repair ("PENNSYLVANIA" → "PA"; anything else, such as
  "ÎLE-DE-FRANCE", → null) came from a lookup, so it becomes `jurisdictionManual: false`.

## 5. Defaults, Skip, Back, Esc, and the live count

- **Defaults:** step 1 Everywhere (or what is saved); step 2 Yes; step 3 no chips. Next is always
  enabled: Next, Next, Show finishes with the defaults.
- **"Only sites open in <state>"** on a first run starts on (D3), and only when it is shown (Yes,
  a state known, in the US) does that default count as an answer. On a re-run it shows what is
  stored (off when nothing is).
- **Skip (D5)** saves the steps already confirmed with Next, as they stood when Next was pressed.
  The step on screen and any after it keep what is already saved (on a first run, nothing).
  It sets the local flag and, for an account, records `{skipped: true}`. No navigation.
- **Back** returns to the previous step with its answers intact.
- **Esc** is Skip. A click on the backdrop does nothing.
- **The count (D7)** runs `countSetup()` over App's `tournaments`: upcoming events (today or
  later), not Personal entries, not satellites or Day 2 restarts (the list's defaults), passing
  `matchesLocation`, `matchesOnline`, `matchesGames` and `matchesBuyin` — the list's own
  predicates (the game and buy-in tests were moved out of `TournamentsView` unchanged), so the
  count and the list cannot disagree. Recomputed on every answer.
- **Finish** writes the answers (section 6), tells a mounted Schedule and Calendar
  (`'onboarding-applied'`) so they change at once, sets the flag, records the answers for an
  account, and on a first run opens the Schedule (D6). A re-run stays where it is.

## 6. Storage

**localStorage** — keys and shapes unchanged:
- `savedLocation`: `{ userLocation: {lat,lng} | null, maxDistance: '<miles>' | '', locationRegion, locationLabel, jurisdiction, jurisdictionManual }`.
- `savedFilters`: the Schedule's standing choices; setup writes only `selectedGames`, `mixedOnly`,
  `buyinRanges`, `showOnline`, `onlyAvailableOnline`, and only for a row the user touched (an
  untouched row is written back as stored, so the filter sheet's Razz survives). A key at its
  default is deleted. Every other key (`siteRules`, `hideSideEvents`, …) is kept. Touching Games
  replaces `selectedGames` with the chips; `$5K+` is both `5000-10000` and `10000+`.
- Location is written (and, for an account, pushed — null clears the account's copy) when a
  location row was touched: a place, the distance or the state. An untouched step 1 leaves both
  copies alone, so finishing setup on a new device never blanks a location the account already
  has. (The spec said "always push"; see 9.)
- `onboarded = '1'`: now only this browser's **cache** of the account's answer.

**`users.onboarding TEXT NULL`** (new):
- NULL: the account has never finished or skipped setup.
- `{"v":1,"legacy":true}`: every account that existed when the migration ran.
- `{"v":2,"at":<ms>,"skipped":<bool>,"filters":{selectedGames?,mixedOnly?,buyinRanges?,showOnline?,onlyAvailableOnline?}}`:
  written by setup. No location (`saved_location` already follows the account).
- Migration `users-onboarding-2026-10` (`dataMigrations`, once, `_applied_migrations`): adds the
  column and backfills the legacy record. Accounts registered after it stay NULL until they set up.

**Compatibility promises:**
- Old accounts are never asked again (the legacy record). A browser with no local flag and no
  saved filters that used to show such a user the wizard no longer does.
- Old blobs are read as they are; every old wizard answer pre-fills the new controls exactly.
- The one repair is B1's state name (section 4).
- On a device that signs in to an account that finished setup elsewhere, `adoptServerOnboarding`
  seeds `savedFilters` from the record when the device has none of its own. The account keeps its
  last **setup** answers, not every later change made in the filter bar.

## 7. Endpoints

- `POST /api/login` adds `onboarding`: the parsed record, or null.
- `POST /api/register` (D1) keeps its 201 and `message`, and adds the login session:
  `{ token, username, userId, avatar: null, realName, handReplayerAccess: false, onboarding: null }`,
  the same 90-day JWT, and the `fg_session` cookie.
- `GET /api/user/onboarding` (any token): `{ onboarding: object | null }`; a guest gets null.
- `PUT /api/user/onboarding` (registered only; a guest gets 403): body `{ skipped?, filters? }`.
  `selectedGames`: strings of 1–40 characters, at most 30; `mixedOnly` / `showOnline` /
  `onlyAvailableOnline`: booleans; `buyinRanges`: the five known bands. Unknown keys are dropped;
  a wrong type is 400; filters over 16 KB before or 2 KB after sanitising are 400. Stores the v2
  record with `at = Date.now()` and returns `{ onboarding }`.
- Old clients ignore the new fields; a new client facing an old server (`onboarding` undefined)
  falls back to the old per-browser rule.

## 8. When setup opens, and re-runs

- **Signed in, registered:** at sign-in the record decides — null clears this browser's flag and
  setup opens (after the name prompt, if that shows); a record is adopted and sets the flag. On a
  launch with a stored session and no local flag, `GET /api/user/onboarding` decides the same way;
  if the server says nothing, the old rule (no saved location and no saved filters) decides.
- **Guests (D2):** the same three steps; the answers stay on the device; no server calls to the
  location or onboarding endpoints. Opens when nothing is saved on the device.
- **Re-run** ("Run setup again" in the location menu, or the `'reopen-onboarding'` event):
  pre-filled from the current filters, the same steps, the same writes, no navigation; it records
  the answers again.

## 9. Owner decisions

Each was built with the default shown. Status: **pending** until the owner confirms.

| | Decision | Default built | Status |
|---|---|---|---|
| D1 | Create Account signs you in (no second sign-in) | yes | pending |
| D2 | Guests see setup too (answers stay on the device) | yes | pending |
| D3 | "Only sites open in <state>" on by default on a first run | on | pending |
| D5 | Skip keeps the steps confirmed with Next | yes | pending |
| D6 | Finishing a first run opens the Schedule | yes | pending |
| D7 | A live count under every step | yes | pending |
| D8 | Registration still asks for a name and a username | unchanged | pending |
| D9 | Settings gets "Edit name" | yes | pending |
| D10 | A region picked in the location menu also answers the state | yes | pending |
| D12 | No change to iOS / Android permission strings or entitlements; city search is the fallback | yes | pending |

Builder's calls the owner may want to see (all small, all reversible):
- Location is written on finish only when a location row was touched (the spec said always);
  "Everywhere" on a re-run is a touch, so B3 is still fixed.
- The distance chips sit under the search, next to the point they apply to, not under the regions.
- Region cells and chips centre their labels (they are controls); tiles and result rows are set at
  the start (the guard classes them as tile and row).
- The edit-name dialog says [Cancel], not [Later].
- Sign in keeps `minLength` 6; only Create Account asks for 8.

## 10. Bugs fixed

- **B1** "Use my location" stored the state as a capitalised full name ("PENNSYLVANIA"), with no
  US check, marked as picked by hand: availability never matched and nothing corrected it. Now a
  postal code, US only, worked out (not manual); stored values are repaired on read.
- **B2** Re-running setup with the Schedule or Calendar mounted changed nothing until a reload, and
  the next filter toggle wrote the old state back over the answers. The views now take the
  answers at once (`'onboarding-applied'`).
- **B3** "Everywhere" on a re-run never cleared the account's copy (`if (token && loc)`), so the next
  launch restored the old location. Now pushed as null.
- **B4** A re-run replaced the whole `savedFilters` blob, wiping `siteRules`, Side Events and the
  rest. Now only setup's keys, only for touched rows.
- **B5** "Show my schedule" only closed the modal. A first run now opens the Schedule.
- **B6** "Yes" to online required a US state; a player in Europe could not answer it. Nothing is
  required now, and abroad no state is asked.
- **B7** Region picks did not set a state, yet the next step asked for one. They now imply it.
- **B8** The password hint said 6 characters while the server requires 8.
- **B9** Registering did not sign you in.
- **B10** Setup was per browser: every new device and the iOS app asked an existing account
  again, and on a shared browser a new account never saw setup (the last user's flag) and
  inherited, then pushed up, that user's location. Now per account.
- **B11** Style debt: inline size literals, `fontWeight: 600` (renders 700), a 📍 emoji,
  `var(--danger, #d66)`. Now the `.ob-*` block in `styles.css` on tokens, `Icon.mapPin`, no
  fallbacks, every block whole g × whole r and every text baseline on an r line.
- **Location race.** A view mounting right after a location PUT could GET the old copy, adopt it
  and push it back. `fetchServerLocation` now waits for a push in flight.
- **B12 (found while testing the second device): a new browser wiped the account's location.**
  The Schedule's and the Calendar's location persistence pushed the view's starting state on
  mount — on a new browser, nothing — so the account's copy was cleared before their own sync
  could read it, and no location ever followed an account to a second device. They now push
  only a change; the sync still pushes a local value up to an account that has none. (Measured
  on a scratch server: before, a fresh browser opening the Schedule left
  `GET /api/user/location` null and showed "All locations"; after, it shows the account's
  region and the server copy stands.)

## 11. Known gaps

- **Android** has no location permission in `AndroidManifest.xml`, and the **Mac** (Catalyst) app
  lacks the location sandbox entitlement, so "Use my location" fails on both (the "Location is
  off" line). City search is the fallback (D12); nothing under `android/` or `ios/` changed.
- **Home and the Calendar ignore games and buy-ins**: Home's "N events this week near you" counts
  by location only, and the Calendar starts with no game or buy-in filter. Setup's count follows
  the Schedule list, so it can be smaller than Home's.
- The reverse lookup asks Nominatim at county level (zoom 8), so the tile often names a county.
