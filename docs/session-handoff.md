# Session handoff — scheduler

Rolling handoff for a fresh Claude Code session on this repo. CLAUDE.md is the
*architecture* handoff (topology, hazards, conventions); this is the *state*
handoff — what just changed, what is waiting, and the traps worth knowing before
touching any of it.

Last updated: 2026-10-14 (from Windows) — see the 2026-10-14 section first. Earlier notes: 2026-10-13, then 2026-09-30, live
tournament clocks + the event audit fixes (below). Before it, 2026-09-28, the
Dashboard grid pass + Schedule header-peek fix (`df32787`, pushed to master).
Below it the 2026-09-25 Schedule grid sweep, then the dated sections back through
2026-08-30; "Seams to the dashboard" and "The build pipeline" were added from the
wsop-console side and verified against both live services.

---

## 2026-10-14 — Locations live; date pills, Sessions and Trend in their last rounds
- **Live:** the bankroll **Locations** tab (52e0895: ITM per entry; a mixed room says "won/ITM" and only
  plain "won" is toned green/red), the venue map (0b0d08e), and build.js reinstalling vite-app deps on
  Render when the lockfile changes (aeb710b).
- **Ready to merge after its guards:** the date-pill fix (branch `fix/date-pill`, worktree `date-pill`).
  Labels centre their INK, read from canvas pixels by `utils/ink-balance.js` (WebKit clamps
  measureText's bounds to the advance). The controls guard now waits for the layout to settle, which
  was the cause of the recurring false "10 Oct" failure.
- **In their final rounds:** the Sessions tab, the Trend overlays, the parser corpora (100 written + 136 spoken real hands; hardening
  next), and the queued features (home customization, onboarding, hand-history export). **Ads are
  PAUSED** (owner, 2026-10-14: "an excellent proof of concept"; memory `ads-paused` has the state of
  each). Catalogue three's specimens and page are on hold too (it was the biggest spender, 6.4M tokens).
- **Model policy (owner, 2026-10-14):** where Opus is not needed, delegate to Sonnet or Haiku. Set
  `model` on every agent; one build plus one check per job (memory `model-delegation`).
- **Trap: scratch seed tokens expire after 12 h.** `setup.cjs` signs `token.txt` with `expiresIn: '12h'`.
  A guard run with an expired token silently skips most views and still prints "all N controls on the
  grid" (21 controls instead of about 600). Check the skipped count and the JWT `exp` before trusting a
  pass. Every scratchpad token was re-signed for 72 h on 2026-10-14.
- **Owner answers wanted:** the parser's 47 questions (page in the table below) and the launch plan's
  7 open questions (its section 16).
- **Loose end:** `overviewStats().mtt.itm` (bankroll-ledger.js) still counts ITM per event; nothing on
  screen shows it, but the owner's rule is per entry. Fix after Sessions and Trend merge (same file).

## 2026-10-14 — Replayer springs merged (Set B the default)
- The flop deal and spread, the turn/river landing, wagers pushed out and swept into the pot, and
  the pot shipped to the winner run on one spring family, the launch ads' Remotion numbers
  (`utils/spring.js`, `utils/replayer-motion.js`, `docs/replayer-springs.md`). Web Animations on
  transform/opacity, computed once per moment; no per-frame JS. Master is merged in (desktop layout,
  venue map, backer page).
- **Flag** `localStorage.replayerSprings`: unset is **Set B "snappy", the default** (owner,
  2026-10-13); '1' Set A "house"; '2'/'snappy' Set B; '0' today's code paths unchanged. Reduced
  motion turns it all off (same animation set as flag '0' under reduce, no Web Animations).
- **Round 3 fixes** (the two reviews' "must"s and the lead's "should"s): the pot never dips at the
  result (each river ghost carries its wager less the showdown's uncalled return, and the figure never
  reads below the press's: 122K, 157K, 197K); one ship per result press (deferred work is the
  moment's generation, `MotionRegistry.defer`; `scripts/check-replayer-ship-once.mjs`); the ship is
  the pile's own chips, not gold coins, landing at the coin's size on a big table; the winner's plaque
  takes its gold at the hit with a ::after glow (opacity only); the board's springs and the pile's new
  row are built in the frame after the press (the board held as seen until then); one ship clip box.
- **Owner rules re-measured**: exports keep the motion except the push-outs, and match the live
  replayer at every seeked instant (0-0.12px); the pot lands on the winner's plaque edge nearest the
  centre, never on the name, at all 46 seats; seat geometry 0.00px against flag '0'.
- **Frame cost**: see `docs/replayer-springs.md` "Frame cost" (round 3 numbers, traced and at 4x).
- **For the Mac / iPhone** (not checkable here): Safari and the Catalyst app at 1440 with Web
  Inspector's timeline on the flop, the result and Forward-mashing (Playwright's WebKit on Windows
  rasterises in software and starves frames, a frame every ~300ms during a moment); an iPhone export
  (no card face missing in a seeked frame of the flop or the result); the plaque's gold glow and the
  board appearing on its first frame after the press on a real device.
- **Merged and deployed 2026-10-14.** The final side-by-side videos (today vs Set B) are in
  `weekly-graphics/replayer-springs/final/` and were sent to Ethan. It reaches TestFlight with the nightly build.
- Trap: in a Playwright capture, press and pin animations in ONE `page.evaluate`, and pin at 0 until
  every animation has its start before running the clock — the page clock does not drive the
  document timeline, and the registry times an arrival from its animation's real start. And a probe's
  "settled" must wait for the registry too (`entries`, `ticks`, `deferred`), not just
  `getAnimations()`: the ship is built a few frames after the press.

## 2026-10-13 — Shipped: home, Overview tables, centring sweep, scroll parity; nightly TestFlight
- **Live on master:** desktop Schedule scrolls like the phone (79a82c3); the mirrored detail-panel motion
  (`utils/detail-motion.js`); the centring sweep (490 controls + venue strips, 9b142b5; the guard now
  visits 102+ views); the rebuilt home + Overview tables (b2ade74: To log, Last result, bankroll line,
  period block, goals, scoped typed "Delete results" with a server guard on `DELETE /api/tracking`).
- **Nightly TestFlight** (91dcce7, CLAUDE.md "Nightly TestFlight build"): from 04:00 ET, ships master
  HEAD once a night when nothing is in the way. **Merging several branches into master over time? Write
  `.testflight-hold` (with a reason) first and delete it when master is whole.**
- **In flight at the end of the day:** replayer springs (worktree `wf_47e1730e-7b7-1`; owner chose
  **Set B** as the default — done on the branch, see the section above; exports animate everything
  except bet slide-outs; pot chips land on the winner's plaque edge, never across the name); the
  bankroll Locations tab (worktree `wf_f6462427-c7b-1`, based on an older master — needs a merge); the
  venue-strip map popup (worktree `venue-map`, branch `feat/venue-map` off `merge/home-tables`:
  MapKit JS when keyed, Google Maps JS on Android when keyed, OSM fallback).
- **PAUSED at 94% weekly usage (evening 2026-10-13) to finish the backer page:** springs final review
  (resume `weekly-graphics/replayer-springs.workflow.js`, run wf_47e1730e-7b7; then switch to Set B,
  merge, send the comparison videos); Locations (workflow script bankroll-locations-tab-wf_f6462427-c7b,
  worktree wf_f6462427-c7b-1); venue map (worktree `venue-map`, branch feat/venue-map, uncommitted
  work — it was re-running the My Schedule guard views at 1440). Backer page: branch
  `feat/backer-page` (worktree `backer-page`, 627fa70) — merge with master, deploy.
- **Queued (owner, 2026-10-13):** onboarding questions refinement; an s-points calculator on events
  whose structures are available (confirm what "s-points" means with Ethan first); letting the user
  change and reorder what the home (Dashboard) shows. **Also queued:** Sessions list and Trend chart (bankroll); WSOP.com hand-history IMPORT (the
  WSOP.com client keeps hands on WSOP's servers behind a replay viewer and writes no files, so
  the import reads that viewer's replay data — never account scraping; `lib/hh-import/wsop-replay.mjs`
  waits for a sanitised HAR from Ethan, `docs/hand-history-io.md` §9); catalogue three (replayer
  polish, ~25 agents — ask first, it is the biggest spender). Ads are paused (memory `ads-paused`).
- **(2026-10-13) Hand-history export built** (branch `feat/hand-history-io`): saved hands as
  PokerStars-format text for PokerTracker 4 from the replay's Share sheet and Hands → Export for
  PokerTracker; the writer, a PokerStars parser that round-trips it, and the import registry.
  `npm run test:hh-io`. `docs/hand-history-io.md`.
- **Usage:** the weekly limit was hit on 2026-10-13. Default to one builder + one verifier per job,
  two or three jobs at a time, full guard runs once per size.

## 2026-10-12 — Home redesign (the Dashboard tab), decisions worth knowing
Built to the panel verdict of 2026-10-11 in steps 1–6 (section 7, Trend, is a marked slot in
`DashboardView.jsx` waiting for the BankrollChart rebuild; section 8, Backers, is later). After the
first critic round:
- **One trip net.** The trip page did not count cash sessions and the home did, so the two showed
  different nets for the same trip. `/api/bankrolls/trips/:id` now returns `cash_sessions` (the
  ledger's own cash source) and `utils/transactions.js tripPnl()` is the one definition, run by both
  (docs/bankrolls.md "One trip net").
- **To log skips a plan's branch that resolved off** (`awaitingResults(..., { plans })`, also
  Results' "Awaiting result" card): "If bag #12" after #12 busted on Day 1 was never played, and one
  tap used to log a phantom bust.
- **The Table Scanner for non-admins:** on master it was a home section for everyone; now it is the
  Playing card's Scan action (everyone) and Hands > Scanner (admins only, since Hands is). A
  non-admin therefore reaches it only once an event is Started. Accepted on purpose (the verdict:
  a tool used only when seated should not cost a permanent section); if non-admins ask for it,
  the cheapest path is a Scan entry in the user menu.
- **Display currency is live:** Results' currency setting is announced
  (`hooks/useDisplayCurrency.js`) and the home follows it at once, not on the next reload.
- Desktop at 1440 keeps a 27g page band right of the NUMBERS pane, as every single-pane tab does
  (docs/desktop-layout.md "Dashboard", Width).

## 2026-10-11 (evening) — Aqua accent, cross-platform font metrics, Dashboard pass
- **Brand accent is aqua**, not orange (black + orange read like an adult site's branding):
  dark `#3cc8e0`, light `#0e7490`, cloudy `#0a4f62` (its grey surface needs the darker one), high
  contrast `#7ae6f5` / `#0b4a5c`. Tokens in styles.css; palette and contrast in docs/design-tokens.md.
  Warnings, trophy/POY gold, chips, bet amber and venue strips stay warm on purpose. Share images
  (utils/export.js), the weekly graphics, both ad recorders and the 12 storyboards were recoloured.
- **Why labels sat high on Apple devices but passed every guard:** Univers had hhea 724/276 vs win
  ~969/250. Apple lays out with hhea, Windows WebKit (the guards) with win. All font files now carry
  hhea == typo == win; `npm run check:fonts` enforces it; URLs carry `?v=2`. See CLAUDE.md.
- Dashboard: 1r more above the first title; the title reads TODAY / TOMORROW for the next event
  (crossfades back to UP NEXT on later cards); count pill ink centred (trailing letter-space
  cancelled with text-indent); Up Next card smaller (name --fs-md, buy-in --fs-sm, 4r action boxes);
  P&L is one 4r bar, 11g|11g|13g, figure and label on one line ("Total Buyins" → "Buy-ins"); the
  carousel's ‹ › are SVG chevrons (a typed ‹ can't be centred without a nudge).
- Removed the bankroll "Of your roll" line from event cards (and its hook/helpers).
- Desktop: closing an event animates like opening (App.jsx keeps the block mounted, `is-closing`).

## 2026-10-11 (later) — Bankroll tracker, Poker Bankroll Tracker-style pass
Three parallel branches, merged on `merge/bankroll-pbt`; details in `docs/bankrolls.md`.
- **Overview** (`BankrollOverview.jsx`, was the Balance tab): hero balance + range profit, the
  cumulative graph (Profit | Balance, 1M/3M/YTD/1Y/All, remembered per device), grouped label/value
  stats, the six latest results. Tab strip is one 35g segmented control that re-divides by tab count.
  Ledger entries gained `fx_display`; cash-session entries `started_at` and `hours`.
- **Reports** (`BankrollReports.jsx`, `BankrollFilters.jsx`, `lib/bankroll-reports.js`,
  `GET /api/bankrolls/reports`): one "fact" per result/session/expense; filters applied client-side
  (date, type, bankroll, game, stakes/buy-in, room, live/online, weekday, part of day); breakdowns by
  room, game, stakes, buy-in, weekday, start hour, session length, month, category. Cash "online" is
  guessed from the room name (`ONLINE_ROOM`).
- **Cash sessions** (`CashSessions.jsx`): month-grouped list led by profit, Stats as rows, a session
  page, a short add form with prefill, a live screen with STACK updates (`cash_session_stacks`,
  migration `cash-session-stacks-2026-10`, in account deletion). Results › Cash opens on the live
  screen while a session runs.
- Open owner questions: Overview default range (YTD) and graph (Profit); drawdown on balance (counts
  withdrawals) vs results only; whether the dashboard's bankroll and the Reports bankroll filter should
  stay linked one way only; Cash opening on the live screen; muted vs coloured month headers.

## 2026-10-11 — Bankroll suite (admins only): ledger, cash sessions, expenses, rules, import
Three parallel branches, merged on `merge/bankroll-suite`. All of it is documented in `docs/bankrolls.md`.
- **The combined ledger** (`lib/bankroll-ledger.js`): every `lib/ledger-sources/*.js` is auto-loaded
  (tournaments, adjustments, cash-sessions, transactions). `/api/bankrolls/ledger|summary|prefs|risk|import`.
  The switcher's balances now come from the server's `/summary` (`balancesFromSummary`); `computeBalances`
  is superseded for display. Money is MAJOR units in every source (dollars; expenses REAL to the cent).
- **Dashboard** (bankroll strip → Dashboard): Overview / Rules / Goals / Import tabs (the Overview is tracker-style: hero, profit or balance graph over 1M–All, grouped statistics, latest sessions — docs/bankrolls.md "The dashboard"); "Of your roll" on
  event cards; risk of ruin `exp(−2μB/σ²)`. CSV import: Poker Bankroll Tracker, the Pokerbase sheet, or a
  generic column mapping. Imported non-USD results are converted at TODAY's rate (an open question).
- **Cash sessions** (`lib/cash-sessions.js`, Results → Cash): log or run live; one live session per
  user (409); `LiveCashBar` sits over the bottom nav on every tab except Results › Cash and Hands.
- **Expenses / income / trips** (`lib/bankroll-transactions.js`, Results → Expenses & income). Trip
  P&L. Tax report gains the expense lines. No receipts (needs object storage first).
- Guards: `check:clipping` / `check:controls` now walk the dashboard tabs, Results › Cash and the
  expenses sheets. Run them against a scratch server (fresh `DB_PATH`, a registered user renamed to an
  app-admin name, `CHECK_TOKEN` signed with that server's `JWT_SECRET`), never a copy of the live DB.
- Open owner questions: whether a trip is scoped by tags only or by date range; where the live-cash bar
  belongs (over the nav, or a chip in the top bar); whether one live session is the right limit; the cash
  move-up rule needs stake fields; and whether imported non-USD results use the rate on their own date.

## 2026-10-10 — Results betas (admins only): bankrolls, analytics, tax report
- **Bankrolls** (`lib/bankrolls.js`, `docs/bankrolls.md`): tables `bankrolls` + `bankroll_adjustments`,
  `tracking_entries.bankroll_id` (NULL = the virtual "Main"). `?bankroll=<all|main|id>` is the shared
  filter (`bankrolls.filterFromQuery` server side, `utils/bankrolls.js` client side).
- **Analytics** (`lib/analytics.js`, `GET /api/analytics`): follows the Results-tab bankroll. ROI CI is a
  seeded percentile bootstrap over events; groups under 30 entries get no estimate.
- **Tax report** (`utils/tax-report.js`, `GET /api/tax-report/entries`, `docs/tax-report.md`): always
  all bankrolls. W-2G poker threshold is >$5,000 net of buy-in through 2025, >=$2,000 from 2026; losses
  90% from 2026 (OBBBA §70114). `W2G_POKER_RULES` needs the 2027 figure when the IRS publishes it.
- **Cash heatmap** offers only the watcher's active (location-derived) rooms once they match the picked
  location. The hosted cash watcher on Render was missing `HOME_LOCATION_PATH` / `ACTIVE_VENUES_PATH` /
  `ACTIVE_VENUES_META_PATH`, so every redeploy reset the picked location to the default and the box
  pulled that over the pick. Set on the service 2026-10-10 (and the meta path added to render.yaml);
  location restored to Philadelphia, 60 mi.

## 2026-10-09 — iPad/Mac desktop layout, Borgata Fall Poker Open, MTT watcher dedupe
- **Desktop layout is width-only** (`DESKTOP_QUERY = '(min-width: 1024px)'`), and the iPad app
  takes all four orientations (`UISupportedInterfaceOrientations~ipad`; iPhone stays portrait).
  Every iPad held sideways, a 13-inch iPad upright, and any Mac window over 1024 CSS px get the
  rail and panes. TestFlight run 37907299568 carries it.
- **Borgata Fall Poker Open 2026** is a hand import (`source_pdf` 'Borgata Fall Poker Open 2026',
  stable_ids `BFPO26-*`, 98 rows on prod): 81 live + 17 BetMGM online (`is_online`, site
  `betmgm`, venue 'BetMGM Fall Poker Open 2026'). Event #31 (invitation-only) left out.
  PokerAtlas has never listed it; if the feed ever does, add a `BRIDGE_SUPERSEDE` row for the
  venue string it uses, or both will list.
- `/api/import-parsed-schedule` now writes `is_online`, `site` and `property`, and runs
  `resolveVenueCoords` after an import. Pass `property` = the room's PokerAtlas name, or the
  series has no coordinate and every location filter hides it.
- **mtt-series-watcher** `fix/wsopc-flight-dedupe` is merged (3bd1a36), restarted, renormalized
  (9,975 names) and re-emitted. The audit's one HIGH (`unlabeled-repeat` on "$40K Multi-Flight -
  Oct. '26") is a false positive: the emitted file has Flights 1-4 correctly.

## 2026-10-08 — Admin "New events" batches

Each new-series alert from the MTT watcher (`POST /api/admin/notify/new-series`) is stored
in `admin_batches` and the push now links to `/?batch=<id>` instead of `/?find=` or `/`.
`GET /api/admin/batches[/:id]` (requireAppAdmin) lists batches and resolves each series to
schedule rows AT READ TIME: exact `venue === name`, then normalised, then a loose whole-word
containment corroborated per row by property + dates. A series with no rows yet reads
"Not in the schedule yet" (prod gets rows only after the :20 ingest + push). Client:
`AdminBatchesView.jsx`, opened by the deep link, user menu > New Events, or the desktop
rail's admin-only New Events entry (main pane); non-admins'
`?batch=` is dropped. Tests: `test/admin-batches.test.js`.

## Next big effort — quick-add hand histories (text or voice)

Decided 2026-10-01; design and decisions in `docs/quick-add-hands.md`, the parts' contract in
`docs/quick-add-contract.md`. **Step 1 (text) shipped to master 2026-10-01 (b05ac2d), admins only:**
- `lib/quick-add.js` + `lib/quick-add/*` — `POST /api/quick-add/parse` and `/answer` (claude-sonnet-5
  tool use; simple answers like "100bb" need no model). Needs `ANTHROPIC_API_KEY` (Render has it;
  the local pm2 env does NOT, so locally both return 503).
- `vite-app/src/utils/quick-add/` — the deterministic gaps engine (`findGaps`, `applyAnswer`).
- `vite-app/src/components/QuickAddView.jsx` — the chat screen (Hands tab → "Quick add").
- `test/quick-add/` — engine tests (`gaps.test.mjs`, 134), server tests (`server.test.js`, 41), and the
  88-hand corpus + `eval.js` (`--oracle` scores the engine; `--url/--token` scores the real parse).
Not yet measured against the REAL model — run `eval.js` against an endpoint with the key first.
Next: step 2 (voice: Web Speech in the browser, a Capacitor speech plugin in the app).

## 2026-09-30 — Live tournament clocks + event audit

**Live clocks.** Bravo and PokerAtlas tournament clocks (both reverse-engineered
this session; recon in mtt-series-watcher `docs/bravo-tournaments-blocker.md` and
`docs/pokeratlas-clock.md`) now drive the dashboard and any running schedule card
in place of the estimate. Server: `lib/live-clocks.js` behind `POST
/api/live-clocks`; PokerAtlas by the event's `clock_ref` (`pa:<tc_id>`, carried
by the MTT feed), Bravo by the room at the venue's coordinates. Client poller in
`vite-app/src/utils/live-clocks.js` (one shared 15 s registry). Cards show blinds
· time on the top line, right-aligned to 27g. A clock seen running then gone from
an answering provider for 5 min → `clock_ended_at`; the card dims and reads
"event completed". Admin reachability probe: `GET
/api/admin/live-clocks/probe?casino=&tc=` (x-sync-token). Traps: TableCaptain's
venue clock can run minutes fast — corrected via the reply envelope's `Updated`;
a break/pause state on PokerAtlas is still UNVERIFIED live.

**Timezone.** The MTT feed now emits each event's date/time in the ROOM's zone
(PokerAtlas `time_zone_name`) and carries `timezone`; the client trusts it over
any name-based guess (`registerRowTimezones` / `getVenueTimezone`). Fixed Austin
showing 3:15 PM PDT for a 2:15 PM Central start.

**Event audit (2026-09-30) + fixes shipped:**
- **Stale-row prune** (`reconcileFeedSeries`, server.js): the feed prune only
  removed a whole series once it left the manifest, so renumbered / re-listed /
  dropped events lingered (196 upcoming orphans, incl. WSOP Circuit stops
  double-listed under an old and new series name). Now within-series rows whose
  (venue, event_number) the feed no longer carries are pruned, under the same
  reference guard, only when rows landed. One-time cleanup: local −927, prod
  −2806. **This is the data-loss-sensitive path — verified on a scratch DB copy
  (0 live rows deleted, referenced rows kept) before shipping.**
- Phenom PSOP titles dropped the `#N:` prefix; the number is read into the badge
  by `shortEventNumber` (online-poker-watcher + utils.js).
- ACR "winners list" / "check list" non-tournament rows filtered.

**Still open from the audit (not yet done):** full title normalisation across the
non-PokerAtlas sources (spelled-out game names, acronym periods like `H.E.R.O.S.`,
day/flight not written as a " - Day 2" suffix, ALL-CAPS ACR/ClubWPT names); the
~1-event-per-stop WSOP Circuit merge leak (a cross-source identity edge case on
flighted events); and a **decision needed** on whether online titles should keep
the guarantee ("$300K GTD") when the card already shows it under the buy-in.

**Cash tab:** top-bar subtitle reads "live cash games" there (not the season
range); the in-view "Live Cash Games" h2 was removed.

---

## Artifacts

Published pages carry work that does not live in the repo. All are private
to the account and readable with WebFetch.

| Page | What it is | URL |
|---|---|---|
| Design audit | 20 numbered plates diagnosing the frontend, each with measured evidence and a live before/after | https://claude.ai/code/artifact/f6ae8a63-8772-45e3-ac16-085637f40cd3 |
| Design directions | The five judgment-call items, 2–3 built options each, for picking a direction | https://claude.ai/code/artifact/9589127b-77ae-4e33-a71f-29ba63cd7f51 |
| Element catalog | Every element type (2,034) with its crop, px and g/r sizes, paint and type, plus the 94 captured screens; built from `D:\projects\element-catalog-2026-10-08.zip` | https://claude.ai/artifact/74MoH91LgUPSokba1A5Lfg |
| Master to-do | Cross-repo state for all five suite projects, assembled from PRs, commits and checklists | https://claude.ai/code/artifact/5d07cb8c-73fc-4c56-a06f-61473455be46 |
| Graphics backlog | 100 measured graphic upgrades across the whole app, each naming the file and quoting the current value | https://claude.ai/code/artifact/f5f543f9-33b7-44e3-94d6-c9e7779eefcd |
| Launch plan | Launch on 5 Jan 2027 at the BWPO, free until a 1 Mar paywall, $10,000 in three gates; channels, the twelve ads, policy wording, ASO, tracking, next 10 actions and 7 open questions (2026-10-13) | https://claude.ai/artifact/5k5qVK6Y8cPmzdMXjJEDgW |
| Variant picker | Ten redesigns of the replayer entry's variant picker (recommended 8+10, fallback 1) (2026-10-13) | https://claude.ai/artifact/Jk96jEaP58rBAsf4eak9ka |
| Parser questions | 47 questions from the real-hand corpora, tap-to-answer; the answers are in its db collection `answers` (Artifact tool, read_db) (2026-10-14) | https://claude.ai/artifact/9m4sQRQY4JpvcuEZJZR5NR |

To revise one, publish the **same file path** again, or pass its URL as `url`.
Publishing without the URL creates a second artifact instead of updating.

---

## 2026-09-28 (Windows) — the Dashboard on the grid + Schedule header-peek fix

`df32787` on master (`b57ffef..df32787`), pushed; Render auto-deployed the web;
iOS TestFlight build requested from the Mac (`ios-testflight.sh`). Production Vite
build passed clean. Four files: `styles.css`, `DashboardView.jsx`, `App.jsx`,
`GridOverlay.jsx`.

**Method — this is how the Dashboard got measured.** The Mac ran the native app
on an iPhone 17 Pro sim (admin login, Capacitor live-reload against the Windows
dev server `100.69.155.34:5199`). The Mac CANNOT run JS in the native WKWebView,
so the grid overlay (`GridOverlay.jsx`, admin-gated) was extended to PRINT the
numbers — a debug panel that scans every dashboard text element and lists the
off-grid ones, per-card row heights (`R[...]`), card chrome, section tops
(`S[...]`), and a stat-cell probe — and the Mac read them off 3x screenshots.
That loop (edit CSS → HMR → Mac hard-reloads + reads panel) is the only way to
measure iOS-specific line-box flooring; the Windows harness (WebKit) does NOT
reproduce it. Safari/safaridriver was banned mid-session — native app only.

**What seated (verified per-pixel on real iOS):** the whole common-path Dashboard.
Up Next playing card (tag pill 2r, stat box 6r, action buttons 4r, badge stack
10r), busted card (finished-badge 5r, rebuy nowrap), Friends chips (8r, three
exact 2r cells), Connections avatars (4r avatar + 2r name = 6r column), all
section titles/badges, the carousel counter. `ALL SEATED`.

**The recipe that worked** (memory `text-box-trim-inert-under-flex` has it in
full): iOS WebKit floors every line box to whole px but keeps
height/min-height/margin/padding sub-px. So seat single-line text in an
EXACT-HEIGHT CELL — `height: N*r` + `line-height: N*r` + `box-sizing: border-box`
— never let a line box size a block. Padding-driven buttons get fixed `height` +
`min-height:0` (+ `nowrap` on long labels — flexbox min-height:auto otherwise
lets the label wrap and blow past the height). `text-box-trim` is INERT under
`display:flex` and unsupported on the iOS 15 target — do not rely on it. A card
lands whole only if its chrome (padding+border+gaps) sums whole AND every row is
whole. The overlay OFF list is DOCUMENT-WIDE: `.stat-value[3..5]` are the SECOND
card's cells, not the active one's — cost ~3 rounds of confusion.

**Header peek (Schedule filter bar):** `.sticky-filters::after`, 0.5r of `--bg`
over the momentum-scroll seam above the pinned date break (background, not
box-shadow — a late-resolving var fails transparent, not the black currentColor
the old shadow hit). Raising the date break's z-index ABOVE the bar fixed the
seam but regressed the scroll-up transit (break painted over the checkboxes), so
the break stays z-index 5 (below the bar). Pixel-proven flat at rest and across 8
momentum frames.

**2-line hero names:** a `useLayoutEffect` in `DashboardView` measures each hero
name's rendered line count and pins `min-height` to `lines*3r` — `:has(br)` only
catches explicit `<br>`, not width wraps.

**Kept, admin-only (Ethan's call):** the `D` demo-states toggle (injects a
playing/busted/2-line/anchor card + demo friends/connections, so the live states
render for grid measurement without live data) and the expanded overlay
diagnostics. Reusable for the ongoing ~3,900-literal → token migration.

**NOT done (rare, Ethan deferred):** the conditional-on-playing card VARIANT's
`~0.30r` residue (negative-margin dashed-edge chrome; cards 1/2/3 at 22.33 /
24.29 / 12.32r). It only renders when another event is actively playing; real
cards are whole. Card 2 there also carries the 2-line-hero wrap.

**Loose end:** pre-existing seeded test events in the `ham5` account from earlier
harness work (before this session) may still be present — this session used the
client-side demo toggle, seeded nothing new, but an old cleanup is worth a pass.

---

## 2026-09-25 (Windows) — the Schedule tab on the grid, shipped

35 commits on master (`c1a7e1c..f91deb6`), pushed 23:06 UTC; TestFlight run
36199678246 built and uploaded `f91deb6` at 23:13 (`success`, 7 min). Render
auto-deployed from the same push.

**The grid, as it now stands** (memory `grid-system` has the full rule set):
g = 100vw/37 (`--gu`), subcolumn 2g, column 8g, subrow 8px (`--subrow`),
primary row 32px. Gutters 1g. Every Schedule element is sized to it — header
gutter to gutter, wordmark one column, filter buttons 3g with 1g gaps, checkbox
squares seated 120→136, sticky filters = the top five primary rows (bottom 160),
date block pinned at 160 (40px, border at 200), pill 160→192, event cards 96px
(120 with a Flight/Day line) with every baseline on a row. Nothing here should
be re-derived: measure the DOM against the overlay.

**The admin grid overlay is anchored to viewport y = 0** — 8px lines, every
fourth stronger (`.grid-dev-baseline`, `styles.css` ~11470). Not to the content
origin (72). Half a session was measured against the wrong origin.

**Traps this session paid for, in order of cost:**

- **`Range.getBoundingClientRect().bottom` is NOT the baseline** — it is
  baseline + font descent, so a 30px serif and a 10px condensed face on the same
  baseline read 5px apart. An inline-block probe (`height:0; vertical-align:
  baseline`) is also wrong when appended inside a **flex** item: it becomes a
  flex child and centres. Two reliable methods: canvas `measureText` font metrics
  + the element rect (`diag5.js`), or **pixel ink** of caps/digits from a
  Playwright screenshot decoded with `PNG` from
  `playwright-core/lib/utilsBundle.js` (`diag6.js`, `final.js`, `dow.js`) —
  digits and caps have ~0 descent, so ink bottom = baseline to within the 0.5px
  of anti-aliasing. Harness scripts are in the session scratchpad.
- **A sticky element's LANDING must equal its PIN.** `scrollDateGroupToTop`
  (`TournamentsView.jsx` ~1215) is the single helper every scroll-to-today path
  uses; its constant landed the date block at 166 (`filtersH + 2`) — 6px shy of
  the pin at 160 and on no grid line — so the default view was off-grid and
  everything measured "correct when pinned" was wrong on first paint. It is
  `filtersH - 4` now: block at 64 + 100 − 4 = 160, landing == pin, no jump on
  the first scroll.
- **"Between the checkboxes and the pill" means the visible squares**, not the
  label's container. 16px squares centred in a 24px row bottomed at 140 (off
  grid) and the gap read as four cells; the labels are 16px now so the squares
  fill 120→136. The sticky filters' bottom padding grew a subrow to keep the
  header's bottom at 160.
- **Anything `align-items: center` inside a baseline-aligned row floats.** The
  date-break's end box centred its weekday inside its own 32px box, parking the
  "F" at 186 while the count sat on 192. It is baseline-aligned now, and the one
  font-metric constant that drops the count and the weekday onto the PILL's
  bottom edge (5.5px = pill 32 − day baseline 26.5) is declared once for both
  (`.date-break-count, .date-break-end`).
- **"On the pill's baseline" means the pill BOX's bottom edge**, not the text
  baseline of the "25" inside it. Aligning the count to the text baseline was
  measured correct three ways and was still wrong. The pill is the grid object;
  the count, weekday and chevron sit on its bottom line (192, a subrow line).

**Open, small:**
- `.date-break-end`'s transparent 32px wrapper now overhangs the block's bottom
  by 10px (178→210 vs the block's 200). Nothing visible; the subgrid audit will
  report it. Drop the fixed height.
- `ios-testflight.yml` uses `actions/checkout@v4`, and every run now annotates
  "Node.js 20 is deprecated … forced to run on Node.js 24". Bump to `@v5` (the
  spawn_task for it failed on a hook timeout, so it exists only here). A
  workflow-only change does not fire a build — the trigger is path-filtered to
  `vite-app/**`, `ios/**`, `capacitor.config.json`, `build.js`.

**Not shipped:** the rest of the "full sweep, Schedule first" — Cash, Social,
Dashboard, the Hands trainers, Settings and Admin are still to be put on the
same grid (screen titles are already non-bold Baskerville everywhere).

---

## 2026-09-14 (Mac) — Mac Catalyst: the app builds, runs and archives for macOS

Handoff #264. Everything is in `docs/mac-catalyst.md`; the three things that cost time:

**Capacitor's Swift package has no Catalyst slice.** `capacitor-swift-pm` is two
binary xcframeworks (device + simulator only), so enabling the destination fails
before any app code compiles. The source compiles for Catalyst unmodified, so
`scripts/build-capacitor-xcframeworks.sh` builds that slice from upstream's Xcode
project at the pinned tag and merges it with upstream's own iOS slices; the local
package `ios/App/capacitor-swift-pm/` overrides the remote by identity. The
binaries are gitignored — **a checkout that has not run the script cannot build the
iOS app either**, which is why the ship script now calls it first.

**The App Manager key cannot do the first Catalyst build.** Device registration
and the Mac Catalyst profiles need the Admin key (`AXP57ABRUD`) plus
`-allowProvisioningDeviceRegistration`. One run fixed it; routine builds work with
either key afterwards.

**The window floor from #263 did not hold** (window dragged to 515×319). Applying
it on scene connect + activate + didBecomeActive does; verified at 370×555 screen
points, which is 480×720 UIKit points under Catalyst's 0.77 iPad scaling.

Verified: Debug build runs sandboxed, loads the live schedule as guest; Release
archive for `Any Mac (Mac Catalyst)` and an App Store **export** (not upload)
succeed. Waiting on Windows: the `--catalyst` flag in `ios-testflight.sh` (#267).

**#266 merged; the runner's first build with the override archived fine (1300)
and then hit Apple's daily upload cap** — App Store Connect error 90382 "Upload
limit reached ... wait 1 day", after ten uploads in eight hours. The three
failed runs from 03:18 UTC onward are all this, not build failures, and the
watchdog does not retry it (it only knows the 600-second sleep-kill). Re-dispatch
by hand once the window clears (from ~19:30 UTC 09-15):
`gh api repos/ethanibennett/futuregame-scheduler/dispatches -f event_type=ios-testflight`.
Rule of thumb the cap implies: **rapid merges should batch**, since every push
to master that touches `vite-app/**` or `ios/**` costs one of the day's uploads.

---

## Shipped 2026-09-13 — the screensaver, and where its halves live

Three PRs, all screensaver, all ending in the same failure mode: something
reports success while showing you an old or wrong picture.

**#225 — the Cockpit page left this repo.** `wsop-console#3` took `cockpit-min.html`
across as `screensaver/cockpit-page.html` and pointed `/d/:token` at it, which made
the two copies here the stale ones. Deleted. **Nothing in this repo renders HTML any
more**, and that is now the line: the Mac builds the `.saver` bundle and its refresher
*here*; the dashboard serves the page, its fonts and the endpoint specs *there*. This
closes the long-standing "decide where the macOS screensaver source belongs" item.

Worth recording once: **"min" meant MINIMALIST, not minified.** `cockpit-min.html`
(07-12) was the *newer* of the two and a different document from
`cockpit-screensaver.html` (07-09) rather than a build of it. Following the name would
have shipped the older full-bleed page over the one with the departures board.

**#226 — `config.json`'s `url` is the ORIGIN.** `render.sh` composes the page URL
itself (`url + '/d/' + token`), so a full page URL there yields `/d/<token>/d/<token>`
and a 404. #222 had "corrected" the README to the full URL, which produced the exact
failure #222 existed to prevent.

**#227 — `render.sh` asks for the HTTP status before spending a render.** Chrome
screenshots an error page as happily as a good one, so the render cannot tell you the
page was wrong: on the current Mac a bad token produced a 26 KB picture of the words
"Not found" while the script logged `wrote frame 26596 bytes`, every minute, forever.
Status rather than byte size, because a size threshold is a guess that would eventually
freeze the saver on a legitimate redesign. A refused render keeps the previous frame,
since a stale dashboard is better than a picture of an error.

Cross-repo: the dashboard also fixed a token-format check the same night
(`wsop-console 0a1acf5`) that had been rejecting ~65% of correctly generated
`base64url` tokens — the same 404, reached from the other end.

---

## Shipped 2026-08-19 → 24

**MTT feed** — #87 ingests `structure_sheet_path` from the feed (and found the
two-write-path trap below); #88 and #89 recorded that trap and the structure hunt.

**Admin** — #92 validates admin event edits instead of writing anything sent; #93
makes admin corrections survive the feed's hourly re-upsert; #94 makes the editor
honest about which rows are feed-owned and will be overwritten.

**Visual** — #90 gradients the header and bottom nav from the screen edges; #91 gave
the replayer felt texture, board shadows, a turn ring, a folded state and player
plaques.

**Two bugs found together** (`b18a7a7`) — `SolverPlayView`, the CFR self-play viewer,
was dead UI: `App.jsx` rendered it on `handsTool === 'watch'`, but `'watch'` was never
in the tool button list and nothing else set it, so the component was imported,
lazy-loaded, code-split and unreachable. Finding that needed the second fix, below.

**TestFlight reliability** — #95 and #96, see the two traps below.

---
## Shipped 2026-08-14 → 17

Twelve PRs, all merged to master and deployed (Render auto-deploys on push;
`ios-testflight.yml` also fires a TestFlight build when `vite-app/**`, `ios/**`,
`capacitor.config.json`, `build.js` or the ship script changes).

**Design system** — #64 dropped Bahnschrift (and the `font-stretch: 85%` hack
plus its two undo-blocks); #65 added the full token layer, additive with no
consumers; #66 and #67 migrated only **exact-equivalence** literals (43 radius,
149 font stacks) so the changes provably could not alter rendering.

**Dashboard** — #68 split empty states into `<FirstRun>` / `<Filtered>` and made
the header subtitle dynamic; #70 restored the top-edge venue bar; #71 fixed the
Up Next fallback, which never received any styling; #72 made the carousel swipe
the whole schedule and tap through to My Schedule, expanded.

**Bugs** — #69 added the missing `DELETE /api/tracking` (the Reset button had
never worked); #73 stopped WSOPC side events showing a ring and pinned the
trophy icons to the title line; #74 abbreviated spelled-out game types.

