#!/usr/bin/env bash
# Keyless smoke: build and boot apps/web with NO Supabase env, then assert the
# public routes render the fork-with-fallback record-mode notice — proof the
# app is actually reading the public record, not just returning HTTP 200.
# This is the fork-with-fallback acceptance test (Task 14).
#
# Critical gotcha: Next.js loads apps/web/.env.local straight off disk via
# @next/env, and only skips a key that is ALREADY set in process.env. Doing
# `env -u NEXT_PUBLIC_SUPABASE_URL ... pnpm build` clears the var from the
# child's environment, which means it is *not* already set — so Next reads it
# straight back out of .env.local. `env -u` alone does NOT achieve keyless.
# The file itself has to move out of the way for the run.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=3111
ENV_FILE=".env.local"
ENV_BAK=".env.local.smokebak"
BODY_FILE="$(mktemp -t keyless-smoke-body)"
SERVER_LOG="$(mktemp -t keyless-smoke-server)"
SERVER_PID=""

cleanup() {
  status=$?
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [ -f "$ENV_BAK" ]; then
    mv -f "$ENV_BAK" "$ENV_FILE"
    echo "restored $ENV_FILE"
  fi
  rm -f "$BODY_FILE" "$SERVER_LOG"
  exit $status
}
trap cleanup EXIT INT TERM

if [ -f "$ENV_FILE" ]; then
  mv "$ENV_FILE" "$ENV_BAK"
fi

# Verify the mechanism actually worked rather than assuming it did.
if [ -f "$ENV_FILE" ]; then
  echo "FAIL setup -> $ENV_FILE is still present after the move, Next would read Supabase creds off disk" >&2
  exit 1
fi
echo "OK setup -> $ENV_FILE moved aside to $ENV_BAK"

echo "== build (keyless) =="
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_ANON_KEY -u SUPABASE_SERVICE_ROLE_KEY \
  NODE_OPTIONS=--max-old-space-size=8192 pnpm build

echo "== boot (keyless, port $PORT) =="
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_ANON_KEY -u SUPABASE_SERVICE_ROLE_KEY \
  pnpm start -p "$PORT" > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!

echo "waiting for the server to accept connections..."
up=0
for _ in $(seq 1 30); do
  if curl -s -o /dev/null "http://localhost:$PORT/"; then
    up=1
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "FAIL startup -> server process exited before it came up" >&2
    cat "$SERVER_LOG" >&2
    exit 1
  fi
  sleep 1
done
if [ "$up" != "1" ]; then
  echo "FAIL startup -> server never answered on port $PORT within 30s" >&2
  cat "$SERVER_LOG" >&2
  exit 1
fi

ROUTES=(/ /news /app /app/marktplatz /proposals /karte /app/events /unternehmen)
NOTICE="Öffentlicher Datensatz"

for route in "${ROUTES[@]}"; do
  code=$(curl -s -o "$BODY_FILE" -w '%{http_code}' "http://localhost:$PORT$route")
  if [ "$code" != "200" ]; then
    echo "FAIL $route -> HTTP $code (expected 200)" >&2
    exit 1
  fi
  if ! grep -q "$NOTICE" "$BODY_FILE"; then
    echo "FAIL $route -> HTTP 200 but missing the record-mode notice ('$NOTICE') — page did not actually run keyless" >&2
    exit 1
  fi
  echo "OK $route"
done

echo "ALL ROUTES OK — keyless record mode verified end to end"
