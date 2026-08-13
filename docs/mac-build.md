# Mac build runbook — futuregame-scheduler

**Audience:** Claude Code running on the Mac laptop (or Ethan directly).
**Moving to a new Mac?** See `docs/mac-migration.md` — the six things here that
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

> ⚠️ **Do not put the clones under `~/Desktop`, `~/Documents` or `~/Downloads`.**
> Those directories are TCC-protected, and a launchd agent has no access to them.
> The agent loads and fires, but every run dies with
> `fatal: Unable to read current working directory: Operation not permitted`,
> while running the same script by hand works — which makes it look like a git
> problem rather than a permissions one. Keeping the clones directly under
> `$HOME` avoids it. Granting `/bin/bash` Full Disk Access also works, but that
> is a broad, permanent grant on a machine that runs a self-hosted Actions
> runner, so prefer the path.

`~/bin/futuregame-autopull.sh` (chmod +x):

```bash
#!/bin/bash
# Pull latest master/main for the futuregame repos — only when the tree is clean.
# Paths must stay outside ~/Desktop, ~/Documents and ~/Downloads (TCC — see above).
REPOS=(
  "$HOME/fg_solver/wsop"               # futuregame-scheduler, formerly wsop-2026-scheduler
  "$HOME/fg_solver/wsop-console-repo"  # wsop-console
)
for r in "${REPOS[@]}"; do
  [ -d "$r/.git" ] || continue
  # Check git's exit status, not just its stdout: a failed `git status` prints
  # nothing, which an emptiness test reads as "clean" and pulls over a dirty tree.
  if ! status="$(git -C "$r" status --porcelain 2>&1)"; then
    echo "$(date): $r — git status failed, skipped: $status" >> "$HOME/Library/Logs/futuregame-autopull.log"
  elif [ -z "$status" ]; then
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
4. **An App Store provisioning profile** for `app.futurega.me.beta` must be present
   in `~/Library/Developer/Xcode/UserData/Provisioning Profiles/`. A fresh machine
   has none, and the App-Manager-role ASC key cannot mint one — the archive
   succeeds and the *export* fails with `No profiles for 'app.futurega.me.beta'
   were found`. See `docs/mac-migration.md` item 6.
5. **Git identity**, before this machine commits anything:
   ```bash
   git config --global user.name "Ethan Bennett"
   git config --global user.email "ethanibennett@gmail.com"
   ```
   The script commits the build-number bump with `--commit`, and the runner does
   it unattended. Without this, git synthesises an address from the hostname
   (e.g. `ethanibennett@mac.lan`) and every automated build commit lands
   unattributed to your GitHub account.

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

   ⚠️ **Run `config.sh` from a shell where the full toolchain is already on
   `PATH`.** The runner freezes `PATH` into `~/actions-runner/.path` at
   registration time and uses that forever. Register from a shell that hasn't
   sourced nvm and the runner cannot find `node`, so every build fails with no
   obvious cause. Verify:
   ```bash
   env -i PATH="$(cat ~/actions-runner/.path)" sh -c 'command -v node xcodebuild git gh'
   ```
   Re-register if anything is missing — editing `.path` by hand is not supported.

3. Start it. **Do not use `svc.sh` if the job needs to codesign** — see below.

> ### ⚠️ `svc.sh` runners cannot codesign against the login keychain
>
> A runner installed with `./svc.sh install` fails at `xcodebuild archive` with:
> ```
> .../Cordova.framework: errSecInternalComponent
> ** ARCHIVE FAILED **
> ```
> This is a launchd-session limitation, **not** a permissions problem, and it is
> immune to every fix that looks like the answer: `security
> set-key-partition-list`, `SessionCreate`/`ProcessType: Interactive` in the
> plist, and an unlocked no-timeout keychain change nothing. The failure
> signature never varies, which is what makes it so slow to diagnose.
>
> **One-step diagnostic:** the same identity signs fine from an interactive
> shell. If a manual `./scripts/ios-testflight.sh` archives and the runner
> doesn't, it is this — stop investigating certificates and profiles.
>
> **Resolution:** run the agent from a session-inheriting process instead:
> ```bash
> ./svc.sh stop && ./svc.sh uninstall
> cd ~/actions-runner && ./run.sh
> ```
> `svc.sh uninstall` removes only the launchd service. It does **not**
> deregister the runner — that is `./config.sh remove` — so registration and
> credentials survive.
>
> The tradeoff: `run.sh` dies with its session and does not survive a reboot. A
> Login Item restores it but makes an unattended build node depend on a GUI
> login. The version that survives everything is a **dedicated build keychain**
> created and unlocked inside the job, which works under `svc.sh` with no GUI
> session at all — at the cost of needing the `.p12` and its export password
> during setup.

The runner executes as your user, so it picks up the App Store Connect key at
`~/.appstoreconnect/private_keys/` and the Xcode toolchain already configured
here. **The key is deliberately not a GitHub secret** — it never leaves this Mac.

To pause automatic builds, stop the runner; the script keeps working by hand.

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
