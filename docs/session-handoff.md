# Session handoff — scheduler

Rolling handoff for a fresh Claude Code session on this repo. CLAUDE.md is the
*architecture* handoff (topology, hazards, conventions); this is the *state*
handoff — what just changed, what is waiting, and the traps worth knowing before
touching any of it.

Last updated: 2026-08-24.

---

## Artifacts

Four published pages carry work that does not live in the repo. All are private
to the account and readable with WebFetch.

| Page | What it is | URL |
|---|---|---|
| Design audit | 20 numbered plates diagnosing the frontend, each with measured evidence and a live before/after | https://claude.ai/code/artifact/f6ae8a63-8772-45e3-ac16-085637f40cd3 |
| Design directions | The five judgment-call items, 2–3 built options each, for picking a direction | https://claude.ai/code/artifact/9589127b-77ae-4e33-a71f-29ba63cd7f51 |
| Master to-do | Cross-repo state for all five suite projects, assembled from PRs, commits and checklists | https://claude.ai/code/artifact/5d07cb8c-73fc-4c56-a06f-61473455be46 |
| Graphics backlog | 100 measured graphic upgrades across the whole app, each naming the file and quoting the current value | https://claude.ai/code/artifact/f5f543f9-33b7-44e3-94d6-c9e7779eefcd |

To revise one, publish the **same file path** again, or pass its URL as `url`.
Publishing without the URL creates a second artifact instead of updating.

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

## Waiting on Ethan

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

### Trap: the share-link codec collided game codes with player counts

`encodeHand` writes `gameCode + numPlayers + heroIdx` with no separator, and
several codes ARE another code plus a digit (`P8`=PLO8, `N8`=NL Stud 8,
`PT`/`LT`). Six game/size combinations decoded as the wrong game with the
wrong player count and hero — including 8-handed NLH and 8-handed PLO. Fixed
by picking the candidate code that leaves exactly two characters. **If you
touch `GAME_CODES`, re-run a full round-trip over every game × every size.**
