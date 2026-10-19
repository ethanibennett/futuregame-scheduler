# futuregame scheduler (futuregame-scheduler)

The poker tournament scheduler/tracker at **futurega.me** — one of five projects in the
futuregame suite (see "The suite" below). This directory is the project's **Windows home**;
sessions opened here own scheduler work.

## Architecture (post-2026-08 reorg — the old single-file frontend is GONE)
- **Frontend**: Vite + React app in `vite-app/` → builds to `public-vite/` (served by the
  server, and wrapped by Capacitor for iOS/Android — see `capacitor.config.json` webDir).
  The legacy single-file `public/index.html` era is dead; its final tree is preserved on
  branch `wip/windows-mtt-feed`. **Two pages since 2026-10-15:** the app (`index.html`, `src/main.jsx`) and
  futurega.me/live, the ads' landing page (`live.html`, `src/live-main.jsx`, about a fifth of the app's JS).
  `live.html` is generated from `index.html` by `vite-app/scripts/make-live-html.mjs`, which `vite.config.js`
  runs on every start (gitignored; edit index.html, never live.html). Anything the landing page needs
  must be imported by it: it does not get the app's CSS or code.
- **Desktop layout**: any window >= 1024px wide (browser, iPad app, Mac app) gets a side rail +
  2 panes (Schedule = list | right pane, the selected event on top and My Schedule under it;
  the third column was dropped 2026-10-10; the two panes sit 2g apart on the background, 2026-10-13) on the SAME g as the phone (g stays 430px/37; panes
  are 9N+1 g, widened by a classic scrollbar's width where one shows). Everything narrower, and
  every phone, is the phone layout, pixel-identical. Design and per-tab plan: `docs/desktop-layout.md`.
- **Backend**: `server.js` — Express 5 + sql.js (SQLite loaded to memory, saved on write).
  `JWT_SECRET` env required. `DB_PATH` env overrides the default `poker-tournaments.db`.
  Responses are gzip/br-compressed (`compression`), except `text/event-stream` — SSE
  must stay uncompressed or events sit in the zlib buffer. `trust proxy` is 1 hop on
  Render (`RENDER` env) and off elsewhere; `TRUST_PROXY` overrides, and the first
  credential request after boot logs `[auth-limit] proxy chain …` with the suggested
  value. Login/register/forgot/reset are limited by `lib/auth-limiter.js` (10 per
  15 min, sliding, per IP and per account). `npm run test:auth-limit` boots
  `server.js` on a scratch port with a stubbed `./solver` — the pattern for any
  server test in a worktree.
- **Solver**: NOT in this repo (carved out 2026-08-09). `./solver` here is a **gitignored
  junction** → `D:\projects\futuregame-solver\solver` (server.js requires into it at
  boot for the trainer features). On Render, `build.js` clones the private
  `futuregame-solver` repo via `SOLVER_REPO_TOKEN`.
- **Mac app**: the same `ios/App` project builds a native macOS app via **Mac Catalyst**
  (enabled 2026-09-14, `docs/mac-catalyst.md`). Capacitor's Swift package ships no
  Catalyst slice, so the project overrides it with the local package
  `ios/App/capacitor-swift-pm/` whose xcframeworks are gitignored and produced by
  `scripts/build-capacitor-xcframeworks.sh` — **every** app build, iOS included, fails
  with "no such package" until that script has run once (the ship script calls it).
- **Build**: `node build.js` = vite build + solver fetch (token) or junction fallback.
  Note: `spawnSync('npm')` fails on native Windows — run `npm install` / `npm run build`
  inside `vite-app/` directly when building locally.
- **Deploy**: push to `master` → Render auto-deploys **futurega.me** (fail-loud build).
- **Hand-history I/O**: saved hands export as PokerStars-format text (PT4 / Hold'em Manager) from
  the replay's Share sheet and Hands → Export for PokerTracker — writer in
  `vite-app/src/utils/hand-history/` (pure, Node-testable), import framework in `lib/hh-import/`
  (a PokerStars-format parser; `wsop-replay` waits for a sample). PT4 analyses Hold'em and four-card
  Omaha only (not stud, draw or 5/6-card Omaha) and files them as PokerStars hands; only a hand the
  user saved or entered exports, never one that arrived by a share link. It is a second reader of the
  text quick add's fast path (`lib/quick-add/hh.js`) already reads; why they stay two, and the test
  that holds them together, are in the doc (§8). `npm run test:hh-io`; design, grammar sources and the
  owner's PT4 check: `docs/hand-history-io.md`.

## Runs 24/7 on this box (don't duplicate)
pm2 app **futuregame-scheduler** serves this checkout on **port 3001**, restarting
nightly at 05:00 (hygiene only now — the MTT feed re-ingests hourly in-process).
`pm2 logs futuregame-scheduler`. Sundays at 18:00 Task Scheduler `futuregame-weekly-graphics` runs `scripts/weekly-graphics.cmd`
(`npm run graphics:weekly`): the "This week near you" Instagram carousels + Stories for the coming
week, per region, into the gitignored `weekly-graphics/<monday>/<region>/`, logging to
`weekly-graphics/run.log`. It reads the schedule from the pm2 server on 3001. Reboot persistence via Task Scheduler
`futuregame-pm2-resurrect` (and `futuregame-tmux-resurrect` for the tmux
sessions — see "Working from the Mac" below). Don't start a second server on 3001 — test on a scratch
port with a `DB_PATH` copy. Env lives in the gitignored `ecosystem.config.cjs`
(`JWT_SECRET`, `SYNC_TOKEN`, `TESTFLIGHT_WATCHDOG`); after editing it, `pm2 restart ecosystem.config.cjs
--update-env && pm2 save`.

## Data flows
- **MTT feed (in)**: `mtt-series-watcher` emits seed JSONs to `./mtt-feed/` hourly (:15);
  `ingestMttFeed()` UPSERTs by (venue, event_number) at boot + hourly (:20), assigning
  feed rows a deterministic `stable_id` (`MTT-<venue>-<event_number>`). After each ingest,
  `pushMttFeedToProd()` mirrors the feed rows to futurega.me via
  `POST /api/tournaments/feed-sync/:token` — gated by a shared `SYNC_TOKEN` env (set on
  Render + in the local pm2 config; both sides self-disable without it). The push also
  carries `feedVenues` so prod prunes series that left the window (see Hazards). The
  nightly 05:00 restart is no longer the ingest trigger, just hygiene.
- **Venue strips**: the feed's `venue` is a SERIES title, but the UI shows the poker ROOM.
  `VENUE_MAP` in `vite-app/src/utils/utils.js` maps series → property; property names come
  from the watcher's `series_directory` table (PokerAtlas `venue_name`), never guessed.
  Since 2026-08-31 the feed also carries `property` (the room name) per row, and
  `getVenueInfo(venue, property)` derives an unmapped series' strip from THAT — the
  title-derived fallback only fires when the directory named no room (~23% of events).
  VENUE_MAP still wins where curated.
- **Venue geo**: `PROPERTY_COORDS` (keyed by strip abbr) + `getVenueCoords(venue)` back the
  location filters; a series inherits its property's coordinate. Values were geocoded via
  Nominatim (the same service `/api/geocode` uses) from `venue_name` + `city_state`; lines
  marked `city-level` are rooms OSM doesn't map by name and sit on the town centre — fine
  at the 100-mile default, replace if a tight radius matters. Each entry carries a `region`
  (US state or country code) because `LOCATION_REGIONS` tests states, not bounding boxes: a
  rectangle around Texas also catches Bossier City LA and Hard Rock Tulsa OK. Those curated
  maps win; behind them, **every live venue is placed from data** by the server
  (`resolveVenueCoords`, table `venue_coords`, `GET /api/venue-coords` → `registerVenueCoords`):
  the feed row's own `venue_lat/venue_lng`, else the room's PokerAtlas coordinates by exact
  `property` name (`data/venue-directory.json`, regenerated read-only from the watcher DB by
  `scripts/build-venue-directory.js`), else Nominatim for the room + town the source named.
  Never a bare room name or a series title. Non-US regions whose ISO code is also a US state
  code use the country name (`PANAMA`, `MALTA`), or they land in "Northeast US". The watcher
  side (per-row coordinates) is `docs/venue-coords-watcher.diff`; see `docs/venue-coords.md`.
- **Venue map**: an event card's venue strip (not online or Personal) opens `VenueMapSheet.jsx`, a
  map of the room. The provider is chosen per platform in `utils/venue-map/providers.js`: Google on
  Android, else MapKit JS, else OpenStreetMap. Each key's env is unset until the owner sets it up;
  see `docs/venue-map.md`.
- **Dashboard seams (3)** — the life-dashboard is a separate app at dashboard.futurega.me:
  - #1 notify: dashboard POSTs `/console/api/backers/notify` (ham-gated) here.
  - #2 departures: dashboard GETs `/api/schedule/:token/upcoming` (DASHBOARD_TOKEN-gated).
  - #3 roster: `syncBackerRoster()` pulls `GET dashboard.futurega.me/api/roster` hourly at
    :35 + at boot, with a **server-only `ROSTER_TOKEN`** as `Authorization: Bearer <token>`.
    Never in the URL, and never `DASHBOARD_TOKEN`: that is compiled into the iOS builds
    (`DashboardSecret.swift`) and used to guard this seam, so anyone who extracted it from an
    app could have pulled every backer's `/b/` token, phone and email (closed 2026-10-14).
    **Without `ROSTER_TOKEN` it sends nothing and logs once per boot**
    (`[roster] ROSTER_TOKEN is not set — … OFF`); a good first pull logs
    `[roster] pull from the dashboard ok`. Each pull is abandoned after 30 s
    (`ROSTER_FETCH_TIMEOUT_MS` overrides it, for tests). `ROSTER_TOKEN` is set on **exactly two
    Render services — this one (futurega.me) and the dashboard's — and deliberately NOT in the
    local `ecosystem.config.cjs`**, so this box no longer syncs. `ROSTER_TOKEN_PREVIOUS` exists
    on the dashboard only (inbound, for rotation); this side always sends the current value.
    Test: `npm run test:roster`. Spec and the dashboard half: `docs/bankroll-merge.md` §2.2
    point 10 and the dashboard's `CLAUDE.md` (seam 3).
    **Rollout order** (each step safe to stop after): generate the secret, never in chat or a
    repo; set `ROSTER_TOKEN` on both Render services (inert on the old code); deploy the
    dashboard FIRST (the leak closes the moment it is live; until the next step this side's
    pull logs `HTTP 404` and backer pages keep the roster they last synced); deploy this
    repo (its boot pull resumes the sync); then update this checkout and restart the pm2 app,
    which loads the new code and logs the sync as off, because no `ROSTER_TOKEN` is added to
    the ecosystem file.

    Generate the secret (**Mac or PC**, identical; prints 64 hex characters and nothing else):
    ```bash
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    ```
    Restart the local app after pulling (**PC (PowerShell)**, this box only):
    ```bash
    pm2 restart futuregame-scheduler
    pm2 logs futuregame-scheduler --lines 30 --nostream
    ```
    ⚠ **The local DB holds live credentials.** Until 2026-10-14 the local pm2 instance DID
    have a token and DID sync (an older version of this file said the opposite — "no token, so
    local roster sync is off by design" — and that was wrong, measurably): the local DB
    mirrors the live backer roster, including each backer's TOKEN, which is the whole of the
    authentication on their `/b/:token` page. So `poker-tournaments.db` on this box holds live
    credentials, and any copy of it does too. A scratch copy was committed to this PUBLIC repo
    on 2026-09-14 for exactly that reason. Nothing refreshes those rows now, but what was
    mirrored is still there: treat the local DB and every copy as production-sensitive.
    A rotation done in the dashboard propagates through this seam and re-keys the
    backer's data automatically — see `rotateBackerToken()`.
- **TestFlight watchdog (out)**: `scripts/testflight-watchdog.js`, scheduled in-process at
  :05/:25/:45. GitHub force-fails a build at exactly 600s when the Mac takes a queued job
  during a brief "dark wake" and then sleeps again, and nothing retries it — #91 sat
  unshipped for three days. The watchdog re-dispatches master HEAD (`repository_dispatch`,
  NEVER `gh run rerun`, which replays the run's original SHA and can make stale code the
  newest build), capped at 3 attempts per SHA, then opens a handoff issue for the Mac.
  Opt-in via `TESTFLIGHT_WATCHDOG=1` so only this box runs it; Render has no `gh` and no
  business dispatching builds. Mitigation only — the cure for the dark wake is on the Mac.
- **Nightly TestFlight build (out)** (owner, 2026-10-13): commits to master carry `[skip ci]`, so
  `scripts/testflight-nightly.js` ships master HEAD once a night instead — armed with the
  watchdog, ticking at :00/:30 from 04:00 to 09:30 Eastern, dispatching on the first tick where it
  makes sense: HEAD not already built or building, no other run live, no `.testflight-hold` at
  the repo root (fresh within 6 h), and futurega.me already serving HEAD when `RENDER_API_KEY` is
  set. Nothing new = no build; still blocked at 09:30 = the night is skipped, logged. One per
  night (`.testflight-nightly.json`). **A session merging several branches should `echo "why" >
  .testflight-hold` first and delete it when master is whole.** `TESTFLIGHT_NIGHTLY=0` turns it
  off; `node scripts/testflight-nightly.js --dry-run` says what it would do now;
  `npm run test:testflight-nightly`.
- **Online feed (in)**: `online-poker-watcher` runs its own pm2 app (a persistent
  loop, emitting at :10 past the hour and at boot) into `./online-feed/` — sources
  ACR, GGPoker, WSOP.com (bracelets + monthly Circuit rings), Phenom, and ClubWPT
  Gold. ClubWPT is TOKEN-FED (a rotating account session token in the watcher's
  gitignored `.env`); an expired token carries the ClubWPT list forward rather
  than pruning it. Ingested by
  `ingestOnlineFeed()` at boot and hourly at :20, alongside the MTT feed. **Each feed owns
  its rows through `source_pdf`** (`'mtt-feed'` / `'online-feed'`) and every operation is
  scoped by that tag — `pruneFeedVenues(keep, label, tag)`, `ingestFeed(dir, tag, label,
  idPrefix)`, and the push's `source_pdf IN (...)`. This is not tidiness: prune deletes every
  feed row whose venue is absent from the list it is handed, so an unscoped prune from one
  feed empties the other (it would have taken 1,798 live rows). `feedStableId` takes a prefix
  per feed (`MTT-` / `ONL-`) because `stable_id` is UNIQUE and two feeds can carry a series
  whose sanitised name and event_number coincide.
- **Live tournament clocks (in, on demand)**: `lib/live-clocks.js` behind `POST /api/live-clocks`.
  The dashboard polls it every 15 s for selected events past their start (and PokerAtlas-clocked
  events up to 6 h before) and drives the Level/Clock stats and the late-reg bar from the room's
  real clock instead of `estimateBlindLevel()`. Two providers, neither needing a login:
  PokerAtlas/TableCaptain over `wss://tourn-clock.pokeratlas.com` by the event's `clock_ref`
  (`pa:<tc_id>`, carried by the MTT feed since 2026-09-29), and Bravo's
  `GetClocksByCasinoDetailID`, with the room found from the venue's coordinates in Bravo's
  roster and the event matched by event number. Recon and payloads:
  mtt-series-watcher `docs/pokeratlas-clock.md` and `docs/bravo-tournaments-blocker.md`.
- **Backer surface stays here**: `/b/:token` public pages, Sunday weekly digest, backer
  web-push (`backer_push_subs`), `console_records` store='backers' (fed by seam #3).
  The page is the vite app since 2026-10-13 (`components/BackerPage.jsx`, rendered by App.jsx's
  `Root` before any login; arithmetic in `utils/backer-page.js`): the server serves the app shell
  to valid tokens only, `no-store` + `noindex` + `Referrer-Policy: no-referrer`, with the manifest
  link dropped (a Home Screen launch must return to the page). `/b/sw.js` and the
  `/api/backer/*` push routes are unchanged. **Theme** (owner, 2026-10-14): the top bar carries the
  app's own theme button (`ThemeButton`; dark, dusk, light, cloudy; `hooks/useThemeChoice.js`, shared with
  `App.jsx`, so one device has one preference, `localStorage['theme']`). With nothing stored the page
  follows the device's scheme and writes nothing; the first press is a choice. Contrast always follows the
  device. Cloudy darkens the page's green and red (`backer-page.css`). `index.html`'s head script applies a
  stored theme before first paint. `scripts/seed-backer-demo.js` seeds made-up backers
  into a SCRATCH DB and prints the `CHECK_BACKER_TOKENS` the guards use to visit the page.
  The page shows the player's **bb/hr** (BB/hr for limit games; owner, 2026-10-14) in the total card and
  on each session line, worked out in the browser from the feed's events with `utils/bb-hr.js` — the feed
  itself gained nothing, and the parity tests still compare it byte for byte. The owner's Backers tab
  shows the same figure from `played` on `GET /api/staking/standing/backers`. Definition, units and
  owner questions: `docs/bankrolls.md` "bb/hr".
  **Session cards are the Schedule's card** (owner, 2026-10-15): `SessionCard` renders CalendarEventRow's
  markup and classes (date and hours as the time, the share as the buy-in, the game as the title with the
  room as its stage line, bb/hr as the late-reg line) and opens like it, to the figures and the owner's
  **notes**: the feed carries `notes` from the result a share points at (`backer_events.ref_table/ref_id`),
  only when there are any (importer lines excluded), so a page without notes is byte for byte unchanged.
  `npm run test:backer-page` holds it; the guards' `backer-page-notes` views open cards from the seed.
  The line under the game is the session's own **subheading** (`subtitle` on `tracking_entries` and
  `cash_sessions`, added at every boot if missing; "Subheading" in the result and cash forms; the feed
  carries it only when set). bb/hr sits under the share; hours read "6h". The total card ends in a
  **settlement bar** counting down to Sunday noon Eastern (`settlementCountdown`). A device signed in to
  the app as an admin gets the app's "#" grid toggle on the page (shared `localStorage.gridOverlay`).
  **Live beacon** (owner, 2026-10-16): while the player is at a table, a "Playing now" card under the name
  (the game or event, the room, since when; never money). `GET /api/backer/:token/live` (`lib/backer-live.js`:
  a live cash session under 24h old, or a tournament whose latest live update is neither a bust nor a bag,
  under 20h old, with no result logged), polled each minute while the page is visible; the player is the
  backers row's owner, else the console owner; a token no roster knows is a 404. The feed is unchanged.
  Test: `npm run test:backer-live` (in `test:backers`).
  **Settled** (owner, 2026-10-19; `lib/staking/backer-settle.js`, wording in `utils/backer-settle.js`): a
  Settled button under the page's settlement bar and on each Bankroll › Backers card. The first press opens
  a settlement for the balance that side was shown (`backer_page_settlements`, keyed by the link; NOT
  `backer_settlements`, which is the series settlements'); the other side's press completes it, the
  running total subtracts it everywhere (`backerCumulativeCents`) so the page reads $0, and one `settlement`
  adjustment goes into the player's Main (`'bks:<id>'`, whole dollars). A share landing between the presses
  voids the half-confirmed one; either side can undo before the other presses. `POST /api/backer/:token/settle`
  (the link, rate limited) and `POST /api/staking/standing/backers/:id/settle` (owner; the card's id, never a
  token), both `{ action: 'confirm'|'undo', amountCents }`. **Notices** (owner): the player ALWAYS hears of the
  backer's press, undo or completion (`sendPushToAdmin`: web push + the native app); the backer hears of the player's
  only through their page's push subscription (`sendBackerPush`, gated by `BACKER_DELIVERY`). Nobody hears of their
  own press or of a repeated tap (`notifySettle` in server.js). Test: `npm run test:backer-settle`.
  **Bankroll merge, Phase 2** (`docs/bankroll-merge.md`; code in `lib/backer-surface.js`):
  - **Delivery is gated.** Push, SMS and the Sunday email go out only where `BACKER_DELIVERY` is on
    (default: on when `RENDER` is set; `BACKER_DELIVERY=1|0` overrides; a typo is off). This box has
    neither, so it can never message a backer. Every boot logs `[backers] delivery is ON|OFF`.
  - **The page's source is a switch, off by default.** `BACKER_PAGE_SOURCE=sql` makes the feed read
    the `backers` table and standing agreements first, with `console_records` as the fallback for a
    token no `backers.public_token` owns. Unset, it is the dashboard-era path, byte for byte. Run
    `GET /api/staking/standing/parity` (owner only) before flipping it: `differ` lists the pages it
    would change, by backer id, never by token.
  - **"New link"** is `POST /api/staking/standing/backers/:id/rotate-link`. Until the roster seam
    retires, a leaked link is best replaced in the dashboard: a later dashboard edit of that backer
    would send the old token back and the roster sync would rotate it back.
  - **The Notify tap** (built ahead of Phase 7; `lib/staking/notify.js`, `components/BackerNotify.jsx`).
    The owner sends a saved result's backer shares from a tournament result's edit form or a cash
    session's page, through `POST /api/staking/standing/notify` (owner only; the client sends
    `{ refTable, refId }`, never a figure).
    - **A manual tap (Q1):** nothing posts on save. A second tap on an unchanged result sends nothing.
    - **Where the shares come from:** the stakes of the roster in `console_records`, plus, under
      `BACKER_PAGE_SOURCE=sql`, the `backers` rows that own a link.
    - **What is recorded:** `backer_events` rows with `source='ledger'` and id
      `<token>:fg-te-<id>` / `fg-cs-<id>`, born delivered, so the sweep never resends them. Delivery
      goes through the gated senders.
    - **Every result write path calls `followShares`:** a notified result's shares follow an edit
      and are voided on delete, silently (Q2), with a revision row each time.
    - **The dashboard overlap:** a share the dashboard already sent that backer on that date, or a
      series agreement on the event for a backer of the same name (Q7), needs a second confirm.
      The dashboard's own Notify does NOT check this app's shares, so notify a night from one app
      only.
    - Spec: `docs/bankroll-merge.md` "Notify tap".
    - Tests: `npm run test:notify-tap` (ports 4600-4609, also in `test:backers`). The guard views
      `results-notify*` and `cash-notify*` are staged by `scripts/notify-states.mjs`, which never
      lets a tap through.
  - Tests: `npm run test:backers` (surface, rotation, parity, the Backers view, the Notify tap),
    booting on ports 4540-4549 and 4600-4609.
  **Bankroll merge, Phase 3: series settlement** (`docs/bankroll-merge.md` §10; code in
  `lib/staking/settlement.js` and `settlement-routes.js`; the panel's logic in
  `vite-app/src/utils/staking-settlement.js`):
  - **The server computes every figure.** Backers pay for their piece up front (owner, Q11), so
    `owed = share of cashes − (piece price − prepaid)`; + = the player pays the backer. Settle stores
    one row per agreement with a snapshot, and a settled series is read back, never recomputed.
  - **Paid writes one `settlement` row** into the series' bankroll (`staking_series.bankroll_id`,
    NULL = Main), `settlement_ref 'bs:<id>'`; unpaid deletes it.
  - **The disputed type meanings are switches**: `STAKING_SETTLEMENT_RULES` (JSON; crossbook as a bet
    or a swap, swap and profit-share bases, budget and package refunds, makeup prepaid). Unset = the
    defaults; every boot logs `[staking] settlement rules: …`. The owner's questions are §17.1.
  - Tests: `npm run test:staking-settlement`, booting on ports 4570-4579. The guards' staking
    settlement views need `scripts/seed-staking-demo.js <scratch.db>` first.
  **Bankroll merge, Phase 5: the dashboard import** (`docs/bankroll-merge.md` "Phase 5: as built";
  code in `lib/money-import/`): owner-only JSON routes under `/api/bankrolls/import/dashboard` (fetch,
  plan, decisions, commit, undo, discard); Phase 6 builds the review screen on them.
  - **The pull is server to server.** `GET DASHBOARD_BASE_URL/api/money-export` with
    `Authorization: Bearer <LEDGER_TOKEN>`, never in a URL or a log. `LEDGER_TOKEN` is set on exactly
    the two Render services and **not** in `ecosystem.config.cjs`; unset or under 32 characters, the
    pull is OFF and every boot logs `[money-import] the dashboard pull is OFF: …`. A pull is checked
    (count, per-store counts, sha256 hash) before it is staged, and nothing is written on fetch.
  - **A commit needs the `planHash` the owner reviewed** and refuses (409 `stale`) if the database
    moved since; one savepoint. **Undo replays the run's journal** and refuses an edited row, listing
    it. A delta re-pulls from the last cursor less 14 days.
  - Tests: `npm run test:money-import` (a stub dashboard in the test process), ports 4610-4619.
  **Bankroll merge, Phase 6: the import review** (`docs/bankroll-merge.md` "Phase 6: as built"; code in
  `vite-app/src/components/BankrollImportDashboard.jsx` + `utils/bankroll-import-dashboard.js`):
  Bankroll › Import (a section chip since the dashboard sheet retired, 2026-10-16), "From the dashboard app", owner only (it hides itself on the routes'
  403). Fetch, the review (pairs, backers, slate, balances, a delta's changes and deletions, the
  opening, the reconciliation, errors, flags), answers saved as given, Import behind a confirm step that
  names every table, Undo behind the typed row count. **A 409 `stale` reloads the plan and highlights
  what moved; the same hash is never resent.** Seed a scratch DB with
  `scripts/seed-money-import-demo.js` (server stopped; refuses `poker-tournaments.db`); for the guards'
  walk (`check:controls` / `check:clipping` `bankroll-import-dashboard`, which imports, undoes and
  fetches again) serve `scripts/money-import-stub-dashboard.js` and boot the scratch server with its
  `LEDGER_TOKEN` + `DASHBOARD_BASE_URL` + `CONSOLE_OWNER_USER_ID`. Tests: `npm run test:money-import`
  (engine + helpers) and `npm run test:money-import-review` (WebKit, ports 4620-4639; needs the built
  app). Trap: innerText reads `an-sec` headings in capitals, so Playwright matches must ignore case.
  **Bankroll merge, Phase 7: standing shares live** (`docs/bankroll-merge.md` "Phase 7: as built"; code in
  `lib/staking/live.js` + the routes in `standing-routes.js`): the money state and its switch
  (`GET`/`PUT /api/bankrolls/money/cutover`, owner only; **unset posting is ON**, only an explicit `off`
  refuses the Notify tap; `cutover: 'live'` stands the roster sync down and ends the feed's roster
  fallback), the Q7 answer stored (`standing_result_answers`, the tap's `answers` body), exclusions,
  a dashboard share's recalc and remove, the drift report and apply, the agreements' routes (list,
  create with a minted link, update, stakes from-today / correct with preview, delivery, events) and
  the unsaved-result preview. Every write path follows a notified share silently, the Personal-row
  admin edit and the import's undo included. Tests: `npm run test:standing-live` (ports 4680-4689).
  **Bankroll merge, Phase 8: the standing UI** (`docs/bankroll-merge.md` "Phase 8: as built"): the Staking
  tab's **Standing** view (`components/StandingView.jsx`, `standing.css`, `utils/standing-ui.js`): the
  agreements with Stakes (from today / correct with preview), Shares (exclude, recalc, remove), Delivery,
  New link, End, + Add (an existing or a new backer, minted a link shown once); the owner's money state
  and drift box. The Notify block's series flag asks Both / Series only (stored). "Posts to backers" under
  the result and cash forms (`PostsToBackers.jsx`, the owner only). Seed: `scripts/seed-standing-demo.js`;
  guards `staking-standing*` (controls) and `staking-standing` (clipping).
  **Bankroll merge, Phase 9: the owner API and deep links** (`docs/bankroll-merge.md` "Phase 9: as built";
  `lib/owner-api/`): `GET /api/owner/money` and `POST /api/owner/sessions/log` behind `LEDGER_TOKEN`
  (`lib/shared-token.js`, constant time; 404 / 503 / 60 a minute; OFF until the token is set, the boot
  line says). The session log is the dashboard's `normalizeSession` verbatim, written through the import's
  mapping with the id as its `bankroll_import_keys` fingerprint (told twice = one row). Deep links
  `#bankroll/<tab>`, `#results/…`, `#staking/standing`, `#tax` (`utils/deep-links.js`, admins only).
  Tests: `npm run test:owner-api` (ports 4690-4699).
  **Bankroll merge, Phase 10: money homes** (`docs/bankroll-merge.md` "Phase 10: as built";
  `lib/money-homes.js`): the WSOP fund is a bankroll's Role (Manage bankrolls: target and day; one fund
  per player, outside the roll), shown with its pace in the Overview's Bankroll section; "Where the money
  is", a seventh Overview section of counted places against the ledger; the tax report's set-aside line
  (`money_settings.taxSetAsidePct`, default 30). `GET /api/bankrolls/money/homes`, `PUT …/locations`,
  `PUT …/settings`. Tests: `npm run test:money-homes` (ports 4710-4719).
  **Bankroll merge, Phase 14: standing payouts** (`docs/bankroll-merge.md` "Phase 14: as built";
  `lib/staking/payouts.js`): a payout to or from a standing backer, with its settlement adjustment
  (`'sp:<id>'`); a backer's running total is shares + opening − payouts everywhere
  (`backerCumulativeCents`), and the feed carries `paidCents` only when there are any. The Standing card's
  Payouts. Tests: `npm run test:standing-payouts` (ports 4730-4739).

- **App Store purchases** (launch plan, action 10; `lib/billing/apple.js`): Apple's signed transactions and
  Server Notifications v2 are verified offline against Apple Root CA - G3 (`lib/billing/AppleRootCA-G3.cer`)
  and written to `subscriptions` (source `apple`, one row per original transaction), so a plan bought in
  the app holds on the web. A purchase is tied to the account by `users.app_account_token`.
  `GET /api/subscription/apple/account-token`, `POST /api/subscription/apple/verify`, `POST
  /api/subscription/apple/webhook`. Product ids: `docs/app-store-listing.md`. Test: `npm run
  test:apple-billing` (a TEST ONLY chain in `test/fixtures/apple-test-chain`).
- **Parser eval from Admin** (`lib/admin-eval.js`): `POST/GET /api/admin/quick-add-eval` (app admins) runs
  `test/quick-add/eval.js` in the background with the server's own ANTHROPIC_API_KEY, one run at a time;
  the Admin screen's "Hand parser, live eval" section starts it and shows the report.
- **Growth measurement** (launch plan, action 5; `lib/growth.js`): `growth_events` (`signup` with its
  source: the browser's first touch from futurega.me/live `?ct=`, the web app's `?src=`, the platform and
  the sign-up form's "How did you hear about us?"; `activated` = the first event saved to My Schedule,
  once) and `user_days` (an account active that UTC day, written by `authenticateToken`). The weekly
  cohort report (sign-ups, activated within 7 days, D7, D30, by source) is `GET /api/admin/growth`
  (app admins). No SDK, no ATT prompt. Test: `npm run test:growth`.

## Hazards
- ⚠️ **Junction hazard**: checking out any pre-carve branch (e.g. `wip/windows-mtt-feed`)
  materializes tracked `solver/` files THROUGH the junction and clobbers
  `D:\projects\futuregame-solver`'s working tree on switch-back. Use `git worktree` for
  old branches. Recovery: `git -C D:\projects\futuregame-solver checkout -- .`, then
  `New-Item -ItemType Junction -Path D:\projects\scheduler\solver -Target D:\projects\futuregame-solver\solver`.
- `poker-tournaments.db` is untracked runtime state owned by the pm2 app. Never commit it.
- ⚠️ **Scratch servers leak.** Every server test and guard run boots its own `server.js -r
  ./test/stub-solver-preload.js`; an agent cut off mid-run, a shell job killed at its time limit, or a
  test that dies before its teardown leaves that copy running, each holding a whole DB in memory. On
  2026-10-14, 53 of them had piled up (RAM at 86%), which made later guards crash and re-run. **After any
  test or guard work, kill them** (the pm2 app is never started with the stub, so it is untouched):

  **PC (PowerShell):**
  ```bash
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'stub-solver-preload' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  ```
- The MTT-feed mirror reconciles deletions: the push carries `feedVenues` (the series we
  still hold) and the receiver prunes feed rows outside it. Pruning **never** touches a row
  referenced by `user_schedules`, `tracking_entries`, `live_updates`, `schedule_conditions`,
  `backer_event_*` or `swap_suggestions` — a series leaving the window usually means it
  ENDED, and those are exactly the events someone has results for. Prune is skipped
  entirely unless the push actually upserted rows, so a malformed payload can't empty
  production.
- Console/dashboard code was stripped (PR #44, 2026-08-10) — don't re-add console routes
  here; that's the wsop-console repo's job.

## The suite (each repo's CLAUDE.md is its handoff — open a session in that directory)
| Project | Windows home | Repo |
|---|---|---|
| scheduler (this) | `D:\projects\scheduler` | futuregame-scheduler |
| solver | `D:\projects\futuregame-solver` (grind runs in the WSL twin) | futuregame-solver |
| cash watcher | `D:\projects\cash-game-watcher` | cash-game-watcher |
| mtt watcher | `D:\projects\mtt-series-watcher` | mtt-series-watcher |
| dashboard | `D:\projects\wsop-console` (prod on Render + WSL standby) | wsop-console |
| online watcher | `D:\projects\online-poker-watcher` | not yet on GitHub (pm2: `online-poker-watcher`) |

The Mac is the Xcode build node (iOS/Watch/screensaver) — see `docs/mac-build.md`.
Ship the app with `./scripts/ios-testflight.sh` there (NOT `deploy.sh --ios`, which
also pushes master, deploys Render and syncs the prod DB — none of it the Mac's job).

### Working from the Mac without the Mac mattering
The Mac SSHes into this box over Tailscale (`ethans-macbook-pro` 100.108.175.125
→ `ethanibennett-windows11` 100.69.155.34) and is **only a terminal** — every
pm2 service, the DB and all web deploys run here regardless of whether it is
awake. The one thing that used to die with the connection was the interactive
Claude Code process, because it was a child of the SSH session.

**Every session must start inside tmux.** A session started outside it dies
with the SSH connection, which is why a Remote Control session list is mostly
`offline` — Remote Control can reach a session, it cannot keep one alive. The
tmux server daemonizes (measured: PPID 1), so a sleeping Mac only detaches the
view. Verified on this box: a session survived 37 hours of sleeps and lid
closes.

The Mac's `~/.ssh/config` does it, one block for every project, because
`RemoteCommand` expands `%n` to the alias you typed and that becomes the tmux
session name:
```
Host sched solver cash mtt dash
    HostName ethanibennett-windows11.taileddf2e.ts.net
    User ethan
    IdentityFile ~/.ssh/id_ed25519_win
    IdentitiesOnly yes
    RequestTTY force
    RemoteCommand C:/msys64/usr/bin/bash.exe -l /d/projects/scheduler/scripts/ssh-tmux.sh %n
    ServerAliveInterval 30
    ServerAliveCountMax 6
    TCPKeepAlive yes
```
`ssh sched` creates or reattaches; `-A` covers both. `scripts/ssh-tmux.sh` wraps the
attach in `script` because Windows' sshd runs the command through PowerShell (its
DefaultShell), which hands MSYS2 a console instead of a pty, so a bare `tmux attach`
fails "open terminal failed: not a terminal" (2026-10-07; the alias had drifted to a
WSL Ubuntu tmux with no Claude in it). Forward slashes in the path on purpose: the
quoting layers between the Mac and PowerShell eat backslashes. Keep a plain `Host win`
with neither `RequestTTY` nor `RemoteCommand`, because `RemoteCommand` breaks
`scp` (or pass `-o RemoteCommand=none`).

Day to day none of that is typed: the sessions stay up, so the Mac app, the
phone and claude.ai reach them directly. SSH is only the bootstrap. A drop
still loses whatever step was mid-flight — tmux keeps the process and
scrollback, it does not replay an interrupted tool call.

**Reboots** are the one thing tmux cannot survive, so `scripts/tmux-resurrect.sh`
rebuilds the five sessions at logon via Task Scheduler
`futuregame-tmux-resurrect` — the tmux half of what `futuregame-pm2-resurrect`
does for pm2. It cd's each session to its project and starts `claude`
(`START_CLAUDE=0` to get bare shells instead). The cd is sent as a KEYSTROKE
rather than passed as `tmux new-session -c`, because MSYS2's login shell sources
/etc/profile which cd's to $HOME a moment after the session starts and
overwrites it — the symptom is Claude opening on `C:\Users\ethan` and stopping
at a trust prompt.

MSYS2 exists **solely** to host tmux; the session still drives Windows-native
node, git, gh and pm2 (`/etc/profile.d/zz-windows-toolchain.sh` puts them on
MSYS2's deliberately-minimal PATH). tmux could not be dropped into Git Bash
instead: Git Bash ships msys-2.0.dll 3.3.6, MSYS2's tmux is built against 3.6.9,
and that runtime is not version-portable — replacing Git Bash's copy breaks Git
Bash. Pair it with `caffeinate -i ssh …` on the Mac, since not dropping beats
recovering.

### Cross-machine handoff
Claude Code sessions are per-machine and cannot message each other, so machines
coordinate through GitHub issues: `./scripts/handoff.sh`.
```bash
./scripts/handoff.sh inbox                        # open items for THIS machine
./scripts/handoff.sh send mac "Ship a build"      # ask the other side to do something
./scripts/handoff.sh read 42 / reply 42 "…" / done 42
```
Open issue = the other machine still owes you something; `done` closes it. **Check
`inbox` at the start of a session on either box.** Messages carry INTENT, not code —
code moves through commits, and the machine split stands: Windows owns the server,
DB and web deploys; the Mac only builds the app.
Pre-reorg session history: this repo's git log, plus the solver-era session log preserved
at `futuregame-solver/docs/legacy-scheduler-era-CLAUDE.md`.

## Quick start (dev)
```bash
npm install
cd vite-app && npm install && npm run build && cd ..
JWT_SECRET="dev-secret" PORT=3199 DB_PATH=./dev.db node server.js
```

## Conventions
- Event naming: WSOP style — NLH/PLO/HORSE abbreviations, no acronym periods, title case,
  "- Day 1"/"- Flight A" suffixes; include format only when distinctive ("7-Max", "Freezeout").
  Six-card PLO hi-lo is **"PLO6 8/b"**, never "Big Easy" (owner, 2026-10-14); keep "Big Easy" only as an
  input alias for old saved hands. "Big Easy Casino" is a venue and keeps its name.
- "Opponent" not "villain". Card notation `AhKs`, suits h/d/c/s, x = face-down.
- Dropdowns/panels use portals to document.body to escape stacking contexts.
- **Pills and buttons** (owner rule, 2026-10-10): the CONTAINER sits on the grid (whole g × whole
  r, edges on grid lines); the LABEL inside is centred vertically and horizontally, ignoring the
  grid — no baseline seating, text-box-trim or metric nudges inside a control. Every other piece of
  text still seats its baseline on an r-line. The tools (top of the Pills-and-buttons block in
  `styles.css`): `.ctl` flex-centres a control; a label in the display face takes `.ctl-cap` (the
  one trim allowed inside a control — Baskerville's line box is not centred on its capitals, so it
  CENTRES, never seats); a content-sized pill (a username, a count) takes class `snap-g`
  (`snap-g-centred` when centred in its parent), which `utils/grid-snap.js` rounds up to whole g.
  Guard: `npm run check:controls` (WebKit, phone + desktop; `CHECK_BASE_URL` / `CHECK_TOKEN_FILE`
  to aim it at a scratch server) measures every control's box against the grid and its label's
  ink centre against the box's (0.75px); run it before deploying any control change.
  **Font metrics must match across platforms** (2026-10-11): Univers shipped with hhea
  ascent/descent 724/276 but OS/2 win ~969/250. Apple (Safari, iOS, the Mac app) builds line
  boxes from hhea, WebKit on Windows (where the guards run) from win — so every centred label
  passed the guard and sat ~14% of its font size high on the owner's devices. The font files
  now carry hhea == typo == win with no line gap; `npm run check:fonts`
  (scripts/check-font-metrics.py, fontTools) fails if any shipped font diverges. Any new or
  replaced font must pass it, and bump the `?v=` on its `@font-face` URL.
- **Clipped text guard**: `npm run check:clipping` (WebKit, phone + desktop) fails on any glyph cut
  off by a clipping ancestor — the descender bug that kept recurring. Text that truncates must
  get its painted room from padding cancelled by an equal negative margin (or a clip-path that
  reaches below the box), never from `overflow-x: clip; overflow-y: visible`, which WebKit
  clips on both axes. Run it before deploying any change to card or list text.
- **Replayer motion is springs**: the flop deal and spread, the turn/river landing, wagers
  pushed out and swept in, and the pot shipped to the winner run on ONE spring family (the
  launch ads' Remotion numbers): `vite-app/src/utils/spring.js` (pure, `npm run test:springs`)
  and `replayer-motion.js` (the registry and the moments). They play as Web Animations on
  transform/opacity, computed once per moment. `localStorage.replayerSprings` unset is Set B
  "snappy" (the default, owner 2026-10-13); '1' Set A, '2' Set B, '0' the old code paths. Exports
  seek them frame by frame (the bet push-outs export settled). Work a moment builds after its press
  belongs to that moment's generation (`MotionRegistry.defer`); `scripts/check-replayer-ship-once.mjs`
  guards the Back/Forward double ship.
  Before/after video: `scripts/capture-replayer-motion.mjs` + `compare-replayer-motion.mjs`.
  See `docs/replayer-springs.md`.
- **The Swiss theme** (owner, 2026-10-16; app admins only): `swiss-light` and `swiss-dark`, in the theme button's
  cycle only for an admin (`utils/theme.js` themeOrder/nextTheme), and shown only to one: `hooks/useThemeChoice.js` gives anyone else
  the standard theme when Swiss is stored on the device (signed out, a non-admin, a backer page), keeping the stored choice. Every style is `vite-app/src/theme-swiss.css`,
  scoped to those two values; the markup hooks it needs render nothing elsewhere (`components/SwissParts.jsx`:
  sentence-case strips, the raised currency mark, the Board density; `utils/swiss-typography.js`: real minus, dashes
  and apostrophes on screen; `utils/swiss-share.js`: the share images). The 47 picks it implements are the catalogue
  https://claude.ai/artifact/PaDqr8bjZWLX2ByoFuDKiE (not taken: 12, 33, 42). Its controls are flush left by design,
  so `check:controls` with `CHECK_THEME=swiss-light` reports their labels off centre; `check:clipping` must pass.
- **Design tokens**: type, spacing, radius, elevation, brand, motion and focus
  tokens live at the top of `vite-app/src/styles.css` — see `docs/design-tokens.md`
  for the steps and what each replaces. Never write a bare literal for anything a
  token covers. Migration off the ~3,900 existing literals is in progress; the
  checklist at the foot of that doc tracks it.
- Update this file when architecture or suite topology changes — it is the handoff.
- **Session state** lives in `docs/session-handoff.md` — what shipped recently,
  what is waiting on Ethan, published artifact URLs, and the traps that have
  already cost time (derived columns, feed-owned rows, deliberate naming rules).
  Read it at the start of a session; update it at the end of a substantial one.
