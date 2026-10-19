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
session_args=(--session "$name" ${cdp[@]+"${cdp[@]}"})
browser_command() { env -i HOME="$HOME" PATH="$PATH" AGENT_BROWSER_SESSION="$name" HOME_AGENT_BROWSER_TIMEOUT_MS="${HOME_AGENT_BROWSER_TIMEOUT_MS:-}" bun run --cwd "$repository" ab -- "${session_args[@]}" "$@"; }
browser_diagnostic() {
  local label=$1 timeout=$2 status=$3
  {
    printf '\n'
    if [[ $status == 124 ]]; then
      printf 'Fixture session stalled during %s: the browser command did not return within %ss, so launch, CDP connect, or a tab switch may be hung.\n' "$label" "$((timeout / 1000))"
    else
      printf 'Fixture session failed during %s (browser command exited %s).\n' "$label" "$status"
    fi
    printf 'Re-run: bun run --cwd apps/web fixture-session'
    printf ' %s' "${session_args[@]}"
    printf ' --prepare %s' "$prepare"
    printf '\nIf it repeats, close the session: bun run ab --'
    printf ' %s' "${session_args[@]}"
    printf ' close\n'
    if [[ -s $diagnostics ]]; then
      printf 'Last browser output (up to 8 KB):\n'
      tail -c 8192 "$diagnostics"
    fi
  } >&2
}
snapshot_diagnostics() {
  local size skip=0 count
  [[ -n $diagnostics ]] || return 0
  size=$(wc -c < "$diagnostics" 2>/dev/null) || size=
  if [[ -z $size ]]; then
    rm -f "$diagnostics" || true
    diagnostics=
    return 0
  fi
  diagnostics_snapshot=$(mktemp "$work/snapshot.XXXXXX") || { rm -f "$diagnostics" || true; diagnostics=; diagnostics_snapshot=; return 0; }
  if [[ $size -gt 65536 ]]; then
    skip=$(( (size - 65536) / 4096 ))
    count=17
  else
    count=$(( (size + 4095) / 4096 ))
  fi
  if dd if="$diagnostics" of="$diagnostics_snapshot" bs=4096 skip="$skip" count="$count" 2>/dev/null && [[ -s $diagnostics_snapshot ]] && mv "$diagnostics_snapshot" "$diagnostics"; then
    diagnostics_snapshot=
  else
    rm -f "$diagnostics_snapshot" "$diagnostics" || true
    diagnostics=
    diagnostics_snapshot=
  fi
}
browser_step_run() {
  local quiet=$1 label=$2 timeout=$3 status=0
  shift 3
  rm -f "$diagnostics" "$diagnostics_snapshot" || true
  diagnostics=
  diagnostics_snapshot=
  if [[ -n $work ]]; then diagnostics=$(mktemp "$work/capture.XXXXXX" 2>/dev/null) || diagnostics=; fi
  HOME_AGENT_BROWSER_TIMEOUT_MS="$timeout" browser_command "$@" > "${diagnostics:-/dev/null}" 2>&1 || status=$?
  snapshot_diagnostics
  if [[ $status == 0 ]]; then return 0; fi
  if [[ $quiet == false || $status == 124 ]]; then browser_diagnostic "$label" "$timeout" "$status"; fi
  return "$status"
}
browser_step() { browser_step_run false "$@"; }
browser_step_quiet() { browser_step_run true "$@"; }
private="$HOME/.home-verify"
mkdir -p "$private"
chmod 700 "$private"
init="$private/$name.init.js"
work="$private/$name.work"
routes="$work/routes"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT
rm -rf "$work"
if ! mkdir -m 700 "$work" 2>/dev/null; then
  printf 'Could not create fixture work directory in %s; check its permissions and available space.\n' "$private" >&2
  exit 1
fi
diagnostics=
diagnostics_snapshot=
fail() { browser_step_quiet close 15000 close || true; rm -f "$init"; }
trap fail ERR
operator_token=$(env -i HOME="$HOME" PATH="$PATH" bun -e 'import {fixtureOperatorAddress, homeSessionToken} from "./tests/browser/fixtures/session.ts"; process.stdout.write(homeSessionToken(fixtureOperatorAddress));')
printf 'try{if(location.hostname==="127.0.0.1"||location.hostname==="localhost"){document.cookie="home-session=;path=/;Max-Age=0;SameSite=Lax";document.cookie="home-session=%s;path=/admin;SameSite=Lax";document.cookie="home-session=%s;path=/api/admin;SameSite=Lax";}}catch{};sessionStorage.setItem("home:playwright-smoke:signed-in","1");localStorage.setItem("home.country.v2","US");\n' "$operator_token" "$operator_token" > "$init"
chmod 600 "$init"
ready='(() => { if (!window.__homeFixtureSession) { window.__homeFixtureSession = fetch("/api/session").then((response) => { window.__homeFixtureSessionStatus = response.status; }, () => { window.__homeFixtureSessionStatus = 0; }); } return window.__homeFixtureSessionStatus === 200 && Boolean(document.querySelector("[data-hydrated]")) && sessionStorage.getItem("home:playwright-smoke:signed-in") === "1" && !location.search.includes("account=signin"); })()'
stage_fixture_session() {
  local status started=false
  if browser_step_quiet close 15000 close; then :; else
    status=$?
    if [[ $status == 124 ]]; then return "$status"; fi
  fi
  for _ in 1 2 3 4 5; do
    if browser_step_quiet launch 30000 open --init-script "$init"; then started=true; break; else
      status=$?
      if [[ $status == 124 ]]; then return "$status"; fi
    fi
    sleep 1
  done
  if [[ $started != true ]]; then
    browser_diagnostic launch 30000 "$status"
    return 1
  fi
  env -i HOME="$HOME" PATH="$PATH" HOME_FIXTURE_PREPARE="$prepare" bun -e 'import {fixtureRoutes} from "./tests/browser/feature-map/fixtures.ts"; import {operatorSupportFixtureRoutes} from "./tests/browser/feature-map/operator-support-fixture.ts"; const activityWindowEnd = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString(); console.log(JSON.stringify([...fixtureRoutes({activityWindowEnd, prepare: process.env.HOME_FIXTURE_PREPARE as "send" | "savings-deposit" | "savings-withdraw"}), ...operatorSupportFixtureRoutes()].map(([pattern, body]) => ["network", "route", pattern, "--body", JSON.stringify(body)])));' > "$routes" || return 1
  browser_step 'fixture route install' 30000 batch --bail < "$routes" || return "$?"
  browser_step 'fixture navigation' 30000 open "http://127.0.0.1:${HOME_FIXTURE_PORT:-3199}/home" || return "$?"
}
if stage_fixture_session && browser_step 'hydration wait' 30000 wait --timeout 15000 --fn "$ready"; then
  :
else
  status=$?
  if [[ $status == 124 ]] || ! { stage_fixture_session && browser_step 'hydration wait' 30000 wait --timeout 15000 --fn "$ready"; }; then
    echo "Fixture session on port ${HOME_FIXTURE_PORT:-3199} did not become a live signed-in session: the browser launch, the fixture routes, or the smoke sign-in state did not apply, so /home may be redirecting to sign-in. Re-run fixture-session." >&2
    fail
    exit 1
  fi
fi
trap - ERR
printf '%s\n' "$name"
