# Session handoff — scheduler

Rolling handoff for a fresh Claude Code session on this repo. CLAUDE.md is the
*architecture* handoff (topology, hazards, conventions); this is the *state*
handoff — what just changed, what is waiting, and the traps worth knowing before
touching any of it.

Last updated: 2026-10-14, night (from Windows) — see the night section first, then the evening one. Earlier notes: 2026-10-13, then 2026-09-30, live
tournament clocks + the event audit fixes (below). Before it, 2026-09-28, the
Dashboard grid pass + Schedule header-peek fix (`df32787`, pushed to master).
Below it the 2026-09-25 Schedule grid sweep, then the dated sections back through
2026-08-30; "Seams to the dashboard" and "The build pipeline" were added from the
wsop-console side and verified against both live services.

---

## 2026-10-16 — Didn't play on Results; the result edit crash; replayer fixes
- **Didn't play (owner):** the Bankroll tab's awaiting-result card has Didn't play beside Log Result. It opens a card form with Notes; Save marks the event not played (user_schedules.not_played, the home's To log action) and keeps the note in the new `user_schedules.not_played_note` (PUT /api/schedule/:id/played takes `note`; marking it played clears it). The event then shows as a Didn't play card among the results by date, with Edit (the note) and Played it (back to awaiting). Not a result: no buy-in, ROI, ledger or backer figure moves. The home's To log Didn't play is still one tap with no note. test:home-log covers the note.
- **Fixed:** editing a logged tournament result blanked the screen for the owner (the Posts-to-backers preview read a tournaments list the edit form is never given), 2026-10-14 to 10-16. Renaming the hero in hand entry moved them to seat 0. Replayer: ALL-IN in the stack figure's type, 3r action pills, no street in the level line (owner).
- **Open:** the owner reports Up Next showing events they never added and missing ones they did. Server query, feeds and this week's commits check out; production's six upcoming events were listed to the owner, waiting on which screen and which events.
- **Review branch** `feat/replayer-catalogue-3`: ideas 7, 8, 11, 12, 46 built, not merged; 37 needs a table-size field (owner). Celebrations catalogue (50 ideas): https://claude.ai/artifact/Th5rd41L7CfeTugoRTTAKH, waiting on picks.

---

## 2026-10-15 (13:07 ET) — Mid-Atlantic clock check: the room's real clock comes through
- **Bravo, while afternoon events ran:** a live clock at Borgata, Live! Philadelphia, Parx, Maryland Live! and MGM National Harbor (1 each). None at Harrah's AC or Horseshoe Baltimore (none at 00:25 either). Wind Creek Bethlehem is not on Bravo.
- **Through the app** (local server, POST /api/live-clocks): Borgata and Parx, the two rooms with events in today's feed, both returned running Bravo clocks (level 6 with blinds and antes).
- **For Ad 2 (launch plan):** "The room's real clock" holds in the Mid-Atlantic cut for Borgata, Live! Philadelphia, Parx, Maryland Live! and MGM National Harbor; film it on a Borgata or Parx event. Not Harrah's AC, Horseshoe Baltimore or Wind Creek.
- **Caveat found:** Borgata's 5:15 PM Lions of the East flight (not yet started) was matched to the morning flight's running clock: Bravo matching is by event, not flight. The dashboard only asks after an event's start, so it is hidden today, but two flights of one event running at once could show the wrong one. **Fixed the same hour:** the client now sends each event's start, and matchBravoClock estimates a clock's start from its level (bravoStartedAt): no clock for a flight more than 30 min before its start, the nearest start among clocks sharing a number, none when the only clock began over 4 h before this flight. Checked live: the 5:15 PM flight now gets none, the 10:15 AM keeps its clock. test:clocks (6 new cases).

