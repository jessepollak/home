# 22. AddressField / recipient board

| # | Follow-up | Disposition | Delivery | State (2026-09-25) |
| --- | --- | --- | --- | --- |
| 22 | AddressField / recipient board | Implemented (library and recipient step) | [#953](https://github.com/jessepollak/home/issues/953) (design), PR [#994](https://github.com/jessepollak/home/pull/994) | merged; the four `AddressField` states and the recipient frames match code except rows 22a–22f; issue open for Jesse's review; no adoption issue because it proposes no production change ([Send recipient board](../../design-system.md#send-recipient-board-953)) |
| 22a | Recipient status Alert padding and error tone | Implemented | [#947](https://github.com/jessepollak/home/issues/947), PR [#989](https://github.com/jessepollak/home/pull/989) | landed on `main` in `da915773`; the Send status now renders the library `Alert` (16/14, body `foreground`) |
| 22b | `Or` separator spacing | Deferred (owner: Jesse) | [#953](https://github.com/jessepollak/home/issues/953) review | code pulls the row 8px closer (`-my-2`); Jesse's #953 review decides whether Figma or code changes |
| 22c | Drawer back icon | Deferred (owner: Jesse) | [#953](https://github.com/jessepollak/home/issues/953) review | the library draws `chevron-left`, code renders `arrow-left`; same decision |
| 22d | Review frame `To` row | Covered | [#1000](https://github.com/jessepollak/home/issues/1000) | open, not queued; the board draws the superseded `display=full` address, and #1000 redraws the `MoneyConfirmSummary` instances with `reveal` |
| 22e | Review row order | Deferred (owner: Jesse) | [#953](https://github.com/jessepollak/home/issues/953) review | code orders From, To, Asset, Network; Figma leads with `To`; same decision |
| 22f | Cash-out region copy and Paste focus | Deferred (owner: Jesse) | [#953](https://github.com/jessepollak/home/issues/953) review | code reads "in United States", and a button paste leaves focus on Paste, so the field shows the shortened `entered` value; changing either in code is production behaviour and needs its own adoption issue if chosen |
