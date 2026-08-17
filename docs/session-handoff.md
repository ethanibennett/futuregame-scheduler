# Session handoff — scheduler

Rolling handoff for a fresh Claude Code session on this repo. CLAUDE.md is the
*architecture* handoff (topology, hazards, conventions); this is the *state*
handoff — what just changed, what is waiting, and the traps worth knowing before
touching any of it.

Last updated: 2026-08-17.

---

## Artifacts

Three published pages carry work that does not live in the repo. All are private
to the account and readable with WebFetch.

| Page | What it is | URL |
|---|---|---|
| Design audit | 20 numbered plates diagnosing the frontend, each with measured evidence and a live before/after | https://claude.ai/code/artifact/f6ae8a63-8772-45e3-ac16-085637f40cd3 |
| Design directions | The five judgment-call items, 2–3 built options each, for picking a direction | https://claude.ai/code/artifact/9589127b-77ae-4e33-a71f-29ba63cd7f51 |
| Master to-do | Cross-repo state for all five suite projects, assembled from PRs, commits and checklists | https://claude.ai/code/artifact/5d07cb8c-73fc-4c56-a06f-61473455be46 |

To revise one, publish the **same file path** again, or pass its URL as `url`.
Publishing without the URL creates a second artifact instead of updating.

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

All five suite repos are at **zero unpushed, zero modified**.

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
5. **`SettingsView` still hardcodes "spring/summer 2026"** — the header is
   dynamic now, and Settings could be wired the same way. The pre-login screens
   genuinely cannot be; they render before any tournament data exists.

Also open: **PR #63** in this repo commits the screensaver Swift sources, which
by its own description exist only on the old Mac — a machine queued for wiping.
Merging it is time-sensitive in a way nothing else here is.

---

## Traps worth knowing

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
