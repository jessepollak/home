#!/usr/bin/env bash
set -euo pipefail
name="home-fixture-$(openssl rand -hex 4)"
cdp=()
while (( $# )); do
  case $1 in
    --session) [[ $# -ge 2 ]] || { echo 'Usage: fixture-session [--session <name>] [--cdp <port>]' >&2; exit 2; }; name=$2; shift 2 ;;
    --cdp) [[ $# -ge 2 && $2 =~ ^[0-9]{1,5}$ ]] || { echo 'Usage: fixture-session [--session <name>] [--cdp <port>]' >&2; exit 2; }; cdp=(--cdp "$2"); shift 2 ;;
    *) echo 'Usage: fixture-session [--session <name>] [--cdp <port>]' >&2; exit 2 ;;
  esac
done
if [[ ! $name =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$ ]]; then echo 'Invalid fixture session name.' >&2; exit 2; fi
repository=$(cd "$(dirname "$0")/../.." && pwd)
browser_command() { env -i HOME="$HOME" PATH="$PATH" AGENT_BROWSER_SESSION="$name" bun run --cwd "$repository" ab -- --session "$name" ${cdp[@]+"${cdp[@]}"} "$@"; }
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
env -i HOME="$HOME" PATH="$PATH" bun -e 'import {fixtureRoutes} from "./tests/browser/feature-map/fixtures.ts"; console.log(JSON.stringify(fixtureRoutes().map(([pattern, body]) => ["network", "route", pattern, "--body", JSON.stringify(body)])));' > "$routes"
browser_command open --init-script "$init" >/dev/null
browser_command batch --bail < "$routes" >/dev/null
browser_command open "http://127.0.0.1:${HOME_FIXTURE_PORT:-3199}/home" >/dev/null
browser_command wait --fn "Boolean(document.querySelector('[data-app-main-authenticated]'))" >/dev/null
trap - ERR
printf '%s\n' "$name"
