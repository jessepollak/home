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
  # MONEY_SIM_REF exists only to test an unmerged branch through this entrypoint; nightly runs use origin/main.
  local ref="${MONEY_SIM_REF:-main}"
  case "$ref" in -*|*..*|*[!A-Za-z0-9._/-]*|'') echo "MONEY_SIM_REF must be a plain branch name" >&2; exit 2 ;; esac
  local swap_issue=2292
  local known_swap=" 12 77 109 126 127 216 319 361 573 630 853 952 "
  # The factory's own bot token, read at post time only; never copied, printed or logged.
  local bot_token_file="$HOME/.config/home-factory/bot-token"
  mkdir -p "$state/runs"

  if [ "$scheduled" = 1 ]; then
    local hour stamp now
    hour=$((10#$(date +%H)))
    if [ "$hour" -lt 1 ] || [ "$hour" -ge 6 ]; then exit 0; fi
    now=$(date +%s)
    stamp=$(cat "$state/last-start" 2>/dev/null || echo 0)
    if [ $((now - stamp)) -lt $((20 * 3600)) ]; then exit 0; fi
  fi
  # The lock records its owner's PID, so a lock left by a run that was killed or cut off by a restart is reclaimed.
  if ! mkdir "$state/lock" 2>/dev/null; then
    local owner
    owner=$(cat "$state/lock/pid" 2>/dev/null || true)
    case "$owner" in ''|*[!0-9]*) owner="" ;; esac
    if [ -n "$owner" ] && kill -0 "$owner" 2>/dev/null; then echo "run $owner holds $state/lock" >&2; exit 0; fi
    rm -rf "$state/lock"
    mkdir "$state/lock" || { echo "could not take $state/lock" >&2; exit 0; }
  fi
  echo $$ > "$state/lock/pid"
  trap 'rm -rf "$state/lock"' EXIT
  # Only scheduled runs advance the once-per-night stamp, so a manual or probe run never suppresses tonight's run.
  if [ "$scheduled" = 1 ]; then date +%s > "$state/last-start"; fi

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
      case "$seed" in ''|*[!0-9]*) continue ;; esac
      if (cd "$worktree" && bun run --cwd apps/web sim:money -- --seed "$seed") > "$state/runs/$stamp_name.seed-$seed.txt" 2>&1; then
        flakes="$flakes $seed"
      elif [[ "$known_swap" == *" $seed "* ]] && only_swap "$state/runs/$stamp_name.seed-$seed.txt"; then
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

  # A swap-signature failure goes to #2292. Any other real failure goes to the open money-actions debt issue
  # (docs/work-sizing.md); with none open, it goes to #2292 under a "Non-swap failure" heading. One comment per issue.
  local swap_new="" other=""
  for seed in $real; do
    if only_swap "$state/runs/$stamp_name.seed-$seed.txt"; then swap_new="$swap_new $seed"
    else other="$other $seed"; fi
  done
  local debt=""
  if [ -n "$other" ]; then
    # Anyone can open an issue on a public repo, so only a debt issue opened by Jesse or the factory bot counts.
    debt=$(gh issue list --repo jessepollak/home --state open --search 'chore(money-actions): pay down money-actions debt in:title' \
      --json number,title,author -q '.[] | select(.title == "chore(money-actions): pay down money-actions debt" and
        (.author.login == "jessepollak" or .author.login == "jessepollakj")) | .number' 2>/dev/null | head -1 || true)
    case "$debt" in *[!0-9]*) debt="" ;; esac
  fi
  local body="$state/runs/$stamp_name.comment-$swap_issue.md"
  : > "$body"
  [ -n "$swap_new" ] && section "Cash-out swap (#$swap_issue) on new seeds" "$swap_new" >> "$body"
  if [ -n "$other" ] && [ -n "$debt" ]; then
    local debt_body="$state/runs/$stamp_name.comment-$debt.md"
    section "Real failures" "$other" > "$debt_body"
    post "$debt" "$debt_body"
  elif [ -n "$other" ]; then
    section "Non-swap failure (no open money-actions debt issue)" "$other" >> "$body"
  fi
  [ -s "$body" ] && post "$swap_issue" "$body"
  exit 1
}

# only_swap <replay output>: true when the replay failed only with the #2292 swap signature (no other violation, no crash).
only_swap() {
  local file="$1"
  grep -q 'crashed' "$file" && return 1
  grep -q '^  step ' "$file" || return 1
  ! grep '^  step ' "$file" | grep -vq "linked to deposit .*, but its own receipt created"
}

# section <heading> <seeds>: one comment section naming the main SHA, the RESULT line and each seed's replay.
section() {
  local heading="$1" list="$2" seed first
  echo "### $heading"
  echo
  echo "Nightly money-action simulation on \`$ref\` at $sha: **$result**. Seeds that failed in the batch and again when replayed alone:"
  echo
  for seed in $list; do
    first=$(grep -m1 '^  step' "$state/runs/$stamp_name.seed-$seed.txt" | sed 's/^  //' || true)
    echo "- \`$seed\`: ${first:-see the replay output}. Replay: \`bun run --cwd apps/web sim:money -- --seed $seed\`"
  done
  echo
}

# post <issue> <body file>: posts as the factory bot account only, with the token used for these gh calls alone.
post() {
  local target="$1" body="$2" login
  if [ "$post" = 0 ]; then echo "comment not posted (--no-post) for #$target: $body" >> "$state/report.log"; return; fi
  if [ ! -f "$bot_token_file" ] || [ ! -O "$bot_token_file" ] || [ -n "$(find "$bot_token_file" -perm -044 -o -perm -040 -o -perm -004)" ]; then
    echo "comment not posted for #$target: no factory bot token readable only by this user" >> "$state/report.log"; return
  fi
  login=$(GH_TOKEN="$(cat "$bot_token_file")" gh api user -q .login 2>/dev/null || true)
  if [ "$login" != "jessepollakj" ]; then echo "comment not posted for #$target: token is not the factory bot account" >> "$state/report.log"; return; fi
  GH_TOKEN="$(cat "$bot_token_file")" gh issue comment "$target" --repo jessepollak/home --body-file "$body" > /dev/null 2>> "$state/report.log" &&
    echo "comment posted on #$target" >> "$state/report.log"
}

main "$@"
exit
