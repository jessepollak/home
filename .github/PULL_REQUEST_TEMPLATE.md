## Summary

<!-- What changed, why, and the issue. -->

Closes #

## Test plan

- [ ] `bun check` / CI green
- [ ] Smoke the changed surface (or N/A — say why)

## Delegated ready publication

Jesse-authorized coordinated runs only; otherwise N/A.

- [ ] Sol integration, fresh exact-head Astra engineering review, current CI, and every applicable proof/design/security/platform/provider/dependency gate passed; no separate inactive Hannah stage added
- [ ] Coordinator undrafted and marked `status:needs-jesse` within `<=5 minutes` of the last gate, or recorded a named truthful blocker and resumption trigger; timing never bypassed a gate
- [ ] Actionable handoffs were serviced, then independent eligible work advanced on a rolling basis without a global wait-for-all barrier
- [ ] Routine follow-up was metadata-delta-only; unchanged accepted evidence was not broadly re-audited or recaptured
- [ ] Jesse remains the only approver and merger; no deployment, funded, destructive, or Neon-cleanup authority was inferred

## UI proof

User-visible UI / core-flow PRs only. Convention: [docs/ui-pr-previews.md](../docs/ui-pr-previews.md).

- [ ] After/ready proof captured from the final current PR head after the last head-changing push — not comps, empty scaffold, or unlabeled `/dev` harness
- [ ] Actual changed route(s), ready state, and all applicable critical states captured (loading, failure, fallback, keyboard/focus, owner/account boundary, scrolling, motion, provider)
- [ ] New immutable per-capture manifest records head/base SHA, time, origin, route/state, browser, viewport/DPR, fixture-vs-live boundary, command/script, and SHA-256 file hashes; it is reviewer-accessible from this PR and old provenance is unchanged
- [ ] Before/after (or justified after-only) inline in this existing description; any old base/pre-change image is labeled only as a truthful Before with provenance
- [ ] Current-tip files published as exact new GitHub `user-attachments/assets`, not `cursor.com/artifacts` / Cloud Agent artifact links
- [ ] Stills: `~390px` width via `<img … width="390">` or equivalent
- [ ] Motion/animation: current-tip inline GitHub-hosted video or GIF; physical-platform and live-provider gates use the required real surface (emulation/mocks are supporting only)
- [ ] Stale tip/base/HOLD text replaced or explicitly superseded; published exact-tip proof reviewed before advancing to `status:ready-for-review` or merge-ready `status:needs-jesse`
- [ ] After every future head-changing push, fresh After/ready captures, exact new attachments, a new immutable manifest, and renewed proof review are required; metadata-only follow-up with unchanged accepted evidence does not trigger recapture

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