**mtt-series-watcher** (3 commits, pushed) — `ac15db1` five normalizer defects,
`74e15c7` the `renormalize:names` migration, `6df72d4` no-limit draw games no
longer classified as hold'em.

**Mac build node** — #63 committed the screensaver Swift sources (`DashboardSaver/`,
`DashboardSaverHelper/`, README), which until then existed only in `~/src` on the
old Mac, a machine queued for wiping; #62 documented the three failures between
TestFlight builds 62 and 63 (`svc.sh` runners cannot codesign against the login
keychain, `config.sh` freezing `PATH` at registration, and the expired legacy
WWDR intermediate yielding zero identities from a valid `.p12`). Both were opened
2026-08-13 and merged 2026-08-17. Neither touches the `ios-testflight.yml`
trigger paths, so no build fired.

**Season label** — #78 and #83 retired the hardcoded "spring/summer 2026",
which was five months stale against a feed running august-november. The header
has computed the real span since #68; `App.jsx` now persists that label and the
splash, `AuthScreen` and `SharedScheduleView` read it back via
`getStoredSeasonLabel()`, while `SettingsView` takes the live value as a prop.
#85 then did the tab title, which needs a second write in `App.jsx` — on a
first-ever load there is no stored label to title with, so without it the tab
holds the static wording all session. The pre-login screens cannot *compute*
the label, but they can display one — the old "they genuinely cannot be
dynamic" note was wrong. The literals left are fallbacks, not oversights:
`SEASON_FALLBACK`, the splash's inline copy and the static `<title>` (both
overwritten during parse), plus `manifest.json`, which stays static because the
OS reads it at install time.

