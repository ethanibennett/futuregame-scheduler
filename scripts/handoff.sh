#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Handoff channel between the machines in the futuregame suite.
#
# Claude Code sessions are stored per-machine and cannot message each other
# across boxes — a session on the Mac never appears in the Windows session list.
# So the channel is GitHub, which both machines already authenticate to with
# `gh`, matching the "GitHub is the only hub" model in docs/mac-build.md.
#
# One issue per handoff. Open means the other machine still owes you something;
# closing it means done. That makes `inbox` a real to-do list rather than a chat
# log you have to re-read.
#
# Messages should carry INTENT ("please ship a TestFlight build"), not code.
# Code moves through commits. The machine split is deliberate: Windows owns the
# server, database and web deploys; the Mac only builds the app. A message
# channel is not a licence for either side to start editing the other's domain.
#
# Usage:
#   ./scripts/handoff.sh send mac "Ship a TestFlight build" [-b "extra detail"]
#   ./scripts/handoff.sh inbox                 # open items addressed to me
#   ./scripts/handoff.sh inbox --all           # both directions
#   ./scripts/handoff.sh read 42
#   ./scripts/handoff.sh reply 42 "building now"
#   ./scripts/handoff.sh done 42 ["build 15 uploaded"]
# ─────────────────────────────────────────────────────────────────────────────

command -v gh >/dev/null || { echo "gh CLI not found — https://cli.github.com" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh is not authenticated — run: gh auth login" >&2; exit 1; }

# This machine's identity, used to default the inbox and to sign messages.
case "$(uname -s)" in
  Darwin) SELF=mac ;;
  *)      SELF=windows ;;
esac

label_for() { echo "handoff:$1"; }

ensure_label() {
  local name; name="$(label_for "$1")"
  gh label list --limit 200 2>/dev/null | grep -q "^${name}\b" && return 0
  # Colours are arbitrary; they just make the two directions easy to tell apart.
  local colour; [ "$1" = "mac" ] && colour="1d76db" || colour="5319e7"
  gh label create "$name" --color "$colour" --description "Handoff addressed to the $1 machine" >/dev/null 2>&1 || true
}

context_block() {
  local branch rev
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  rev="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
  printf '\n\n---\nfrom **%s** · `%s` @ `%s` · %s\n' \
    "$SELF" "$branch" "$rev" "$(date '+%Y-%m-%d %H:%M %Z')"
}

cmd="${1:-}"; shift || true

case "$cmd" in
  send)
    to="${1:-}"; title="${2:-}"; shift 2 2>/dev/null || true
    body=""
    while [ $# -gt 0 ]; do
      case "$1" in
        -b|--body) body="${2:-}"; shift ;;
        *) echo "unknown flag: $1" >&2; exit 2 ;;
      esac
      shift
    done
    [ "$to" = "mac" ] || [ "$to" = "windows" ] || { echo "usage: handoff.sh send <mac|windows> \"title\" [-b body]" >&2; exit 2; }
    [ -n "$title" ] || { echo "a title is required" >&2; exit 2; }
    [ "$to" != "$SELF" ] || echo "note: addressing a handoff to this same machine ($SELF)" >&2
    ensure_label "$to"
    url=$(gh issue create \
      --title "$title" \
      --label "$(label_for "$to")" \
      --body "${body}$(context_block)")
    echo "sent to $to → $url"
    ;;

  inbox)
    # Note: passing --label twice to `gh issue list` ANDs them, so listing both
    # directions has to be two calls rather than one.
    list_one() {
      gh issue list --state open --label "$(label_for "$1")" \
        --json number,title,updatedAt \
        --template '{{range .}}  #{{.number}}  {{.title}}  ({{timeago .updatedAt}}){{"\n"}}{{end}}' 2>/dev/null \
        || gh issue list --state open --label "$(label_for "$1")"
    }
    case "${1:-}" in
      --all)
        for side in mac windows; do
          echo "→ addressed to $side:"
          out="$(list_one "$side")"
          [ -n "$out" ] && echo "$out" || echo "  (none)"
        done
        ;;
      mac|windows)
        echo "open handoffs addressed to $1:"
        out="$(list_one "$1")"
        [ -n "$out" ] && echo "$out" || echo "  (none)"
        ;;
      "")
        echo "open handoffs addressed to this machine ($SELF):"
        out="$(list_one "$SELF")"
        [ -n "$out" ] && echo "$out" || echo "  (none)"
        echo
        echo "read one with:  ./scripts/handoff.sh read <number>"
        ;;
      *) echo "usage: handoff.sh inbox [mac|windows|--all]" >&2; exit 2 ;;
    esac
    ;;

  read)
    n="${1:-}"; [ -n "$n" ] || { echo "usage: handoff.sh read <number>" >&2; exit 2; }
    gh issue view "$n" --comments
    ;;

  reply)
    n="${1:-}"; msg="${2:-}"
    [ -n "$n" ] && [ -n "$msg" ] || { echo "usage: handoff.sh reply <number> \"message\"" >&2; exit 2; }
    gh issue comment "$n" --body "${msg}$(context_block)" >/dev/null
    echo "replied on #$n"
    ;;

  done)
    n="${1:-}"; note="${2:-done}"
    [ -n "$n" ] || { echo "usage: handoff.sh done <number> [note]" >&2; exit 2; }
    gh issue comment "$n" --body "${note}$(context_block)" >/dev/null
    gh issue close "$n" >/dev/null
    echo "closed #$n"
    ;;

  ""|-h|--help)
    sed -n '4,30p' "$0"
    ;;

  *)
    echo "unknown command: $cmd (try --help)" >&2; exit 2
    ;;
esac
