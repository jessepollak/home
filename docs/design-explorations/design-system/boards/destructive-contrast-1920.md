# Light destructive candidates (#1920)

Issue [#1920](https://github.com/jessepollak/home/issues/1920) proposes a Light-only `--destructive` adjustment. Review it on `review-boards--destructive-contrast`: four mobile frames reuse the owned destructive Badge and Button variants on card and page surfaces, with identical content and a scoped token override. The card stands in for a dialog: Light popover (`oklch(1 0 0)`) equals the card, without a portal escaping the override. Field error text and a destructive alert show other uses of the token.

| Candidate | Light token | OKLCH | Rest on card (10% tint) | Rest on page (10% tint) | Hover on card (20% tint) | Plain text on card |
| --- | --- | --- | --- | --- | --- | --- |
| Current | `#c8372d` | `oklch(0.555 0.184 28.5)` | 4.48:1 — fails | 4.13:1 — fails | 3.84:1 — fails | 5.20:1 |
| A | `#c33128` | `oklch(0.540 0.184 28.5)` | 4.76:1 | 4.38:1 — fails | 4.05:1 — fails | 5.54:1 |
| B | `#bd2b23` | `oklch(0.524 0.184 28.5)` | 5.07:1 | 4.67:1 | 4.30:1 — fails | 5.94:1 |
| C | `#b42318` | `oklch(0.500 0.182 29.5)` | 5.57:1 | 5.13:1 | 4.68:1 | 6.57:1 |

A is the smallest step that clears the reported axe failures. B passes rest on card and page. C reuses existing `--status-negative` and also passes hover on card. A and B keep the same hue and chroma as Current; OKLCH values are rounded descriptions of the hex candidates.

Contrast is WCAG relative luminance with the tint composited in sRGB over the Light card (`oklch(1 0 0)`) and page `--muted` (`oklch(0.97 0 0)`) backgrounds; normal text needs at least 4.5:1. Badge and Button rest uses a 10% destructive tint; hover uses 20%.

`--market-loss` shares `#c8372d` and passes as plain text (5.20:1 on card / 4.77:1 on page). It is not part of this proposal.

The exploration fixes the appearance to Light. Tailwind's inline theme maps `--color-destructive` to `var(--destructive)`, so the wrapper changes existing variants without replacing production components. Story accessibility findings remain reported in the non-blocking exploration lane, including the known Current tint-contrast failures.

**Disposition:** no candidate is selected or adopted. Production keeps `#c8372d`; Dark stays unchanged. Jesse selects on the board before a separately reviewed adoption updates the shared Light token.
