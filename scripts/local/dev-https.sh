#!/bin/sh
# `pnpm dev:https`: `pnpm dev` behind Caddy on https://admin.localhost and
# https://platform.localhost (docs/api/README.md §7).
set -eu
cd "$(dirname "$0")/../.."
config=scripts/local/Caddyfile

fail() {
  printf '✗ %s\n    Fix: %s\n' "$1" "$2" >&2
  exit 1
}

command -v caddy >/dev/null 2>&1 || fail "dev:https needs Caddy, which isn't installed." "brew install caddy, then run pnpm dev:https again."

if ! out=$(caddy start --config "$config" --adapter caddyfile 2>&1); then
  printf '%s\n' "$out" | tail -n 3 >&2
  fail "Caddy didn't start; port 443 or its admin port 2019 is probably taken, perhaps by another pnpm dev:https." \
    "stop that one, or run caddy stop; lsof -nP -iTCP:443 -sTCP:LISTEN shows what holds 443."
fi
trap 'caddy stop >/dev/null 2>&1 || true' EXIT
trap 'exit 130' INT TERM

if [ "$(uname)" = Darwin ]; then
  if ! security find-certificate -c "Caddy Local Authority" /Library/Keychains/System.keychain >/dev/null 2>&1; then
    echo "Trusting Caddy's local certificate authority, once; macOS asks for your password."
    caddy trust || fail "The browser won't trust https://admin.localhost without it." "run caddy trust while pnpm dev:https is running."
  fi
else
  echo "If the browser warns about the certificate, run caddy trust once while this is running."
fi

echo "Admin console: https://admin.localhost   Partner console: https://platform.localhost"
pnpm dev
