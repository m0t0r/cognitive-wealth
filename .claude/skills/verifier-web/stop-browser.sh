#!/usr/bin/env bash
# Stops what start-browser.sh started, and only that: closes the agent-browser session, then stops
# the Chrome whose pid start-browser.sh recorded, after checking that pid is still that Chrome
# (headless, with its throwaway profile). Any other Chrome, including one on 9222, is left alone.
#
#   stop-browser.sh [session]
set -euo pipefail

session=${1:-verify}
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
pidfile="$main/.dev/verify/chrome.pid"
profilefile="$main/.dev/verify/chrome.profile"

agent-browser --session "$session" close >/dev/null 2>&1 || true

[ -f "$pidfile" ] || exit 0
pid=$(cat "$pidfile")
profile=$(cat "$profilefile" 2>/dev/null || true)
cmd=$(ps -o command= -p "$pid" 2>/dev/null || true)

# A recycled pid belongs to some other process by now: leave it.
if [ -n "$cmd" ] && [ -n "$profile" ] && [[ "$cmd" == *"--headless=new"* && "$cmd" == *"--user-data-dir=$profile"* ]]; then
  kill "$pid"
  for _ in $(seq 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
fi
[ -n "$profile" ] && [[ "$profile" == "${TMPDIR:-/tmp}"* || "$profile" == /tmp/* || "$profile" == /var/folders/* ]] && rm -rf "$profile"
rm -f "$pidfile" "$profilefile"
