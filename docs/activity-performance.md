# Activity scroll profile

Run only against an isolated local **production build**, never a dev server or a provider-backed session. From the repository root, with port 3199 free:

```sh
cd apps/web
# Do not use `bun run build`: that command migrates the database.
env -i HOME="$HOME" PATH="$PATH" NEXT_TELEMETRY_DISABLED=1 HOME_PLAYWRIGHT_SMOKE=1 \
  HOME_OPERATOR_ADDRESSES=0x1111111111111111111111111111111111111111,0x3333333333333333333333333333333333333333 \
  ./node_modules/.bin/next build
env -i HOME="$HOME" PATH="$PATH" NEXT_TELEMETRY_DISABLED=1 HOME_PLAYWRIGHT_SMOKE=1 \
  HOME_OPERATOR_ADDRESSES=0x1111111111111111111111111111111111111111,0x3333333333333333333333333333333333333333 \
  ./node_modules/.bin/next start --hostname 127.0.0.1 --port 3199
# In another shell, from the repository root:
bun run --cwd apps/web profile:activity --rows 300 --route /activity --viewport mobile \
  --cpu-throttle 4 --out /tmp/activity-profile.json
```

Use only a port not already occupied; set `HOME_FIXTURE_PORT` and pass the matching `--base-url http://localhost:<port>` for another port. Keep the exact server PID and stop only that PID when finished. The fixture-only smoke environment must be set at **both build and start**; no `.env.local`, credentials, migrations, or provider requests are needed. The browser uses the shared Playwright signed-in smoke session and API fixture routes; Activity and actions are overridden by generated data. The local loopback image route exercises optional token images. Options: `--rows` total rows (default 300), `--route /home|/activity`, `--viewport mobile|desktop`, `--cpu-throttle 1|4|6`, `--network-delay` and `--image-delay` in milliseconds (both default 0), `--repeat` count, `--label`, `--out` JSON file, `--browser chromium|chrome|shell|headed` (default `chromium`), `--video` directory, and `--cpu-profile <path>` for a single-run CDP CPU profile of the fling window (requires `--repeat 1`). `chromium` launches the full Playwright Chromium in new headless mode, not the old headless shell; `chrome` launches system Google Chrome in new headless mode, `shell` launches the old headless shell for comparison, and `headed` launches full Playwright Chromium with a display. Check the actual 20-row unthrottled rAF intervals before interpreting heavier workloads: some headless/display environments still do not deliver a regular ~16.7 ms cadence. The measured repetitions never record video. If `--video` is passed, a separate unmeasured replay writes a video, adding one run; do not compare its timing to JSON metrics. Pages contain at most **25 transfers**, matching the production API contract; ~10% of rows are independently supplied actions. Each run creates a fresh browser context. Video includes the load/fill lead-in and may be large. The JSON includes per-cursor reads and flags duplicate/missing pages.

The `load` window ends when the first Activity row exists; `fill` repeatedly scrolls the authenticated main container until every fixture page has been served and “End of activity” is visible. `loadedRows` counts uniquely served transfers plus supplied actions; `mountedRows` counts currently mounted list items, which may be a bounded virtualized window rather than the full history. `append` spans the first continuation page and records response-to-list-mutation latency; for a one-page workload this latency is zero. `fling` uses CDP compositor scroll gestures down and up on the populated page. Each measured snapshot includes a rAF `blankCheck` of visible list-viewport gaps (frames with a gap and maximum gap in pixels); these checks also run during the non-fling phases and add measurement overhead. `detail` scrolls to the logical mid-list row, measures three dialog opens, and verifies Escape returns focus to that row. `status` scrolls to the top and flips one pending action to confirmed without navigation or clearing the owner's cache: the app's cash-out polling interval refetches the actions query in place every 15 seconds while another generated cash-out is refreshing. The status window includes the wait for the next poll, and `updateToRowsMs` is not response-to-render latency. Frame p50/p90/p95/p99/max and shares above 16.7/33.4 ms come from rAF intervals. Long tasks and long animation frames (LoAF) are browser PerformanceObserver entries; LoAF blocking is summed blockingDuration. CDP Script, Layout, RecalcStyle and Task durations are converted to milliseconds; LayoutCount is a count. Heap, DOM nodes, JS event listeners, mounted rows, and total DOM elements are after forced GC. Leak deltas compare after fling with before fling, and after three dialog cycles with after fling (they are diagnostic, not proof of a leak).

`fill` always runs without CPU throttling so a slow fully mounted feed can still load every page; `--cpu-throttle` applies to every other scenario, including `load` and the first `append`.

Only synthetic Chromium is covered. CDP CPU throttling is not a real device; CDP gesture speed, heap GC, background scheduling, local fixture interception, and instrumentation perturb results. Rendering may continue after a response and rAF only samples visible frames; rAF intervals alone do not prove presented frame rate. Compare the same machine/build/browser/flags and repeated runs, not absolute timings across hosts. The profile does not diagnose production-provider/network behavior.

## Current design

Home's feed and the Activity page render the same ledger (`client/activity/activity-ledger.tsx`). Its Pending group stays fully rendered; the Recent group, which grows with history, mounts only a window of rows (`client/activity/virtual-activity-list.tsx`, `@tanstack/react-virtual`). Measurement drove each choice:

