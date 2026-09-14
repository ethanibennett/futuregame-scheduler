# DashboardSaver

The macOS screensaver that displays the Cockpit dashboard, plus the helper that
keeps its image fresh.

Until 2026-08 the Swift sources lived only in `~/src` on the old Mac build node —
untracked, on a machine about to be wiped, while a `crontab` entry ran the
refresh every minute. This directory is now the source of truth.

## Layout

This directory is the **native** half of the screensaver: the thing the Mac
builds. The page it displays is the dashboard's and lives in `wsop-console`.
That is the seam -- *what the Mac builds* here, *what the dashboard serves*
there.

| path | what |
|---|---|
| `DashboardSaver/` | the `.saver` bundle -- `DashboardSaverView.swift`, `Info.plist`, `build.sh` |
| `DashboardSaverHelper/` | the refresher -- `main.swift`, `render.sh`, `build.sh`, LaunchAgent plist |

Four files used to sit here and no longer do. `dashboard-page.html` and
`baskerville.b64` were byte-identical to `wsop-console/screensaver/`, which is
where the dashboard READS them at runtime. `cockpit-screensaver.html` and
`cockpit-min.html` were the Cockpit page, stranded here by the 2026-08-09
cutover: it took the `/d/:token` route away but left the page, so the dashboard
went on serving the older design while the newer one sat in a repo with no
route to serve it from. The newer of the two is now
`wsop-console/screensaver/cockpit-page.html` and is what `/d/:token` serves
(wsop-console#3).

If you are looking for the page the saver displays, it is in that repo. Nothing
in this one renders HTML any more.

## How it works

The `.saver` does not render HTML itself — it blits a PNG. `render.sh` drives
headless Chrome against the token-gated dashboard URL, writes
`dashboard.png` into Application Support, and the saver displays it.

WKWebView and a LaunchAgent were both tried first and were TCC-blocked; the
`crontab` + Chrome-headless route is what actually works.

## Configuration — not in this repo

`render.sh` reads:

```
~/Library/Application Support/DashboardSaver/config.json
```

which holds `url` and `token`. **That token is a credential and is deliberately
not committed.** On a new machine, recreate the file with the dashboard URL and
the `DASHBOARD_TOKEN` value from the server environment.

The URL is on the **dashboard**, not on this server:

```json
{ "url": "https://dashboard.futurega.me", "token": "<DASHBOARD_TOKEN>" }
```

`url` is the **origin only**. `render.sh` composes the page URL itself --
`d['url'].rstrip('/') + '/d/' + d['token']` -- so putting the full page URL in
there yields `.../d/<token>/d/<token>`, a 404, and the silent-stale failure
described below.

This repo's own history says otherwise and will mislead you: `a5e2450 Cockpit
screensaver: serve the flight-deck at /d/:token` added that route HERE, and the
2026-08-09 cutover moved the whole dashboard surface to the standalone service.
`grep "app.get('/d/" server.js` in this repo now returns nothing; the route
lives in `wsop-console/server/server.js`. Pointing `config.json` at the
scheduler gets a 404, and because `render.sh` only replaces `dashboard.png`
when Chrome produced a frame, the saver goes on showing the last good image
with no error anywhere -- the silent-stale failure described above.

## Refresh schedule

The refresh runs from `crontab`, not launchd:

```
* * * * * /path/to/DashboardSaverHelper/render.sh
```

Re-establish this on any machine that takes over the screensaver — the saver
shows a stale image, with no error, if it is missing.

## Build and install

```bash
cd DashboardSaver && ./build.sh          # produces DashboardSaver.saver
```

Copy the result into `~/Library/Screen Savers/`, then select it in System
Settings. Building the `.saver` requires Xcode and a Mac; this is the one part
of the suite that cannot move to the Windows box.