All five suite repos are at **zero unpushed, zero modified**, and this repo has
**no open PRs**.

---

## Seams to the dashboard (dashboard.futurega.me)

The dashboard is a separate service and a separate repo (`wsop-console`), and
three seams cross between them. This doc has never mentioned them, which is how a
session ends up debugging one side of a two-sided problem. All three were verified
live on 2026-08-30.

1. **notify (in)** — `POST /console/api/backers/notify` (`server.js:485`), ham-Basic
   gated. The dashboard client posts backer session results here because the backer
   tables never left this repo.
2. **departures (out)** — `GET /api/schedule/:token/upcoming` (`server.js:464`),
   DASHBOARD_TOKEN-gated, 404 on mismatch. The dashboard has no `user_schedules` or
   `tournaments` tables, so its departures board is our `computeDashboardEvents`.
   Probed 2026-08-30: 200 with real events, and the dashboard payload showed the
   same four upcoming — so this seam is working end to end, not merely reachable.
3. **roster (in)** — `syncBackerRoster()` (`server.js:9772`) pulls
   `DASHBOARD_BASE_URL/api/roster/:token` at boot and hourly at :35, then LWW-merges
   into `console_records`. Our `backers` store froze at the 2026-08-09 cutover, so
   without this pull `/b/:token` pages and the weekly digest miss every backer added
   or renamed since. The dashboard end answered 200 on 2026-08-30.

