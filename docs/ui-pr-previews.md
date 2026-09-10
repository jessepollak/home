# UI PR previews

Status: approved v1, September 8, 2026. Exact-tip proof rule and delegated publication authority (Jesse via Astra, September 10, 2026). Operator convention for showing a user-visible UI change in a pull request. Not a CI gate, not the full contribution process, and not a production claim.

## When

PRs that change user-visible UI or core flows.

Skip docs-only, CI-only, and pure server PRs.

## What

**Proofs are the live implementation.** Capture the running product in a real browser (Chrome or equivalent): preview, production, or localhost on this tip. Design comps are not after shots.

**Non-motion UI:** Before and after is preferred. After-only is OK if a before shot isn’t useful.

**Motion / animation:** A short **GitHub-hosted video or GIF** in the PR description (paste/drop → `user-attachments`) is required. It must render inline; static stills alone do not prove tweens or animation.

**Exact-tip lifecycle:** Capture After and ready-state proof only from the exact current PR head. Every push that changes the PR head SHA invalidates prior After/ready-state proof and readiness review. Make fresh captures, publish exact new GitHub `user-attachments` files, create a new immutable per-capture manifest, and obtain renewed proof review. An older base or pre-change capture may remain only as a truthful **Before**, with its original provenance; it never proves the current After or ready state. Routine follow-up with an unchanged head and already accepted evidence is metadata-delta-only; do not restart broad audits or recapture unchanged accepted evidence.

## How

Capture the **live implementation** (preview, production, or localhost on the final PR head) in a real browser. Capture the actual changed route or routes in the ready state and every applicable acceptance-critical state: loading, failure, fallback, keyboard/focus, owner/account boundary, scrolling, motion, and provider surface. Paste or drop before/after stills — or a short video/GIF for motion — into the **existing GitHub PR description** (not a comment) with short, truthful route/state captions. ~390px width is preferred for stills.

Create a new immutable manifest for every capture. Each manifest records the **head SHA**, **base SHA**, capture **time**, **origin**, actual **route and state**, **browser**, **viewport**, **DPR**, **fixture-versus-live boundary**, exact **capture command/script**, and SHA-256 **hashes** for every published file. Never overwrite, relabel, or modify old provenance; each manifest binds only its files to that reviewed tip. Make every manifest reviewer-accessible from the PR description by embedding it or linking its immutable PR-accessible artifact; private or run-only evidence does not count.

If acceptance requires a physical platform, capture on that physical device/platform; emulation is supporting evidence only. If acceptance requires a live provider surface, mocked or fixture proof does not satisfy that gate; record the boundary and preserve the provider check.

**Host must be GitHub user-attachments.** After paste/drop, GitHub inserts a new `https://github.com/user-attachments/assets/…` URL. Keep the exact new URL for each current-tip file. For stills, use it in HTML `<img … width="390">` (preferred: it sets the width) or markdown `![alt](url)`. For video/GIF, paste/drop the same way so GitHub plays it inline (`![alt](url)` is enough).

**Previews must render inline** in the existing PR body so reviewers can scan the change without clicking. Update that description in place on the same head. Replace or explicitly supersede stale tip/base/HOLD text; do not append contradictory proof history. Keep older manifests and any truthful Before capture as historical provenance.

**Do not** link or embed `cursor.com/artifacts` / Cloud Agent artifact URLs. Those 302 to short-lived (~15 minute) signed S3 URLs and break for reviewers.

**Do not** leave bare `https://…` URLs, markdown links like `[screenshot](url)`, or “see attached” without an inline image or video.

**Do not commit** preview PNGs under `docs/pr-previews/` or elsewhere for new PRs.

**Do not** use as “after”: Hazel comps boards, empty scaffolds, unlabeled `/dev` harness shots, or any design comp (comps-as-after). Those are not the live impl.

After paste/drop, wrap the GitHub user-attachments URL as an `<img>` (or `![…](…)`) inside the Before/After table (or after-only block). The table example below already uses `<img>` — that embed is required for scannability, not optional markup.

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

Motion (video or GIF) is a short inline clip, not a stills table:

```markdown
**Period chip tween**

![Chart period chip switches](https://github.com/user-attachments/assets/<id>)
```

`docs/pr-previews/pr-3-home-shell/` on [PR #3](https://github.com/jessepollak/home/pull/3) is a past example (`home.png`, `account.png`). Leave those files in place; they are not the current How.

## Out of scope (v1)

CI screenshot gates and Percy/Chromatic.

## Done

A reviewer can understand the UX change by **looking at the existing PR description**: exact new inline GitHub user-attachments show the actual changed route and applicable states on the final-head live implementation, and reviewer-accessible immutable per-capture manifests prove their provenance. They are not comps, empty scaffolds, or unlabeled harnesses. Opening links or attachments is not enough. `cursor.com/artifacts` links do not count — they expire. The applicable code/design reviewer reviews the published exact-tip proof before a UI PR advances to `status:ready-for-review` or `status:needs-jesse` for merge. `status:blocked` and `status:needs-jesse` for a Jesse decision may be applied without visual-proof gating.

In a Jesse-authorized delegated run, the coordinator may undraft and publish `status:needs-jesse` only after Sol integration, fresh exact-head Astra engineering review, current CI, and every applicable proof, design, security, platform, provider, and dependency gate pass; no separate inactive Hannah stage is required. Service each actionable handoff, then advance independent eligible work on a rolling basis without waiting for all lanes or handoffs or creating a global wait-for-all barrier. Target publication within `<=5 minutes` after the last gate passes; the target never bypasses a gate, and a miss requires a named truthful blocker and observable resumption trigger. Jesse alone approves and merges. This grants no deployment, funded, destructive, or Neon-cleanup authority.
