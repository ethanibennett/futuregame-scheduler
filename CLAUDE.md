# futuregame scheduler (futuregame-scheduler)

The poker tournament scheduler/tracker at **futurega.me** — one of five projects in the
futuregame suite (see "The suite" below). This directory is the project's **Windows home**;
sessions opened here own scheduler work.

## Architecture (post-2026-08 reorg — the old single-file frontend is GONE)
- **Frontend**: Vite + React app in `vite-app/` → builds to `public-vite/` (served by the
  server, and wrapped by Capacitor for iOS/Android — see `capacitor.config.json` webDir).
  The legacy single-file `public/index.html` era is dead; its final tree is preserved on
  branch `wip/windows-mtt-feed`.
- **Backend**: `server.js` — Express 5 + sql.js (SQLite loaded to memory, saved on write).
  `JWT_SECRET` env required. `DB_PATH` env overrides the default `poker-tournaments.db`.
- **Solver**: NOT in this repo (carved out 2026-08-09). `./solver` here is a **gitignored
  junction** → `D:\projects\futuregame-solver\solver` (server.js requires into it at
  boot for the trainer features). On Render, `build.js` clones the private
  `futuregame-solver` repo via `SOLVER_REPO_TOKEN`.
- **Build**: `node build.js` = vite build + solver fetch (token) or junction fallback.
  Note: `spawnSync('npm')` fails on native Windows — run `npm install` / `npm run build`
  inside `vite-app/` directly when building locally.
- **Deploy**: push to `master` → Render auto-deploys **futurega.me** (fail-loud build).

## Runs 24/7 on this box (don't duplicate)
pm2 app **futuregame-scheduler** serves this checkout on **port 3001**, restarting
nightly at 05:00 (hygiene only now — the MTT feed re-ingests hourly in-process).
`pm2 logs futuregame-scheduler`. Reboot persistence via Task Scheduler
`futuregame-pm2-resurrect`. Don't start a second server on 3001 — test on a scratch
port with a `DB_PATH` copy. Env lives in the gitignored `ecosystem.config.cjs`
(`JWT_SECRET`, `SYNC_TOKEN`); after editing it, `pm2 restart ecosystem.config.cjs
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
  Unmapped series fall back to `deriveVenueInfo()` (abbr from the title + a generated
  color), so a new series is readable before anyone curates it.
- **Dashboard seams (3)** — the life-dashboard is a separate app at dashboard.futurega.me:
  - #1 notify: dashboard POSTs `/console/api/backers/notify` (ham-gated) here.
  - #2 departures: dashboard GETs `/api/schedule/:token/upcoming` (DASHBOARD_TOKEN-gated).
  - #3 roster: `syncBackerRoster()` pulls `dashboard.futurega.me/api/roster/:token`
    hourly at :35 + at boot (self-disables without `DASHBOARD_TOKEN`; the local pm2
    instance has no token, so local roster sync is off by design).
- **Backer surface stays here**: `/b/:token` public pages, Sunday weekly digest, backer
  web-push (`backer_push_subs`), `console_records` store='backers' (fed by seam #3).

## Hazards
- ⚠️ **Junction hazard**: checking out any pre-carve branch (e.g. `wip/windows-mtt-feed`)
  materializes tracked `solver/` files THROUGH the junction and clobbers
  `D:\projects\futuregame-solver`'s working tree on switch-back. Use `git worktree` for
  old branches. Recovery: `git -C D:\projects\futuregame-solver checkout -- .`, then
  `New-Item -ItemType Junction -Path D:\projects\scheduler\solver -Target D:\projects\futuregame-solver\solver`.
- `poker-tournaments.db` is untracked runtime state owned by the pm2 app. Never commit it.
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

The Mac is the Xcode build node (iOS/Watch/screensaver) — see `docs/mac-build.md`.
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
- "Opponent" not "villain". Card notation `AhKs`, suits h/d/c/s, x = face-down.
- Dropdowns/panels use portals to document.body to escape stacking contexts.
- Update this file when architecture or suite topology changes — it is the handoff.
