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
  rectangle around Texas also catches Bossier City LA and Hard Rock Tulsa OK. **A new
  series needs a `VENUE_MAP` entry to be locatable** — without one it has no coordinate and
  both location filters exclude it.
- **Dashboard seams (3)** — the life-dashboard is a separate app at dashboard.futurega.me:
  - #1 notify: dashboard POSTs `/console/api/backers/notify` (ham-gated) here.
  - #2 departures: dashboard GETs `/api/schedule/:token/upcoming` (DASHBOARD_TOKEN-gated).
  - #3 roster: `syncBackerRoster()` pulls `dashboard.futurega.me/api/roster/:token`
    hourly at :35 + at boot (self-disables without `DASHBOARD_TOKEN`; the local pm2
    instance has no token, so local roster sync is off by design).
- **TestFlight watchdog (out)**: `scripts/testflight-watchdog.js`, scheduled in-process at
  :05/:25/:45. GitHub force-fails a build at exactly 600s when the Mac takes a queued job
  during a brief "dark wake" and then sleeps again, and nothing retries it — #91 sat
  unshipped for three days. The watchdog re-dispatches master HEAD (`repository_dispatch`,
  NEVER `gh run rerun`, which replays the run's original SHA and can make stale code the
  newest build), capped at 3 attempts per SHA, then opens a handoff issue for the Mac.
  Opt-in via `TESTFLIGHT_WATCHDOG=1` so only this box runs it; Render has no `gh` and no
  business dispatching builds. Mitigation only — the cure for the dark wake is on the Mac.
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
    RemoteCommand C:\msys64\usr\bin\bash.exe -lc "tmux new -A -s %n"
    ServerAliveInterval 30
    ServerAliveCountMax 6
    TCPKeepAlive yes
```
`ssh sched` creates or reattaches; `-A` covers both. Keep a plain `Host win`
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
- "Opponent" not "villain". Card notation `AhKs`, suits h/d/c/s, x = face-down.
- Dropdowns/panels use portals to document.body to escape stacking contexts.
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