- **Why virtualize.** Fully mounted, 2,000 loaded rows produced about 520,000 DOM nodes on Home (about 985,000 on the Activity page) and 108–211 MB of JS heap; every detail open re-rendered the list for 0.8–6.6 s. The DOM grows with history, so no per-row micro-optimization bounds it. With the Recent group windowed, the same history keeps about 5,000–8,700 nodes and 15–18 MB; most remaining rows belong to the synthetic Pending group.
- **Why TanStack Virtual.** It is maintained, headless, supports variable measured heights and an arbitrary scroll element with a scroll margin, and matches the TanStack libraries already in use. It adds about 10 KB gzip to the initial `/activity` scripts in the fixture build. Home keeps its single shell scroller; there is no inner scrolling panel.
- **Scroll host and margin.** The list uses the shell scroller (`main[data-app-main-authenticated]`), then the nearest scrollable ancestor, then the window. A `ResizeObserver` recomputes the list's offset when content above it changes size. Rows are measured as they mount; the 64 px estimate only positions rows that have not rendered. A list that attaches to the scroller, or becomes active again, never writes the scroll position, so the shell's own scroll restoration wins.
- **Anchoring.** Native scroll anchoring is off for the windowed list (Safari has none, and absolutely positioned rows are poor anchors). When items change while the list's top is scrolled above the viewport, the first visible row's key and pixel offset are captured and restored, so pages appended below, rows inserted or reordered above, and height corrections do not move the viewport. The decision uses the list's position before the change, so content growing above the history (for example, a new pending action) keeps the visible row in place even when it pushes the list's top below the old scroll position. When the list starts at or below the top of the viewport, as after pull-to-refresh at the top of Home, new rows push later rows down as they would natively. Rows that resize above the viewport adjust the scroll by the size change.
- **Hidden shell panels.** The shell keeps inactive panels mounted. An inactive list detaches from the scroller, renders no rows, and keeps its measured sizes, so it cannot fight the visible panel's scroll position.
- **Rows.** Rows are memoized on the ledger item and a stable open callback, so scroll, detail open, and continuation state do not re-render them. Feed amounts render static digits until their value changes after mount, then animate later changes; this removes one number-animation element per digit from every mounted row. Presentation dates reuse cached `Intl.DateTimeFormat` instances.
- **Accessibility.** Each row keeps its list item, button, and label, plus `aria-posinset` and `aria-setsize` (`-1` until the history is exhausted). The focused row stays mounted while scrolled away, Tab and Shift+Tab move through the window, and closing a detail returns focus to the same row (scrolling it back into view if it was unmounted) or to the Activity region if it no longer exists. Browser find-in-page and full-page text snapshots see only the mounted window.

Pagination is unchanged: the continuation sentinel sits after the list's full virtual height, so unmounted rows never trigger fetches or read as missing history.

## Measured envelope

Headless Chromium 140 (Playwright), production fixture build of the ledger, Apple Silicon laptop, one run per cell unless noted, fling = CDP gesture at 4,000 px/s down the whole loaded feed and back. About 10% of synthetic rows are actions, some of them pending. Frame columns are shares of rAF intervals over 16.7 ms and 33.4 ms.

| Scenario | Before >16.7 / >33.4 / p95 | After >16.7 / >33.4 / p95 | DOM nodes before → after |
|---|---|---|---|
| Home mobile, 2,000 rows, CPU 1× | 45% / 18% / 53 ms | 22% / 1.0% / 27 ms | 518,943 → 5,083 |
| Home mobile, 2,000 rows, CPU 4× | 87% / 62% / 274 ms | 84% / 15% / 43 ms | 518,943 → 5,069 |
| Home mobile, 2,000 rows, CPU 6× | 96% / 89% / 824 ms | 93% / 56% / 62 ms | 518,943 → 5,062 |
| Activity mobile, 2,000 rows, CPU 1× | 50% / 17% / 56 ms | 27% / 1.8% / 27 ms | 984,548 → 8,675 |
| Home desktop, 2,000 rows, CPU 1× | 52% / 28% / 71 ms | 18% / 1.1% / 27 ms | 519,071 → 5,204 |
| Home mobile, 150 rows, CPU 1× | 36% / 6% / 35 ms | 24% / 1.0% / 27 ms | 36,042 → 1,747 |
| Home mobile, 100 rows, CPU 4× (3 runs) | 36–54% / 7–12% / 36–44 ms | 63–74% / 5–14% / 32–40 ms | 23,613 → 1,652 |
| Home mobile, 20 rows, CPU 4× (3 runs) | 51–64% / 5–9% / 28–36 ms | 56–61% / 4–7% / 32–34 ms | 5,423 → 1,478 |

Detail open (median of three) fell from 818 ms to 59 ms at 2,000 rows unthrottled, and from 3.5 s to 100 ms at CPU 4×. The older-page append's longest animation frame fell from 297 ms to 110 ms at CPU 4×. Short feeds are within run-to-run noise of the old list. Between about 100 and 300 loaded rows at CPU 4×, the old list, fully mounted and scrolled on the compositor, has fewer intervals over 16.7 ms because the windowed list mounts rows on the main thread; intervals over 33.4 ms and p95 are similar. That middle range is a known gap. Even an unthrottled 20-row feed shows 27–47% of rAF intervals above 16.7 ms in this environment, so the interval shares are relative evidence, not a presented frame rate. Sustained 60 fps is not reached at CPU 4× or 6×, and real iOS Safari and Android devices have not been measured.
