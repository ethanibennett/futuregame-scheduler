# Mac build runbook — futuregame-scheduler

**Audience:** Claude Code running on the Mac laptop (or Ethan directly).
**Moving to a new Mac?** See `docs/mac-migration.md` — the five things here that
aren't in git, and the order to move them in.
**Role of this machine:** Xcode build node — the iOS/Android (Capacitor) app and the
macOS screensaver. Nothing else. The 24/7 runtime moved to the Windows box
(2026-08-09): scheduler server + MTT feed run under pm2 on Windows, the solver
grind + dashboard server run under systemd in WSL2. **Do not restart the solver
grind on this Mac** — the WSL grind owns the checkpoints now.

**Coordination model:** GitHub is the only hub. This Mac pulls `master`, builds,
and (when intentional) pushes. Nothing on this Mac talks to the Windows box
directly.

> ⚠️ Pushing to `master` auto-deploys to Render (futurega.me). Commit docs and
> code deliberately; use branches + PRs for anything you're not ready to ship.

## Stay current (auto-pull via launchd)

One agent keeps both repos fresh. Adjust `REPOS` if your clone paths differ.

`~/bin/futuregame-autopull.sh` (chmod +x):

```bash
#!/bin/bash
# Pull latest master/main for the futuregame repos — only when the tree is clean.
REPOS=(
  "$HOME/Desktop/fg_solver/wsop"        # futuregame-scheduler, formerly wsop-2026-scheduler (adjust if cloned elsewhere)
  "$HOME/Desktop/fg_solver/wsop-console-repo"  # wsop-console
)
for r in "${REPOS[@]}"; do
  [ -d "$r/.git" ] || continue
  if [ -z "$(git -C "$r" status --porcelain)" ]; then
    git -C "$r" pull --ff-only >> "$HOME/Library/Logs/futuregame-autopull.log" 2>&1
  else
    echo "$(date): $r dirty — skipped" >> "$HOME/Library/Logs/futuregame-autopull.log"
  fi
done
```

`~/Library/LaunchAgents/me.futurega.autopull.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>me.futurega.autopull</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>-lc</string><string>$HOME/bin/futuregame-autopull.sh</string></array>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
```

Install: `launchctl load ~/Library/LaunchAgents/me.futurega.autopull.plist`
Check: `tail ~/Library/Logs/futuregame-autopull.log`

## Ship to TestFlight (one command)

```bash
./scripts/ios-testflight.sh
```

Pulls `master`, builds the web app, syncs it into the Capacitor project, bumps
the build number past whatever App Store Connect already has, archives, and
uploads. Roughly five minutes, most of it in `xcodebuild archive`.

The app **bundles** the web build (`capacitor.config.json` → `webDir: public-vite`),
so shipping a frontend change to the app means rebuilding and re-uploading —
a Render deploy alone does not reach installed apps.

Useful flags:

| flag | effect |
|---|---|
| `--dry-run` | everything up to the archive, then stop — good for checking the sync |
| `--no-pull` | build the working tree as-is instead of pulling |
| `--commit` | commit the build-number bump for you |
| `--build N` | force a specific build number |

**What it will not do:** touch Render, touch the database, or push to `master`.
That is deliberate. `deploy.sh --ios` does all three, so it can no longer be used
here — it exits without a `RENDER_API_KEY`, prompts for admin credentials, starts
a local server to sync the production database, and runs `git push origin master`
(which auto-deploys futurega.me). Shipping the app should not require deploying
the web app, and the Mac is not supposed to touch the database at all.

The only file the script changes is `project.pbxproj` (the build number). Commit
it so the repo matches TestFlight.

### One-time setup

1. **App Store Connect API key.** appstoreconnect.apple.com → Users and Access →
   Integrations → App Store Connect API → generate a key with the **App Manager**
   role. Save the `.p8` as
   `~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8`.
   Apple lets you download it **once**. It is a credential — never commit it.
   If your key ID differs from the default, export `ASC_KEY_ID` / `ASC_ISSUER_ID`.
2. **Share the Xcode scheme.** Xcode → Product → Scheme → Manage Schemes → tick
   **Shared** for `futurega.me`, then commit `ios/App/App.xcodeproj/xcshareddata/`.
   Schemes otherwise live in gitignored `xcuserdata`, so `xcodebuild -scheme`
   works only on a machine where Xcode has already generated one. The script
   warns rather than failing if it is missing.
3. **Xcode command line tools** selected:
   `sudo xcode-select -s /Applications/Xcode.app`

Signing is automatic against team `27TK6846H8`; bundle ID `app.futurega.me.beta`.

### Automatic builds (self-hosted runner)

`.github/workflows/ios-testflight.yml` runs the script above on this Mac whenever
a push to `master` touches something the app bundles (`vite-app/**`, `ios/**`,
`capacitor.config.json`, `build.js`). Merge a frontend change on the Windows box
and the Mac starts archiving within seconds — no polling, nobody remembering.

It can also be fired manually from the Actions tab, or programmatically from
anywhere:

```bash
gh api repos/ethanibennett/futuregame-scheduler/dispatches -f event_type=ios-testflight
```

Rapid merges collapse into a single build (`concurrency.cancel-in-progress`)
rather than queueing an archive per commit.

**This does not ship tournament data.** The installed app fetches events live
from `https://futurega.me/api` (`API_URL` in `vite-app/src/utils/api.js` points
there on native) and refetches on the SSE `schedule-refetch` broadcast, so feed
updates reach phones in seconds with no build at all. Only bundled web assets and
the native project need a rebuild — hence the path filter.

#### One-time: install the runner

GitHub hosts no macOS runner that can sign with your key, so the runner lives
here:

1. Repo → **Settings → Actions → Runners → New self-hosted runner → macOS**.
2. Run the `./config.sh` command it gives you (it embeds a registration token).
   Accept the default labels — the workflow targets `[self-hosted, macOS]`.
3. Install it as a background service so it survives reboots:
   ```bash
   ./svc.sh install && ./svc.sh start && ./svc.sh status
   ```

The runner executes as your user, so it picks up the App Store Connect key at
`~/.appstoreconnect/private_keys/` and the Xcode toolchain already configured
here. **The key is deliberately not a GitHub secret** — it never leaves this Mac.

To pause automatic builds, stop the service (`./svc.sh stop`); the script keeps
working by hand.

### Running it by hand instead

```bash
npm install && node build.js   # vite build → public-vite/
npx cap sync ios               # copy web build + plugins into ios/App
npx cap open ios               # then Product → Archive → Distribute App
```

Android, when needed: `npx cap sync android && npx cap open android`.

## Screensaver

`screensaver/` builds the macOS `.saver` in Xcode — Mac-only, unchanged by the
Windows move. Open its project, Archive, install the produced `.saver`.

## What NOT to do on this Mac

- Don't run `solver/multiway/grind3*.sh` — the WSL2 grind on the Windows box owns
  `solver/strategies/razz3-cap3.json` + checkpoint. A second writer corrupts it.
- Don't run the scheduler server here as a service — Render is prod; the Windows
  box runs the 24/7 local instance (with the MTT feed).
