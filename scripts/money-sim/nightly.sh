#!/usr/bin/env bash
# Nightly money-action simulation on origin/main. Not a PR gate. See docs/money-sim-nightly.md.
#
#   nightly.sh [--scheduled] [--runs N] [--no-post]
#
# --scheduled  launchd mode: runs once per night slot (02:00 local). launchd fires a slot missed during sleep once on
#              wake, so a late run still covers that night; a second firing in the same slot does nothing.
# --runs N     seeds to run (default 1000).
# --no-post    never post; write the would-be comment to the local log instead (the bot identity is still checked).
#
# A green night posts nothing. Any failure posts one new comment from the factory bot account on the tracking issue.
set -euo pipefail

repo="${MONEY_SIM_REPO:-$HOME/src/home}"
worktree="${MONEY_SIM_WORKTREE:-$HOME/src/home-worktrees/money-sim-nightly}"
state="${MONEY_SIM_STATE:-$HOME/Library/Logs/home-money-sim}"
# MONEY_SIM_REF exists only to test an unmerged branch through this entrypoint; nightly runs use origin/main.
ref="${MONEY_SIM_REF:-main}"
issue="${MONEY_SIM_ISSUE:-2292}"
bot_token_file="${MONEY_SIM_BOT_TOKEN_FILE:-$HOME/.config/home-factory/bot-token}"
bot_login="jessepollakj"
replay_cmd="bun run --cwd apps/web sim:money -- --seed"
scheduled=0 runs=1000 post=1 sha="unknown" result="" gap="" exit_status=0
args=("$@")

log() { echo "$(date -u +%FT%TZ) $ref $sha: $*$gap" >> "$state/report.log"; }

# retry <seconds> <command...>: reruns a failing command with doubling waits (5s up to 60s) for about that long.
retry() {
  local budget=$1 pause=5 start=$SECONDS; shift
  until "$@"; do
    [ $((SECONDS - start + pause)) -le "$budget" ] || return 1
    sleep "$pause"
    pause=$((pause * 2)); [ "$pause" -le 60 ] || pause=60
  done
}

# fail <comment body>: reports the night's failure as one new bot comment, then exits nonzero.
fail() {
  local body="$state/runs/$stamp.comment.md" token login
  {
    echo "### Nightly money-action simulation failed${night:+ ($night)}"
    echo
    echo "\`$ref\` at $sha${result:+: **$result**}${gap}. Full output and seed list: \`runs/$stamp*\` in the nightly log directory."
    echo
    printf '%s\n' "$1"
  } > "$body"
  if [ ! -r "$bot_token_file" ]; then log "nothing posted: no factory bot token at $bot_token_file"; exit 1; fi
  token=$(cat "$bot_token_file")
  login=$(retry 120 env GH_HOST=github.com GH_TOKEN="$token" gh api user --jq .login 2>/dev/null) || login=""
  if [ "$login" != "$bot_login" ]; then log "nothing posted: the bot token is not $bot_login (got '${login:-no answer}')"; exit 1; fi
  if [ "$post" = 0 ]; then log "not posted (--no-post): $body"; exit 1; fi
  if retry 300 env GH_HOST=github.com GH_TOKEN="$token" gh issue comment "$issue" --repo jessepollak/home --body-file "$body" > /dev/null 2>> "$state/report.log"; then
    log "failure posted on #$issue"
  else
    log "nothing posted: GitHub refused or never answered the comment on #$issue, after retries"
  fi
  exit 1
}

# harness <what>: the run could not produce a trustworthy result.
harness() { log "harness error: $1"; fail "**Harness error, not an invariant result:** $1."; }

while [ $# -gt 0 ]; do
  case "$1" in
    --scheduled) scheduled=1 ;;
    --runs) runs="${2:?--runs needs a number}"; shift ;;
    --no-post) post=0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
case "$runs" in ''|*[!0-9]*|0) echo "--runs takes a positive integer" >&2; exit 2 ;; esac
case "$ref" in -*|*..*|*[!A-Za-z0-9._/-]*|'') echo "MONEY_SIM_REF must be a plain branch name" >&2; exit 2 ;; esac
mkdir -p "$state/runs"

# One run at a time: re-run this script under a kernel lock (lockf(1)), released when the process exits.
if [ -z "${MONEY_SIM_LOCKED:-}" ]; then
  MONEY_SIM_LOCKED=1 /usr/bin/lockf -s -t 0 "$state/run.lock" /bin/bash "$0" ${args[@]+"${args[@]}"} || exit_status=$?
  if [ "$exit_status" = 75 ]; then echo "another run holds $state/run.lock" >&2; exit 0; fi
  exit "$exit_status"
fi

