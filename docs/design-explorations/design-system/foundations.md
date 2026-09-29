# Foundations

`apps/web/app/globals.css` is the source for production colour, radius and spacing tokens. Review light and dark treatments in Storybook (see [theme](../../design-system/theme.md)). Code defines `--warning` (#b45309 Light / #fbbf24 Dark) for the pending status dot (#942). The #947 chart tokens were later removed from CSS when the chart work stopped consuming them.

- **Colour.** Production tokens have Light and Dark modes in `globals.css`.
  - They include shadcn semantic tokens, `market-gain`, `market-loss`, `balance-*`, `payout-*`, `warning`, `status-positive`, `status-caution`, and `status-negative`.
  - Four existing Light values were corrected to match code: `foreground` #171717 → #0a0a0a, `card-foreground` #171717 → #0a0a0a, `muted` #f8f8f8 → #f5f5f5 and `destructive` #dc2626 → #e7000b. This is why the families from #683 now show as CHANGED.
  - **Revision 2 proposed new values that led code** (Jesse's direction: soften red, rebalance red and green); [#947](https://github.com/jessepollak/home/issues/947) adopted the values below. The retired chart tokens are historical; active tokens remain in `globals.css`. Contrast is measured on white.
    - `destructive` #e7000b → **#c8372d** (5.2:1). The old red passed contrast; the problem was chroma, so the new value lowers saturation.
    - `market-gain` #137333 → **#0a7c4a** (5.3:1), and `market-loss` #b42318 → **#c8372d** (5.2:1). The loss hex matches `destructive`, but the token stays separate so the meaning stays separate (decision below).
    - New `warning` **#b45309** (5.0:1), for the title and icon of limit warnings; #942 adopted the Light/Dark code token for the pending status dot, and #947 reuses it.
    - Dark was checked separately rather than copied from Light. Code keeps its Dark `destructive`, `market-gain` and `market-loss` values; the chart-token contrast notes below document the historical #947 exploration, not current CSS.
    - The historical chart treatment used `chart-gain` **#10934a** (4.0:1), `chart-loss` **#e0473f** (4.1:1), and `chart-baseline` **#8a8a8a** (3.45:1). These values are no longer defined in CSS.
    - The historical area fill under the line used the line colour at 12% → 0%. `alpha/chart-gain-12` and `alpha/chart-loss-12` documented the top stop.
    - Comparables: Coinbase (#098551 / #CF202F) and PayPal set the depth. Robinhood's #00C805 and Cash App's lime were rejected as neon, since they fall under 3:1 once a fill sits behind them.
  - Tailwind opacity modifiers include `bg-destructive/10` and `ring-foreground/10`. The historical exploration also documented chart fills and over-white fallback colours.
- **Radius.** `radius/sm…4xl` follow the `calc(var(--radius) * n)` scale, where `--radius` is 4px. `radius/full` is added.
- **Scale.** Documented historical design values include:
  - Spacing: `space/*`, the Tailwind steps plus `hairline`, `screen-inset` and `card`.
  - Sizes: `size/*`, including `hit-min` 44, the control heights, `money-cta` 44, `row-min` 56, `keypad-key` 56 and `tab-bar` 56.
  - Motion: `motion/duration/*` (0, 100, `chip-max` 120, 150, `tab-max` 180, 200, 250, 300, `sheet` 350), `motion/easing/*` (`out`, `overlay`, `content`) and `motion/press-scale` 0.97. Check the running components in Storybook for motion parity.
- **Elevation.** CSS owns shadows and the `Elevation/card-ring` treatment (`ring-1 ring-foreground/10`).
- **Type.** Text styles `Home/*`.
  - New styles: `Amount entry` (48/48), `Heading` (18/28), `Label` (14/20 medium), `Keypad` (20/28), `Micro` (12/16 medium), `Mono` (12/16) and, in run 11, `Mono sm` (14/20, `font-mono text-sm` for `CopyableValue`), and #841's `Mono tight` (Geist Mono 12/16, −0.3px letter spacing; proposed `font-mono text-xs tracking-tight` for the full review address). Run 11 moved the #683 families off unstyled Inter onto these styles wherever size and weight match (`FinanceRow` title 14/20 `Label`, context 14/20 `Small`, value context 12/16 `Caption`), which makes a title-aligned row 58px tall, as `py-2` + `leading-snug`/`leading-normal` render in code.
  - Production uses the fonts declared in the [theme](../../design-system/theme.md).
- **Icons.** Code imports Lucide glyphs from `lucide-react`; review their states in the owned component stories.
