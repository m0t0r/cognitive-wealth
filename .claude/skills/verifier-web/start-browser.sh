#!/usr/bin/env bash
# Starts one headless Chrome on 127.0.0.1:9222 that both agent-browser and the chrome-devtools MCP
# drive (the MCP is configured with --browserUrl http://127.0.0.1:9222), signed in as <email>.
#
#   start-browser.sh <email> <app-url> <client-ip> [session]
#
# Launching agent-browser with --args "--remote-debugging-port=9222" hangs its daemon, so Chrome
# starts first and agent-browser connects to it. The Chrome's pid and profile go to
# .dev/verify/chrome.{pid,profile}, so stop-browser.sh stops that one process and nothing else.
set -euo pipefail

email=${1:?usage: start-browser.sh <email> <app-url> <client-ip> [session]}
app=${2:?app url, e.g. http://localhost:3000}
ip=${3:?client ip, e.g. 10.77.0.1}
session=${4:-verify}
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
# dev:sign-in saves to the checkout it runs from, so a worktree's own session comes first: one in
# the main checkout may belong to another task's server and database.
state="$(git rev-parse --show-toplevel)/.dev/auth/$email.json"
[ -f "$state" ] || state="$main/.dev/auth/$email.json"
pidfile="$main/.dev/verify/chrome.pid"
mkdir -p "$main/.dev/verify"

[ -f "$state" ] || { echo "No session file $state; run: pnpm dev:sign-in $email --app $app --ip $ip" >&2; exit 1; }

# Reuse only the Chrome this script started, identified by its recorded pid. Anything else on 9222
# (often an everyday Chrome with remote debugging on) would put the trace in a personal browser.
listener=$(lsof -t -iTCP:9222 -sTCP:LISTEN 2>/dev/null | head -1 || true)
if [ -n "$listener" ]; then
  if [ "$listener" != "$(cat "$pidfile" 2>/dev/null)" ]; then
    cmd=$(ps -o command= -p "$listener")
    echo "Port 9222 is held by another process (pid $listener: ${cmd:0:120}). Ask the user to quit it, then rerun." >&2
    exit 1
  fi
else
  chrome=$(ls -d "$HOME"/.agent-browser/browsers/chrome-*/"Google Chrome for Testing.app"/Contents/MacOS/"Google Chrome for Testing" | sort -V | tail -1)
  profile=$(mktemp -d)
  # nohup execs Chrome, so $! is Chrome's own pid: the process that listens on 9222.
  nohup "$chrome" --headless=new --remote-debugging-port=9222 --user-data-dir="$profile" \
    --no-first-run about:blank >/dev/null 2>&1 &
  echo $! >"$pidfile"
  echo "$profile" >"$main/.dev/verify/chrome.profile"
  for _ in $(seq 20); do curl -sf http://127.0.0.1:9222/json/version >/dev/null && break; sleep 0.5; done
  curl -sf http://127.0.0.1:9222/json/version >/dev/null || { echo "Chrome didn't come up on 9222" >&2; exit 1; }
fi

agent-browser --session "$session" connect 9222
agent-browser --session "$session" state load "$state"
agent-browser --session "$session" --headers "{\"x-forwarded-for\":\"$ip\"}" open "$app"
