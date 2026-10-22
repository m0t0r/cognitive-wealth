#!/bin/sh
# Starts Redis with an ACL file built from the mounted secrets. compose.yaml and the e2e global
# setup both run this script, so e2e exercises the production ACL.
#
# The file lands on a tmpfs and holds only SHA-256 hashes (`#<hex>`), so no password ever appears
# in argv, the environment, `docker inspect` or on disk. Extra arguments go to redis-server.
#
# Users:
# - default: disabled, so every connection must authenticate as a named user.
# - app (/run/secrets/redis_password): the web app. Only `cw:*` keys (REDIS_KEY_PREFIX must start
#   with `cw:`) and only the commands its storage adapter sends: GET, SET (incl. EX/PX), DEL,
#   INCR, EXPIRE, GETDEL. No MULTI, EVAL, SCAN, KEYS, FLUSH* or CONFIG.
# - janitor (/run/secrets/redis_janitor_password, optional): SCAN and DEL on `cw:*`. Only e2e
#   mounts it, to empty a worker's keys between tests; compose leaves it out.
set -eu

ACL_FILE=/run/redis/users.acl

password_hash() {
  if [ ! -s "$1" ]; then
    echo "redis: secret $1 is missing or empty" >&2
    exit 1
  fi
  # `openssl rand -hex 32 > file` leaves a trailing newline that isn't part of the password.
  tr -d '\r\n' <"$1" | sha256sum | cut -d ' ' -f 1
}

# What any client needs to connect: HELLO/AUTH for the handshake, PING for health checks, and
# CLIENT SETINFO, which node-redis sends after connecting (it ignores a refusal, but every refusal
# would land in the ACL log).
CONNECT="+hello +auth +ping +client|setinfo"

app_hash=$(password_hash /run/secrets/redis_password)
janitor_hash=""
if [ -e /run/secrets/redis_janitor_password ]; then
  janitor_hash=$(password_hash /run/secrets/redis_janitor_password)
fi

umask 077
{
  echo "user default off resetpass resetkeys resetchannels -@all"
  echo "user app on #$app_hash resetkeys ~cw:* resetchannels -@all $CONNECT +get +set +del +incr +expire +getdel"
  if [ -n "$janitor_hash" ]; then
    echo "user janitor on #$janitor_hash resetkeys ~cw:* resetchannels -@all $CONNECT +scan +del"
  fi
} >"$ACL_FILE"

# Skips the image's entrypoint on purpose: it only fixes ownership as root (we start as `redis`)
# and loads the bundled modules (search, JSON, …), which we don't use.
exec redis-server --aclfile "$ACL_FILE" "$@"
