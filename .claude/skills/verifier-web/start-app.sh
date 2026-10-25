#!/usr/bin/env bash
# Runs the production build of `web` on the host against the throwaway verification services
# (compose.verify.yaml), never the dev stack: the standalone server the Docker image runs, without
# building an image. Each server gets a fresh database and its own Redis key prefix.
#
#   start-app.sh [--port <n>] [--ref <git ref>]
#
# Without --ref it serves the working tree on :3100. With --ref (say the PR's base, for "before"
# captures) it checks that ref out into .dev/worktrees/<sha>, builds it there and serves it on
# :3101, each from its own database migrated by that ref's own migrations.
# Turbo restores an unchanged build from its cache, so a rerun costs seconds, not a rebuild.
set -euo pipefail

port="" ref=""
while [ $# -gt 0 ]; do
  case "$1" in
    --port) port=$2; shift 2 ;;
    --ref) ref=$2; shift 2 ;;
    *) echo "usage: start-app.sh [--port <n>] [--ref <git ref>]" >&2; exit 2 ;;
  esac
done

# The main checkout holds .secrets/ and runs Compose, so a worktree never recreates the services.
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
compose=(docker compose --project-directory "$main" -f "$main/compose.yaml" -f "$main/compose.verify.yaml")
secrets="$main/.secrets"

if [ -n "$ref" ]; then
  sha=$(git rev-parse --short "$ref^{commit}")
  app="$main/.dev/worktrees/$sha"
  port=${port:-3101}
  if [ ! -d "$app" ]; then
    git -C "$main" worktree add --detach "$app" "$sha" >/dev/null
  fi
  (cd "$app" && pnpm install --frozen-lockfile --prefer-offline --silent)
else
  app=$(git rev-parse --show-toplevel)
  port=${port:-3100}
fi
url="http://localhost:$port"
out="$main/.dev/verify"
mkdir -p "$out"
database="verify_$port"

"${compose[@]}" up -d --wait db redis mailpit >/dev/null

# A fresh database per server, cloned from the empty `cognitive_wealth`, which carries the roles'
# default privileges; database-level grants aren't copied, so they're repeated (as e2e does).
"${compose[@]}" exec -T db sh -c 'PGPASSWORD="$(cat /run/secrets/postgres_password)" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres' <<SQL
drop database if exists "$database" with (force);
create database "$database" owner migrator template cognitive_wealth;
revoke all on database "$database" from public;
grant connect on database "$database" to app;
SQL

(cd "$app" &&
  DATABASE_URL="postgres://migrator@localhost:5433/$database" \
    DATABASE_PASSWORD_FILE="$secrets/db_migrator_password" pnpm --silent --filter @repo/db db:migrate &&
  DATABASE_URL="postgres://app@localhost:5433/$database" \
    DATABASE_PASSWORD_FILE="$secrets/db_app_password" pnpm --silent db:seed >/dev/null &&
  pnpm exec turbo build --filter=web --output-logs=errors-only)

# Lay the standalone server out as the Docker image does (and e2e's global setup): Next leaves the
# client assets and public/ out of .next/standalone, so without them every /_next/static/* 404s.
# A fresh copy each time, since a --ref checkout or a cached build never got one.
web="$app/apps/web"
standalone="$web/.next/standalone/apps/web"
rm -rf "$standalone/.next/static" "$standalone/public"
cp -R "$web/.next/static" "$standalone/.next/static"
cp -R "$web/public" "$standalone/public"

# Replace the server this script started on this port last time; refuse anything else there.
pidfile="$out/server-$port.pid"
if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
  kill "$(cat "$pidfile")"
  while kill -0 "$(cat "$pidfile")" 2>/dev/null; do sleep 0.2; done
fi
if lsof -t -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $port is taken by another process; pass --port with a free one." >&2
  exit 1
fi

# The production container's environment (compose.yaml's `web`), pointed at the verify services.
env -i PATH="$PATH" HOME="$HOME" \
  NODE_ENV=production HOSTNAME=127.0.0.1 PORT="$port" \
  BETTER_AUTH_URL="$url" BETTER_AUTH_SECRET_FILE="$secrets/better_auth_secret" \
  DATABASE_URL="postgres://app@localhost:5433/$database" \
  DATABASE_PASSWORD_FILE="$secrets/db_app_password" \
  REDIS_URL=redis://app@localhost:6380 REDIS_PASSWORD_FILE="$secrets/redis_password" \
  REDIS_KEY_PREFIX="cw:v$port-$(date +%s):" \
  EMAIL_TRANSPORT=smtp SMTP_URL=smtp://localhost:1026 \
  EMAIL_FROM="Cognitive Wealth <no-reply@cognitive-wealth.localhost>" \
  AUTH_TRUSTED_IP_HEADER=x-forwarded-for \
  nohup node "$app/apps/web/.next/standalone/apps/web/server.js" >"$out/server-$port.log" 2>&1 &
echo $! >"$pidfile"

for _ in $(seq 60); do curl -sf "$url/api/health" >/dev/null && { echo "$url"; exit 0; }; sleep 0.5; done
echo "Server didn't become healthy; see $out/server-$port.log" >&2
exit 1
