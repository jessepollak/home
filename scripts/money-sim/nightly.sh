#!/usr/bin/env bash
# Nightly money-action simulation on origin/main. Not a PR gate. See docs/money-sim-nightly.md.
#
#   nightly.sh [--scheduled] [--runs N] [--no-post]
#
# --scheduled  launchd mode: runs once per night slot (02:00 local). launchd fires a slot missed during sleep once on
#              wake, so a late run still covers that night; a second firing in the same slot does nothing.
# --runs N     seeds to run (default 1000).
# --no-post    never post a GitHub comment; write the would-be comment to the local log instead.
#
# Each run detaches a dedicated worktree at the freshly fetched origin/main, runs `sim:money` (which starts its
# own anvil fork and scratch Postgres and never reads DATABASE_URL), then replays every failing seed alone once.
# A seed that passes alone is a flake. A seed whose completed replay violates an invariant again is real; a real
# failure outside the known cash-out swap set (#2292), or a run that could not complete, is posted as the factory
# bot account only.
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
  # The lead's brief keeps these known #2292 seeds local-only while #2292 is open; any other failure on them is real.
  local known_swap=" 12 77 109 126 127 216 319 361 573 630 853 952 "
  # The factory's own bot token, read at post time only; never copied, printed or logged.
  local bot_token_file="$HOME/.config/home-factory/bot-token"
  local sha="unknown" result="" stamp_name gap="" posted=0
  stamp_name=$(date -u +%Y%m%dT%H%M%SZ)
  mkdir -p "$state/runs" "$state/alerts"

  if [ "$scheduled" = 1 ]; then
    # The night slot is the most recent 02:00: before 02:00 it is yesterday's.
    local night last yesterday
    if [ $((10#$(date +%H))) -lt 2 ]; then night=$(date -v-1d +%F); else night=$(date +%F); fi
    last=$(cat "$state/last-night" 2>/dev/null || true)
    [ "$last" = "$night" ] && exit 0
    yesterday=$(date -j -v-1d -f %F "$night" +%F)
    if [ -n "$last" ] && [ "$last" != "$yesterday" ]; then gap=" (missed nights after $last)"; fi
  fi

  # The lock records its owner's PID, so a lock left by a run that was killed or cut off by a restart is reclaimed.
  # A lock still without a PID file is being taken right now and counts as held for five minutes.
  if ! mkdir "$state/lock" 2>/dev/null; then
    local owner
    owner=$(cat "$state/lock/pid" 2>/dev/null || true)
    case "$owner" in ''|*[!0-9]*) owner="" ;; esac
    if [ -n "$owner" ] && kill -0 "$owner" 2>/dev/null; then echo "run $owner holds $state/lock" >&2; exit 0; fi
    if [ -z "$owner" ] && [ -n "$(find "$state/lock" -maxdepth 0 -mmin -5)" ]; then echo "$state/lock is being taken" >&2; exit 0; fi
    rm -rf "$state/lock"
    mkdir "$state/lock" || { echo "could not take $state/lock" >&2; exit 0; }
  fi
  echo $$ > "$state/lock/pid"
  trap 'rm -rf "$state/lock"' EXIT
  # Only scheduled runs mark their night, so a manual or probe run never suppresses tonight's run.
  if [ "$scheduled" = 1 ]; then echo "$night" > "$state/last-night"; fi

  local out="$state/runs/$stamp_name.txt" seeds="$state/runs/$stamp_name.failing"
  if ! prepare_worktree > "$out.setup" 2>&1; then
    harness "setup" "the worktree could not be updated to origin/$ref or bootstrapped"
  fi

  local status=0 seed_flag=()
  if grep -q '"failing-seeds"' "$worktree/apps/web/sim/money/cli.ts"; then seed_flag=(--failing-seeds "$seeds"); fi
  (cd "$worktree" && bun run --cwd apps/web sim:money -- --runs "$runs" ${seed_flag[@]+"${seed_flag[@]}"}) > "$out" 2>"$out.err" || status=$?
  # Before the CLI could write the full list, read the seeds it printed (at most 40).
  if [ ${#seed_flag[@]} -eq 0 ]; then
    sed -n '/^failing seeds/,/^$/p' "$out" | sed -n 's/^ *\([0-9][0-9]*\)  .*/\1/p' > "$seeds" || true
  fi
  result=$(grep -m1 '^RESULT' "$out" | sed 's/^RESULT *//' || true)
  [ -n "$result" ] || harness "no-result" "the simulation exited $status without a RESULT line"
  local held total
  held=$(printf '%s\n' "$result" | sed -n 's/.*(\([0-9][0-9]*\)\/\([0-9][0-9]*\)).*/\1/p')
  total=$(printf '%s\n' "$result" | sed -n 's/.*(\([0-9][0-9]*\)\/\([0-9][0-9]*\)).*/\2/p')
  if [ -z "$held" ] || [ -z "$total" ]; then harness "no-result" "the RESULT line could not be read"; fi
  if [ "$held" -lt "$total" ] && ! [ -s "$seeds" ]; then
    harness "seed-list" "$((total - held)) runs failed but no failing seeds were listed"
  fi

  local flakes="" swaps="" real="" broken=""
  if [ -s "$seeds" ]; then
    while read -r seed; do
      case "$seed" in ''|*[!0-9]*) continue ;; esac
      local replay="$state/runs/$stamp_name.seed-$seed.txt"
      if (cd "$worktree" && bun run --cwd apps/web sim:money -- --seed "$seed") > "$replay" 2>&1; then
        flakes="$flakes $seed"
      elif ! grep -q '^RESULT' "$replay" || ! grep -q '^  step ' "$replay"; then
        # The replay never reached an invariant violation (fork startup, crash): a harness error, not a repeat.
        broken="$broken $seed"
      elif [[ "$known_swap" == *" $seed "* ]] && only_swap "$replay"; then
        swaps="$swaps $seed"
      else
        real="$real $seed"
      fi
    done < "$seeds"
  fi

  local line="$(date -u +%FT%TZ) $ref $sha: $result; flakes:${flakes:- none}; known #$swap_issue swap:${swaps:- none}; real:${real:- none}; replay errors:${broken:- none}$gap"
  echo "$line" >> "$state/report.log"
  echo "$line"
  [ -z "$real" ] && [ -z "$broken" ] && exit 0

  # A swap-signature failure goes to #2292. Any other real failure, and any replay that could not run, goes to the
  # open money-actions debt issue (docs/work-sizing.md); with none open, to #2292 under its own heading.
  local swap_new="" other=""
  for seed in $real; do
    if only_swap "$state/runs/$stamp_name.seed-$seed.txt"; then swap_new="$swap_new $seed"
    else other="$other $seed"; fi
  done
  local debt="" body="$state/runs/$stamp_name.comment-$swap_issue.md" rest="$state/runs/$stamp_name.comment-rest.md"
  [ -n "$other$broken" ] && debt=$(debt_issue)
  : > "$body"
  : > "$rest"
  [ -n "$swap_new" ] && section "Cash-out swap (#$swap_issue) on new seeds" "$swap_new" >> "$body"
  local heading="Non-swap failure"
  [ -n "$debt" ] || heading="Non-swap failure (no open money-actions debt issue)"
  [ -n "$other" ] && section "$heading" "$other" >> "$rest"
  [ -n "$broken" ] && replay_errors "$broken" >> "$rest"
  if [ -s "$rest" ] && [ -n "$debt" ]; then post "$debt" "$rest"; elif [ -s "$rest" ]; then cat "$rest" >> "$body"; fi
  [ -s "$body" ] && post "$swap_issue" "$body"
  exit 1
}

# prepare_worktree: each step returns on failure explicitly, because callers run it as an `if` condition.
prepare_worktree() {
  git -C "$repo" fetch --quiet origin "$ref" || return 1
  if [ ! -e "$worktree/.git" ]; then git -C "$repo" worktree add --quiet --detach "$worktree" "origin/$ref" || return 1; fi
  git -C "$worktree" fetch --quiet origin "$ref" || return 1
  git -C "$worktree" checkout --quiet --detach "origin/$ref" || return 1
  sha=$(git -C "$worktree" rev-parse --short=9 HEAD) || return 1
  (cd "$worktree" && bun run worktree:bootstrap -- --copy-env) || return 1
}

# harness <kind> <detail>: the run could not produce a trustworthy result. Logs locally and alerts once per kind
# per week, so a broken machine does not repeat the same comment every night.
harness() {
  local kind="$1" detail="$2"
  echo "$(date -u +%FT%TZ) $ref $sha: run did not complete ($kind): $detail$gap" >> "$state/report.log"
  local mark="$state/alerts/$kind"
  if [ -n "$(find "$mark" -mtime -7 2>/dev/null)" ]; then exit 1; fi
  local body="$state/runs/$stamp_name.comment-harness.md" debt
  debt=$(debt_issue)
  {
    echo "### Nightly simulation did not complete"
    echo
    echo "The nightly money-action simulation on \`$ref\` at $sha did not produce a trustworthy result: $detail. No invariant result is reported for this night; the next night runs again."
  } > "$body"
  posted=0
  post "${debt:-$swap_issue}" "$body"
  [ "$posted" = 1 ] && touch "$mark"
  exit 1
}

# debt_issue: the open money-actions debt issue, counted only when Jesse or the factory bot opened it.
debt_issue() {
  local found
  found=$(gh issue list --repo jessepollak/home --state open --search 'chore(money-actions): pay down money-actions debt in:title' \
    --json number,title,author -q '.[] | select(.title == "chore(money-actions): pay down money-actions debt" and
      (.author.login == "jessepollak" or .author.login == "jessepollakj")) | .number' 2>/dev/null | head -1 || true)
  case "$found" in *[!0-9]*) found="" ;; esac
  printf '%s' "$found"
}

# only_swap <replay output>: true when the replay failed only with the #2292 swap signature (no other violation, no crash).
only_swap() {
  local file="$1"
  grep -q 'crashed' "$file" && return 1
  grep -q '^  step ' "$file" || return 1
  ! grep '^  step ' "$file" | grep -vq "linked to deposit .*, but its own receipt created"
}

# section <heading> <seeds>: one comment section naming the SHA, the RESULT line and each seed's replay.
section() {
  local heading="$1" list="$2" seed first
  echo "### $heading"
  echo
  echo "Nightly money-action simulation on \`$ref\` at $sha: **$result**. Seeds whose replay alone violated an invariant again:"
  echo
  for seed in $list; do
    first=$(grep -m1 '^  step' "$state/runs/$stamp_name.seed-$seed.txt" | sed 's/^  //' || true)
    echo "- \`$seed\`: $first. Replay: \`bun run --cwd apps/web sim:money -- --seed $seed\`"
  done
  echo
}

# replay_errors <seeds>: seeds whose replay never reached an invariant result, reported apart from failures.
replay_errors() {
  local seed
  echo "### Replays that could not run"
  echo
  echo "Nightly money-action simulation on \`$ref\` at $sha: **$result**. These seeds failed in the batch, but their replay alone stopped before any invariant result, so they are not confirmed failures:"
  echo
  for seed in $1; do echo "- \`$seed\`. Replay: \`bun run --cwd apps/web sim:money -- --seed $seed\`"; done
  echo
}

# post <issue> <body file>: posts as the factory bot account only, with the token used for these gh calls alone.
# It always returns 0 (a refusal is logged, never fatal) and sets posted=1 only when GitHub accepted the comment.
post() {
  local target="$1" body="$2" login
  if [ "$post" = 0 ]; then echo "comment not posted (--no-post) for #$target: $body" >> "$state/report.log"; return 0; fi
  if [ ! -f "$bot_token_file" ] || [ ! -O "$bot_token_file" ] || [ -n "$(find "$bot_token_file" -perm -044 -o -perm -040 -o -perm -004)" ]; then
    echo "comment not posted for #$target: no factory bot token readable only by this user" >> "$state/report.log"; return 0
  fi
  login=$(GH_TOKEN="$(cat "$bot_token_file")" gh api user -q .login 2>/dev/null || true)
  if [ "$login" != "jessepollakj" ]; then echo "comment not posted for #$target: token is not the factory bot account" >> "$state/report.log"; return 0; fi
  if GH_TOKEN="$(cat "$bot_token_file")" gh issue comment "$target" --repo jessepollak/home --body-file "$body" > /dev/null 2>> "$state/report.log"; then
    echo "comment posted on #$target" >> "$state/report.log"
    posted=1
  else
    echo "comment not posted for #$target: GitHub refused it" >> "$state/report.log"
  fi
  return 0
}

main "$@"
exit
