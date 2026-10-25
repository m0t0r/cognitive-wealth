#!/usr/bin/env bash
# Starts one headless Chrome on 127.0.0.1:9222 that both agent-browser and the chrome-devtools MCP
# drive (the MCP is configured with --browserUrl http://127.0.0.1:9222), signed in as <email>.
#
#   start-browser.sh <email> <app-url> <client-ip> [session]
#
# The session defaults to this checkout's own (`verify` in the main checkout, `verify-<token>` in a
# worktree), and the script prints it. Launching agent-browser with --args
# "--remote-debugging-port=9222" hangs its daemon, so Chrome starts first and agent-browser
# connects to it. The Chrome's pid, profile and owner (this checkout's token and path) go to the
# main checkout's .dev/verify/chrome.{pid,profile,owner}, so stop-browser.sh stops that one process
# and nothing else.
#
# One Chrome serves every worktree, and they can't share it: agent-browser sessions connected to one
# Chrome drive the same tab with the same cookies, and Chrome traces one page at a time. So the
# owner file is a lock. Another checkout's Chrome is refused while that checkout is alive; once it's
# gone (or its Chrome is), this checkout takes over with a fresh Chrome.
set -euo pipefail

eval "$(node "$(git rev-parse --show-toplevel)/packages/dev-env/src/cli/verify-names.ts")"
email=${1:?usage: start-browser.sh <email> <app-url> <client-ip> [session]}
app=${2:?app url, e.g. http://localhost:3100}
ip=${3:?client ip, e.g. 10.77.0.1}
session=${4:-$VERIFY_SESSION}
main=$VERIFY_MAIN
# dev:sign-in saves to the checkout it runs from, so a worktree's own session comes first: one in
# the main checkout may belong to another task's server and database.
state="$VERIFY_TOP/.dev/auth/$email.json"
[ -f "$state" ] || state="$main/.dev/auth/$email.json"
mkdir -p "$VERIFY_DIR"

[ -f "$state" ] || { echo "No session file $state; run: pnpm dev:sign-in $email --app $app --ip $ip" >&2; exit 1; }

# Reuse only the Chrome this script started, identified by its recorded pid. Anything else on 9222
# (often an everyday Chrome with remote debugging on) would put the trace in a personal browser.
listener=$(lsof -t -iTCP:9222 -sTCP:LISTEN 2>/dev/null | head -1 || true)
if [ -n "$listener" ]; then
  if [ "$listener" != "$(cat "$VERIFY_CHROME_PID" 2>/dev/null)" ]; then
    cmd=$(ps -o command= -p "$listener")
    echo "Port 9222 is held by another process (pid $listener: ${cmd:0:120}). Ask the user to quit it, then rerun." >&2
    exit 1
  fi
  owner=$(sed -n 1p "$VERIFY_CHROME_OWNER" 2>/dev/null || true)
  owner_path=$(sed -n 2p "$VERIFY_CHROME_OWNER" 2>/dev/null || true)
  if [ "$owner" != "$VERIFY_TOKEN" ]; then
    if [ -n "$owner_path" ] && git -C "$main" worktree list --porcelain | grep -qxF "worktree $owner_path"; then
      echo "The shared Chrome on 9222 is in use by $owner_path. Wait until its verification is done (its stop-browser.sh frees it), or ask the user." >&2
      exit 1
    fi
    # Its owner is gone: start over, so none of its cookies (shared by every localhost port) stay.
    echo "Taking over the shared Chrome from ${owner_path:-a removed checkout}." >&2
    kill "$listener"
    for _ in $(seq 20); do kill -0 "$listener" 2>/dev/null || break; sleep 0.25; done
    profile=$(cat "$VERIFY_CHROME_PROFILE" 2>/dev/null || true)
    [ -n "$profile" ] && [[ "$profile" == "${TMPDIR:-/tmp}"* || "$profile" == /tmp/* || "$profile" == /var/folders/* ]] && rm -rf "$profile"
    rm -f "$VERIFY_CHROME_PID" "$VERIFY_CHROME_PROFILE" "$VERIFY_CHROME_OWNER"
    listener=""
  fi
fi
if [ -z "$listener" ]; then
  chrome=$(ls -d "$HOME"/.agent-browser/browsers/chrome-*/"Google Chrome for Testing.app"/Contents/MacOS/"Google Chrome for Testing" | sort -V | tail -1)
  profile=$(mktemp -d)
  # nohup execs Chrome, so $! is Chrome's own pid: the process that listens on 9222.
  nohup "$chrome" --headless=new --remote-debugging-port=9222 --user-data-dir="$profile" \
    --no-first-run about:blank >/dev/null 2>&1 &
  echo $! >"$VERIFY_CHROME_PID"
  echo "$profile" >"$VERIFY_CHROME_PROFILE"
  printf '%s\n%s\n' "$VERIFY_TOKEN" "$VERIFY_TOP" >"$VERIFY_CHROME_OWNER"
  for _ in $(seq 20); do curl -sf http://127.0.0.1:9222/json/version >/dev/null && break; sleep 0.5; done
  curl -sf http://127.0.0.1:9222/json/version >/dev/null || { echo "Chrome didn't come up on 9222" >&2; exit 1; }
fi

agent-browser --session "$session" connect 9222
agent-browser --session "$session" state load "$state"
agent-browser --session "$session" --headers "{\"x-forwarded-for\":\"$ip\"}" open "$app"
echo "agent-browser session: $session"
