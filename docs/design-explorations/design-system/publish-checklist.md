# Publish checklist

Jesse publishes from Figma → Assets → Publish library.

1. **Check the dialog lists the new items.**
   - The surviving new components or sets: Icon; new primitives from Badge to RadioGroup in the matrix including `InputOTP` and `InputOTPSlot`; finance components from MoneyPrimaryAmount to PriceChart including `MoneyConfirmRow`; run 11's `Card` set, `TradeActions`, `SystemKeyboard`, `ShimmerRow` and `TransactionAmount`; and run 12's `Popover` (`292:5883`). The deleted Figma numpad and key must drop out of the published library.
   - 83 new variables: 29 colours, 12 `color/alpha/*` and 4 radius values in `Home tokens`, and 38 in the new `Home scale` collection. Revision 2 adds `warning`, `chart-gain`, `chart-loss`, `chart-baseline`, `alpha/chart-gain-12` and `alpha/chart-loss-12`.
   - The new `Dark` mode.
   - 4 effect styles and the text styles including run 11's `Mono sm` and #841's `Home/Mono tight`.
2. **Check the changes to existing items.**
   - `Button` (`12:27`) gains 55 variants and renames its properties to `variant` / `size` / `state`. `Variant=Primary` becomes `variant=default, size=touch` and `Variant=Secondary` becomes `variant=outline, size=touch`. Node IDs and instances are preserved.
   - `Card` set `269:5270` has the #841 HomeTotalBalance description and four surviving variants: flush/list `269:5196`, default/default `269:5244`, default/list `273:5531`, flush/hero `301:5912`. Publish the #882 deletion of legacy variant `12:28`.
   - Revision 3 changes: `FinanceRow` gains a `Show action` boolean (default off, so existing instances and `Home — final` are unchanged). `Alert` draws `AlertAction` as an outline button. `ResultHeader` gains `outcome=unknown`. `Icon` gains `icon=circle-help`. `MoneyConfirmSummary` rows sit in the standard block. `PriceChart` fits its column. `MoneyPrimaryAmount` was optically centred; [#1015](https://github.com/jessepollak/home/issues/1015) supersedes it with one-run centring.
   - Run 10 change: `MoneyConfirmSummary` (`166:1803`) gains a first `To` row, and `MoneyConfirmRow layout=full-value` (used only there) draws a full mono address with a copy icon; #841 proposes a one-line treatment at 390px. The summary's only four instances are the Review board's frames.
   - Run 11 changes (revision 4):
     - `FinanceRow` is restructured in all five variants (body wrapper, Icon chevron, in-slot primary Retry glyph, text styles, 12px padding). At the time, instances in `Home — final`, historical frames and Home states re-rendered with 58px rows; #841 subsequently centred lone values in Figma (proposed).
     - `Card` `12:28` became the `inset=legacy` variant of the new `Card` set `269:5270`, and `CopyableValue` `166:1820` became `display=truncated` of `282:5961`. At that time both IDs and mappings were kept; #882 later deleted the Card legacy variant.
     - New sets: `TradeActions`, `SystemKeyboard`, `ShimmerRow` and `TransactionAmount`. `MoneyConfirmRow` gains `layout=copyable`, and `Icon` gains `house` and `chart-column-increasing`.
     - `Button` gets an `Icon` instance-swap property. `Drawer` and `Field` get native slots. `SectionHeader`, `MoreRow`, `ShellHeader`, `TabBar` and `TabItem` lose their text-glyph and absolute-layer stand-ins.
     - New text style `Home/Mono sm`. `color/chart-baseline` changes to #8a8a8a.
   - Run 12 changes (revision 5):
     - `SignedBalanceBar` `91:927` becomes `items=borrow+cash+investments` of the new set `293:5935`, beside `items=cash+investments` and `items=cash`. The ID and mapping are kept.
     - `Skeleton` (all three shapes) fills with `color/alpha/foreground-10` instead of `color/muted`, so every `ShimmerRow` and skeleton reads as code's `bg-foreground/10` on the card and on the muted page.
     - `Empty` draws `EmptyAction` as a `Button` instance (`variant=default, size=lg`, 44px tall) instead of a raw frame.
     - `Home states` (`190:2821`) is rebuilt on `Card`, `SignedBalanceBar`, `ShimmerRow`, `Skeleton`, `Empty`, `Button` and `Popover` instances; #841 subsequently moved it onto the Home page beside Screens. #882 later deleted the legacy Card variant.
   - Every other #683 family, including `FinanceRow`, `SignedBalanceBar` and `ActivityLoader`, shows CHANGED because of the token corrections (Figma `getPublishStatusAsync`, re-read 2026-09-23 after revision 2).
   - #841 changes needing publication: FinanceRow `96:1147` (body alignment and description), CurrencyMarkSlot `12:59` (scaling Shimmer disc), ShimmerRow `274:6015` (40px mark and description), CopyableValue `282:5961` (text style and description), MoneyConfirmRow `166:1802` (description), Card `269:5270` (description) and new `Home/Mono tight` text style. #882 subsequently deleted the Figma numpad and key; publish to remove their published definitions.
   - Revision 2 changes three token values: `destructive`, `market-gain` and `market-loss` (see [Foundations](foundations.md)). #947 adopted them in code, so publishing the softer tones no longer leads code; [#1003](https://github.com/jessepollak/home/issues/1003) clears their `PROPOSED` descriptions and syncs Dark `chart-baseline`.
   - #792 changes (Cash L2 proposal, unpublished). Each addition is off by default, so existing instances are unchanged:
     - `ShellHeader` (`11:773`) gains `Show back` (a 44px Back target with the new `icon=arrow-left`, as the nested chrome in `client/home/shell-chrome.tsx`) and `Show mark` (default on; turn it off with `Show back`).
     - `FinanceRow` (`96:1147`) gains `Show selected` (primary `circle-check`) and `Show choice` (muted `circle`) in the trailing slot. The September 25 redesign no longer uses either (no Cash frame sets them), so drop both before publishing unless another proposal adopts a selectable row.
     - `MoneyTicker` (`12:2`) gains `Show context` (off by default) and `Context`, the line under a hero balance. The context is muted by default. The Cash and Savings frames override its fill to the `color/market-gain` variable for the earning rate (`4.08% APY`, `Earning 4.08% APY`), matching the exploration's `text-market-gain`. If the proposal is selected, replace that override with a `Context tone` variant before publishing.
     - `CurrencyMarkSlot` (`12:59`) gains `Kind=Flag (ID)` (`341:9836`) and `Kind=Savings` (`342:3772`, lucide `piggy-bank`).
     - `Icon` (`156:1726`) gains `icon=arrow-left` (`341:9646`).
   - Boards, screens and References are frames. They do not publish.
3. **Keep References out of any public share.** The section contains Mobbin images and exists for internal reference only.
4. **Publish.** Then publish the Code Connect template files with `bun run --cwd apps/web figma:connect:publish` (CI does this on `main` when `FIGMA_ACCESS_TOKEN` is set). Do not add hand mappings with `add_code_connect_map` or `send_code_connect_mappings` for nodes in `apps/web/figma/components/<Name>.json`, and do not replace existing ones by hand: a UI-created mapping blocks the template publish ([Figma workflow](../figma-workflow.md#code-connect)).
5. **Spot-check `Home — final` (`92:922`).** Its `Button` instances should read `variant=default|outline, size=touch, state=default` and look unchanged apart from the token corrections and the proposed money-in green.
6. **Resolve the review threads in Figma.** Each of the 29 revision-2 threads, the 8 revision-3 threads and the 2 run-11 threads (`1939110696`, `1939110898`) has a reply saying what changed; Jesse resolves them. Run 12 answered no Figma threads.
