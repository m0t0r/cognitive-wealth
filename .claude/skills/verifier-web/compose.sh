#!/usr/bin/env bash
# Runs compose.yaml's own services (the images, the custodian, migrations) from this checkout in a
# Compose project of its own (#158), never the dev stack's `cognitive-wealth` or its volumes:
#
#   compose.sh up [<service> ...]   build and start them (all of compose.yaml's when none is named)
#   compose.sh down                 stop them and delete the project's volumes
#   compose.sh <command> [<arg> ...] any other `docker compose` command on the project (ps, logs, exec)
#
# The project (`cw-compose-<token>`) and its host ports (web, custodian, Mailpit) come from
# @repo/dev-env (verify-names.ts), like start-app.sh's, so checkouts never share them, and worktree
# teardown (`pnpm dev:prune`) removes a gone worktree's project with its volumes. A worktree has no
# .secrets/, so this one gets throwaway secrets in its own (gitignored) .secrets/; the main
# checkout's real ones are used there, but in volumes of this project, never the dev stack's.
set -euo pipefail

eval "$(node "$(git rev-parse --show-toplevel)/packages/dev-env/src/cli/verify-names.ts")"
top=$VERIFY_TOP

# Every secret compose.yaml names, as its header's loop makes them; existing files are kept.
(umask 077 && mkdir -p "$top/.secrets")
for s in $(sed -n 's|^ *file: \./\.secrets/||p' "$top/compose.yaml"); do
  [ -s "$top/.secrets/$s" ] || (openssl rand -hex 32 >"$top/.secrets/$s" && chmod 644 "$top/.secrets/$s")
done

compose=(docker compose -p "$VERIFY_COMPOSE_PROJECT" --project-directory "$top" -f "$top/compose.yaml")
export WEB_PORT=$VERIFY_COMPOSE_WEB_PORT CUSTODIAN_PORT=$VERIFY_COMPOSE_CUSTODIAN_PORT \
  MAILPIT_PORT=$VERIFY_COMPOSE_MAILPIT_PORT

case "${1:-}" in
  up)
    shift
    "${compose[@]}" up --build --detach --wait "$@"
    echo "Project $VERIFY_COMPOSE_PROJECT: web http://localhost:$WEB_PORT, custodian http://127.0.0.1:$CUSTODIAN_PORT, Mailpit http://127.0.0.1:$MAILPIT_PORT" >&2
    ;;
  down) "${compose[@]}" down --volumes --remove-orphans ;;
  "") echo "usage: compose.sh up [<service> ...] | down | <docker compose command> [<arg> ...]" >&2; exit 2 ;;
  *) "${compose[@]}" "$@" ;;
esac
