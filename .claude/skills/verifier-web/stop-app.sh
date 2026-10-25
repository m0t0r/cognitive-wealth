#!/usr/bin/env bash
# Stops what start-app.sh started, from the main checkout or any worktree: each server whose pid it
# recorded in the main checkout's .dev/verify/, after checking that pid is still a standalone web
# server, then the --ref checkouts it built in .dev/worktrees/. The verify Compose project keeps running.
#
#   stop-app.sh
set -euo pipefail

main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")

for pidfile in "$main"/.dev/verify/server-*.pid; do
  [ -f "$pidfile" ] || continue
  pid=$(cat "$pidfile")
  cmd=$(ps -o command= -p "$pid" 2>/dev/null || true)
  # A recycled pid belongs to some other process by now: leave it. Next renames its process title
  # to `next-server (v…)` once it starts, so `ps` shows that rather than `node …/server.js`.
  if [[ "$cmd" == "next-server "* || "$cmd" == node*"/.next/standalone/apps/web/server.js"* ]]; then
    kill "$pid"
    for _ in $(seq 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    echo "stopped $(basename "$pidfile" .pid) (pid $pid)"
  fi
  rm -f "$pidfile"
done

for checkout in "$main"/.dev/worktrees/*/; do
  [ -d "$checkout" ] || continue
  git -C "$main" worktree remove --force "$checkout"
  echo "removed ${checkout%/}"
done
