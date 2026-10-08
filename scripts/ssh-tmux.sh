#!/usr/bin/env bash
# The Mac's `ssh sched|solver|cash|mtt|dash` aliases land here (RemoteCommand
#   C:\msys64\usr\bin\bash.exe -l /d/projects/scheduler/scripts/ssh-tmux.sh %n).
# Windows' sshd runs commands through its DefaultShell (PowerShell), which hands
# MSYS2 a console, not a pty, so a bare `tmux attach` fails "not a terminal".
# `script` allocates the pty tmux needs. Measured 2026-10-07 from the Mac.
exec script -qfc "tmux new -A -s ${1:?session name}" /dev/null
