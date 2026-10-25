#!/usr/bin/env bash
# Stops what start-browser.sh started from this checkout, and only that: closes the agent-browser
# session, then, if this checkout holds the shared Chrome (.dev/verify/chrome.owner), stops the
# Chrome whose pid start-browser.sh recorded, after checking that pid is still that Chrome
# (headless, with its throwaway profile), and frees it for other worktrees. Any other Chrome,
# including one on 9222, is left alone.
#
#   stop-browser.sh [session]
set -euo pipefail

eval "$(node "$(git rev-parse --show-toplevel)/packages/dev-env/src/cli/verify-names.ts")"
session=${1:-$VERIFY_SESSION}
pidfile=$VERIFY_CHROME_PID
profilefile=$VERIFY_CHROME_PROFILE

agent-browser --session "$session" close >/dev/null 2>&1 || true

[ -f "$pidfile" ] || exit 0
# Another worktree's Chrome stays: closing our session was all there was to do.
[ "$(sed -n 1p "$VERIFY_CHROME_OWNER" 2>/dev/null || true)" = "$VERIFY_TOKEN" ] || exit 0
pid=$(cat "$pidfile")
profile=$(cat "$profilefile" 2>/dev/null || true)
cmd=$(ps -o command= -p "$pid" 2>/dev/null || true)

# A recycled pid belongs to some other process by now: leave it.
if [ -n "$cmd" ] && [ -n "$profile" ] && [[ "$cmd" == *"--headless=new"* && "$cmd" == *"--user-data-dir=$profile"* ]]; then
  kill "$pid"
  for _ in $(seq 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
fi
[ -n "$profile" ] && [[ "$profile" == "${TMPDIR:-/tmp}"* || "$profile" == /tmp/* || "$profile" == /var/folders/* ]] && rm -rf "$profile"
rm -f "$pidfile" "$profilefile" "$VERIFY_CHROME_OWNER"
