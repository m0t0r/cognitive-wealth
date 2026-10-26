#!/usr/bin/env bash
# Runs the production build of `web` on the host against the throwaway verification services
# (compose.verify.yaml), never the dev stack: the standalone server the Docker image runs, without
# building an image. Each server gets a fresh database (seeded, with the custodian's example
# Deliveries ingested) and its own Redis key prefix.
#
#   start-app.sh [--port <n>] [--ref <git ref>] [--seed <file>[:<export>]]
#
# Without --ref it serves the working tree; with --ref (say the PR's base, for "before" captures)
# it checks that ref out into .dev/worktrees/<token>-<sha>, builds it there and serves it, each from
# its own database migrated by that ref's own migrations. Every checkout has its own port pair, its
# own databases and its own state in the main checkout's .dev/verify/<token>/, all named by
# @repo/dev-env (verify-names.ts), so runs from different worktrees never touch each other's, and
# worktree teardown removes them. The main checkout keeps :3100 and :3101.
# Turbo restores an unchanged build from its cache, so a rerun costs seconds, not a rebuild.
# --seed then runs one more seed function, such as the change's own e2e helper
# (apps/web-e2e/support/households.ts:seedHouseholdOfGrace), through @repo/db's run-seed.ts (#164).
# Both come from the working tree, even with --ref, so before and after get the same data.
set -euo pipefail

port="" ref="" seed=""
while [ $# -gt 0 ]; do
  case "$1" in
    --port) port=$2; shift 2 ;;
    --ref) ref=$2; shift 2 ;;
    # Absolute, since the seed runs from the working tree whichever checkout is served.
    --seed) seed="$(realpath "${2%%:*}")${2#"${2%%:*}"}"; shift 2 ;;
    *) echo "usage: start-app.sh [--port <n>] [--ref <git ref>] [--seed <file>[:<export>]]" >&2; exit 2 ;;
  esac
done

eval "$(node "$(git rev-parse --show-toplevel)/packages/dev-env/src/cli/verify-names.ts")"
main=$VERIFY_MAIN
# The main checkout holds .secrets/ and runs Compose, so a worktree never recreates the services.
compose=(docker compose --project-directory "$main" -f "$main/compose.yaml" -f "$main/compose.verify.yaml")
secrets="$main/.secrets"

if [ -n "$ref" ]; then
  role=ref
  sha=$(git rev-parse --short "$ref^{commit}")
  app="$VERIFY_REF_CHECKOUTS/$VERIFY_TOKEN-$sha"
  port=${port:-$VERIFY_REF_PORT}
  database=$VERIFY_REF_DATABASE
else
  role=head
  app=$VERIFY_TOP
  port=${port:-$VERIFY_PORT}
  database=$VERIFY_DATABASE
fi
url="http://localhost:$port"
out=$VERIFY_STATE
pidfile="$out/server-$role.pid"
log="$out/server-$role.log"
mkdir -p "$out"

# Only a server this checkout recorded for this role is ours to replace: the pid must still be a
# standalone web server (Next renames its title to `next-server (v…)` once it starts).
ours=""
if [ -f "$pidfile" ]; then
  pid=$(cat "$pidfile")
  cmd=$(ps -o command= -p "$pid" 2>/dev/null || true)
  if [[ "$cmd" == "next-server "* || "$cmd" == node*"/.next/standalone/apps/web/server.js"* ]]; then
    ours=$pid
  fi
fi

# Before anything destructive: a port held by anything but our own server is refused, so a clash
# with another worktree's server leaves its database and process alone.
listener=$(lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -1 || true)
if [ -n "$listener" ] && [ "$listener" != "$ours" ]; then
  cmd=$(ps -o command= -p "$listener" 2>/dev/null || true)
  echo "Port $port is taken by another process (pid $listener: ${cmd:0:120}), perhaps another worktree's server. Nothing was changed; pass --port with a free one." >&2
  exit 1
fi

if [ -n "$ref" ] && [ ! -d "$app" ]; then
  git -C "$main" worktree add --detach "$app" "$sha" >/dev/null
