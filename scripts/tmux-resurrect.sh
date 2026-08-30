#!/usr/bin/env bash
# Bring the per-project tmux sessions back after a reboot.
#
# The Mac's ~/.ssh/config points every project alias at
#   tmux new -A -s %n
# so `ssh sched` attaches to the session named `sched` and creates it if it is
# missing. That covers everything except a reboot, which takes the tmux server
# with it — this is the tmux half of what futuregame-pm2-resurrect does for pm2,
# and it is registered the same way (at logon, as ethan, after a short delay).
#
# Why the cd is sent as a keystroke rather than passed as `new-session -c`:
# MSYS2's login shell sources /etc/profile, which cd's to $HOME, so the -c
# working directory is overwritten a moment after the session starts. Measured:
# the pane came up in ~ and Claude reported "Accessing workspace: C:\Users\ethan"
# and stopped on a trust prompt. Sent as a keystroke it lands after the profile
# has run, Claude opens on the project and starts clean.
set -u

# alias : project directory. The alias is the tmux session name AND the ssh
# alias, because the Mac's config passes %n straight through.
SESSIONS="
sched:/d/projects/scheduler
solver:/d/projects/futuregame-solver
cash:/d/projects/cash-game-watcher
mtt:/d/projects/mtt-series-watcher
dash:/d/projects/wsop-console
"

# Set to 0 to have the sessions come back as bare shells instead — the tmux
# sessions still survive, you just type `claude` yourself after a reboot.
START_CLAUDE="${START_CLAUDE:-1}"

for entry in $SESSIONS; do
  name="${entry%%:*}"
  dir="${entry#*:}"
  [ -d "$dir" ] || { echo "skip $name: $dir missing"; continue; }
  if tmux has-session -t "$name" 2>/dev/null; then
    echo "skip $name: already running"
    continue
  fi
  tmux new-session -d -s "$name"
  tmux send-keys -t "$name" "cd $dir" Enter
  if [ "$START_CLAUDE" = "1" ]; then
    sleep 1
    tmux send-keys -t "$name" "claude" Enter
  fi
  echo "started $name -> $dir"
done
