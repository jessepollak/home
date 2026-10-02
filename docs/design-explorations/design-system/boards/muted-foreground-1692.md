# Light muted foreground candidates (#1692)

Issue [#1692](https://github.com/jessepollak/home/issues/1692) proposes a Light-only `--muted-foreground` adjustment. Review it on `review-boards--muted-foreground`: four mobile frames reuse the real funded Home overview and its Activity feed, with identical fixtures and a scoped token override.

| Candidate | Light token | Approximate hex | Card contrast | Page contrast |
| --- | --- | --- | --- | --- |
| Current | `oklch(0.556 0 0)` | `#737373` | 4.73:1 | 4.34:1 — fails |
| A | `oklch(0.54 0 0)` | `#6f6f6f` | 5.06:1 | 4.64:1 — smallest passing step |
| B | `oklch(0.52 0 0)` | `#696969` | 5.51:1 | 5.05:1 |
| C | `oklch(0.50 0 0)` | `#636363` | 6.00:1 | 5.50:1 |

Contrast values supplied in the issue compare normal-size text against the Light card (`oklch(1 0 0)`) and page `--muted` (`oklch(0.97 0 0)`) backgrounds; the target is at least 4.5:1. Hex values are rounded previews of the OKLCH tokens.

The exploration fixes the appearance to Light. Tailwind's inline theme maps `--color-muted-foreground` to `var(--muted-foreground)`, so the wrapper changes existing secondary text without replacing production components. Story accessibility findings remain reported in the non-blocking exploration lane, including the known Current page-contrast failure.

**Disposition:** no candidate is selected or adopted. Production keeps `oklch(0.556 0 0)`; Dark stays unchanged. Jesse selects on the board before a separately reviewed adoption updates the shared Light token and verifies other secondary-text surfaces.