fi
if [ -n "$ref" ]; then
  (cd "$app" && pnpm install --frozen-lockfile --prefer-offline --silent)
fi

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

# The custodian's example Deliveries, ingested into the world's Firm, so pages that show Positions
# have data (#147). A ref from before Ingestion has neither the CLI nor the fixtures.
feed="$app/apps/custodian/fixtures/feed"
if [ -f "$app/packages/portfolio/src/cli/ingest.ts" ] && [ -d "$feed" ]; then
  for delivery in "$feed"/*/; do
    (cd "$app" &&
      DATABASE_URL="postgres://app@localhost:5433/$database" \
        DATABASE_PASSWORD_FILE="$secrets/db_app_password" \
        pnpm --silent custodian:ingest "$(basename "$delivery")" --root "$feed" >/dev/null)
  done
fi

if [ -n "$seed" ]; then
  DATABASE_URL="postgres://app@localhost:5433/$database" \
    DATABASE_PASSWORD_FILE="$secrets/db_app_password" \
    node "$VERIFY_TOP/packages/db/src/cli/run-seed.ts" "$seed" >&2
fi

# Each run's ids are new, so list the Households' publicIds for URLs, with the database to query.
households="$out/households-$role.tsv"
"${compose[@]}" exec -T db sh -c "PGPASSWORD=\"\$(cat /run/secrets/postgres_password)\" psql -qAt -F '	' -U postgres -d $database -c 'select name, public_id from household order by name'" >"$households" 2>/dev/null || true # no table before Households
echo "Database: postgres://app@localhost:5433/$database (password file $secrets/db_app_password)" >&2
echo "Households ($(wc -l <"$households" | tr -d ' ')): name and publicId in $households" >&2

# Lay the standalone server out as the Docker image does (and e2e's global setup): Next leaves the
# client assets and public/ out of .next/standalone, so without them every /_next/static/* 404s.
# A fresh copy each time, since a --ref checkout or a cached build never got one.
web="$app/apps/web"
standalone="$web/.next/standalone/apps/web"
rm -rf "$standalone/.next/static" "$standalone/public"
cp -R "$web/.next/static" "$standalone/.next/static"
cp -R "$web/public" "$standalone/public"

# Replace our own server from last time (on this port or another); never anyone else's.
if [ -n "$ours" ]; then
  kill "$ours"
  while kill -0 "$ours" 2>/dev/null; do sleep 0.2; done
fi
# Again, since the build took a while: a server that took the port meanwhile would answer the health
# check below in place of ours.
listener=$(lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -1 || true)
if [ -n "$listener" ]; then
  cmd=$(ps -o command= -p "$listener" 2>/dev/null || true)
  echo "Port $port was taken during the build (pid $listener: ${cmd:0:120}); pass --port with a free one." >&2
  exit 1
fi

# The production container's environment (compose.yaml's `web`), pointed at the verify services.
env -i PATH="$PATH" HOME="$HOME" \
  NODE_ENV=production HOSTNAME=127.0.0.1 PORT="$port" \
  BETTER_AUTH_URL="$url" BETTER_AUTH_SECRET_FILE="$secrets/better_auth_secret" \
  DATABASE_URL="postgres://app@localhost:5433/$database" \
  DATABASE_PASSWORD_FILE="$secrets/db_app_password" \
  REDIS_URL=redis://app@localhost:6380 REDIS_PASSWORD_FILE="$secrets/redis_password" \
  REDIS_KEY_PREFIX="cw:v:$VERIFY_TOKEN:$role:$(date +%s):" \
  EMAIL_TRANSPORT=smtp SMTP_URL=smtp://localhost:1026 \
  EMAIL_FROM="Cognitive Wealth <no-reply@cognitive-wealth.localhost>" \
  AUTH_TRUSTED_IP_HEADER=x-forwarded-for \
  nohup node "$app/apps/web/.next/standalone/apps/web/server.js" >"$log" 2>&1 &
echo $! >"$pidfile"

for _ in $(seq 60); do curl -sf "$url/api/health" >/dev/null && { echo "$url"; exit 0; }; sleep 0.5; done
echo "Server didn't become healthy; see $log" >&2
exit 1
