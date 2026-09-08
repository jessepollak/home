# UI PR previews

Status: approved v1, September 8, 2026. Operator convention for showing a user-visible UI change in a pull request. Not a CI gate, not a contribution process, and not a production claim.

## When

PRs that change user-visible UI or core flows.

Skip docs-only, CI-only, and pure server PRs.

## What

**Before and after is preferred.** After-only is OK if a before shot isn’t useful.

## How

Add before/after images directly in the **GitHub PR description** (upload or attach in the PR body) with short captions. ~390px width is preferred for Home.

**Do not commit** preview PNGs under `docs/pr-previews/` or elsewhere for new PRs. GitHub hosts the upload when you paste or drop it into the description. Size with HTML after GitHub inserts the URL:

```markdown
**Home (after)** — quiet hero, Add money / Send / Receive.

<img alt="Signed-in Home shell" src="https://github.com/user-attachments/assets/<id>" width="390" />
```

`docs/pr-previews/pr-3-home-shell/` on [PR #3](https://github.com/jessepollak/home/pull/3) is a past example (`home.png`, `account.png`). Leave those files in place; they are not the current How.

## Out of scope (v1)

CI screenshot gates, Percy/Chromatic, issue/PR templates.

## Done

A reviewer can understand the UX change from the PR description (with the attached previews).