**One probe proves the whole configuration.** `GET /api/schedule/<DASHBOARD_TOKEN>/upcoming`
returning 200 proves the token is set on this Render service AND matches the
dashboard's copy — which is the same value `syncBackerRoster()` reads. A 404 means
the token is wrong or missing, and the roster pull is silently dead too.

**The trap in seam 3: it self-disables.** `syncBackerRoster()` opens with
`if (!token) return;` — no warning, no log line, nothing in any payload. Backer
pages would keep rendering the frozen cutover roster and look entirely healthy.
That is the same failure class that cost the dashboard 16 days of sleep data
(`OURA_*` undeclared in its blueprint) and left its APNs alert seam inert for two
weeks (`APNS_*` — set 2026-08-31, after two weeks of silent 503s; a device still has
to register before anything can be delivered). Three instances, one shape: an env var that is
read but never declared, and a code path that treats absent as "off" rather than
"broken".

**Superseded 2026-10-14: seam 3 has its own token.** Everything above about seam 3 and
`DASHBOARD_TOKEN` is the history. The roster carries every backer's `/b/` token, phone and
email, and `DASHBOARD_TOKEN` is compiled into the iOS builds, so anyone who extracted it from
an app could have pulled all of it. The pull now sends a server-only `ROSTER_TOKEN` as
`Authorization: Bearer` to `GET /api/roster`, and `DASHBOARD_TOKEN` opens nothing there. So
the probe in the paragraph above no longer proves the roster pull; the proof is
`[roster] pull from the dashboard ok` in the boot log. The self-disable trap is also
fixed: without `ROSTER_TOKEN` the sync logs `[roster] ROSTER_TOKEN is not set … OFF` once per
boot, and each pull is abandoned after 30 s. `ROSTER_TOKEN` lives on the two Render services
only, never in the local ecosystem file, so this box's sync is deliberately off. CLAUDE.md
(seam #3) has the rollout order; `npm run test:roster` covers the header, the self-disable and
the timeout.

**DASHBOARD_TOKEN's blast radius grew, and not on this side.** The same shared
secret reads this schedule, reads the dashboard payload and roster, renders the
Windows lock screen — and, since dashboard `bc75c1a`, **sends an APNs push to
Ethan's phone** via the MTT watcher's new-series alert. Ours are read-only and keep
the token in the path deliberately. The dashboard hardened its acting route in
`cfb4efc` (header token, payload caps, retry dedupe) and the watcher moved to the
header in `08449ca`. If a fourth consumer ever needs to *act*, give it its own
token rather than widening this one.

**Dashboard-side state, as of 2026-08-30** (its `docs/session-handoff.md` is the
detail): `origin/main` at `e7b6417`; Oura ingest restored and one day old; Apple
Watch activity 47 days stale, weight absent, and APNs delivering to nobody — all
three waiting on one `native-ios` rebuild.

---

## The build pipeline was dead for four days, and nothing said so

Between **2026-09-07 and 2026-09-11** every iOS TestFlight run on this repo failed —
five consecutive runs — and it went unnoticed because nothing watches this workflow.
It surfaced only when someone pushed a native change to `wsop-console` and started
pulling the thread.

**The cause was machine-level, not repo-level.** `build.keychain-db` on the Mac held
**zero** signing identities; both were in `login.keychain`, which CI cannot see
because the job narrows the search list to the build keychain. Every archive died
with *"No iOS Development signing certificate ... with a private key was found"*.
Fixed 2026-09-11; **build 130 shipped** on a re-run of the newest failure.

**Three things here are worth knowing before the next time:**

- **The tooling lives in the other repo**, because that is where the incident was
  driven from: `wsop-console/scripts/diagnose-signing.sh` reports which keychain case
  you are in, and `repair-build-keychain.sh` fixes it. Both are read-first, and the
  repair has a `--recreate` path for when the keychain password is lost — GitHub
  cannot show a secret back, so a forgotten `BUILD_KEYCHAIN_PASSWORD` is unrecoverable
  unless the keychain is empty, which it was.
- **`docs/mac-build.md` is now partly wrong.** Its `run.sh`-not-`svc.sh` instruction
  was the interim workaround from before the dedicated build keychain existed. Both
  runners on the Mac are `svc.sh` services today, which is what makes them survive a
  reboot. Issue #79 repeated that advice and has been closed with a note.
- **A runner serves one repo.** `mac-build-node` is this repo's; `wsop-console` got
  its own second registration (`mac-build-node-wsop`) on the same Mac, because a
  personal account has no org-level runners. Its jobs had been queuing 24h and dying.

**Something watches now.** `build-watcher` runs under pm2 on the Windows box, polls
all five repos every 15 minutes, and pushes to Ethan's phone on a failed or stuck
run — "stuck" meaning queued or running far longer than the work takes, which is the
shape that has no natural end. It is the reason this section should not need writing
again. If builds break and no push arrives, check `pm2 list` first.

---

## Waiting on Ethan

- **(2026-10-13) A sample of WSOP.com's replay data** — the client keeps hands on WSOP's servers
  (no files on disk): a HAR of the replay viewer loading 3 hands (one to showdown, one won without
  one, one multi-way all-in), cookies and auth headers stripped, with the hand ids the client shows
  (`docs/hand-history-io.md` §9). `lib/hh-import/wsop-replay.mjs` refuses until then.
- **(2026-10-13) The PokerTracker 4 import check** — import an exported file into an empty PT4
  database and report what it rejects or misreads; import it twice to confirm PT4 de-duplicates by
  hand number (`docs/hand-history-io.md` §10). Until then PT4 acceptance is checked only against
  genuine PokerStars hands, not against PT4 itself.
- **(2026-10-13) MapKit JS key** — a Maps ID + a key with MapKit JS enabled (.p8) in the Apple
  Developer account; then `MAPKIT_TEAM_ID` / `MAPKIT_KEY_ID` / `MAPKIT_PRIVATE_KEY` on Render and in
  `ecosystem.config.cjs`. Later, for Android: `GOOGLE_MAPS_BROWSER_KEY` (+ optional
  `GOOGLE_MAPS_MAP_ID`). Until then the venue map uses OpenStreetMap.
- **(2026-10-13) Overview "Shares sold" row** — left out (staking is per agreement, not per result;
  several settlement rules are still marked GUESS). Needs how a sold share should be counted.
- **(2026-10-12) "OcalaBetS" vs "OcalaBets"** — PokerAtlas, the feed and VENUE_MAP spell it with a
  capital S; the regulator and press do not. Change at the source (watcher series_directory) and in
  `utils.js` VENUE_MAP together if wanted.

0. **Bankroll tracker decisions (asked 2026-10-11; re-ask at the start of a session until answered).**
   Current behaviour → recommendation: (1) Overview opens on YTD → keep; (2) graph defaults to
   Profit → keep; (3) "below the peak" counts withdrawals → change to results only; (4) dashboard
   bankroll ↔ Reports bankroll filter linked one way → link both ways; (5) Results › Cash opens on
   the live screen during a session → keep; (6) month headers / per-hour muted → keep; (7) live bar
   above the nav → keep; (8) one live session at a time → keep; (9) move-up/down cash rule not built
   → derive the big blind from the stakes text ("2/5" → $5); (10) trips count tagged expenses only →
   use the trip's date range plus tags; (11) imported non-USD results at today's rate → the rate on
   each result's date (needs a historical-rates source, e.g. ECB data).
1. **Univers 500/600 woff2** into `vite-app/public/fonts/`. Only he can obtain
   them (Linotype licence). Unblocks audit item 6 — emphasis currently has to
   jump 400→700 with no middle tier.
2. **Design directions 18 and 19** — surface depth, and the results chart. Both
   mocked up in the directions artifact; a letter each is enough.
3. **Should the filtered empty state count what it excluded?** "14 events match
   everything else in your filter" is the most useful line on that screen. The
   `hint` prop already accepts it; nothing computes the count yet.
4. **Display-font picker: two-way or three-way?** `helvetica` still has live CSS
   but was never in the toggle cycle, so it is unreachable dead code.
5. **Keep the Mac awake while a build is in flight** — the only real cure for the
   600-second dark-wake kill. #96 retries, but a healthy build needs 3–10 minutes
   against that window, so retries are coin flips. Windows cannot fix this: there
   is no API to pause a runner (`DELETE /actions/runners/{id}` deregisters it, and
   re-registering needs `config.sh` ON the Mac — do not go near it).
6. **Windows Credential Manager is not persisting credentials.** Both `gh` and git
   broke on 2026-08-24 with "Unable to persist credentials with the 'wincredman'
   credential store". Worked around with `gh auth login --insecure-storage` plus
   `gh auth setup-git`, which stores the token in plaintext in `hosts.yml` — fine,
   but a downgrade. Repairing the store itself is a Windows-side job.
7. **Apply the watcher's venue-coordinate patch** (`docs/venue-coords-watcher.diff`,
   in mtt-series-watcher, then `npm run emit`). The scheduler already places every
   live venue from `data/venue-directory.json` + Nominatim (2026-10-08: 32 unplaced
   venues → 0). Until the patch lands, a room that is NEW to PokerAtlas after the
   snapshot stays unplaced until `node scripts/build-venue-directory.js` is re-run.
   See `docs/venue-coords.md`.

