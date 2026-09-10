## Summary

<!-- What changed, why, and the issue. -->

Closes #

## Test plan

- [ ] `bun check` / CI green
- [ ] Smoke the changed surface (or N/A — say why)

## UI proof

User-visible UI / core-flow PRs only. Convention: [docs/ui-pr-previews.md](docs/ui-pr-previews.md).

- [ ] Captured from the final current PR head after the final code push (not comps, empty scaffold, or unlabeled `/dev` harness)
- [ ] Retained manifest records head/base SHA, capture time, origin/route, browser, viewport/DPR, fixture-vs-live boundary, command/script, and SHA-256 file hashes
- [ ] Ready state and all applicable critical states captured (loading, failure, fallback, keyboard/focus, owner/account boundary, scrolling, motion, provider)
- [ ] Before/after (or justified after-only) inline in this existing description
- [ ] Published as GitHub `user-attachments/assets` (paste/drop into this PR body), not `cursor.com/artifacts` / Cloud Agent artifact links
- [ ] Stills: `~390px` width via `<img … width="390">` or equivalent
- [ ] Motion/animation: current-tip inline GitHub-hosted video or GIF; physical-platform requirements captured on that platform (emulation is supporting only)
- [ ] Stale tip/base/HOLD text replaced or explicitly superseded; published exact-tip proof reviewed before `status:ready-for-review`
- [ ] I will recapture and republish after any later code push unless the reviewer explicitly reaccepts a demonstrably unchanged visual surface

Paste/drop shots here, then wrap the GitHub URL:

```markdown
| Before | After |
| --- | --- |
| <img alt="Home before" src="https://github.com/user-attachments/assets/<id>" width="390" /> | <img alt="Home after" src="https://github.com/user-attachments/assets/<id>" width="390" /> |
| Previous hero. | Quiet hero, Add money / Send / Receive. |
```

## Skip UI proof

Check **one** if this PR is not user-visible:

- [ ] Docs-only
- [ ] CI-only
- [ ] Pure server
