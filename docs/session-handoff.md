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
