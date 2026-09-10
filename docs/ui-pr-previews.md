# UI PR previews

Status: approved v1, September 8, 2026. Motion: video preferred (Jesse via Hunter, September 10, 2026). Live implementation only — no comps-as-after (Jesse/Hunter, September 10, 2026). Operator convention for showing a user-visible UI change in a pull request. Not a CI gate, not a contribution process, and not a production claim.

## When

PRs that change user-visible UI or core flows.

Skip docs-only, CI-only, and pure server PRs.

## What

**Proofs are the live implementation.** Capture the running product in a real browser (Chrome or equivalent): preview, production, or localhost on this tip. Design comps are not after shots.

**Non-motion UI:** Before and after is preferred. After-only is OK if a before shot isn’t useful.

**Motion / animation:** Prefer a short **GitHub-hosted video or GIF** in the PR description (paste/drop → `user-attachments`). It must render inline. Static stills alone are not enough for tweens or animation.

## How

Capture the **live implementation** (preview, production, or localhost on this tip) in a real browser. Paste or drop before/after stills — or a short video/GIF for motion — into the **GitHub PR description** (not a comment) with short captions. ~390px width is preferred for stills.

**Host must be GitHub user-attachments.** After paste/drop, GitHub inserts a `https://github.com/user-attachments/assets/…` URL. Keep that URL. For stills, use it in HTML `<img … width="390">` (preferred: it sets the width) or markdown `![alt](url)`. For video/GIF, paste/drop the same way so GitHub plays it inline (`![alt](url)` is enough).

**Previews must render inline** in the PR body so reviewers can scan the change without clicking.

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

CI screenshot gates, Percy/Chromatic, issue/PR templates.

## Done

A reviewer can understand the UX change by **looking at the PR description** (inline stills, or for motion an inline video/GIF, on `github.com/user-attachments/assets/…`). Those captures are of the **live implementation** — not comps, empty scaffolds, or unlabeled harnesses. Opening links or attachments is not enough. `cursor.com/artifacts` links do not count — they expire.
