# Modal open profile

Measures tap → visible money sheet → actionable content for Add money and Send on an isolated local **production build** with fixture data. Build and start the fixture server exactly as in [Activity scroll profile](activity-performance.md), then from the repository root:

```sh
bun run --cwd apps/web profile:modals --flow add-money --viewport mobile --cpu-throttle 4 \
  --cache cold --browser headed --repeat 5 --out /tmp/modal-profile.json
```

Options: `--flow add-money|send`, `--viewport mobile|desktop` (390×844 touch or 1280×800), `--cpu-throttle 1|4|6`, `--cache cold|warm`, `--network slow4g|none` (Chromium network emulation), `--api-delay <ms>` (funding reads and, for Send, the network-fee read), `--chunk-delay <ms>` (every script chunk, including the initial page load, so it is slow), `--browser chromium|chrome|shell|headed`, `--repeat`, `--base-url`, `--out`, and `--cpu-profile <path>` (cold, single repetition). `cold` taps as soon as the trigger is enabled after navigation, usually before idle preload finishes; `warm` waits for network idle plus 3 s. Each repetition also closes with X and taps again (`reopen`). Add money runs in the Indonesia fixture region so a provider row exists.

Use `--browser headed`. Headless Chromium on some hosts delivers animation frames about every 130 ms, which turns every frame-based milestone into a multiple of that interval. The rAF-based milestones (`firstVisibleMs`, `settledMs`) are frame callbacks, not compositor presentation; `domMs` is the first mutation containing the sheet; `actionableMs` is an enabled `Deposit <currency>` row (Add money) or amount input (Send). `settledMs` restarts whenever the loading shell hands off to a new popup element or the popup's bounds change, so it reports the final sheet's settling rather than the placeholder's. Compare it only within the same path. Compare runs on the same machine and build; CDP throttling is not a phone.

## Reference path

The ~100 ms visible-sheet target applies to the preloaded (warm) path in mobile emulation without CPU throttling. Cold network time is reported separately; it is not hidden inside the entrance motion.

## Results (#1119)

Median milliseconds from the input event, fixture production build, headed Chromium, before → after:

| Scenario | First visible sheet | Actionable methods |
| --- | --- | --- |
| Mobile, no throttle, warm (reference) | 65 → 65 | 69 → 54 |
| Mobile, no throttle, cold | 114 → 65 | 85 → 86 |
| Mobile, 4× CPU, warm | 148 → 129 | 131 → 109 |
| Mobile, 4× CPU, cold | 176 → 111 | 158 → 160 |
| Mobile, 4× CPU, cold, slow 4G | 459 → 145 | 429 → 413 |

Before, a tap that arrived before the sheet chunk showed nothing until the chunk downloaded, and after three failed downloads it showed nothing at all. Now the canonical sheet opens with its title, X and a placeholder, and the methods arrive in place; on slow 4G, 145 ms to the sheet versus 413 ms to methods is the cold-network cost. Home startup is unchanged in the same measurement: 34 script requests, 846,852 script bytes before the tap, and the same three idle-preload chunks.

Main-thread cost on the warm tap is one long task (about 75 ms at 4× CPU, 20 ms unthrottled) inside the drawer's open layout effects, which force a full-document layout while the modal locks page scroll. It scales with Home's layout cost rather than with the sheet, so it belongs to the app-wide performance audit (#1118), not to deferred loading.

## Entry points

| Entry | Code preload | Blocking work moved | Status |
| --- | --- | --- | --- |
| Add money (Home action, empty-Activity prompt, Cash) | Idle once verified; pointer-down and focus | Sheet no longer waits for its chunk; providers and open-order reads prefetch on intent | Loading shell with method-list placeholder |
| Receive | Inside Add money | None; address comes from the verified session | Complies |
| Send, Activity cash-out resume | Idle once verified; pointer-down and focus | Sheet no longer waits for its chunk; fee reserve and recipients still load in the open sheet | Loading shell |
| Buy / Sell (Invest, Borrow Buy row) | Pointer-down and focus | Sheet no longer waits for its chunk; availability already loads with the page | Loading shell |
| Save deposit / withdraw | None; the journey is imported with the Cash route | No deferred chunk or loading shell; the tray and its steps mount with the route | Complies |
| Borrow direct market | Opens from route data | Sheet no longer waits for its chunk | Loading shell |
| Borrow / Repay / collateral steps | Idle while management is open; pointer-down | Already a deferred step inside the open sheet | Already complied |
| Activity detail | Pointer-down on the list | Sheet no longer waits for its chunk | Loading shell |
| Convert | None | No production entry point exists | Not applicable |

No entry prefetches prepared actions, quotes, provider sessions or wallet prompts. Data-only prefetch is limited to Add money, whose reads are owner- and region-keyed and cleared with the owner's cache.
