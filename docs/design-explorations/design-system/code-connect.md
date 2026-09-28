# Code Connect

Code Connect maps a Figma component to its code owner. It does not sync changes in either direction.

[#684](https://github.com/jessepollak/home/issues/684) owns Code Connect: the `*.figma.ts` template files under `apps/web/{client,components}/explorations/code-connect/`, their parse check and the publish job. Each [`apps/web/figma/components/<Name>.json`](../../../apps/web/figma/components/) file maps one Figma node to its code owner. [`apps/web/figma-components.json`](../../../apps/web/figma-components.json) identifies the library and lists frames, deliberately unmapped nodes (sub-parts, design-only), and code components without a Figma component; this doc and [figma-mapping.json](../figma-mapping.json) do not keep their own mapping copies. See [Figma workflow](../figma-workflow.md#code-connect) for what is published.

- Every mapped node ID was re-read from the live file after #841's page split. `Card` maps the surviving set `269:5270`; #882 deleted its legacy variant `12:28`. `SignedBalanceBar` maps the set `293:5935`; `91:927` is one of its variants.
- #882 deleted the Figma numpad and key (`166:1739`, `166:1738`). #941 deleted the code numpad, so neither side has one.
- Before the scope moved to #684, #841 wrote 28 rows with `add_code_connect_map` (label `React`). Each reported success, and `get_code_connect_map` still reads back `{}`. #684's publish supersedes those writes; #841 makes no further Code Connect calls.

Templates for sets with proposed states or drawings must not translate those states into props:

- `MoneyPrimaryAmount` `state=error`. Map only `empty` and `entered`, which follow the `amount` value; the error is `MoneyAmountDisplay`'s `overAvailable` (#941), not a `MoneyPrimaryAmount` prop.
- `PriceChart` `tone=gain|loss|scrub|error`. Code draws the line in `var(--primary)`; `tone=loading` follows the history status and is not a prop.
- `ToggleGroup` `variant=outline` keeps its name and mapping; its one-group-border drawing has code parity since #947.
- `ShimmerRows` maps the default with both proposed `Show media` and `Show context` on. Code's template renders `count`; #687 added only a `hero` variant, so the template must not claim either boolean.
- `CopyableValue display=full` draws the superseded one-line complete review address. Per Jesse’s #945 decision, code adopts `presentation="reveal"` (condensed one-line address; tap for full address and Copy button) on review `To`, `Resolves to`, and Account address. Figma needs a `reveal` drawing; parity pending. The template must not claim `display=full` parity.
- `TabItem` `Icon=Card` belongs to the Card proposal (#636); code has no Card tab, so the template renders the Home tab for it.
- `Alert` uses the `Action` text for the `AlertAction` button label.
