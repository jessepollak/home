# Home coordinator machine handoff — September 10, 2026

Status: **MIGRATION PAUSED**. GitHub Issues and PRs remain the sole board. This file is a recovery pointer, not a second backlog.

## Authority and runtime

- Current remote `main`: `aab1507e86560c2f27afc6b23f075aea5ef3cf03`.
- PR #215 merged as `74480899d4a89d52f890d993d832c923ca11c82e`; its coordinator/checklist/approval policy is authoritative.
- In this delegated run, the coordinator may undraft and mark `status:needs-jesse` only after Sol integration, fresh exact-head Astra review, current CI, and every applicable proof/design/security/platform/provider/dependency gate passes.
- Jesse alone approves and merges. Deployment, funded actions, destructive operations, and Neon cleanup require separate authorization.
- Old run IDs below are provenance only. They are **not resumable processes on the new machine**.

### Notification replay defect

Installed cbcode on the old host can omit custom subagent/PR wake notifications from model replay after remote compaction. Tracked as TOSHI-1161; fix PR: https://coinbase.ghe.com/retail/mux/pull/3068 at reported head `ab565c71`.

Until a fixed cbcode version is released, installed, and the coordinator session is safely restarted, use normal tool results: event-driven `subagent_wait`, then explicit `subagent status`/output retrieval and `pr_status`. Do not rely on wake-only custom messages. No old-host hot patch, package update, process restart, or extension change was authorized.

## Delivery matrix

| Issue / PR | Durable remote ref and exact SHA | State and accepted evidence | Remaining gate / next owner |
|---|---|---|---|
| #52 / PR #60 | PR branch `cursor/headless-fund-onramp-caa5` = `f35f06d2bcbec4eb120158c0261f338a31e4399e`; migration branch `wip/pr60-migration-8378784` = `837878472a718d51ef26f2ea3a863388983f9d03` | Latest checkpoint has fresh Astra engineering **OK** and full `bun check` 946 pass / 2 skip. Existing PR is `status:blocked`. The older PR-head UI proof was invalidated by the source change and is not current evidence. | New coordinator: verify both refs, integrate checkpoint into the existing PR branch with an explicit remote-head lease, then make a completely new immutable exact-tip capture/review. Authorized provider owner must verify CDP Headless Onramp entitlement, deployed-domain allowlisting, Apple/Google Pay merchant readiness, deployed credentials/sandbox settings, and a real sandbox order. No funded action is authorized. PR: https://github.com/jessepollak/home/pull/60; checkpoint receipt: https://github.com/jessepollak/home/pull/60#issuecomment-5626932092 |
| #186 / PR #225 | `fix/provider-recovery-186` = `ce32d695a455ba37c7744a3444957e1219084731` | Fresh Astra **OK**, full check/build and remote CI green, no UI proof gate; PR and issue are `status:needs-jesse`. | Jesse approval/merge only. After merge, resume the locked transaction sequence. PR: https://github.com/jessepollak/home/pull/225 |
| #209 / draft PR #226 | `wip/issue-209-savings-2026-09-10` = `cff4bc4dbc8cb1765b973b82507e13be5c5f6b68` | Fresh Astra **OK**, full `bun check` 949 pass / 2 skip. Weighted APY, freshness, refresh retention, balance/APY separation, shared rate policy, owner fencing, and deterministic mounted expiry are implemented. Draft and issue remain `status:working`. | Fresh exact-tip Save browser proof, immutable GitHub attachments/manifests, design review, then current CI and readiness decision. No Home preview adoption in this PR. PR: https://github.com/jessepollak/home/pull/226 |
| #207 / draft PR #227 | `wip/issue-207-ui-foundation-2026-09-10` = `188183eac2df59e7f4cc84766cbd3b32406d49e5` | Saved F1 foundation/catalog WIP. Root check 947 pass / 2 skip, both builds, and 15 Chromium tests passed. Zero `apps/web` diff. DM Sans plus explicit licensed DM Mono numeric companion is implemented. Corrected head has **not** received fresh independent Astra review. Draft and issue remain `status:working`; remote CI may still be settling. | Fresh exact-head Astra review, then exact-tip catalog screenshots/motion and design clearance. Keep #207 open after F1; production adoption/migration/skill remain later slices. PR: https://github.com/jessepollak/home/pull/227 |
| #211 / merged PR #219 | PR merged as `25da0670f3d00541c682dd36d6cb0e0cbb8ba24b`; issue remains `status:working`, priority P0 | Premerge fix landed. | Authorized deployment, then verify Jesse’s affected production session is recovered and no cleanup loop repeats. Only then close incident #211. Issue: https://github.com/jessepollak/home/issues/211 |
| #173 / PR #174 | Merged as `aab1507e86560c2f27afc6b23f075aea5ef3cf03` | Fresh engineering and visual/motion review passed; nine exact-tip GitHub attachments are in the PR body. Issue closed. | No action unless a new defect is filed. PR: https://github.com/jessepollak/home/pull/174 |
| #161 / PR #164 | Merged as `088e407c6255c162432fbdce035349ad321d60b0` | Exact-head code/visual proof accepted; two byte-verified GitHub attachments in PR body. Issue closed. | No action unless a new defect is filed. PR: https://github.com/jessepollak/home/pull/164 |
| #205 / PR #215 | Merged policy; issue closed | Priority backfill and coordinator contract delivered. | No additional Home policy PR/review. |

