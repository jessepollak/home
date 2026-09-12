# Lane: Jesse fix round on PR #{{PR_NUMBER}} (issue #{{ISSUE_NUMBER}})

Jesse reviewed this PR. His review is a mandatory round outside the review cap. Branch `{{BRANCH}}` is checked out in `{{WORKTREE}}`; pull the latest head first (`git pull --ff-only`).

## Jesse's comments (newest fetched; also read the PR thread and any review threads for context)

{{JESSE_COMMENTS}}

## Required sequence — no step skipped

1. Apply every item he raised. Where an item is ambiguous, choose the smaller interpretation and say which you chose in the reply.
2. `{{HEAVY_SLOT}} bun check` → push → CI green.
3. ONE reply on the PR (marker at the end) naming the commit SHA and what changed per item. Resolve nothing on his behalf; do not reply per thread.
4. For user-visible changes: capture a NEW screenshot/clip from the fixed head and replace the old attachment in the PR body (an asset dated after the fix commit).
5. Remove the `review:jesse` label; swap `status:working` → `status:needs-jesse`. Verify with `gh pr view {{PR_NUMBER}} --json labels,isDraft`.

If an item needs a product decision you cannot make, do the rest, then post the single question in the same reply and leave `status:needs-jesse` with `review:jesse` removed.

{{CONTRACT}}
