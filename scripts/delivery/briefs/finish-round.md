# Lane: finish PR #{{PR_NUMBER}} for issue #{{ISSUE_NUMBER}} — {{ISSUE_TITLE}}

Attempt {{ATTEMPT}}. A previous lane opened this PR and exited before it was reviewable. Branch `{{BRANCH}}` is checked out in `{{WORKTREE}}` with any uncommitted WIP preserved; `git status` and `git log origin/main..HEAD` first, then `gh pr view {{PR_NUMBER}} --json state,isDraft,labels,statusCheckRollup,body`.

Your job is to get this PR to ready, not to restart the work: keep the existing commits, finish what is missing (tests, `bun check`, the single review round if it did not happen, rebase, CI, proof, labels), and undraft. If the branch is unsalvageable, say so in one PR comment (marker) and label `status:blocked`.

## Issue

{{ISSUE_BODY}}

{{CONTRACT}}