---

## Traps worth knowing

**A PR description can be stale relative to its own branch.** #62's body says
the runner-persistence question is "still open" — but the second commit on that
same branch, `bb09675`, had already resolved it, and the description was never
rewritten. Reading the body and not the merged diff put a solved problem into
this doc as an open decision, and sent the Mac an instruction the docs
explicitly reject. Read what a PR *merged*, not what it *said*.

**The Mac runner is a LaunchAgent under `svc.sh`, and `status=offline` does not
tell you why.** `docs/mac-build.md` is the authority: the dedicated build
keychain is in place (`ios-testflight.yml:63` unlocks `build.keychain-db`), and
the runner starts at **GUI login** — an accepted limitation, since FileVault
requires the disk be unlocked at boot before any agent runs. `run.sh` is the
interim workaround and undoes the fix; use `svc.sh status` / `svc.sh start`. A
queued job waits ~24h for a runner.

On 2026-08-17 the #78 build showed how little `offline` tells you: the runner
was down at 21:04, came up unprompted, took the job at 22:12, cleared checkout
and the keychain unlock, then died ten minutes into the archive with *"the
self-hosted runner lost communication"*. Not a logged-out Mac and not a dead
session — a machine that most likely slept mid-build. **Read the job's step
list before diagnosing from runner status.** Note also that a runner dying
outright skips the `if: always()` keychain restore, which leaves the
interactive user's search list build-only and later reads as Xcode failing to
sign; `security list-keychains -d user -s ~/Library/Keychains/login.keychain-db`
puts it back.

**A green `npm run build` on this box built nothing, for weeks.** `build.js` called
`spawnSync('npm', ...)`, which fails ENOENT on native Windows because npm is a `.cmd`
shim, returning `status === null` — and the guard `(build.status ?? 0) !== 0` coerces
null to 0, i.e. to success. So the build printed "Running vite build...", exited 0, and
left `public-vite/` untouched. Render builds on Linux and was never affected, which is
exactly why it went unnoticed. Fixed in `b18a7a7` (`runOrDie()`, `shell: true`, fails on
a spawn error or any non-zero/null status). **The consequence outlives the fix:** any
"verified in the running app" claim made on this machine before 2026-08-24 was verified
against a stale bundle. Re-check rather than trust those. And builds that used to fail
silently now fail loudly — that is the point, but it may surface swallowed problems.

**TestFlight builds die at exactly 600 seconds, and a sleeping Mac is not the whole
story.** The runner is registered, so the job does NOT sit safely queued: the Mac
surfaces in a brief "dark wake" with throttled networking, the runner reconnects, GitHub
hands it the queued job within ~30 seconds, the Mac sleeps again, and GitHub force-fails
at the communication timeout. Three failures, all exactly 600s. The corroborating detail
is the giveaway: on #91 the Checkout step took 10m17s where it normally takes 3 seconds,
and on #90 the runner was still reporting step results 19.5 minutes AFTER GitHub had
declared the job failed. Read the job's step timings before diagnosing from runner
status. #96 now retries these automatically (3 per SHA, then a handoff issue), but that
is mitigation: a healthy build needs 3–10 minutes against a 600-second window, so every
retry is a coin flip. **The cure is on the Mac.**

