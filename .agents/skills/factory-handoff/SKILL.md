---
name: factory-handoff
description: Hand in-progress local work in a Home worktree to the factory. Use when Jesse says "hand off to factory", "send this to the factory", or "/factory-handoff". Captures the session's intent and decisions in the issue, snapshots the code to the issue's `agent/<n>` branch, and queues the run. Not for filing brand-new work with no local state; file an ordinary issue for that.
---

# Hand local work to the factory

The factory runs from GitHub state alone: an issue and a branch. A handoff therefore moves two things through GitHub and nothing else:

- **Intent.** What this session learned and decided, written into the issue body, because the factory never sees this conversation.
- **Code.** The exact local state, committed as one snapshot on `agent/<n>`, the branch the factory owns for issue `n`.

Never copy a working tree, `node_modules`, env files, or browser state to another machine. Pulling factory work back later is the same contract in reverse (`git fetch origin agent/<n>` into a fresh worktree), so keep the branch the single source of truth.

Jesse runs this skill in his own session, so his GitHub identity edits the issue and applies `factory`. Both happen only after he confirms the plan in step 4.

## 1. Find the work

1. List candidate worktrees: the session's working directory plus every worktree this session or its children wrote to (`git worktree list`, then `git -C <path> status --porcelain` and `git -C <path> log --oneline origin/main..HEAD`). Code often lives in a child worktree, not the session directory.
2. Stop writers first. If a child agent is still running against a candidate worktree, interrupt or wait for it; never snapshot a tree that is still changing.
3. One handoff is one issue, one branch, one PR. If the session produced several independent changes, hand off each separately or ask which one.
4. Resolve the issue, in order: the branch name `agent/<n>`; an open PR's `Closes #n` or `Refs #n`; the session's own references; a search of open issues. If none exists, draft a new issue with a required title prefix (`feat(...)`, `fix(...)`, `design(...)`, and so on) and its `Area:` lines from [work sizing](../../../docs/work-sizing.md).
5. Record the state: issue number and author, open PRs on `agent/<n>` and their authors, whether remote `agent/<n>` already exists and at what head, local commits ahead of `origin/main`, and uncommitted files.

Stop and tell Jesse when remote `agent/<n>` already has commits that are not in the local branch (the factory or another session moved it), when the issue is not authored by Jesse, or when `factory:working` is already on the issue.

## 2. Gather context

Write the handoff from what this session actually established, citing files, commits, issues, and PRs. Read the transcript, child reports, and the diff rather than summarising from memory. Capture:

- **Goal and done-when.** The observable outcome the factory must reach.
- **Decisions.** Each decision Jesse made, dated, with the rejected alternative when it matters. These are the most expensive things to lose.
- **State of the code.** What the snapshot contains, what works, what is half-built, and which files are scaffolding.
- **Remaining work.** Ordered, concrete steps.
- **Validation so far.** Commands run and their results, including known failures and whether each also fails on `main`.
- **Pitfalls.** Approaches tried and abandoned, and why.
- **Open questions.** Anything still undecided.

Leave out anything that is not public-safe: this repository is public. No secrets, env values, private hosts or paths, internal tool names, model routing, spend, or customer data.

## 3. Ask Jesse

Ask once, with up to four questions, only about what step 2 could not settle. Typical gaps: what "done" means for this handoff, an undecided design choice, scope the factory should cut or leave for a follow-up, and whether the factory should finish everything or stop at the first PR. Skip any question the session already answered and fold the answers into the issue text.

## 4. Confirm the plan

Show Jesse, in one message: the issue (existing number or the new title), the worktree and file count being snapshotted, the branch and expected head, any open PR the factory will continue, and the issue text to be written. Proceed only on his confirmation. He may choose to file without queueing; then skip applying `factory` in step 7.

## 5. Snapshot the code

In the chosen worktree:

1. Check what will be committed: `git status --porcelain --untracked-files=all`. Exclude env files, local artifacts, and anything gitignored; never `git add -f`. Scan the staged diff for secrets and private text before committing; stop if any appears.
2. Commit everything as one snapshot on top of the existing local commits: `chore(handoff): snapshot local work for #<n>`. Do not rewrite or squash earlier commits; the factory squashes on publish.
3. Push to the factory branch. Put the push on its own line:
   ```sh
   git push origin HEAD:refs/heads/agent/<n>
   ```
   When remote `agent/<n>` already exists and is an ancestor of the local head (for example a branch this session pushed earlier), the push fast-forwards. Never force-push over a remote head you do not hold locally.
4. Record the pushed head: `git rev-parse HEAD`.

## 6. Update the issue

Add or replace one `## Handoff` section at the end of the issue body, with the context from steps 2 and 3, followed by exactly one marker line naming the pushed head:

```md
## Handoff

<goal, decisions, code state, remaining work, validation, pitfalls, open questions>

<!-- factory-handoff head=<40-hex sha> -->
```

Edit the body with `gh issue edit <n> --body-file <file>`, preserving everything above the section. Keep any existing `Area:` lines. A second handoff replaces the section and its marker; never leave two markers.

## 7. Clear the way and queue

1. Keep an open Jesse-authored PR on `agent/<n>` open: the factory adopts it and pushes to the same PR. A PR on that branch by anyone else, or more than one open PR, makes the factory stop and ask, so resolve that first.
2. Apply the label: `gh issue edit <n> --add-label factory`.
3. Leave the local worktree untouched. Further local edits do not reach the factory; to change course, comment on the issue or PR instead.

## 8. Report

Tell Jesse the issue link, the pushed head, the PR the factory will continue if any, and that the factory now owns `agent/<n>`. To bring the work back later, fetch `agent/<n>` into a fresh worktree; do not reuse the snapshotted one while the factory is running.

The factory starts from the marked head only when the branch head still matches it. If Jesse pushes again after labelling, rerun steps 5 and 6 so the marker names the new head.
