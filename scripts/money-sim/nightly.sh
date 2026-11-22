#!/usr/bin/env bash
# Nightly money-action simulation on origin/main. Not a PR gate. See docs/money-sim-nightly.md.
#
#   nightly.sh [--scheduled] [--runs N] [--no-post]
#
# --scheduled  launchd mode: runs at most once per 20 hours, only between 01:00 and 06:00 local time.
# --runs N     seeds to run (default 1000).
# --no-post    never post a GitHub comment; write the would-be comment to the local log instead.
#
# Each run detaches a dedicated worktree at the freshly fetched origin/main, runs `sim:money` (which starts its
# own anvil fork and scratch Postgres and never reads DATABASE_URL), then replays every failing seed alone once.
# A seed that passes alone is a flake. A seed that fails again is real; a real failure outside the known cash-out
# swap set (#2292) is posted once as a comment, as the factory bot account only.
set -euo pipefail

main() {
  local scheduled=0 runs=1000 post=1
  while [ $# -gt 0 ]; do
    case "$1" in
      --scheduled) scheduled=1 ;;
      --runs) runs="${2:?--runs needs a number}"; shift ;;
      --no-post) post=0 ;;
      *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
    shift
  done
  case "$runs" in ''|*[!0-9]*) echo "--runs takes a positive integer" >&2; exit 2 ;; esac

  local repo="${MONEY_SIM_REPO:-$HOME/src/home}"
  local worktree="${MONEY_SIM_WORKTREE:-$HOME/src/home-worktrees/money-sim-nightly}"
  local state="${MONEY_SIM_STATE:-$HOME/Library/Logs/home-money-sim}"
  local issue="${MONEY_SIM_ISSUE:-}"
  # MONEY_SIM_REF exists only to test an unmerged branch through this entrypoint; nightly runs use origin/main.
  local ref="${MONEY_SIM_REF:-main}"
  local swap_issue=2292
  local known_swap=" 12 77 109 126 127 216 319 361 573 630 853 952 "
  local bot_token_file="${MONEY_SIM_BOT_TOKEN_FILE:-$HOME/.config/home-money-sim/bot-token}"
  mkdir -p "$state/runs"

  if [ "$scheduled" = 1 ]; then
    local hour stamp now
    hour=$((10#$(date +%H)))
    if [ "$hour" -lt 1 ] || [ "$hour" -ge 6 ]; then exit 0; fi
    now=$(date +%s)
    stamp=$(cat "$state/last-start" 2>/dev/null || echo 0)
    if [ $((now - stamp)) -lt $((20 * 3600)) ]; then exit 0; fi
  fi
  if ! mkdir "$state/lock" 2>/dev/null; then echo "another run holds $state/lock" >&2; exit 0; fi
  trap 'rmdir "$state/lock" 2>/dev/null || true' EXIT
  date +%s > "$state/last-start"

  local stamp_name out seeds
  stamp_name=$(date -u +%Y%m%dT%H%M%SZ)
  out="$state/runs/$stamp_name.txt"
  seeds="$state/runs/$stamp_name.failing"

  git -C "$repo" fetch --quiet origin "$ref"
  if [ ! -e "$worktree/.git" ]; then
    git -C "$repo" worktree add --quiet --detach "$worktree" "origin/$ref"
  fi
  git -C "$worktree" fetch --quiet origin "$ref"
  git -C "$worktree" checkout --quiet --detach "origin/$ref"
  local sha
  sha=$(git -C "$worktree" rev-parse --short=9 HEAD)
  (cd "$worktree" && bun run worktree:bootstrap -- --copy-env > "$out.bootstrap" 2>&1)

  local status=0 seed_flag=()
  if grep -q '"failing-seeds"' "$worktree/apps/web/sim/money/cli.ts"; then seed_flag=(--failing-seeds "$seeds"); fi
  (cd "$worktree" && bun run --cwd apps/web sim:money -- --runs "$runs" ${seed_flag[@]+"${seed_flag[@]}"}) > "$out" 2>"$out.err" || status=$?
  # Before the CLI could write the full list, read the seeds it printed (at most 40).
  if [ ${#seed_flag[@]} -eq 0 ]; then
    sed -n '/^failing seeds/,/^$/p' "$out" | sed -n 's/^ *\([0-9][0-9]*\)  .*/\1/p' > "$seeds"
  fi
  local result
  result=$(grep -m1 '^RESULT' "$out" | sed 's/^RESULT *//' || true)
  if [ -z "$result" ]; then
    echo "$(date -u +%FT%TZ) $ref $sha: no RESULT line (exit $status); see $out.err" >> "$state/report.log"
    exit 1
  fi

  local flakes="" swaps="" real=""
  if [ -s "$seeds" ]; then
    while read -r seed; do
      [ -n "$seed" ] || continue
      if (cd "$worktree" && bun run --cwd apps/web sim:money -- --seed "$seed") > "$state/runs/$stamp_name.seed-$seed.txt" 2>&1; then
        flakes="$flakes $seed"
      elif [[ "$known_swap" == *" $seed "* ]]; then
        swaps="$swaps $seed"
      else
        real="$real $seed"
      fi
    done < "$seeds"
  fi

  local line="$(date -u +%FT%TZ) $ref $sha: $result; flakes:${flakes:- none}; known #$swap_issue swap:${swaps:- none}; real:${real:- none}"
  echo "$line" >> "$state/report.log"
  echo "$line"
  [ -z "$real" ] && exit 0

  # A real failure that shows the #2292 swap signature on a seed outside the known set goes to #2292; every
  # other real failure goes to the money-sim issue. At most one comment per issue per night.
  local swap_new="" other=""
  for seed in $real; do
    if grep -q "linked to deposit .*, but its own receipt created" "$state/runs/$stamp_name.seed-$seed.txt"; then swap_new="$swap_new $seed"
    else other="$other $seed"; fi
  done
  [ -n "$swap_new" ] && comment "$swap_issue" "$swap_new" "swap"
  [ -n "$other" ] && comment "$issue" "$other" "other"
  exit 1
}

# comment <issue> <seeds> <name>: writes the comment, then posts it as the factory bot account when allowed.
comment() {
  local target="$1" list="$2" name="$3"
  local body="$state/runs/$stamp_name.comment-$name.md"
  {
    echo "Nightly money-action simulation on \`$ref\` at $sha: **$result**."
    echo
    echo "Seeds that failed in the batch and again when replayed alone:"
    echo
    for seed in $list; do
      local first
      first=$(grep -m1 '^  step' "$state/runs/$stamp_name.seed-$seed.txt" | sed 's/^  //' || true)
      echo "- \`$seed\`: ${first:-see the replay output}. Replay: \`bun run --cwd apps/web sim:money -- --seed $seed\`"
    done
  } > "$body"
  if [ "$post" = 0 ]; then echo "comment not posted (--no-post): $body" >> "$state/report.log"; return; fi
  if [ -z "$target" ]; then echo "comment not posted: MONEY_SIM_ISSUE is unset: $body" >> "$state/report.log"; return; fi
  if [ ! -r "$bot_token_file" ]; then echo "comment not posted: no factory bot token: $body" >> "$state/report.log"; return; fi
  local login
  login=$(GH_TOKEN=$(cat "$bot_token_file") gh api user -q .login 2>/dev/null || true)
  if [ "$login" != "jessepollakj" ]; then echo "comment not posted: token is not the factory bot account: $body" >> "$state/report.log"; return; fi
  GH_TOKEN=$(cat "$bot_token_file") gh issue comment "$target" --repo jessepollak/home --body-file "$body" >> "$state/report.log" 2>&1
}

main "$@"
exit