**`cancel-in-progress: true` destroys queued runs, not just in-flight ones.** Until #95,
a build waiting for the sleeping Mac was shot by the next merge — run `31774333122` was
cancelled with `runner_name` empty and `started_at == created_at`, never assigned, at the
exact second the following run was created. Run `31774443175` was cancelled 34 seconds
into a live archive. Note what that first one also proves: a run merely *waiting* for a
runner holds the group's ACTIVE slot, not the pending one, which is the fact the whole
fix rests on and which GitHub's docs do not spell out.

**Never retry a build with `gh run rerun`.** It replays the run's ORIGINAL head SHA —
attempt 3 of #90 ran 24.5 hours after attempt 1 on the same commit. Since
`scripts/ios-testflight.sh` reconciles the build number against App Store Connect, a
stale rerun uploads older code carrying a HIGHER build number, making stale code the
newest TestFlight build. Use `gh api repos/<repo>/dispatches -f event_type=ios-testflight`,
which builds master HEAD. #96 does this.

**A terminal screenshot does not tell you which machine ran the command.** During the
2026-08-24 auth outage the first `gh auth login` was run on the Mac (`ethanibennett@mac ~ %`)
while the broken box was Windows; nothing changed and the second attempt looked like a
repeat failure. Check the prompt, or check `hosts.yml`'s mtime.
**Not every "messy" name is a defect.** `mtt-series-watcher`'s
`src/normalize/event-name.ts` has a deliberate rule that a lone variant token
drops the separator — `NLH Flight A` is correct, and `NLH - Flight A` would be
the regression. 151 rows match that pattern. Read the rule before "fixing" it.

**Derived columns do not update themselves.** `event_name` and `game_variant` in
the watcher DB are derived from `name_raw` at collect time, and the emitter reads
the stored column. Fixing a normalizer therefore reaches **nothing** already
collected — a plain `npm run emit` changes zero rows. Run `npm run
renormalize:names` first. Re-deriving `game_variant` is safe in one direction
only: `game_type_long` was never persisted, so a recompute has less information
than the original call and can only be trusted to replace the `'NLH'` fallback.

**The MTT feed has TWO write paths, and they drift.** `ingestMttFeed()` (local,
boot + hourly :20) and the `/api/tournaments/feed-sync/:token` receiver
(`server.js:11331`, what prod runs) each have their own INSERT/UPDATE column
lists. #87 found `structure_sheet_path` in the receiver but not in
`ingestMttFeed()`, so a full local ingest wrote **0** rows while the code looked
done. Add a feed column to *both*, and verify by ingesting into a DB copy and
counting — not by reading the receiver. Note `pushMttFeedToProd()` does
`SELECT *`, so anything the local path stores reaches prod for free.

**Structure sheets are hunted, not just read.** Beyond PokerAtlas's ~28%, the watcher now hunts
venue sites (`mtt-series-watcher/src/structures/`, `npm run hunt`, hourly before emit). Wynn is
the first resolver: bundled per-series PDFs matched to events on `total_buy_in` + `guarantee`,
emitted as `<pdf>#page=N`. Live count went 0 → 246 → **301** rows. Adding a venue is one module
there, not a change here — this repo needs nothing further. PokerAtlas itself is exhausted: no
per-tournament endpoint, and its event-page HTML holds nothing the API does not.

**Structure sheets come from the watcher, not from here.** PokerAtlas exposes
`structure_url` / `blind_structure_link`; mtt-series-watcher has always
collected it, but its emitter dropped it until `e58e9ba`. Coverage is
per-series all-or-nothing (Legends of Poker, Summer Colorado, WPT bestbet,
WSOPC Atlantic City ~100%; Wynn and most WSOPC zero) — 246 of 2,388 rows. The
card suppresses the column when `venue.abbr === 'WSOP'` in favour of the
computed WSOP PDF, which today affects only the two Horseshoe/Paris entries.

**Feed rows are not this repo's to edit.** Anything with `stable_id LIKE 'MTT-%'`
is owned by the watcher and re-UPSERTed hourly at :20, so a fix applied here is
reverted within the hour. `server.js:9302` documents the contract. The split at
the time of writing was 204 feed rows vs 68 local.

**Test migrations against a DB copy, never production.** Doing so caught a
regression in #74 that would otherwise have shipped: `"Satellite to NLH"` became
`"NLH Satellite -"`, because the variant prepend empties the tail and the
existing trailing-dash cleanup runs *before* it.

**Verify UI at the DOM, not the stylesheet.** Two changes were reported as
"verified" on the strength of computed CSS while the component was on a code path
nobody hit — see #71. Measure the rendered element, not the rule.

**The browser preview pane does not composite in this environment**, so
screenshots time out. Read the DOM with `javascript_tool` / `read_page` instead;
that is what caught the Up Next fallback.

---

## Local environment

**Remote Control.** The PATH install (`%APPDATA%\npm\claude.cmd`) had an emptied
credential record — zero-length access and refresh tokens, and scopes predating
`user:sessions:claude_code`, which is why sessions kept dropping. Fixed by
`claude auth login` on 2026-08-17. `~\Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1`
now wraps `claude` so a plain invocation starts in Remote Control, named after
the directory; `claude -Local` opts out, and subcommands, `-p` and `--bg` pass
through untouched. `ecosystem.remote-control.cjs` (gitignored) holds an unenabled
pm2 definition for a supervised session — revisit its flags against
`claude remote-control --help` before enabling; it was written before that help
was readable.

**Do not start a second server on :3001.** pm2 runs `futuregame-scheduler` from
this checkout. Test on a scratch port with a `DB_PATH` copy, and stop the
watcher's collector before running any migration against `mtt-series.db`.

## 2026-08-24 — Replayer: catalogue one implemented, catalogue two published

