# UI PR previews

Status: v2, Jesse-locked September 11, 2026. Replaces the v1 exact-tip manifest convention. Operator convention for showing a user-visible UI change in a pull request. Not a CI gate and not a production claim.

## When

PRs that change user-visible UI or core flows. Skip docs-only, CI-only, and pure server PRs.

## What

The **Vercel preview link** (posted automatically on every PR) is the primary proof. Add to the PR description:

- **Non-motion UI:** one screenshot of the changed route on the current head, ~390px wide. Before/after only when the before genuinely helps.
- **Motion / animation:** one short video or GIF (roughly 30 seconds or less) showing the transition.

Capture the live implementation in a real browser — preview, production, or localhost on the PR head. Design comps, empty scaffolds, and unlabeled `/dev` harness shots are not proof. If you push new UI changes after capturing, replace the screenshot; do not keep stale ones.

## How

Attach from the CLI (GitHub CLI 2.100 or newer; `gh pr edit --help` lists `--attach`) so the file lands as a GitHub `user-attachments` asset and renders inline:

```bash
gh pr edit <n> --repo jessepollak/home --attach './after.png#Home after: quiet hero'
gh pr edit <n> --repo jessepollak/home --attach ./motion.webm
```

Or paste/drop the file into the PR description in the browser. Either way the description must show the image or video inline; bare links, `cursor.com/artifacts` URLs (they expire), and committed PNGs under `docs/pr-previews/` are not accepted.

Stills render at a readable width with `<img src="https://github.com/user-attachments/assets/<id>" width="390" />`. Videos render as a player from their bare URL on its own line.

## Not required

Immutable manifests, SHA-256 hashes, tile sets, per-state screenshot matrices, publication plans, or separate proof reviews. Behavioral states belong in tests, not screenshots.

## Done

A reviewer can open the PR, click the Vercel preview, and see one inline image or clip that matches the described change.
