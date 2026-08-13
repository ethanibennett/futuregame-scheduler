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
| 3 | Apple Distribution cert + private key | login keychain | Yes — reissue in the developer portal (see the WWDR note below) |
| 4 | Auto-pull launchd agent | `~/bin/futuregame-autopull.sh`, `~/Library/LaunchAgents/me.futurega.autopull.plist` | Yes — both are in `docs/mac-build.md` |
| 5 | GitHub Actions self-hosted runner | wherever `actions-runner/` was unpacked | Yes — registration is machine-bound and **must** be recreated |
| 6 | Provisioning profiles | `~/Library/Developer/Xcode/UserData/Provisioning Profiles/` (older Xcode: `~/Library/MobileDevice/Provisioning Profiles/`) | Yes, but **not** by the build script alone — see below |

Item 6 is the one that actually bit during the 2026-08 migration, because it is
invisible until the very last step. The build node needs an **App Store**
distribution profile for `app.futurega.me.beta` (a profile with no
`ProvisionedDevices`). On a machine that has used Xcode's GUI for a while one is
simply present; on a fresh machine there is none, and Xcode tries to create one
through the API and fails with:

```
Cloud signing permission error
No profiles for 'app.futurega.me.beta' were found
```

An **App Manager**-role ASC key cannot mint profiles — that needs
Certificates/Identifiers/Profiles rights (Admin). So a fresh machine has three
ways out, cheapest first:

1. Copy the `.mobileprovision` files from the old machine (they are not secrets;
   AirDrop is fine). This is what unblocked 2026-08.
2. Sign in to Xcode → Settings → Accounts → Download Manual Profiles, or create
   the profile by hand in the developer portal.
3. Generate an ASC key with **Admin** role so cloud signing can mint profiles
   itself, and update `ASC_KEY_ID` / `ASC_ISSUER_ID`. A new key is additive — the
   existing `.p8` is not invalidated.

Option 1 or 2 unblocks a migration; **option 3 is the only one that survives
unattended operation**, because copied profiles expire (the 2026-08 one expires
2027-04-08) and a runner with no human at the GUI cannot renew them. Do it
deliberately before the expiry rather than discovering it from a failed
automated build.

> Two traps when diagnosing this:
> - `--dry-run` **cannot** catch it. The failure lands at `exportArchive`, which
>   is past where the dry run stops. A green dry run proves nothing about signing.
> - The signing identity in the archive log is a **red herring**. The archive may
>   be signed `Apple Development: Created via API` and still export fine, because
>   `exportArchive` re-signs using the identity and profile named in
>   `ios/ExportOptions.plist`. The signal to read is
>   `No profiles for '<bundle id>' were found`.

Item 1 is the only genuinely irreplaceable one. If it's lost you are not stuck:
generate a new key in App Store Connect and update `ASC_KEY_ID` / `ASC_ISSUER_ID`
(defaults live in `scripts/ios-testflight.sh`). But it's worth not losing.

> ⚠️ Items 1–3 are credentials. Never commit them, never print them to a terminal
> or into a chat, and move them only inside an encrypted disk image or by AirDrop.
> Confirming a file exists and copied is enough; its contents never need to be read.

### A good `.p12` that yields zero identities: the WWDR intermediate

A fresh Mac ships only the **legacy** Apple Worldwide Developer Relations
intermediate, which expired 2023-02-07. Import a perfectly valid `.p12` and
`security find-identity -v -p codesigning` still reports **0 valid identities**,
which reads exactly like a failed or cert-only import — and sends you re-exporting
a `.p12` that was never the problem.

The tell is to drop `-v`, which lists invalid identities too:

```bash
security find-identity -p codesigning      # no -v
# → CSSMERR_TP_NOT_TRUSTED against the identity you just imported
```

Fix: install the current **WWDR G3** intermediate from
<https://www.apple.com/certificateauthority/>. The identity becomes valid
immediately; no re-import or re-issue is needed.

## Order of operations

1. Inventory + protect unpushed work on the **old** Mac.
2. Bundle the six items above.
3. Set up the **new** Mac and get a `--dry-run` passing.
4. Only then: deregister the runner on the old Mac, register it on the new one.
5. Only then: wipe the old Mac.

Runner registration is bound to a machine, so it has to be removed on the old one
and created on the new one — in that order, and not before step 3 succeeds.

> ⚠️ **`--dry-run` is not a full gate.** It stops before the archive, so it never
> passes `-scheme` to `xcodebuild` and cannot catch a missing or broken scheme.
> A green dry run plus a failing real run is the expected shape of that bug.
> Treat step 3 as done only after a **real** run reaches App Store Connect.
>
> Related: `scripts/ios-testflight.sh` discards stderr when querying ASC for the
> latest build and falls back to a local counter, so an auth failure degrades
> quietly. The `iOS build number: N → M (past ASC latest …)` line is the proof
> the key worked; `using local counter` means it did not.

**`render.env` is not needed on a build node.** `deploy.sh` is retired there, and
the file carries `RENDER_API_KEY` and `ADMIN_PASS`. A build node runs a
self-hosted Actions runner that executes repo workflow code as your user, so
every credential in that home directory widens the blast radius. Migrate it only
to a machine that actually deploys.

## On the old Mac

Paste this into a fresh Claude Code session, from inside the scheduler clone:

```
You're on my old MacBook. I'm migrating this project to a new Mac and then wiping this
one. This machine is the futuregame suite's Xcode build node: it builds the iOS app and
the macOS screensaver, and nothing else runs here.

Read CLAUDE.md, docs/mac-build.md and docs/mac-migration.md first. The scheduler clone is
probably ~/fg_solver/wsop (older machines: ~/Desktop/fg_solver/wsop) — confirm before
trusting it, and don't assume the clone Xcode builds from is the only one.

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

PHASE 3 — CHECK WHAT ONLY A WORKING BUILD MACHINE CAN TELL YOU. The shared Xcode scheme
is already committed (xcshareddata/xcschemes/futurega.me.xcscheme) — confirm it is still
there rather than re-doing it. What you cannot recreate later is local signing state:
list the provisioning profiles in ~/Library/Developer/Xcode/UserData/Provisioning Profiles/
with `security cms -D -i <file>` and confirm an App Store profile for app.futurega.me.beta
(no ProvisionedDevices) exists, plus its expiry. That profile is item 6 and a fresh
machine cannot mint it with the App-Manager-role key. Verify the build path with
`./scripts/ios-testflight.sh --dry-run` (stops before the archive, uploads nothing) —
but note a green dry run does NOT prove signing works.

PHASE 4 — BUNDLE THE THINGS THAT AREN'T IN GIT. Collect into ~/Desktop/mac-migration/:
  - the .p8 key (Apple allows exactly one download — if this is lost, the key is gone and
    a new one must be generated)
  - render.env (skip it if the target is only a build node — see the note above)
  - the autopull script + plist
  - the Apple Distribution certificate AND its private key, exported as a .p12 with a
    password (Keychain Access → My Certificates → right-click → Export). Keychain Access
    is at /System/Library/CoreServices/Applications/ on macOS 26 — not in Utilities, and
    Spotlight does not index it.
Then turn that folder into an ENCRYPTED disk image (Disk Utility → File → New Image →
Image from Folder → AES-256) and tell me the path. Transfer by AirDrop or a cable.

Separately, and NOT in the encrypted image (they aren't secrets): copy
~/Library/Developer/Xcode/UserData/Provisioning Profiles/*.mobileprovision into a plain
folder and AirDrop that too. Without the App Store profile for app.futurega.me.beta the
new machine archives fine and then fails at export.

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
