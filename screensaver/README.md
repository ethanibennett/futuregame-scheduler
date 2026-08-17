# DashboardSaver

The macOS screensaver that displays the Cockpit dashboard, plus the helper that
keeps its image fresh.

Until 2026-08 the Swift sources lived only in `~/src` on the old Mac build node —
untracked, on a machine about to be wiped, while a `crontab` entry ran the
refresh every minute. This directory is now the source of truth.

## Layout

| path | what |
|---|---|
| `DashboardSaver/` | the `.saver` bundle — `DashboardSaverView.swift`, `Info.plist`, `build.sh` |
| `DashboardSaverHelper/` | the refresher — `main.swift`, `render.sh`, `build.sh`, LaunchAgent plist |
| `cockpit-screensaver.html`, `cockpit-min.html` | the Cockpit page the saver renders |
| `dashboard-page.html` | the older dashboard page |
| `baskerville.b64` | embedded font |

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
