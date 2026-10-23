#!/usr/bin/env bash
# Starts one headless Chrome on 127.0.0.1:9222 that both agent-browser and the chrome-devtools MCP
# drive (the MCP is configured with --browserUrl http://127.0.0.1:9222), signed in as <email>.
#
#   start-browser.sh <email> <app-url> <client-ip> [session]
#
# Launching agent-browser with --args "--remote-debugging-port=9222" hangs its daemon, so Chrome
# starts first and agent-browser connects to it.
set -euo pipefail

email=${1:?usage: start-browser.sh <email> <app-url> <client-ip> [session]}
app=${2:?app url, e.g. http://localhost:3000}
ip=${3:?client ip, e.g. 10.77.0.1}
session=${4:-verify}
root=$(git rev-parse --show-toplevel)
state="$root/.dev/auth/$email.json"

[ -f "$state" ] || { echo "No session file $state; run: pnpm dev:sign-in $email --app $app --ip $ip" >&2; exit 1; }

# Reuse only a headless Chrome for Testing this script started; anything else on 9222 (often an
# everyday Chrome with remote debugging on) would put the trace in a personal browser.
listener=$(lsof -t -iTCP:9222 -sTCP:LISTEN 2>/dev/null | head -1 || true)
if [ -n "$listener" ]; then
  cmd=$(ps -o command= -p "$listener")
  case "$cmd" in
    *"/.agent-browser/browsers/"*"--headless=new"*) ;;
    *) echo "Port 9222 is held by another process (pid $listener: ${cmd:0:120}). Quit it and rerun." >&2; exit 1 ;;
  esac
else
  chrome=$(ls -d "$HOME"/.agent-browser/browsers/chrome-*/"Google Chrome for Testing.app"/Contents/MacOS/"Google Chrome for Testing" | sort -V | tail -1)
  profile=$(mktemp -d)
  nohup "$chrome" --headless=new --remote-debugging-port=9222 --user-data-dir="$profile" \
    --no-first-run about:blank >/dev/null 2>&1 &
  for _ in $(seq 20); do curl -sf http://127.0.0.1:9222/json/version >/dev/null && break; sleep 0.5; done
  curl -sf http://127.0.0.1:9222/json/version >/dev/null || { echo "Chrome didn't come up on 9222" >&2; exit 1; }
fi

agent-browser --session "$session" connect 9222
agent-browser --session "$session" state load "$state"
agent-browser --session "$session" --headers "{\"x-forwarded-for\":\"$ip\"}" open "$app"
