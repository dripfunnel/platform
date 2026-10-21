#!/bin/sh
# `pnpm dev:https`: `pnpm dev` behind Caddy on https://admin.localhost, https://platform.localhost
# and every partner's https://store.<partner>.localhost (docs/setup/local.md §6). `--all` (pnpm dev:https:all) also
# starts the studio's sandbox, store-proxy, storefront-core and the template, as `pnpm dev:all` plus the sandbox.
set -eu
cd "$(dirname "$0")/../.."
config=scripts/local/Caddyfile
all=0
[ "${1:-}" = --all ] && all=1

fail() {
  printf '✗ %s\n    Fix: %s\n' "$1" "$2" >&2
  exit 1
}

command -v caddy >/dev/null 2>&1 || fail "dev:https needs Caddy, which isn't installed." "brew install caddy, then run pnpm dev:https again."

# To a file, not $(…): the `caddy run` that `caddy start` leaves behind keeps a pipe open forever.
log=$(mktemp)
if ! caddy start --config "$config" --adapter caddyfile >"$log" 2>&1; then
  tail -n 3 "$log" >&2
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
echo "Merchant portals: https://store.<partner>.localhost (https://store.northstar.localhost, …); emails and texts print here."
if [ "$all" = 1 ]; then
  echo "Also: the studio's sandbox on :8790, store-proxy on :8788 (preview and shop hosts), storefront-core and the template."
  pnpm exec turbo run dev start:local
else
  pnpm dev
fi