## Retained paused stacks and triggers

- PR #217 `fix/mobile-shell-reachability-193` = `b5c259aaefd09e0362a181fbd1caf4beb4fe5010`, draft. Issue #193 is blocked on physical iPhone Safari evidence.
- PR #218 `feat/activity-infinite-scroll-196` = `b1af05356257ac67ff39c4352d9e93446a88e081`, draft stacked on #217. Resume after #217 merges and retarget/revalidate. Its babysit ownership belongs to another session; do not alter from this handoff.
- PR #220 `fix/shared-asset-marks-194` = `aed8043c0e9c0d35109131b974c9186c6dec3ed4`, draft on the former #164 branch. #164 is now merged; next owner must retarget/revalidate. Its babysit ownership belongs to another session.
- #69: blocked on signed-in production empty-cash UI proof.
- #136: blocked on deployed configured diagnostics and separately authorized funded-QA steps.
- #189: blocked on live email-code refresh persistence.
- #197: blocked on authoritative Codex `filterTokens` pagination behavior.
- Transaction order after #225 merges: `#184 + pre-cutover #187 → #185 → integrated #187 → unfunded acceptance → separately authorized funded acceptance`.

## Evidence portability

- Current accepted #174, #164, and merged #157 visual evidence is portable through inline GitHub `user-attachments` in their PR descriptions.
- #60’s old-host evidence package is for superseded head `f35f06d`; it is intentionally **not** current proof for `8378784`. No required current-head asset is unsaved—the required action is a fresh recapture on the new host.
- #207 reviewer-support screenshots and localhost catalog artifacts were not final proof and were not published. Rebuild from PR #227 and capture fresh proof after independent review.
- #209 has no final proof yet; capture from PR #226 after cloning.
- Do not copy `.env` files, tokens, provider credentials, browser profiles, customer/session data, local databases, raw child transcripts, `node_modules`, `.next`, test-results, or private local logs. Re-authenticate `gh`, Vercel, and provider portals independently. Provider credentials were not migrated.

## New-machine recovery

```bash
git clone git@github.com:jessepollak/home.git
cd home
git fetch origin --prune

git rev-parse origin/main
# expected at handoff: aab1507e86560c2f27afc6b23f075aea5ef3cf03

git ls-remote origin \
  refs/heads/wip/pr60-migration-8378784 \
  refs/heads/fix/provider-recovery-186 \
  refs/heads/wip/issue-209-savings-2026-09-10 \
  refs/heads/wip/issue-207-ui-foundation-2026-09-10

bun install --frozen-lockfile
```

Create separate worktrees per writer; never reuse old `/tmp` paths or assume old child IDs are live. Read the linked issue and PR immediately before mutation. Use explicit remote-head checks and `--force-with-lease` only where the intended PR branch requires a non-fast-forward integration.

## First recovery actions

1. Verify this manifest ref, `origin/main`, all listed remote heads, issue/PR labels, CI, open threads, and cbcode version. Keep the wake-result workaround until PR #3068 is released and installed.
2. Resume #60 first: integrate `8378784` into existing PR #60 with a verified lease, then recapture/review/publish current-head proof and service the provider/platform gate. Do not reuse the superseded evidence.
3. In parallel, run fresh Astra on #207 head `188183e`; if accepted, capture catalog proof/design review. Advance #209 from reviewed head `cff4bc4` to exact-tip proof/design. Keep #225 in Jesse’s approval queue and resume the transaction sequence only after it merges.

Old host remains migration-paused after this handoff. Do not restart its coordinator, PR notifications, or schedules without Jesse explicitly reactivating it.
