#!/bin/sh
set -eu

PATH="$HOME/.bun/bin:$PATH"
export PATH

mode=${1:-scheduled}
production_url=${HOME_VERIFY_PRODUCTION_URL:?Set HOME_VERIFY_PRODUCTION_URL to the production Home origin.}
case "$production_url" in
  https://*) ;;
  *) echo "HOME_VERIFY_PRODUCTION_URL must be HTTPS." >&2; exit 2 ;;
esac

repository=${HOME_VERIFY_REPOSITORY:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}

export HOME_VERIFY_ROLE=factory

if [ -z "${HOME_ACCESS_PASSWORD:-}" ] && [ -n "${HOME_ACCESS_PASSWORD_OP_REF:-}" ]; then
  HOME_ACCESS_PASSWORD=$(op read "$HOME_ACCESS_PASSWORD_OP_REF")
  export HOME_ACCESS_PASSWORD
fi

canary_root=${HOME_VERIFY_CANARY_DIR:-"$HOME/.home-verify/canary"}
run_stamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
run_dir="$canary_root/$run_stamp"
umask 077
mkdir -p "$run_dir"
summary="$run_dir/summary.md"
printf '# Verification canary — %s\n\n- Production: `%s`\n- Mode: `%s`\n\n| surface / journey | result | evidence |\n| --- | --- | --- |\n' "$run_stamp" "$production_url" "$mode" >"$summary"

status=0
run_canary() {
  label=$1
  shift
  log="$run_dir/$(printf '%s' "$label" | tr '/ ' '--').log"
  run_result=0
  if bun run --cwd apps/web verify "$@" --live --base-url "$production_url" --out "$run_dir/evidence" >"$log" 2>&1; then
    result=pass
  else
    result=fail
    run_result=1
    status=1
  fi
  evidence=$(tail -n 1 "$log" 2>/dev/null || printf 'no evidence bundle')
  printf '| %s | %s | `%s` |\n' "$label" "$result" "$evidence" >>"$summary"
  return "$run_result"
}

for surface in landing sign-in home-panel balances activity save borrow invest send cash-out add-money account-settings coverage; do
  run_canary "$surface nightly" "$surface" || true
done

weekly_day=${HOME_VERIFY_WEEKLY_DAY:-7}
if [ "$mode" = weekly ] || { [ "$mode" = scheduled ] && [ "$(date -u +%u)" = "$weekly_day" ]; }; then
  if run_canary "save deposit" save --canary-operation deposit --allow-confirm; then
    run_canary "save withdraw" save --canary-operation withdraw --allow-confirm || true
  fi
  if run_canary "borrow" borrow --canary-operation borrow --allow-confirm; then
    run_canary "borrow repay" borrow --canary-operation repay --allow-confirm || true
  fi
  run_canary "send to jesse.base.eth" send --canary-operation send --recipient jesse.base.eth --allow-confirm || true
fi

issue_number=$(gh issue list --repo "$repository" --state open --search 'Verification canary in:title' --json number,title --jq '.[] | select(.title == "Verification canary") | .number' | head -n 1)
if [ -z "$issue_number" ]; then
  issue_url=$(gh issue create --repo "$repository" --title 'Verification canary' --body 'Scheduled production verification canary summaries are posted here.')
  issue_number=${issue_url##*/}
fi
if ! gh issue pin "$issue_number" --repo "$repository" >/dev/null 2>&1; then
  printf 'Could not pin the Verification canary issue %s; pin it manually if it is unpinned.\n' "$issue_number" >&2
fi
gh issue comment "$issue_number" --repo "$repository" --body-file "$summary"
printf '%s\n' "$summary"
exit "$status"
