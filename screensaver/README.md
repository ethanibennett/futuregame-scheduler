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
cd DashboardSaver && ./build.sh
cp -R build/DashboardSaver.saver ~/Library/Screen\ Savers/
```

Then select **Daily Dashboard** in System Settings. Note the `build/` prefix:
`build.sh` starts with `rm -rf build`, so the bundle only ever exists one
directory down, and a `cp` without it fails with a bare "No such file or
directory" that reads like the build failed when it did not.

Building the `.saver` requires Xcode and a Mac; this is the one part of the
suite that cannot move to the Windows box.

## When the screen is black

The saver draws into `legacyScreenSaver.appex`, which has no stdout, and macOS
SIGKILLs `ScreenSaverEngine` if you launch it from a shell to watch it. So the
view narrates itself to `os_log` instead — construction, every frame load, and
each change in what it draws:

```bash
log show --last 10m --predicate 'subsystem == "me.futurega.DashboardSaver"' --style compact
```

**Check the signature first.** A screensaver must be signed by a real
certificate chain. `legacyScreenSaver` loads the bundle through AMFI, which
refuses an ad-hoc signature outright:

```
amfid: .../DashboardSaver not valid: AppleMobileFileIntegrityError Code=-423
       "The file is adhoc signed or signed by an unknown certificate chain"
```

Nothing else reports it. The bundle links, `codesign` verifies it, System
Settings lists and selects it, and the log even says `Setting module
"DashboardSaver"` — then the principal class is never instantiated, so the
screen is black and the saver's own logging never runs to say so. `build.sh`
now picks a real identity automatically and fails if it cannot, but if you see
black with no log lines at all, read amfid before anything else:

```bash
log show --last 10m --predicate 'process == "amfid"' --style compact | grep -i dashboard
```

Notarization is not needed — that gates Gatekeeper on quarantined downloads,
and this bundle is built locally.

Once the signature is good, read the saver's own log against the three things
black can mean:

| what the log says | what is wrong |
|---|---|
| nothing at all | the bundle never loaded — check amfid above, then `NSPrincipalClass` in `Info.plist` |
| `init` but no `draw ->` | the view exists and is never asked to draw |
| `draw -> placeholder` | drawing fine, no frame — the `no frame:` line above it says whether the PNG is missing or unreadable |
| `draw -> frame` | the saver is working; you are looking at something else |

That last row is the common one. The preview pane in System Settings renders
third-party `.saver` bundles through WallpaperAgent rather than the screensaver
engine, and it shows black for savers that run correctly when actually
invoked — so judge the saver by going idle, never by the preview.

Check the helper separately; it logs to its own file:

```bash
tail ~/Library/Logs/DashboardSaver/helper.log
```
