#!/usr/bin/env bash
set -euo pipefail
name="home-fixture-$(openssl rand -hex 4)"
cdp=()
prepare=send
while (( $# )); do
  case $1 in
    --session) [[ $# -ge 2 ]] || { echo 'Usage: fixture-session [--session <name>] [--cdp <port>] [--prepare send|savings-deposit|savings-withdraw]' >&2; exit 2; }; name=$2; shift 2 ;;
    --cdp) [[ $# -ge 2 && $2 =~ ^[0-9]{1,5}$ ]] || { echo 'Usage: fixture-session [--session <name>] [--cdp <port>] [--prepare send|savings-deposit|savings-withdraw]' >&2; exit 2; }; cdp=(--cdp "$2"); shift 2 ;;
    --prepare) [[ $# -ge 2 ]] || { echo 'Usage: fixture-session [--session <name>] [--cdp <port>] [--prepare send|savings-deposit|savings-withdraw]' >&2; exit 2; }; prepare=$2; shift 2 ;;
    *) echo 'Usage: fixture-session [--session <name>] [--cdp <port>] [--prepare send|savings-deposit|savings-withdraw]' >&2; exit 2 ;;
  esac
done
if [[ ! $name =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$ ]]; then echo 'Invalid fixture session name.' >&2; exit 2; fi
case "$prepare" in
  send|savings-deposit|savings-withdraw) ;;
  *) echo 'Invalid fixture prepare kind (use send, savings-deposit, or savings-withdraw).' >&2; exit 2 ;;
esac
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
operator_token=$(env -i HOME="$HOME" PATH="$PATH" bun -e 'import {fixtureOperatorAddress, homeSessionToken} from "./tests/browser/fixtures/session.ts"; process.stdout.write(homeSessionToken(fixtureOperatorAddress));')
printf 'try{if(location.hostname==="127.0.0.1"||location.hostname==="localhost"){document.cookie="home-session=;path=/;Max-Age=0;SameSite=Lax";document.cookie="home-session=%s;path=/admin;SameSite=Lax";document.cookie="home-session=%s;path=/api/admin;SameSite=Lax";}}catch{};sessionStorage.setItem("home:playwright-smoke:signed-in","1");localStorage.setItem("home.country.v2","US");\n' "$operator_token" "$operator_token" > "$init"
chmod 600 "$init"
ready='(() => { if (!window.__homeFixtureSession) { window.__homeFixtureSession = fetch("/api/session").then((response) => { window.__homeFixtureSessionStatus = response.status; }, () => { window.__homeFixtureSessionStatus = 0; }); } return window.__homeFixtureSessionStatus === 200 && Boolean(document.querySelector("[data-hydrated]")) && sessionStorage.getItem("home:playwright-smoke:signed-in") === "1" && !location.search.includes("account=signin"); })()'
stage_fixture_session() {
  browser_command close >/dev/null 2>&1 || true
  local started=false
  for _ in 1 2 3 4 5; do
    if browser_command open --init-script "$init" >/dev/null 2>&1; then started=true; break; fi
    sleep 1
  done
  [[ $started == true ]] || return 1
  env -i HOME="$HOME" PATH="$PATH" HOME_FIXTURE_PREPARE="$prepare" bun -e 'import {fixtureRoutes} from "./tests/browser/feature-map/fixtures.ts"; import {operatorSupportFixtureRoutes} from "./tests/browser/feature-map/operator-support-fixture.ts"; const activityWindowEnd = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString(); console.log(JSON.stringify([...fixtureRoutes({activityWindowEnd, prepare: process.env.HOME_FIXTURE_PREPARE as "send" | "savings-deposit" | "savings-withdraw"}), ...operatorSupportFixtureRoutes()].map(([pattern, body]) => ["network", "route", pattern, "--body", JSON.stringify(body)])));' > "$routes" || return 1
  browser_command batch --bail < "$routes" >/dev/null || return 1
  browser_command open "http://127.0.0.1:${HOME_FIXTURE_PORT:-3199}/home" >/dev/null || return 1
}
if ! { stage_fixture_session && browser_command wait --timeout 15000 --fn "$ready" >/dev/null 2>&1; }; then
  if ! { stage_fixture_session && browser_command wait --timeout 15000 --fn "$ready" >/dev/null 2>&1; }; then
    echo "Fixture session on port ${HOME_FIXTURE_PORT:-3199} did not become a live signed-in session: the browser launch, the fixture routes, or the smoke sign-in state did not apply, so /home may be redirecting to sign-in. Re-run fixture-session." >&2
    fail
    exit 1
  fi
fi
trap - ERR
printf '%s\n' "$name"
