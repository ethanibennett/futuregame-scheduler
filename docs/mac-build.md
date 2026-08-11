# Mac build runbook — futuregame-scheduler

**Audience:** Claude Code running on the Mac laptop (or Ethan directly).
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

## Build the iOS app (Capacitor)

The app wraps the **Vite build output** (`capacitor.config.json` → `webDir: public-vite`).

```bash
cd <repo>            # futuregame-scheduler checkout
npm install          # root deps (first time / after dep changes)
node build.js        # vite-app deps + `vite build` → ../public-vite/
npx cap sync ios     # copy web build + plugins into ios/App
npx cap open ios     # opens Xcode
```

In Xcode: select device/simulator → **▶ Run**, or Product → Archive for
TestFlight (signing uses the team already configured in `ios/App`).

Android, when needed: `npx cap sync android && npx cap open android`.

## Screensaver

`screensaver/` builds the macOS `.saver` in Xcode — Mac-only, unchanged by the
Windows move. Open its project, Archive, install the produced `.saver`.

## What NOT to do on this Mac

- Don't run `solver/multiway/grind3*.sh` — the WSL2 grind on the Windows box owns
  `solver/strategies/razz3-cap3.json` + checkpoint. A second writer corrupts it.
- Don't run the scheduler server here as a service — Render is prod; the Windows
  box runs the 24/7 local instance (with the MTT feed).
