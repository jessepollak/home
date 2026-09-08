# UI PR previews

Status: approved v1, September 8, 2026. Operator convention for showing a user-visible UI change in a pull request. Not a CI gate, not a contribution process, and not a production claim.

## When

PRs that change user-visible UI or core flows.

Skip docs-only, CI-only, and pure server PRs.

## What

**Before and after is preferred.** After-only is OK if a before shot isn’t useful.

## How

1. Commit PNGs under `docs/pr-previews/<slug>/`. ~390px width is preferred for Home.
2. Embed them in the **PR body** with short captions.

Existing pattern: `docs/pr-previews/pr-3-home-shell/` on [PR #3](https://github.com/jessepollak/home/pull/3) (`home.png`, `account.png`). Cite that folder; do not delete or regenerate those PNGs.

```markdown
**Home (after)** — quiet hero, Add money / Send / Receive.

<img alt="Signed-in Home shell" src="docs/pr-previews/<slug>/home.png" width="390" />
```

## Out of scope (v1)

CI screenshot gates, Percy/Chromatic, issue/PR templates.

## Done

A reviewer can understand the UX change from the PR description (with the embedded previews).
