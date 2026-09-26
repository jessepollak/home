#!/usr/bin/env bash
set -euo pipefail
name="home-fixture-$(openssl rand -hex 4)"
if [[ ${1:-} == --session && $# == 2 ]]; then name=$2
elif [[ $# != 0 ]]; then echo 'Usage: fixture-session [--session <name>]' >&2; exit 2
fi
if [[ ! $name =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$ ]]; then echo 'Invalid fixture session name.' >&2; exit 2; fi
repository=$(cd "$(dirname "$0")/../.." && pwd)
browser_command() { env -i HOME="$HOME" PATH="$PATH" AGENT_BROWSER_SESSION="$name" bun run --cwd "$repository" ab -- --session "$name" "$@"; }
private="$HOME/.home-verify"
mkdir -p "$private"
chmod 700 "$private"
init="$private/$name.init.js"
routes=$(mktemp "${TMPDIR:-/tmp}/home-fixture-routes.XXXXXX")
cleanup() { rm -f "$routes"; }
fail() { browser_command close >/dev/null 2>&1 || true; rm -f "$init"; }
trap cleanup EXIT
trap fail ERR
printf '%s\n' 'sessionStorage.setItem("home:playwright-smoke:signed-in","1");localStorage.setItem("home.country.v2","US");' > "$init"
chmod 600 "$init"
env -i HOME="$HOME" PATH="$PATH" bun -e 'import {fixtureRoutes} from "./tests/browser/feature-map/fixtures.ts"; for (const [pattern, body] of fixtureRoutes()) console.log(`${pattern}\t${JSON.stringify(body)}`);' > "$routes"
browser_command open --init-script "$init" >/dev/null
while IFS=$'\t' read -r pattern body; do
  browser_command network route "$pattern" --body "$body" >/dev/null
done < "$routes"
browser_command open "http://127.0.0.1:${HOME_FIXTURE_PORT:-3199}/home" >/dev/null
browser_command wait --fn "Boolean(document.querySelector('[data-app-main-authenticated]'))" >/dev/null
trap - ERR
printf '%s\n' "$name"
