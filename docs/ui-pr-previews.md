# UI PR previews

Status: approved v1, September 8, 2026. Operator convention for showing a user-visible UI change in a pull request. Not a CI gate, not a contribution process, and not a production claim.

## When

PRs that change user-visible UI or core flows.

Skip docs-only, CI-only, and pure server PRs.

## What

**Before and after is preferred.** After-only is OK if a before shot isn’t useful.

## How

Add images in the **GitHub PR description** (upload/attach in the PR body) with short captions. ~390px width is preferred for Home.

**Do not commit PNGs** under `docs/pr-previews/` or elsewhere for this purpose.

## Out of scope (v1)

CI screenshot gates, Percy/Chromatic, issue/PR templates, committing screenshot assets.

## Done

A reviewer can understand the UX change from the PR description (with the attached previews).
