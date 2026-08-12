# Migrating the Mac build node to a new machine

**Audience:** Claude Code on either the old Mac or the new one, or Ethan directly.
**Companion doc:** `docs/mac-build.md` — what this machine is *for* once it works.

This Mac is the suite's Xcode build node: it builds the iOS app (Capacitor) and the
macOS screensaver, and nothing else runs on it. Almost everything it needs is in
git and comes back with a `git clone`. This doc is about the handful of things
that **aren't**, and the order to move them in.

## What isn't in git

| # | Item | Path | Replaceable? |
|---|---|---|---|
| 1 | App Store Connect API key | `~/.appstoreconnect/private_keys/AuthKey_UCFMFW9636.p8` | **No** — Apple allows exactly one download |
| 2 | Render + admin credentials | `~/.claude/projects/-Users-ethanibennett-WSOP-scheduler/render.env` | Yes, if you have the values elsewhere |
| 3 | Apple Distribution cert + private key | login keychain | Yes — reissue in the developer portal |
| 4 | Auto-pull launchd agent | `~/bin/futuregame-autopull.sh`, `~/Library/LaunchAgents/me.futurega.autopull.plist` | Yes — both are in `docs/mac-build.md` |
| 5 | GitHub Actions self-hosted runner | wherever `actions-runner/` was unpacked | Yes — registration is machine-bound and **must** be recreated |

Item 1 is the only genuinely irreplaceable one. If it's lost you are not stuck:
generate a new key in App Store Connect and update `ASC_KEY_ID` / `ASC_ISSUER_ID`
(defaults live in `scripts/ios-testflight.sh`). But it's worth not losing.

> ⚠️ Items 1–3 are credentials. Never commit them, never print them to a terminal
> or into a chat, and move them only inside an encrypted disk image or by AirDrop.
> Confirming a file exists and copied is enough; its contents never need to be read.

## Order of operations

1. Inventory + protect unpushed work on the **old** Mac.
2. Bundle the five items above.
3. Set up the **new** Mac and get a `--dry-run` passing.
4. Only then: deregister the runner on the old Mac, register it on the new one.
5. Only then: wipe the old Mac.

Runner registration is bound to a machine, so it has to be removed on the old one
and created on the new one — in that order, and not before step 3 succeeds.

## On the old Mac

Paste this into a fresh Claude Code session, from inside the scheduler clone:

