# UI PR previews

Status: approved v1, September 8, 2026. Operator convention for showing a user-visible UI change in a pull request. Not a CI gate, not a contribution process, and not a production claim.

## When

PRs that change user-visible UI or core flows.

Skip docs-only, CI-only, and pure server PRs.

## What

**Before and after is preferred.** After-only is OK if a before shot isn’t useful.

## How

Add before/after images directly in the **GitHub PR description** (upload or attach in the PR body) with short captions. ~390px width is preferred for Home.

**Previews must render inline** in the PR body so reviewers can scan the change without clicking. Use HTML `<img … width="390">` (preferred: it sets the width) or markdown `![alt](url)`.

**Do not** leave bare `https://…` URLs, markdown links like `[screenshot](url)`, or “see attached” without an inline image.

**Do not commit** preview PNGs under `docs/pr-previews/` or elsewhere for new PRs. GitHub hosts the upload when you paste or drop it into the description.

After paste/drop, GitHub inserts a URL. Keep or wrap that URL as an `<img>` (or `![…](…)`) inside the Before/After table (or after-only block). The table example below already uses `<img>` — that embed is required for scannability, not optional markup.

When both before and after exist, use a two-column markdown table:

```markdown
| Before | After |
| --- | --- |
| <img alt="Home before" src="https://github.com/user-attachments/assets/<id>" width="390" /> | <img alt="Home after" src="https://github.com/user-attachments/assets/<id>" width="390" /> |
| Previous hero. | Quiet hero, Add money / Send / Receive. |
```

After-only is fine as a single image (or one column) when a before shot isn’t useful:

```markdown
**Home (after)** — quiet hero, Add money / Send / Receive.

<img alt="Signed-in Home shell" src="https://github.com/user-attachments/assets/<id>" width="390" />
```

`docs/pr-previews/pr-3-home-shell/` on [PR #3](https://github.com/jessepollak/home/pull/3) is a past example (`home.png`, `account.png`). Leave those files in place; they are not the current How.

## Out of scope (v1)

CI screenshot gates, Percy/Chromatic, issue/PR templates.

## Done

A reviewer can understand the UX change by **looking at the PR description** (inline images). Opening links or attachments is not enough.