stamp=$(date -u +%Y%m%dT%H%M%SZ) night=""
if [ "$scheduled" = 1 ]; then
  # The night slot is the most recent 02:00: before 02:00 it is yesterday's. Only scheduled runs mark a night.
  if [ $((10#$(date +%H))) -lt 2 ]; then night=$(date -v-1d +%F); else night=$(date +%F); fi
  last=$(cat "$state/last-night" 2>/dev/null || true)
  [ "$last" = "$night" ] && exit 0
  if [ -n "$last" ] && [ "$last" != "$(date -j -v-1d -f %F "$night" +%F)" ]; then gap=" (missed nights after $last)"; fi
  echo "$night" > "$state/last-night"
fi

out="$state/runs/$stamp.txt" seeds="$state/runs/$stamp.failing"
# A run that fires on wake can start before the network is up: wait up to 10 minutes for GitHub to answer.
retry 600 git -C "$repo" ls-remote --quiet --exit-code origin "$ref" > "$out.network" 2>&1 ||
  harness "GitHub was unreachable for 10 minutes (git ls-remote origin)"
if ! {
  retry 120 git -C "$repo" fetch --quiet origin "$ref" &&
  { [ -e "$worktree/.git" ] || git -C "$repo" worktree add --quiet --detach "$worktree" "origin/$ref"; } &&
  retry 120 git -C "$worktree" fetch --quiet origin "$ref" &&
  git -C "$worktree" checkout --quiet --detach "origin/$ref" &&
  sha=$(git -C "$worktree" rev-parse --short=9 HEAD) &&
  (cd "$worktree" && bun run worktree:bootstrap -- --copy-env)
} > "$out.setup" 2>&1; then
  harness "bootstrap failed: the worktree could not be updated to origin/$ref or bootstrapped"
fi

(cd "$worktree" && bun run --cwd apps/web sim:money -- --runs "$runs" --failing-seeds "$seeds" < /dev/null) > "$out" 2>&1 || exit_status=$?
result=$(grep -m1 '^RESULT' "$out" | sed 's/^RESULT *//' || true)
[ -n "$result" ] || harness "the simulation exited $exit_status without a RESULT line"
held=$(printf '%s\n' "$result" | sed -n 's/.*(\([0-9][0-9]*\)\/\([0-9][0-9]*\)).*/\1/p')
total=$(printf '%s\n' "$result" | sed -n 's/.*(\([0-9][0-9]*\)\/\([0-9][0-9]*\)).*/\2/p')
[ -n "$held" ] && [ -n "$total" ] || harness "the RESULT line could not be read"
# Each line is a seed, tagged " crashed" when its batch run stopped before any invariant result.
seed_check=0
grep -qvE '^[0-9]+( crashed)?$' "$seeds" 2>/dev/null || seed_check=$?
[ "$seed_check" = 1 ] || harness "the failing-seed list is missing, unreadable, or malformed"
listed=$(wc -l < "$seeds" | tr -d ' ') || harness "the failing-seed list could not be read"
[ "$listed" = "$((total - held))" ] || harness "the failing-seed list has $listed entries but RESULT reports $((total - held)) failed runs"
if [ "$held" = "$total" ]; then
  [ "$exit_status" = 0 ] || harness "every run held but the simulation exited $exit_status"
  log "$result; green"
  exit 0
fi
[ "$exit_status" != 0 ] || harness "$((total - held)) runs failed but the simulation exited 0"

# Replay each failing seed alone once. "Failed again" needs a completed replay that reports an invariant violation.
again=0 flakes=0 errors=0 crashed=0 shown=0 lines=""
while read -r seed tag; do
  batch="violated an invariant in the batch"
  if [ "$tag" = crashed ]; then crashed=$((crashed + 1)) batch="crashed in the batch (harness error, no invariant result)"; fi
  replay="$state/runs/$stamp.seed-$seed.txt"
  if (cd "$worktree" && bun run --cwd apps/web sim:money -- --seed "$seed" < /dev/null) > "$replay" 2>&1; then
    flakes=$((flakes + 1)) what="passed alone"
  elif grep -q '^RESULT' "$replay" && grep -q '^  step ' "$replay"; then
    again=$((again + 1)) what="failed again: $(grep -m1 '^  step ' "$replay" | sed 's/^  //' | cut -c1-200)"
  else
    errors=$((errors + 1)) what="stopped before any invariant result (harness error)"
  fi
  echo "seed $seed: $batch; replay $what" >> "$out.replays"
  if [ "$shown" -lt 20 ]; then shown=$((shown + 1)) lines="$lines- \`$seed\` $batch; replay $what"$'\n'; fi
done < "$seeds"

log "$result; batch crashes $crashed; replays failed again $again, passed $flakes, harness errors $errors; seeds in $out.replays"
more=$((listed - shown))
fail "$((total - held)) runs failed in the batch: $((listed - crashed)) violated an invariant, $crashed crashed before any invariant result (harness errors). Replayed alone: $again failed again, $flakes passed, $errors stopped before any invariant result (harness errors).

${lines}$([ "$more" -gt 0 ] && echo "- and $more more (full list in the local log)")

Replay one: \`$replay_cmd <seed>\`"