```
You're on my old MacBook. I'm migrating this project to a new Mac and then wiping this
one. This machine is the futuregame suite's Xcode build node: it builds the iOS app and
the macOS screensaver, and nothing else runs here.

Read CLAUDE.md, docs/mac-build.md and docs/mac-migration.md first. The scheduler clone is
probably ~/Desktop/fg_solver/wsop — confirm before trusting it.

PHASE 1 — INVENTORY ONLY. Change nothing. Report what exists, with dates and sizes:
  1. ~/.appstoreconnect/private_keys/           App Store Connect API key (AuthKey_UCFMFW9636.p8)
  2. ~/.claude/projects/-Users-ethanibennett-WSOP-scheduler/render.env
                                                RENDER_API_KEY, ADMIN_EMAIL, ADMIN_PASS
  3. ~/bin/futuregame-autopull.sh + ~/Library/LaunchAgents/me.futurega.autopull.plist
  4. Any GitHub Actions self-hosted runner (look for an actions-runner dir and
     `launchctl list | grep -i actions.runner`)
  5. Every git clone of ethanibennett/* — find them, don't assume the paths
  6. Signing identities: `security find-identity -v -p codesigning`
  7. Installed screensaver: ~/Library/Screen Savers/*.saver
  8. Xcode version and whether xcode-select points at it

PHASE 2 — PROTECT UNPUSHED WORK. Before anything else, for every clone found: report
uncommitted changes, unpushed commits, and stashes. Anything unpushed is the only thing
here that doesn't exist elsewhere — surface it and ask me what to do. Do not discard it.

PHASE 3 — FIX ONE THING WHILE YOU'RE STILL ON A WORKING BUILD MACHINE. The repo has no
shared Xcode scheme, so schemes live in gitignored xcuserdata and a fresh clone can't run
`xcodebuild -scheme "futurega.me"`. That will bite on the new Mac. In Xcode: Product →
Scheme → Manage Schemes → tick "Shared" for futurega.me, then commit
ios/App/App.xcodeproj/xcshareddata/ on a branch and open a PR. Verify first with
`./scripts/ios-testflight.sh --dry-run` (stops before the archive, uploads nothing).

PHASE 4 — BUNDLE THE THINGS THAT AREN'T IN GIT. Collect into ~/Desktop/mac-migration/:
  - the .p8 key (Apple allows exactly one download — if this is lost, the key is gone and
    a new one must be generated)
  - render.env
  - the autopull script + plist
  - the Apple Distribution certificate AND its private key, exported as a .p12 with a
    password (Keychain Access → My Certificates → right-click → Export)
Then turn that folder into an ENCRYPTED disk image (Disk Utility → File → New Image →
Image from Folder → AES-256) and tell me the path. Transfer by AirDrop or a cable.

RULES:
  - Never print the contents of the .p8, .p12 or render.env to the terminal or to me.
    Confirm they exist and copied; that's all.
  - Never commit any of them. Verify with `git status` and `git check-ignore` after.
  - Delete NOTHING from this Mac and DON'T deregister the Actions runner yet — the new
    machine has to be working first. Runner registration is machine-bound, so it gets
    removed here and re-created there, in that order.

PHASE 5 — Write ~/Desktop/mac-migration/CHECKLIST.md: what to install on the new Mac
(Xcode + command line tools, node, gh + `gh auth login`), where each bundled file goes,
how to re-register the Actions runner per docs/mac-build.md, and how to verify — the
verification is `./scripts/ios-testflight.sh --dry-run` succeeding, then a real run.

Start with Phase 1 and stop for my go-ahead before Phase 3.
```

## On the new Mac

### Install

```bash
xcode-select --install                  # or install Xcode from the App Store first
sudo xcode-select -s /Applications/Xcode.app
brew install node gh
gh auth login
```

Open Xcode once and let it finish installing components — `xcodebuild` fails in
odd ways until that's done.

### Restore

| Item | Goes to |
|---|---|
| `AuthKey_*.p8` | `~/.appstoreconnect/private_keys/` (create the dir; `chmod 600` the key) |
| `render.env` | the same `~/.claude/projects/...` path, only if you still use `deploy.sh` |
| `.p12` cert | double-click to import into the login keychain |
| autopull script + plist | `~/bin/` and `~/Library/LaunchAgents/`, then `launchctl load` the plist |

Then clone and confirm the app builds:

```bash
git clone https://github.com/ethanibennett/futuregame-scheduler.git
cd futuregame-scheduler
npm install
./scripts/ios-testflight.sh --dry-run
```

`--dry-run` pulls, builds the web app, syncs it into the iOS project and stops
before archiving — so it exercises everything except signing and upload, without
consuming a build number. When that passes, run it for real.

### Re-register the Actions runner

Only after a real build succeeds, and after removing the runner on the old Mac.
Repo → **Settings → Actions → Runners → New self-hosted runner → macOS**, run the
`./config.sh` it gives you, accept the default labels (the workflow targets
`[self-hosted, macOS]`), then:

```bash
./svc.sh install && ./svc.sh start && ./svc.sh status
```

The runner executes as your user, which is why the `.p8` at
`~/.appstoreconnect/private_keys/` is enough and no GitHub secret is involved —
the key never leaves the machine.

## Done when

- `./scripts/ios-testflight.sh` completes and the build appears in TestFlight
- a push to `master` touching `vite-app/**` starts a run on the new runner
- the old Mac's runner is deregistered and its copies of items 1–3 are destroyed