## 2026-10-15 (morning) — App Store purchases on the account; Admin growth screen; catalogue three cont.
- **Apple billing, server side:** `lib/billing/apple.js` verifies StoreKit 2 transactions and App Store Server Notifications v2 against Apple Root CA - G3 (downloaded from apple.com, fingerprint checked), maps product ids to plans, ties purchases to accounts by `appAccountToken`, and keeps the `subscriptions` row current on renewal, grace, expiry, refund and revocation (idempotent by notificationUUID). Replaces the logging-only webhook. Tests: `test:apple-billing` (8), `test:account` (22, covers `apple_notifications`). **Owner:** create the six products and set the notification URL (`docs/app-store-listing.md`, "In-app purchases"). **Mac:** the StoreKit plugin.
- **Paywall switch:** `GET /api/subscription` now carries `paywallLive` and `features` (lib/billing/features.js, MONETIZATION-PLAN.md §6 as written); `PAYWALL_LIVE=1` turns gating on, unset = every feature open (today). `hooks/useSubscription.js` reads it (has, limit), unused until screens gate. **Owner, before 1 March:** §6 gates conflict detection behind Pro while the launch plan leads every ad with the clash check; decide which wins. StoreKit plugin handed to the Mac (issue #279).
- **Growth, round two:** four more once-per-account moments (onboarded, result_logged, share_sent, followed) and saves in the first week, shown as Admin → Growth's "First week" line; UTM tags (utm_source/medium/campaign/content) and ct/src captured on ANY landing, first touch only, never on a backer page and only the first path segment (deeper ones can be tokens); click ids deliberately not kept.
- **Lighter app start:** the backer page, the /live fallback, the admin grid overlay, the setup wizard and the export sheet load on demand (main bundle 712 KB to 671 KB). **Export sheet** fixed onto the grid (a 1.5r gap set the bottom-anchored sheet half an r off; it had never been measured: the guard view needs saved events). **Full suite green** (all test:* but solver): two stale tests fixed, the Overview's seventh section (Phase 10) and the watchdog's history cases GitHub has aged out.
- **Landing page split:** futurega.me/live is its own Vite page (180 KB of JS against the app's 900 KB); `live.html` is generated from index.html on every Vite start. Trap found on the way: the landing page lost `analytics.css` (it came from the app bundle), so it imports it now. The backer page's admin "#" button snaps to the grid at any window height.
- **Attribution, server side:** `lib/attribution.js`: SKAdNetwork and AdAttributionKit postback copies stored at `/.well-known/skadnetwork/report-attribution/` and `/.well-known/appattribution/report-attribution/` (anonymous, 60/min/IP, 400 for non-postbacks) in `attribution_postbacks`; `POST /api/growth/apple-ads` resolves an Apple Ads token with Apple's attribution API and records the campaign once (`growth_events` apple_ads; the cohort report credits `apple-ads/<campaignId>`). Native half (token post, Info.plist endpoints, conversion values) on the Mac's issue #279. Tests: `test:growth` (growth + attribution).
- **Parser eval from Admin:** Admin → "Hand parser, live eval" → Run the parser eval: the server runs test/quick-add/eval.js with its own ANTHROPIC_API_KEY in the background (lib/admin-eval.js; about 270 model calls, roughly $5-15, 45 minutes), shows progress and keeps the report. No terminal or token needed. It answers launch plan action 2 (open quick add to everyone?). Without the key on the server it says so (503). Test: test:admin-eval (oracle mode, no model).
- **Ratings prompt:** `utils/review-prompt.js` asks after the third saved event or a logged bag, never within an hour of a bust, at most every 120 days; a no-op until the Mac adds the InAppReview plugin (issue #279).
- **Admin → Growth** shows the weekly cohorts. **Replayer:** the turn ring works (it never had); game picker labels centred on their ink.
- **Scheduled:** a one-shot at 13:07 ET today reruns the Mid-Atlantic clock check while afternoon events run. A recurring no-downtime resume was refused by the permission classifier; the owner can start one with /loop.

## 2026-10-15 (night, replayer) — Catalogue three resumed ("Fifty ways to quiet the table")
- **Source:** https://claude.ai/artifact/MAjgSxmsn2vaMMt6t1oCRb (50 ideas, read 2026-08-31). Done directly, not by agents (token budget).
- **Done (batch 1):** 2 (both dead `potCollect` keyframes and the orphan `neonPulse` deleted), 6 (watermark a flat ivory, no blend; the light themes keep their dark mark), 33 (the play button is a ghost, play and pause alike, so the brand fill means only the active turn), 14 (matte dealer button), 27 (a fold's plaque settles at its cards' pace and curve), 34 (a muck keeps its plaque's colour). Also deleted: every `.replayer-chip-delta` rule (rendered nowhere).
- **Moot in today's code:** 39 (the chip delta is not rendered), 40 (undealt cards are not drawn, so nothing is ambiguous). **Likely superseded by springs, to confirm:** 28, 31, 36. **Skipped:** 19 (the pot labels' caps: the owner set them at half the figure's height). **Owner decisions:** 1 (retire three themes), 3 (felt colour picker to swatches), 43, 48.
- **Done (batch 2):** 26 (one held beat, 1200ms at 1x, before the showdown reveal in autoplay; exports step themselves, so videos are unchanged), 17 (the side pots, the last display-face figures on the felt, take the pot's condensed face; the level line was already condensed).
- **Done since:** 4 (the floating SPR and pot-odds badge rules were dead: SPR is text in the pot cell, pot odds sit under the table; deleted).
- **Already true in today's code:** 22 (the level block sits in a bordered pill), 44 (badge offsets are in r, not px).
- **Owner's taste, not done:** 21 (drop "Pot" with one pot: the owner chose POT inline), 23 (ALL-IN light and wide: today's heavy badge is deliberate, "the one action that should stop you"), 24 (the hand name in the display face on the felt).
- **Done (09:00-, after a 6.5-hour idle the owner rightly called out):** 29 + the turn ring itself: `.replayer-seat.active-turn` was styled in August but no code ever set it, so a replay never showed who acts next. The next action's player now gets it until the showdown (`turnIdx`, HandReplayerView.jsx), with one aqua pulse as the turn lands (starts at opacity 0, so exports never show it; reduced motion drops it). That also makes idea 33's reasoning true: aqua fill = whose turn.
- **Superseded by the springs (checked against docs/replayer-springs.md):** 25 (the pot ticks up as each wager lands), 28 (the flop is one gesture, turn/river single placements), 31 (chips squash on arrival), 36 (the pot ships to the winner on the arm spring).
- **Done:** 41 (the inspect panel in the plaque's material with a notch to its seat; street labels ivory, not aqua; the label column fits PREFLOP so every row aligns; the open seat rises above its neighbours). **Already true / not wanted:** 16 (card backs are a user setting with a near-black design), 20 (one formatter; the 100,000 compact threshold is a recorded choice).
- **Done:** 42 (the street in the level line, inside the captured element, so exports say which street). **Moot:** 45 (radius and plaques are both capped in r).
- **Done (afternoon):** 15 (cast shadows tinted by the felt's shade, --shadow-rgb on the table; near-black on the default dark felt, coloured on a picked one), 24 (the showdown hand name in the display face: it is the one line of prose on the table).
- **Decided against, with the reason:** 9 and 13 (a nap and a bounce light would move the felt's brightness profile, which is MEASURED to Casino Royale's; see feltStops), 10 (the owner turned the card highlight down on 2026-10-11: a box-shadow framed the image's box, not the card), 47 (a line at the bets' 42% fraction runs down the sides at about 28% and 72%, through the board's outer cards), 49 (the transport bar already sits on the table's dark ground), 21 and 23 (the owner's recorded choices).
- **Bug found checking 38, fixed:** split-pot share fractions were measured against every chip committed, an uncalled bet included, so a 2,000 pot split three ways with 1,000 returned read "2/9" on each share; now against what was awarded ("1/3"). 38 itself is already covered (#94 groups the row by share). 18 is the owner's rule ("E. Bennett").
- **50 is moot (measured 2026-10-15):** nothing paints outside the table box any more (the rail's outer shadow reaches ~3px against 6-22px of gap at 402x874, 874x402 and 1280x800), and the top seat's overflow already has the capture's 50px pad.
- **Last seven settled (2026-10-15 late):** 11, 12 and 46 built on branch `feat/replayer-catalogue-3` (worktree `D:/projects/scheduler-cat3`), pushed, **not merged: owner review** (before/after shots sent).
  - **11:** one cast function of `--lift`: hole cards 0.6, board 1, dealer 1.4, a chip stack 0.4 + 0.3 a chip, one shadow per stack. Found on the way: `--cast-x: 0` had to become a length, since calc(0 * n) is a number and drop-shadow drops the whole filter.
  - **12:** each straight run one value (its normal), each end a conic round its own centre. The light is a `::before` sized in the rail's own container units, with the inset shading moved to `::after`; landscape uses `@container rail (orientation: landscape)`. The round table takes the conic whole, and the octagon keeps the linear.
  - **46:** `scale` 0.92 (top row) to 1.0 (bottom) by `--seat-depth` from castStyle. The origin is each seat's anchor, so edge seats keep their 1g to the screen edge. Nothing grows. **Owner check:** a scaled plaque's text leaves the r grid.
  - **Moot or decided:** 5 (already one fixed-height `.replayer-under`; the banner and its twin are gone), 30 (the springs spec: "nothing plays backwards"), 32 (the empty state is a list row matching the skeleton, per 78/81; a felt there would bring back the reflow).
  - **Taste:** 35 (ALL-IN shows only where the figure would be 0).
  - **Missed, not started:** 7 (fold the light strip into the rail), 8 (the plaque hairline), 37 (draw the empty seats).
  - **The catalogue itself now carries every idea's status** (live, approval with real renders, your decision, not started, not doing): https://claude.ai/artifact/MAjgSxmsn2vaMMt6t1oCRb (v3, 15 Oct).
- **Guard note, closed:** `button.game-fave-btn "2-7 TD"` (ink dx -0.76 at 1280x800) is fixed by `text-indent: var(--track-caps)`. Re-run 2026-10-15 late: hands-games and the hands-entry views, 162 controls, 0 failing.
- **Focus-ring audit done** (design-tokens checklist). Six form controls had an inline `outline: none` and no ring at all; they now take `.focus-inset`. Pushed as 4ec083a.

## 2026-10-15 (night, last) — Launch plan action 8 drafted; privacy docs caught up; actions 6 held
- **App Store listing:** `docs/app-store-listing.md`, paste-ready: name, subtitle, both keyword sets, categories, age rating, promo text, description (guardrail-clean, no Mac, no provider, no online room), What's New, review notes rewritten for ACR staying, the screenshot list, and what to do after approval. **Owner to supply:** privacy policy CHECK answers (then publish `/privacy`), a support email (`/support`), the review demo account, and the Hands decision (plan action 2).
- **Privacy docs:** inventory §10b, the policy draft §8 and the App Privacy labels (Usage Data: Product Interaction now Yes, linked, Analytics, not tracking) cover the growth measurement. Account deletion now clears `growth_events` and `user_days` (test:account covers them).
- **Landing footer** is the plan's exact wording (1-800-MY-RESET national, 1-800-GAMBLER NJ, not affiliated). Setup's re-run prefill shows the state filter on when nothing is stored (the new default).
- **Held, deliberately (action 6):** `webContentsDebuggingEnabled: false` and dropping the β both wait for the submission build, since TestFlight builds are the store binary; AdServices / SKAdNetwork need native code, which needs the Mac to compile (send as a handoff when it is time).

## 2026-10-15 (night, later) — Launch plan action 5: first-party growth measurement
- **Built:** `lib/growth.js` + hooks: sign-ups record their source (first touch `acqSource`, `?src=`, platform, and the new optional "How did you hear about us?" on the sign-up form); the first save to My Schedule records `activated` once; every signed-in day writes `user_days`. `GET /api/admin/growth?weeks=13` returns the weekly cohorts (activated within 7 days, D7 and D30 once old enough, sources). Accounts made before this have no signup event and are left out of the cohorts rather than guessed.
- **Screen (2026-10-15 morning):** Admin → Growth, last 13 weeks (`GrowthReport.jsx`, `utils/growth-report.js`): week, new sign-ups, activated, D7, D30, and the top sources. **Not yet:** the weekly scorecard's email; native attribution (AdServices, SKAdNetwork) is action 6.

## 2026-10-15 (night) — Launch plan action 3: live-only defaults and futurega.me/live
- **Live-only defaults:** a NEW browser starts with online events off and "available in my state" on (`DEFAULT_FILTERS` and setup's `WIZARD_DEFAULTS` both flipped; CalendarView matches). Any browser with earlier use (saved filters or location, finished setup) has its old online choices written down once first (`migrateLiveOnlyDefaults`, location-prefs.js, called at App.jsx load), so current testers see no change. "Clear all" keeps the online choices. Server setup records now carry `liveDefaults: true`; an older record is read under the old defaults, so a Yes from before still shows online.
- **futurega.me/live:** `LivePage.jsx` (+ `utils/live-page.js`, `live-page.css`) on the backer page's shell: title, lede, the next 30 days' live counts (`GET /api/public/live-summary`: not online, not restarts, not Personal; cached 10 min; 1,236 events / 71 series / 62 rooms on 15 Oct), five features, the buttons, 21+ and 1-800-GAMBLER. No online room, data source or venue named. The App Store button appears once `APP_STORE_ID` + `APP_STORE_PT` (campaign provider token) are set on Render, and carries `?ct=`; until then "On iPhone and iPad from 5 January." Android visitors get "Open the web app". First touch kept in `localStorage.acqSource` for growth measurement. Guards: `live-page` in check:controls and check:clipping.
- **Settle bar:** label "Settle", whole New York days (Saturday "1 day" all day, Sunday morning "Today", Sunday from noon "7 days"); the bar stays exact to Sunday noon.
- **Owner to do:** the official App Store badge artwork (Apple's marketing tools) can replace the text button once the app is listed; set `APP_STORE_ID` and `APP_STORE_PT` then.

## 2026-10-15 (latest) — Backer page round two: subheadings, settlement bar, admin grid
- **Cards:** the "Notes" label is gone; bb/hr sits under the share and its percentage; hours read "6h" (the shared `fmtHours`, so the owner's Backers tab too); 1r more above the notes in an open card.
- **Subheading:** the line under the game is no longer the room. It is the session's own `subtitle` (new column on `tracking_entries` and `cash_sessions`, added at boot when missing), typed as "Subheading" in the result form (Results) and the cash session form; 60 characters, one line; the feed carries it only when set. No subheading = no second line.
- **Total card:** 1r more between "Running total" and the figure; a settlement bar at its foot (the Schedule's late-reg block): "Until settlement" and a countdown to Sunday 12:00 New York time, draining over the week; clock changes handled (tests). Card 19r.
- **Elsewhere:** the graph's "Your share" reads "Balance"; the backer's name is one size smaller (2xl to xl, baseline re-seated, measured on line 4).
- **Admin grid:** a device signed in to the app as an admin (token in localStorage) gets the "#" toggle on backer pages; backers never see it.
- **Then (same day):** the name and the total's figure each sit in a 3r row (the figure one size down, 3xl to 2xl); the total card's rows are 1r further apart (label r3, figure r9, stats r13, divider r15, settlement r19, bar r20-21; 23r). The extra space on the right of a desktop window is a classic scrollbar's lane (the column widens by it so content keeps 37g; owner: makes sense); the theme button now sits 1g inside the content there, not over the scrollbar.
- **Guard fix:** `check:controls` read an in-flow sticky 0.4px under its stuck line as stuck and dropped the scroll; the stuck test is one-sided now. The demo seed's notes are opt-in (`seedBackerDemo(db, { notes: true })`, on from the CLI) so the parity tests keep the plain seed.

## 2026-10-15 (later) — Backer page: session cards are the Schedule's card, and open to the notes
- **Owner asks:** the cards "should expand like in the schedule to reveal the notes I've added", and be "as close to the schedule card as possible, just swapping out information".
- **Built:** `SessionCard` (components/BackerPage.jsx) is CalendarEventRow's markup: strip (the room's long name when open), date · hours as the time, the share as the buy-in with "20% of +$479" as the guarantee, game as the title with the room as its stage line, bb/hr (and a "Notes" hint) as the late-reg line, chevron. Open: Session, Your piece, Hours, Win rate in the detail grid, then the notes in the Schedule's italic notes line (line breaks kept).
- **Feed:** `buildFeed` (lib/backer-surface.js) adds `notes` from the linked tracking entry or cash session, only when non-empty, never "Imported from the dashboard" / "Logged from chat". Parity suites unchanged; new `test/backer-notes.test.js` in `test:backer-page`.
- **Guards:** `scripts/seed-backer-demo.js` now puts notes on the full history's three newest sessions; `check:controls` step `backer-page-notes` and a "notes open" clipping pass. Both clean, phone and desktop.

## 2026-10-15 — Short Deck asks the room's rule; three answers in
- **Short Deck:** choosing it in the replayer asks whether trips beat a straight (rooms differ). The answer is stored on the hand (`hand.tripsBeatStraight`), ranks it through `gameEvalFor` (utils/poker-engine.js), and travels in share links as code `SKT` (plain `SK` keeps the default). Per-device default in `localStorage.shortDeckTripsBeatStraight`. Guard step `hands-short-deck-rule`.
- **Answered:** the third number in "1/2/5" is a straddle (as built); crossbook is a bet (the default). Both questions closed in the docs.
- **Still open:** the launch plan's 7 (listed in this session's chat; the artifact is the source).
- **Fixed:** `test:hilo` runs again (31/31): the sliced replayer memo is handed every helper it calls; a plain split mark holds only when the cards cannot decide (cards decide since 1477966, on purpose). The "Overview ITM counts per event" bug was already fixed (per entry since 2026-10-13); struck.
- **Launch Q3 (Mid-Atlantic clocks), checked 00:25 ET 15 Oct through Bravo:** Live! Philadelphia, Maryland Live! and MGM National Harbor each published a clock. Borgata, Harrah's AC, Parx and Horseshoe Baltimore published none at that hour: inconclusive, recheck while an afternoon event runs (probe: Bravo roster by the room's PROPERTY_COORDS, then GetClocksByCasinoDetailID with { mgmtID, casinoID }). Wind Creek Bethlehem is not on Bravo.
- **Launch answers (owner, 2026-10-15):** 1. no agreement with PokerAtlas or Bravo: keep them quiet; no provider is named anywhere in the app (the Cash cards' source tag and raw feed errors removed). 2. ACR stays in the store build until it has to go (its major events matter). 3. asked whether App Store subscribers can use the web: yes, with the purchase recorded on the account server side when the paywall is built. 4. the Mac app launches later; the ads say iPhone and iPad. 5. BWPO (Borgata Winter Poker Open) explained; whether the owner plays it is still open. 6. prices stand; the owner asks testers.
- **Still parked by the owner:** `fix/replayer-hilo-pills` (whole-r pills, a single-row split pot on a phone held sideways).

## 2026-10-15 — The cutover is done
- **Live:** LEDGER_TOKEN on both Render services; the owner ran the import on futurega.me; MONEY_SOURCE=scheduler on futuregame-dashboard. The dashboard summary reads futurega.me (checked: roll $26,462, freshness.money ok). Dashboard main is ad62960 (Phase 11, merged).
- **Open:** no WSOP fund bankroll on futurega.me yet, so the dashboard shows the fund at $0 against its old $50k default; the owner sets it in Manage bankrolls (Role: the WSOP fund, $65,000 by 2027-05-03).
- **Not done, by choice:** Phase 13 (deleting the dashboard's own money screens). The money is a tracker (memory money-is-a-tracker); leave them unless asked.

## 2026-10-14 (close) — Phase 11 pushed; the cutover made plain
- **Dashboard repo:** `feat/money-source` (ad62960) is pushed, NOT merged: the dashboard reads its money
  from futurega.me behind `MONEY_SOURCE=scheduler`, off by default. Merging deploys the dashboard; the
  owner merges.
- **The owner's direction:** the money is a tracker, so no freeze windows or soaks (memory
  `money-is-a-tracker`). The whole cutover is four steps, in the spec's "Phase 11: as built".

## 2026-10-14 (end) — Bankroll merge Phase 14: standing payouts, merged
- **Live on master:** payouts to and from standing backers (the Standing card's Payouts), their
  settlement in the ledger, and the running total net of them on every surface. Spec: "Phase 14: as built".
- **Verified:** `test:standing-payouts` (5), the page and Standing helpers, `test:backers` with the
  byte-for-byte parity, `test:backer-page`, `test:standing-live`; the Standing guards at both sizes.
- **The merge, what is left:** Phase 11 is the dashboard repo (wsop-console: its adapter onto
  `/api/owner/*`), then the cutover (12) and the retire (13), which need the owner and LEDGER_TOKEN set
  on both Render services. Everything in this repo's share of the merge is built.
- **Open:** "Edit home renders a blank screen" was not reproduced (local build at 402 and 1440 renders the
  sheet; futurega.me serves the same bundle). Likely the Mac app's older TestFlight build; tonight's 04:00
  nightly ships master.

## 2026-10-14 (last) — Bankroll merge Phase 10: money homes, merged
- **Live on master:** the WSOP fund as a bankroll Role with target and pace, "Where the money is" in the
  Overview, the tax report's set-aside line. Spec: "Phase 10: as built"; CLAUDE.md has the block.
- **Verified:** `test:money-homes` (5 + 2); the controls guard on the Overview, the manager and the tax
  report at both sizes; the new rows by screenshot with the grid overlay.
- **Also today:** the backer page's month pill one size down, 2r under it and between cards (owner).
- **Next in the merge:** Phase 11 is the dashboard repo's adapter (wsop-console), then the cutover (12,
  with the owner) and the retire (13). Those need LEDGER_TOKEN set and the owner present.

## 2026-10-14 (latest) — Bankroll merge Phase 9: the owner API and deep links, merged
- **Live on master:** `/api/owner/money` and `/api/owner/sessions/log` behind LEDGER_TOKEN (OFF on every
  server until the token is set; the boot line says), the deep links. Spec: "Phase 9: as built".
- **Verified:** `test:owner-api` (13 + the parser's cases). No guard: no new control.
- **Phase 8 is merged** (b61d78f). **Open bug report:** "Edit home renders a blank screen" (owner, from
  the Mac). Reproduced NOT: the sheet renders on the local build at 402 and 1440 as ham5, and futurega.me
  serves the same bundle. If it is the Mac app, its bundle is last night's TestFlight build, before the
  day's merges. Waiting on where it was seen.
- **Next:** Phase 10 (money homes: the fund target line, "Where's the money", tax set-aside).

## 2026-10-14 (later) — Bankroll merge Phase 8: the standing UI, on `feat/money-merge-8`
- **Built** (worktree `.claude/worktrees/money-merge-8`): the Staking tab's Standing view, the Notify
  block's Q7 ask (Both / Series only), "Posts to backers" under the result and cash forms. Spec: "Phase 8:
  as built"; CLAUDE.md has the block. Phase 7 is merged (7e9bc1c).
- **Verified:** `test:standing-live` (18 + 6 helper cases); the guards' `staking-standing*` and the
  guards at 402 and 1440: all Standing controls on the grid, no clipped text. The Notify views were NOT re-measured here (the scratch world lacks their staged results); their confirm row only gained two buttons of the recipe that passed before.
- **Next:** Phase 9 (the owner API and deep links), Phase 10 (money homes).

## 2026-10-14 (late) — Bankroll merge Phase 7: standing shares live, on `feat/money-merge-7`
- **Built, tested, merged as 7e9bc1c** (worktree `.claude/worktrees/money-merge-7`, made by hand because the app
  cannot create one from the Mac's remote view: it mangles the Windows path). Spec: "Phase 7: as built";
  CLAUDE.md has the block. 18 cases in `test:standing-live`; notify tap, backers, money-import and standing
  suites still pass. Server only: Phase 8 draws the UI.
- **Decision to know:** unset posting is ON (the owner wanted the tap before the cutover); the cutover
  runbook should set `posting: 'off'` on this side until its step 6.
- **Next:** merge when the owner says so; Phase 8 (the Staking UI on these routes).

## 2026-10-14 (night) — Bankroll merge Phase 6: the import review, merged
- **Live on master:** Bankroll › Dashboard › Import › "From the dashboard app", owner only (hidden on
  the routes' 403). Nothing changes for anyone else, and on futurega.me the pull stays OFF until
  `LEDGER_TOKEN` is set on both Render services (the Phase 5 rollout table in `docs/bankroll-merge.md`).
  Spec: "Phase 6: as built"; CLAUDE.md has the block.
- **Verified:** `test:money-import` (57 engine + 20 helper cases), `test:money-import-review` (18, WebKit,
  end to end against the stub dashboard), `check:controls` and `check:clipping` `--only
  bankroll-import-dashboard` at 402 and 1440 (all 90/93 controls on the grid, no clipped text, 6 views
  each) on a scratch server seeded with `scripts/seed-money-import-demo.js` and
  `scripts/money-import-stub-dashboard.js`.
- **Trap found: forty paragraphs drift 0.05r.** `an-p`'s two fractional pads each floor to a 1/64 px
  layout unit, so a long prose view lands what follows it off the grid. The review pads a whole r below
  and pushes the baseline with a transform (`.bid .an-p`). Any other long prose view will meet it.
- **Trap: innerText reads `an-sec` headings in capitals**, so a Playwright match on a heading must ignore
  case (the review test's `waitText` does).
- **Next for the merge:** the owner sets `LEDGER_TOKEN` (Phase 0), the rehearsal pull through this screen,
  then Phase 7 (standing shares live) and Phase 8 (the Staking UI). `fix/replayer-hilo-pills` stays paused.

## 2026-10-14 (evening) — Where things stand; TOKEN BUDGET RULES
- **Read memory `model-delegation` (the token budget) first.** The owner burned half a 4x week in two days.
  No background agents by default: do the work directly, run ONE guard `--only` the touched views per
  size, use short sessions and short replies.
- **Live since the morning section:**
  - Bankroll: the Bankroll footer tab (Social is in the username menu), the floating +, Sessions, Trend,
    Locations, the read-only Backers tab, bb/hr (bb for big-bet games, BB for limit; owner rule), and
    the Bankroll page title.
  - Staking: the Staking entry in the username menu and rail.
  - Backer pages: the header says "your action with Ethan Bennett", plus a theme button.
  - The admin Notify tap, PER BACKER, on a result's edit form and a cash session.
  - Replayer: its own games (PLO5, PLO6, PLO6 8/b, Short Deck, NLO8) and the desktop top-seat fix.
  - The rest: Edit home, onboarding v2, the PT4 hand-history export, the parser hardening.
  - Bankroll merge phases 1–5 (Phase 5's pull is OFF until LEDGER_TOKEN is set on both Render services,
    which needs the owner's OK), and the dashboard's money export (deployed CLOSED).
- **Paused branches (resume only when the owner asks):**
  - ~~`feat/money-merge-6`~~: merged (the night section).
  - `fix/replayer-hilo-pills`: the hi-lo pills, plus the sideways-phone top seat. It was waiting on whole-r
    pills and a single-row landscape layout.
- **Owner questions open:**
  - The merge page's Q15–Q25 (settlement meanings; Q15 crossbook is a bet vs a swap, and the two pay
    opposite ways).
  - Short Deck: do trips beat a straight?
  - bb/hr: is the third number in "1/2/5" a straddle?
  - The launch plan's 7.
- **Notify caveat:** the dashboard's own Notify does not check futurega.me's shares. Send each night from
  ONE app.

## 2026-10-14 — A day of merges: bankroll, replayer, parser, the roster leak; the bankroll merge begins
- **Live on master (4a19a4b):**
  - Bankroll: Locations (ITM per entry), the Trend graph (Total, Tournaments and Cash lines, Fill,
    gridlines), the Sessions tab, a **Bankroll** footer tab in Social's old slot (it opens Results &
    Tracking; Social moved to the username menu and the rail's lower group), and a floating **+** on
    Results and in the dashboard sheet (Tournament result, Cash session, Start live session, Expense or
    income; a non-admin goes straight to the Log Result form).
  - Replayer: springs with Set B as the default; PLO5, PLO6, PLO6 8/b, Short Deck and NLO8 as their own
    games, with "Big Easy" renamed PLO6 8/b everywhere a user sees it and kept as an input alias (the
    shorthand code BE still decodes).
  - Quick add: hardened against 100 written and 136 spoken real hands, with the owner's 47 answers
    (decisions A–I are switches in `lib/quick-add/decisions.js`). **Not run against the live model:**
    agents have no API key, so a live eval needs the owner.
  - Date pills centre their ink (`utils/ink-balance.js`), and the controls guard waits for layout to settle.
  - The bankroll merge's Phase 1 (`money-merge-2026-10` migration, applied on prod 09:44Z; classify and
    standing engines). It is schema and engines only, and changes nothing users see.
- **Roster leak closed (owner-approved):**
  - The dashboard's roster endpoint used to serve every backer's token, phone and email under
    DASHBOARD_TOKEN, which is compiled into iOS. It now needs ROSTER_TOKEN, a Bearer header set on both
    Render services only (wsop-console 10716e9, scheduler 38fd609).
  - Prod sync was verified: "pull from the dashboard ok — 3 record(s) offered".
  - This box has NO ROSTER_TOKEN, so it no longer mirrors backer credentials. The rows already in
    poker-tournaments.db remain.
  - Recommended, not done: rotate DASHBOARD_TOKEN (it sat in Render's request logs for as long as the old
    sync ran) and decide whether backer links need rotating.
- **The bankroll merge** (owner, 2026-10-14; memory `bankroll-merge`; spec `docs/bankroll-merge.md`):
  - futurega.me owns the money, and the dashboard's money screens retire.
  - The owner answered all 16 questions on the page below. They differ from the defaults on: a manual
    Notify tap, silent corrections, asking on a standing/series overlap, every game on its own, and
    backers paying up front.
  - Render disks keep 7 daily snapshots on all three services.
  - Phase 2 (backer pages on the new tables, behind a switch) is being built on Sonnet.
- **TestFlight:** the 04:00 nightly (de93d30) sat queued with no runner because the Mac was asleep. It was
  cancelled for a manual build of da5afa2 (Bankroll tab + the + button) at the owner's ask, which is queued
  until the Mac wakes. `.testflight-nightly.json` records it under `manual`.
- **In flight (Sonnet):**
  - Edit home: fixing a slow GET that undoes a saved change.
  - Hand-history export: fixing a shared hand being credited to the viewer, and reusing
    `lib/quick-add/hh.js`.
  - Onboarding v2: rebuilding from its spec.
  - Money merge Phase 2.
- **Owner questions open:**
  - Short Deck: does trips beat a straight? The branch has the straight winning; Triton and GG rules
    rank trips higher; `SHORT_DECK_TRIPS_BEAT_STRAIGHT` plus its tests.
  - The launch plan's 7 questions (its section 16).
- **Bugs found then (status checked 2026-10-15):** the desktop top-seat cut-off is fixed (85a3c41, merged); the hi-lo pills overlapping the board wait on the owner-parked `fix/replayer-hilo-pills`; `test:hilo` runs again (d26eccd); ITM counts per entry (since 2026-10-13).
- **Ads PAUSED; catalogue three on hold** (memories `ads-paused`, `model-delegation`).
- **Trap: scratch seed tokens expire after 12 h** (`setup.cjs`, `expiresIn: '12h'`). An expired token makes
  a guard skip most views and still print "all N controls on the grid". Check the skipped count. A fresh
  72 h seed is in `scratchpad/date-pill-merge/seed/`.

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

## 2026-10-13 — First-run setup v2 ("onboarding questions refinement"), branch `feat/onboarding-refine`
- **Built, not merged** (worktree `.claude/worktrees/onboarding`). Spec, the before/after question
  list word for word, storage and endpoints: `docs/onboarding.md`. Three optional questions
  (where you play live, online too, what you play) instead of four required ones; a live count;
  "Use my location" / city search / regions with the state worked out; Skip keeps confirmed steps.
- **Per account now:** `users.onboarding` (migration `users-onboarding-2026-10` backfills every
  existing account with `{"v":1,"legacy":true}`, so no old user is asked again);
  `GET/PUT /api/user/onboarding`; `/api/login` returns `onboarding`; `/api/register` returns a
  session (Create Account signs you in).
- **Fixed on the way (docs/onboarding.md §10):** B1 the state stored as "PENNSYLVANIA" (repaired on
  read), B2 a re-run not reaching a mounted Schedule, B3 Everywhere not clearing the account copy,
  B4 a re-run wiping siteRules, B10 setup per browser, a location GET/PUT race, and B12: a new
  browser's first Schedule pushed its empty location on mount and wiped the account's copy, so
  location never followed an account to a second device (the views now push only a change).
- **Waiting on Ethan:** the wording (docs/onboarding.md §2) and decisions D1–D13 (§9), all built
  with their defaults. Settings gained "Edit name".
- **2026-10-14 update:** master (4a19a4b: Bankroll tab, floating +, Sessions, Trend, venue maps) merged
  in with three conflicts, all additive. **Launch plan, built in (L1):** online events are off until the
  player says yes, so a first run starts step 2 at "No, live only" and writes it on finish AND on skip;
  where a state is known the state filter is written on too. The Schedule's global default
  (`DEFAULT_FILTERS.showOnline`) is NOT changed: that is the launch plan's separate live-only-defaults job.
- **Trap: a first-run guard needs an account whose `users.onboarding` is NULL.** The migration marks every
  account in a seeded DB legacy, so `freshie` (and any seed user) shows no setup until it is NULLed with
  sql.js while the server is stopped. The grid overlay is admin-only (`ham`, `ham5`, `claude`), so overlay
  screenshots of a FIRST run need `ham5`'s record NULLed too (and a fresh copy per run, since finishing
  writes it).
- **Trap: never close setup with Esc or Skip in a guard.** Both SAVE the steps already confirmed with Next
  (that is D5), so a guard that pressed Esc after picking Texas and a state wrote that location to the
  account it signed in as (PUT /api/user/location, a v2 skipped record) and poisoned every later run
  (`onboarding-places` then failed: a manual state beats a region's). The clipping guard now leaves setup
  open and reloads. `scripts/check-text-clipping.mjs` signs in as `ham5` on whatever server it is pointed
  at, so this would have written to the owner's account on :3001.
- Guards: `npm run check:controls -- --only onboarding,real-name-prompt,settings-edit-name,auth-register,
  location-dropdown` (`onboarding-places` is a prefix match) and `check:clipping`, whose first-run section
  prints "first-run setup: 8 views measured": anything but 8 means a stage was skipped.
- Screenshots (grid overlay on, both sizes): the builder's scratch folders `scratchpad/onboarding/shots/`
  and `scratchpad/onboarding-v2/shots/`.

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
  `npm run test:hh-io`. `docs/hand-history-io.md`. **Reviewed and finished 2026-10-14:** a shared
  hand no longer exports as the viewer's; PT4 takes four-card Omaha only (5/6-card Omaha is written
  but marked "PT4 skips it"); PLO6 8/b (never Big Easy), NLO8 and Short Deck (refused by name) mapped;
  a short big blind posts its blind first; and `lib/quick-add/hh.js` (the fast path) and
  `lib/hh-import` are held to agree on the same text (doc §8).
- **Usage:** the weekly limit was hit on 2026-10-13. Default to one builder + one verifier per job,
  two or three jobs at a time, full guard runs once per size.

## 2026-10-13 — Edit home: choose and order the Dashboard's sections (branch feat/home-customize)
Owner request: "the option to change or reorder what's on the dashboard". Built to the spec in the
worktree `home-custom`. What a later session needs to know:
- **The list is the real sections**: Up Next (locked on), To log, Last result, Bankroll (admins),
  This month (the period block) and its two parts, Signal or noise and Goals (admins). The Table
  Scanner is not a home section (it is the Playing card's Scan action); Trend is one registry entry
  in `utils/home-layout.js` plus one element in DashboardView's section map once it is built.
- **Storage**: `users.home_layout` (dataMigration `users-home-layout-2026-10`), `GET`/`PUT
  /api/user/home-layout`. The server checks the document's SHAPE only (`lib/home-layout.js`), so a
  newer build's unknown ids are stored as sent and kept in place on save; NULL is the default home
  (Reset stores null, so a later change to the default reaches that user). Client:
  `hooks/useHomeLayout.js` (localStorage `homeLayout:u<id>` for the first paint, GET then reconcile,
  600 ms debounced PUT, retry on online, keepalive on pagehide, storage-event sync between tabs).
- **Desktop mapping** (docs/desktop-layout.md "Dashboard"): one stored order; each section keeps
  its pane; each pane shows its sections in the user's relative order; a desktop group reorder
  rewrites only that group's slots.
- **A hidden section is not mounted**, so it makes no requests (verified: Last result hidden, no
  `/api/cash-sessions`; This month hidden, no ledger / trips / analytics). `HomeNumbers.jsx` is now
  the `useHomeNumbers` hook (its sheets and the summary refresh), because on the phone the bankroll
  line and the period block can be apart.
- **Deviations from the spec, on purpose**: the row's switch sits 30..34g of the card (1g in from
  its edge, Settings' switch exactly), not 31..35g, which put it flush on the card's hairline;
  the arrows moved 1g left with it (Move up 23..26g, Move down 26..29g, a 1g gap before the
  switch) and the name column is 3..22g. The name is a 4r cell on +3r, not 3r on +3r (the note's own 1em line
  overflowed the 1.25r line box and moved the baseline 0.06r at 1440). A drag's slot changes when
  the card's LEADING edge crosses a neighbour's midpoint, not its centre: This month is 15r among
  5r cards and its centre could never pass the card above it before the list clamp stopped it. The
  status line says "Saved to your account" while a save is under way and online, and the offline
  sentence only once a save failed or the device is offline (it flashed for 600 ms on every change
  otherwise). Under reduced motion the tokens are 0ms but styles.css forces every transition to
  1ms (!important), so computed durations read 0.001s; moves still land in the same frame.
- **Owner questions, answered with the spec's recommended defaults** (ask Ethan if any should
  change): (1) Up Next is locked on but movable; (2) the drag handle is pointer-only, the arrows
  are the keyboard and screen-reader path; (3) Signal or noise and Goals are parts of This month
  (they move with it, have their own switches, are disabled while it is off); (4) the Table Scanner
  stays off the list; (5) guests get no Edit home and keep the default; (6) one order for both
  layouts, panes fixed per section; (7) no Cancel: changes apply at once, Reset has an 8 s Undo.
- **New device**: the default paints first and the account's layout lands once (one re-order).
  Accepted.
- Guards: `scripts/home-states.mjs` stages `layout-custom` and `layout-numbers-empty` by answering
  GET /api/user/home-layout and clears the cached copy around them. Both guards answer the route
  in the page (`routeHomeLayout`): every other GET is the default home whatever the account saved
  (an owner's custom home does not change what the other views measure), and every PUT is echoed
  back, so they write nothing (safe on :3001). New views:
  dashboard-edit, dashboard-edit-reset, dashboard-custom, dashboard-numbers-empty (desktop).
- **After the independent review (2026-10-14)**, three fixes:
  (1) *A slow GET undid a saved change*: `useHomeLayout.pull()` now remembers `versionRef` when its
  GET goes out and drops the answer if the layout changed meanwhile and that change is saved (or
  came from another tab); an unsaved change still falls through to reconcile and is pushed. Covers
  the load GET and the 5-minute foreground re-pull. Pinned by
  `utils/__tests__/home-layout-sync.test.mjs`, which runs the REAL hook under React with a stand-in
  window/document/localStorage and a fetch the test answers one request at a time (no jsdom needed:
  copy its header for any other hook that wants a real-run test; it is in `npm run test:home`).
  (2) *The sheet let Tab leave it*: a capture-phase keydown on document wraps Tab / Shift+Tab
  between the sheet's first and last visible control, as VenueMapSheet's does. The Analytics and
  Bankroll dashboard sheets still do not trap focus (the same gap, not touched here).
  (3) *"All bankrolls" twice in a custom order*: `bankrollAbovePeriod` now reads the column without
  the sections that render nothing (To log reports whether it has a row through `onShown`; Last
  result needs `onLog`; the bankroll line needs a line), so Bankroll, To log (empty), This month
  shows the scope once.

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
| Merge questions | The 16 bankroll-merge calls; answers in its db collection `answers` (2026-10-14) | https://claude.ai/artifact/K7iAcVUaV7ZjQ21U9EyynU |

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

**Setup state is per account (`users.onboarding`); `localStorage.onboarded` is only a cache.**
Clearing the flag does not re-run setup for an account that has a record: the next launch asks
`GET /api/user/onboarding`, adopts the record and sets the flag again. To see setup as a new user,
use a NEW account (registered after the migration ran, so its column is NULL), or "Run setup
again" in the location menu. Both guards keep it shut with `onboarded = '1'`; a scratch DB seeded
by registering accounts on a fresh boot leaves them all NULL (the migration ran before they
existed), which is why `freshie` reaches setup.

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
- The saved-hands API block was registered twice in `server.js`; checked 2026-10-15, once now.
- `/api/hands` is not the endpoint the replayer calls — it uses
  `/api/replayer/hands`, which spreads the entire `hand_data` blob into every
  list row. Anything the picker needs is already client-side.
- The esbuild `Unexpected "@media"` CSS warning is gone (no CSS warnings in the build, 2026-10-15).

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
