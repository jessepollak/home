### `activity`
- **Entry context**: activity · `/activity` · same · signed-in seed + `/api/activity`, `/api/actions` fixtures · goto path (Home renders the same feed inline since #789).

- **Live**: read-only
- **Owned paths**: `apps/web/app/activity/**`, `apps/web/client/activity/**`, `apps/web/client/home/activity-panel.tsx`, `apps/web/app/api/activity/**`
- **Reach**:
  1. `goto "/activity"`
  2. `expect "Activity"`
- **Notes**: The fixture-session helper seeds signed-in state and API fixtures. Add `/api/activity` fixture rows when exercising populated states; the Home Activity card is the interactive entry point.
- **Expect**: `Activity` heading (`#activity-title`, client/activity/activity-panel.tsx `DefaultActivityHeader`); empty state `No activity yet`; end marker `End of activity`; error `Try again` button; later-page failure shows a concise inline `Try again`; rows expose `View <direction> <symbol> transaction details` activation labels and brand/curated icons, provider logos, or ≤2-character initials as row marks (activity-panel.tsx `TransferActivityRow`); an indexed Home action retains its action row (title and status) instead of generic transfer rows.
- **States**: loading shimmer (`ActivityPage`, client/home/activity-panel.tsx `ShimmerRows count={4}`); empty (`No activity yet`); error (`Try again`); success list; automatic continuation while the sentinel is visible (client/activity/use-activity.ts: bounded 3-page bursts with a 250 ms yield), with a reserved loader-height continuation area between requests and on failure; settled Home actions join the timeline only when transfer pages reach their time, while pending ones are never hidden; later-page failure keeps rows and automatically retries the exact cursor up to twice (after 1 s and 3 s) before showing `Try again`; authoritative exhaustion only at a null cursor; cyclic cursors stop without further requests, while non-advancing cursors fail after the bounded retry budget; offscreen, unmounted, or owner-changed continuation stops and fences stale work.
- **Evidence**: screenshot; DOM snapshot; console/errors; marks `shell:paint` (dashboard).
- **Owned by**: `apps/web/client/activity/`, `apps/web/client/home/activity-panel.tsx`, `/api/activity`, `/api/actions`.
- **Unknowns**: row value/date text remains fixture-dependent; pagination has no routine control copy — continuation is automatic while the sentinel is visible, and the only pagination affordances are the later-page `Try again` and the authoritative `End of activity` marker.