**Shipped (PR #104, branch `feat/replayer-cards`, 8 commits)** — all 100 items of
the first replayer catalogue. Grouped by surface: cards 1-14, table and seats
15-45, motion 46-60, chrome 61-80, exports 81-100. The dominant pattern was
finished work that was never connected: the action timeline (fully styled CSS,
setting defaulting to **true**, a panel row advertising it, no markup),
`spawnFlyingChips` (no callers), `calcSPR` / `estimateRange` /
`calcShowdownEquity` / `.replayer-seat-pos` / `.replayer-chip-delta` (all
complete, none rendered), landscape fullscreen (computed, listened for by a live
matchMedia listener, applied to nothing).

**Not merged.** Build is clean, `node --check server.js` passes, both chunks
parse, and a cross-component scope audit ran — but nothing has been rendered in
a browser. Worth eyeballing the felt, the settings sheet and one export first.

**Found in passing, both pre-existing:**
- `toast` was referenced throughout `HandReplayerReplayView` but declared only in
  the outer `HandReplayerView`. Optional chaining does not save an *undeclared*
  identifier, so every GIF export's completion toast has thrown a ReferenceError
  since f701013 (2026-05-19). Fixed in this branch.
- The whole saved-hands API block is registered **twice** in `server.js` (~7168
  and ~7292). Express serves the first; the second is dead. Spawned as its own
  task, not fixed here.
- `/api/hands` is not the endpoint the replayer calls — it uses
  `/api/replayer/hands`, which spreads the entire `hand_data` blob into every
  list row. Anything the picker needs is already client-side.
- esbuild reports one `Unexpected "@media"` CSS warning in `styles.css`. It
  predates this work (reproduced against `fd45213`) and is still unexplained.

**Catalogue two — published:** https://claude.ai/code/artifact/2ab02148-2c58-4adc-a456-7c6c09f70545
100 craft items with 100 live before/after specimens built from the replayer's
own materials. Nothing in it is a bug; it is about agreement — the rail is lit
from two directions and the felt from one, four objects within 40px cast four
different shadows, nine corner radii, eleven kinds of information at one type
size. Three items are consequences of the first pass and say so.

Build systems for both catalogues are in the session scratchpad
(`scratchpad/replayer/` and `scratchpad/polish/`), not the repo.

## 2026-08-25 — Replayer polish catalogue implemented (99 of 100)

All of catalogue two is in on `feat/replayer-cards` ([PR #104](https://github.com/ethanibennett/futuregame-scheduler/pull/104)),
eight more commits. **22 was skipped** (felt wear and history) and **26-29 were
reverted** after review — the white-stock deck, the edge band, the mirrored
index and the twelve court panels are out, and everything retuned for white
stock went back with them (the warm rim light is load-bearing again, because
all four suit fills are darker than the felt's dark stop).

**The big ones:** the rail was lit from two opposite corners while everything
else described one source. The table is a container now, so the rail, the cards
and the weave scale with it instead of being three fixed sizes on a fluid box.
The felt went from a 1:1.59 portrait oval — a shape no poker table has — to
1.30:1, and the seat coordinates are derived from the inset rather than being
ten hand-written tables holding a copy of it. Eleven kinds of information at
one type size became three tiers. Four shadow directions became one. The
transport bar joined the table's world. The four "Coming Soon" sounds are built
(Web Audio, synthesised, no assets).

**Verification changed this session.** The build cannot see a runtime error, and
the previous pass shipped two: `toast` referenced out of scope, and the
chip-flight effect's dependency array naming three consts declared further down
the component — a dep array evaluates on every render, so the render sat in
their temporal dead zone and the replay view threw into its error boundary.
There is now a scan for that pattern (`dep arrays naming a later const`), and a
render harness: `scratchpad/harness/` inlines the built stylesheet and the real
card SVGs into a static page and screenshots it with headless Edge
(`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe --headless=new
--screenshot=...`). Rebuild it with `python refresh.py` after any build.

That harness caught four things reading could not: **ALL-IN rendered as a solid
purple slab with no text**, because the generic per-action colour rule sets
`color: var(--act-allin)` over the badge's own purple ground; the deck landed
on the button player's cards; the board ran under the mid-height side plaques
(pre-existing, and worse before this pass); and the pot sat hard against the
top edge of the shallower felt.

**Still unrendered:** the React logic. The harness is static markup, so autoplay
pacing, the count-ups, the rewind cross-fade, the bookends and the exports have
not been exercised. The Chrome extension's PreToolUse hook times out on this
box, which is what forced the harness route.

### 2026-08-25 (later) — merged and deployed, and how the last three bugs were found

`master` at `4ca6371`, deployed, production serving `index-3BTCZ7pL.js`. The
merge went out clean; Render 502s for a minute or two mid-deploy, which is
normal.

The static harness was not enough. Driving the REAL app through Chrome DevTools
Protocol found three more things it could not:

1. **A paragraph of source comment rendering on the page** above the table. A
   block comment in JSX *children* position is text, not a comment — React
   renders it and the build says nothing, because it is valid JSX. Check for
   it by grepping the built bundle for your own comment text: esbuild strips
   real comments, so anything that survives is being rendered.
2. **The replayer crashing into its error boundary on mount** — a third
   temporal-dead-zone bug. `scripts/tdz_scan.py` now covers `const NAME`,
   `const { A, B }` **and** `const [a, b] = useState()`; missing the last form
   is why the scan reported clean while the app was dead.
3. **Shared `#h/` links have never worked for their audience.** The replayer is
   admin-only and a share link is the one way anyone else sees a hand — but the
   replayer consumes `initialHand` and calls `onClearInitialHand`, which nulls
   `sharedHandData`, and the tab was gated on `isAdmin || sharedHandData`. The
   table rendered, cleared itself, and the visitor got "Coming Soon". Fixed by
   remembering that a hand *arrived*.

**The CDP smoke test** is `scratchpad/harness/live.mjs`. It mints a guest token,
opens a shared-hand link, steps the transport, and reports every console error.
`SMOKE_ORIGIN=https://futurega.me node live.mjs out.png` runs it against
production. Two things to know if you rebuild it: navigating from `/` to
`/#h/...` is a *hash* change and never remounts the app (use a different path),
and Edge caches `index.html`, so disable the network cache or you will test the
previous build.

## 2026-08-25 — "the table moves" turned out to be three different bugs

"The table should remain absolutely static and unscrollable" cost three
separate fixes, and each one only became visible after the one before it:

1. **It slid.** The timeline's `scrollIntoView` was scrolling every scrollable
   ancestor, including `.replayer-replay`. Scroll the strip itself
   (`el.scrollTo({left: dot.offsetLeft - el.clientWidth/2 + ...})`), never the
   element.
2. **It was sized by a guess.** `width: min(100%, (100vh - --header-h - insets
   - 140px) * 0.6667)` was standing in for a layout the browser already knew,
   and it did not know about the admin tool rail (two rows of pills, ~110px,
   admins only) or the hand title row — and `100vh` in a standalone iOS webview
   is the whole window, while Chrome's device emulation reports the content box
   and applies no safe-area insets. That is the entire "Chrome iPhone 16 Pro vs
   a real iPhone 16 Pro" divergence. Now: `.replayer-table-slot` is a size
   container (`container-type: size`) and the table is
   `height: min(100cqh, calc(100cqw * 1.5))`. No viewport units.
3. **It resized.** Layout-derived sizing means anything that grows below the
   table shrinks it, and the pot-odds line, hand-strength bar, draw bar and
   result banner all appear and disappear mid-hand. Now the strips share one
   `.replayer-under` region of declared height (`min(34%, 180px)`, scrolls
   inside) and each keeps its own box for the whole hand with its contents
   hidden — reserved with the real markup, not a pixel constant. In landscape
   that region floats over the felt instead of taking a share of the column.

**Trap for next time:** `.replayer-landscape` is `position: fixed; inset: 0`.
Re-declaring `position` on it in a later rule silently un-fixes the whole
landscape view and drops it back into the 600px content column — the table went
from 1257px wide to 600.

**Harness** (all in the session scratchpad, all CDP against the real app as a
guest): `move.mjs` records the table's rect at every step and prints
`DISTINCT left/top/width/height` — 1/1/1/1 is the pass condition;
`fit.mjs` checks fit at a given viewport (`FIT_W/FIT_H/FIT_DPR/FIT_DESKTOP`,
and `FIT_SIM` injects the admin rail and iOS safe areas that emulation omits);
`prod.mjs` does the same against production, where the local guest token is not
a credential, so it takes the door a visitor takes — Continue as Guest, then
the `#h/` link.

### The test data was hiding the bug

"It's all wrong everywhere" on the phone, while every fit test passed. Both
were true: the table was inside the viewport, and the furniture on it was on
top of itself. The harness could not see it because the smoke hand's players
are called **"Opp 1"** through **"Opp 5"** and the app's own
`DEFAULT_OPP_NAMES` are **"Cristian Gutierrez"** and **"Keith McCormack"**. A
plaque is as wide as its name.

**Any harness for the replayer must use `DEFAULT_OPP_NAMES`, not the shorthand
defaults.** `overlap.mjs` injects them at full length and reports every pair of
table objects whose boxes intersect; zero is the pass condition.

The instinct at that point was to detect the browser or the app. It would not
have helped — a desktop browser renders the same collision with the same data,
and the fix was four absolute sizes on a container-scaled object:
`.replayer-seat-info { min-width: 72px }` (the one that mattered),
`.replayer-seat-name { max-width: 88px }`, `--card-h`'s 38px floor and
`.replayer-seat-stack`'s `--fs-sm`. Rule of thumb: **on the table, a px floor
is a legibility limit and the design token is the ceiling** —
`clamp(<floor>, <n>cqw, <token>)`. Anything else stops scaling before the table
does and collides.

Also: the harness guest **token expires**. A stale one lands on the login
screen and every probe reads as "no table", which looks exactly like a
rendering fault. All four harnesses click *Continue as Guest* now instead.

## 2026-08-30 — the replayer table, rebuilt around a grid

The table is now **full-bleed** (portrait replay does what landscape always
did: `position: fixed; inset: 0`, app chrome hidden, transport in flow at the
bottom, Back is the way out) and laid out on a **16 × 32 grid**.

16 × 32 is not arbitrary: the table is about one-to-two, so those cells come
out **square** (23.3 × 23.2px at 393×852). A square cell means a step is the
same distance on both axes, which turns the seat geometry into counting — the
even-perimeter spacing I first solved as `corner² = 17.6² + (35−d)² = d²`
(d = 21.9% of the height) is just **seven cells** on the grid. Layout lives in
`gx(col)` / `gy(row)` helpers: felt inset to col 2 / row 3, seats on columns
2.5 / 8 / 13.5, rows 5 and 27 (ring midpoint row 16).

### The bug pattern that cost the most time

**A value that looks like it scales but is pinned by something downstream.**
Five instances this session, and every one read as "the design is wrong" until
it was measured:

- `clamp(9px, 5.4cqw, var(--fs-sm))` — the cqw term wanted 20px, the token
  ceiling held it at 13. The comment said "the token is the ceiling, held from
  about a 250px table upward", which was true when the table WAS 250px. It is
  373 now. All the felt's type had stopped growing with the cloth.
- `transform: translateX(-50%)` plus an animation whose keyframes set
  `transform` — a keyframe REPLACES it, and with `fill: both` it never comes
  back. The action badge and the winner's hand name were each off-centre by
  half their own width, permanently. Grep for elements that are centred by a
  transform AND animated; there should be none.
- `background-position: <percentage>` on a gradient — percentages resolve
  against (box − image) and a gradient's image IS the box, so the shift is
  always exactly zero. No chip had ever been rotated.
- Absolute px floors on container-scaled objects (`min-width: 72px`,
  `max-width: 88px`, `height: 56px`, `radius = 85`). **On the table a px value
  is a legibility floor and the design token is the ceiling** —
  `clamp(<floor>, <n>cqw, <ceiling>)`. Anything else stops scaling before the
  table does and then collides.
- Two drawings of one object: the pot's chip and the seat's chip differed in
  aspect, edge and overlap. One rule, `--disc-w` the only variable.

### Harness (session scratchpad, all CDP against the real app as a guest)

`overlap.mjs` is the one that matters. Zero overlapping pairs and zero clipped
is the pass condition, and note two things it learned the hard way:

- it measures the **union of the card elements**, not `.card-row` — a splayed
  fan is absolutely-positioned children that overflow their row, so the row
  box reads 60px where 121px of card is drawn. Every "0 overlaps" measured
  against the row was measured against the wrong box.
- it injects `DEFAULT_OPP_NAMES` at full length. See the earlier note: the
  smoke hand's players are `Opp 1`–`Opp 5` and a plaque is as wide as its name.

Env: `OV_SEATS` (2–9 or `T`) swaps the player-count character in the share
link; `OV_HAND` supplies a whole hand (the smoke hand is triple draw and has
no community board); `OV_STEP=end` or a number steps the transport;
`OV_GRID=16x32` overlays the grid and reports how far object CENTRES sit from
a grid line (median 0px, worst 3px currently). `move.mjs` still asserts
`DISTINCT left=1 top=1 width=1 height=1`.

## Online tournaments — where the plan stands (2026-09-14)

Plan: `C:/Users/ethan/.claude/plans/logical-strolling-swing.md`. Watcher lives in
`D:/projects/online-poker-watcher` (committed locally, **not on GitHub** —
pushing it is outward-facing and is Ethan's call).

Done: feed separation (#237), the `is_online`/`site` columns, the ACR adapter and
emitter (701 rows live), the Online toggle (#239), the bracelet/timezone fixes
(#241), and jurisdiction + availability (#242).

Adapters: ACR, **GGPoker**, **WSOP.com** and **Phenom** all ship. Live feed is
1,199 rows — ACR 701, GGPoker 370, Phenom 128, WSOP.com 0 (its 2026 bracelet
series ran May 30–July 14; a schedule of finished events is not a schedule, and
it will fill again when the next series is announced).

**ClubWPT Gold now HAS an adapter** — reversed on 2026-09-14. Its web bundle
carries no schedule, but a separate protobuf backend (mttapi.clubwptgold.com,
found via cert transparency) does. It is TOKEN-FED: the watcher reads a ClubWPT
session token from the watcher repo's gitignored `.env` (CLUBWPT_TOKEN) and never
logs in. The token is a live real-money-account session and EXPIRES — when it
does, the ClubWPT list is carried forward (not pruned) and the emitter logs "the
list is going stale"; refresh it by capturing a new token from a logged-in
browser (DevTools > Network > tournamentList) into that .env and
`pm2 delete online-poker-watcher && pm2 start ecosystem.config.cjs` (a plain
restart does NOT re-read interpreter_args, so the --env-file flag needs the
delete+start). Live: 36 ClubWPT events in the scheduler.

**PokerStars/FanDuel and BetMGM have no adapter and will not get one**, because
they publish no schedule anywhere reachable — every PokerStars
domain terminates at a 235-byte redirect shell, BetMGM's only schedules are blog
posts behind `Disallow: /`, and ClubWPT Gold's bundle has no tournament route at
all. That is a finding, not a gap: an adapter needs a source. See the watcher's
`docs/sources.md` for the evidence per site.

**The collector loop runs.** pm2 app `online-poker-watcher` (its own
`ecosystem.config.cjs`), one persistent process that emits at :10 past the hour
and at boot — deliberately NOT a pm2 `cron_restart`, which mtt-series-watcher
already learned silently stops firing. The scheduler ingests at :20 and the MTT
watcher emits at :15, so :10 shares a minute with nobody. `pm2 logs
online-poker-watcher` shows one block per run with a per-source tally.

WSOP.com now also has the monthly gold-RING Circuit series, 10 events live.

Not done: the watcher's append-only raw-response archive (it fetches, normalizes
and emits in one pass, so the only record of what a source said is the current
feed and the captured fixtures); and the payload work — `compression` middleware
plus a date window from the client, since `/api/tournaments` accepts
`startDate`/`endDate` and `App.jsx` sends none. The table is 3,302 rows.

### Traps this work has already paid for

- **`online-sites.js` lists expire, and review sites are not sources.** Every
  record carries `verifiedOn` and `evidence`. #242 took ClubWPT Gold's deny-list
  from a review page and shipped SEVEN states where the operator names eight —
  Arizona missing, so an Arizona player was told the room was open to them
  (fixed in #243). The watcher's recon doc had already recorded that the
  secondary sources contradict each other and must not be encoded. **Take a
  state list from the operator or not at all.**
- **A buy-in floor is per room, not per dollar.** ACR tops out at $25,500 and
  Phenom at $500; one $200 rule kept 10 of Phenom's 186 rules, switching the
  room off rather than filtering it. `SITE_FLOORS` in the emitter, overridable
  with `ONLINE_BUYIN_FLOOR_<SITE>`.
- **pm2 fork mode never runs your script as `argv[1]`.** It runs its own
  `ProcessContainerFork.js` and imports your module, so every argv-based "am I
  the main module?" guard answers false under pm2 — `main()` never runs, the
  event loop empties, the process exits 0, and pm2 logs "exited via signal
  [SIGINT]" with two EMPTY log files. No stack, no error, because nothing ran.
  A pm2 entry must do its work as a top-level side effect with no guard, and
  keep anything importable (therefore testable) in another module.
- **An empty manifest is a failed emit, not an empty schedule.** Both halves are
  guarded now — the scheduler skips ingest on a manifest with no series (#244),
  and the emitter refuses to write one. Losing the feed should take two
  independent failures.
- **Don't write off a promo page because its schedule is an image.** WSOP.com's
  Circuit schedule renders as a JPG, which the recon read as "not collectable" —
  and the same page links the promotion's T&C as a **PDF** with the whole table
  in text. A live series with $1.5M in guarantees was invisible for want of
  opening the second link.
- **`git add -A` committed a 1.5 MB scratch DB and a debug file** in one
  afternoon. Both now ignored by pattern (`scratch-*.db`, `*-diag.txt`).
- **A published schedule keeps its finished events on it.** WSOP.com's page
  still lists the whole 2026 series; GGPoker's `/wsop-online/` lists bracelets
  back to August. Every adapter drops instances at or before the poll time, or
  the scheduler fills with tournaments that already played.
- **Never clone a feed row to seed test data.** A row with
  `source_pdf='online-feed'` whose venue is not in the manifest is deleted by the
  next ingest's prune, silently, at boot. Seed with a different tag.
- **The two feeds' timezone agreement is load-bearing.** The emitter normalizes
  every site to Eastern (`emit/online-feed.ts`, `DISPLAY_TZ`); the scheduler
  labels a card from its venue's zone and defaults an unknown venue to PACIFIC.
  `online-sites.js` supplies the prefix-to-zone map that bridges them. Change
  either side alone and the card states a correct time in the wrong zone.
- **A backslash does not survive CDP `Runtime.evaluate`.** A regex literal sent
  as part of an expression string arrived with its escape stripped and matched
  nothing, while a plain literal beside it matched five rows — which reads
  exactly like a filtering bug and cost several cycles. Build regexes in-page
  with `new RegExp('...')`.

## A backer token is exposed and is NOT being rotated — deliberate, 2026-09-14

One backer's token (David Mulle) was committed to this PUBLIC repo inside a
scratch database copy, commit 4d52085. The force-push removed it from master but
GitHub still serves unreachable objects by SHA — verified, the blob still
returns 1,564,672 bytes. The token grants READ access to his private page: name,
stakes, opening and cumulative figures, and five session results. Read-only; no
write, nothing financial to move.

**Ethan decided not to rotate it.** Changing the link breaks the one he has
already sent. Do not rotate it without asking him again — the earlier
instruction to rotate was withdrawn.

The mechanism EXISTS and is tested if that changes: dashboard -> Backers ->
"New link", which re-keys backer_public, backer_events and backer_push_subs via
the roster seam (futuregame-scheduler#250). scripts/test-backer-rotation.mjs.

The remaining mitigation is a GitHub Support request to purge the unreachable
objects from ethanibennett/futuregame-scheduler at 4d52085. That is now the only
thing that reduces this exposure.

## DASHBOARD_TOKEN rotation — COMPLETE (2026-09-15)

`DASHBOARD_TOKEN_PREVIOUS` was unset on both Render services and both were
redeployed to reload env — the old token is now dead. The final laggard was NOT
the phone or the screensaver: it was **this box's own local pm2 scheduler**,
which had the OLD token live in memory and hit the dashboard's roster seam hourly
with it. Its `ecosystem.config.cjs` already held the CURRENT token — but
`pm2 restart <name> --update-env` reads the SHELL env, not the config file, so
every restart this session kept the stale in-memory value. Fixed with
`pm2 delete futuregame-scheduler && pm2 start ecosystem.config.cjs && pm2 save`
(a full config re-read), verified by SHA. Post-restart the boot roster sync went
out on the current token with zero PREVIOUS warnings. iOS build 17 (installed +
open) covers the phone. The one consumer never directly verified was the Mac
screensaver config JSON; if it 401s, update its token to the current value.

History below kept for the next rotation.

--- (during the rotation) ---

Both services accept the new token AND the old
one (`DASHBOARD_TOKEN_PREVIOUS`), so nothing is locked out.

Done: Render scheduler, Render dashboard, local `ecosystem.config.cjs` (which
now DECLARES the token — it previously existed only in pm2's saved dump with no
declared source, so a `pm2 delete` would have dropped it and roster sync would
have stopped silently), and the GitHub secret in wsop-console.

All nine pm2 apps are on the new token (verified by SHA-256, 0 stale).

STILL ON THE OLD TOKEN — these are why PREVIOUS must stay set:
  * installed iOS/Watch builds — needs a TestFlight build (the GitHub secret is
    already updated, so the next build picks it up)
  * the Mac screensaver config JSON

⚠ `pm2 kill` + `pm2 resurrect` does NOT fix a stale env var. Resurrect restores
each app's env FROM THE DUMP, and the dump wins over the shell — every app came
back with the old value even though the reviving shell exported the new one.
Only `pm2 restart <app> --update-env`, from a shell that exports the new value,
re-reads it. The one app that was already correct was the scheduler, because its
gitignored ecosystem.config.cjs DECLARES the token rather than inheriting it,
which is the pattern the rest should move to.
cash-game-watcher's ecosystem.config.cjs is TRACKED — its token must never go
there.

When `[dashboard-token] … authenticated with DASHBOARD_TOKEN_PREVIOUS` stops
appearing in both services' logs, every consumer has caught up: unset
DASHBOARD_TOKEN_PREVIOUS on both Render services and the old token is dead.

⚠ Render does NOT redeploy on an API env-var change, and `POST /services/:id/restart`
does NOT pick up new env either — it created no deploy at all. Only
`POST /services/:id/deploys` does. Two rounds of verification said the rotation
had failed when it had simply never been loaded.

## Rotating DASHBOARD_TOKEN

It is ONE shared secret gating both dashboard seams in both directions, compared
byte-for-byte at each end — and it has SEVEN copies:

  1. Render env, scheduler (futurega.me)
  2. Render env, dashboard (dashboard.futurega.me)
  3. local `ecosystem.config.cjs`  (the local pm2 instance really does sync)
  4. GitHub secret `DASHBOARD_TOKEN` in wsop-console (materializes DashboardSecret.swift)
  5. **installed iOS/Watch builds** — compiled in; only a TestFlight build updates them
  6. cash-game-watcher (APNs alert seam, sent as a header)
  7. the Mac screensaver's config JSON

`DASHBOARD_TOKEN_PREVIOUS` is accepted for INBOUND checks so the seven can be
rolled one at a time. Outbound calls always present the CURRENT value, so a
rotation cannot settle back onto the old secret.

    1. set DASHBOARD_TOKEN_PREVIOUS = the current value on BOTH Render services
    2. generate a new one:  openssl rand -hex 32
       (must match /^[A-Za-z0-9]{6,64}$/ — both ends shape-gate before comparing)
    3. set the new DASHBOARD_TOKEN in all seven places
    4. ship a TestFlight build, or every installed phone stays on the old value
    5. when `[dashboard-token] … authenticated with DASHBOARD_TOKEN_PREVIOUS`
       stops appearing in either service's log, every consumer has caught up
    6. unset DASHBOARD_TOKEN_PREVIOUS on both services — the old token is now dead

The warning in step 5 is throttled to once an hour, so a consumer polling every
minute cannot bury it. Tests: `node scripts/test-dashboard-token.mjs` here and
`node server/test/dashboard-token.test.js` in wsop-console — the same 24
assertions, because the two files are two ends of one handshake and a
disagreement breaks the seam in one direction only.

## Open to-dos (asked for 2026-09-14, not yet started)

Three UI items raised while the online-tournaments work was in flight, kept here
so they survive a compaction:

- **Bring back the event-number pills.** They were on the card and are gone.
- **Variants in the event card need a better solution.** HORSE renders correctly;
  9-Game does not. The mixed-game variant list is the general case and the fix
  should be one that covers any N-game mix rather than another special case.
- **New card graphics for the replayer.**

Added 2026-09-30:

- **Add BetMGM as an online room.** The 2026-09-14 recon found no public schedule
  (its only schedules are blog posts, and its `robots.txt` disallows everything; see
  the online watcher's `docs/sources.md`). The route that has worked since is the
  app's own traffic: ClubWPT Gold became token-fed after a capture, and the Bravo
  and PokerAtlas clocks came from phone captures (mitmproxy setup in the
  2026-09-30 entry). Capture the BetMGM Poker app's lobby, document the endpoint in
  the watcher's `docs/`, then add the adapter. The scheduler side already knows the
  site (`online-sites.js`: `betmgm`, regulated, state allow-list), so rows only
  need `site: 'betmgm'`. Respect the watcher rule: if the endpoint is gated,
  don't work around the gate.

~~Also outstanding from the same day: the event card's start time and buy-in are
NOT baseline-aligned … deliberate as of #236.~~ **Superseded 2026-09-25.** The
card is on the grid now: time and buy-in share the 32px row baseline, the
guarantee sits one subrow below the buy-in on its own line, and the name is on
64 — 96px cards, 120 with a Flight/Day line. The #236 collision was solved by
gridding row 1 (`.cal-bar-row1`: `1fr` + a 3-subcolumn money column) rather than
by abandoning the baselines.

### Trap: the share-link codec collided game codes with player counts

`encodeHand` writes `gameCode + numPlayers + heroIdx` with no separator, and
several codes ARE another code plus a digit (`P8`=PLO8, `N8`=NL Stud 8,
`PT`/`LT`). Six game/size combinations decoded as the wrong game with the
wrong player count and hero — including 8-handed NLH and 8-handed PLO. Fixed
by picking the candidate code that leaves exactly two characters. **If you
touch `GAME_CODES`, re-run a full round-trip over every game × every size.**
