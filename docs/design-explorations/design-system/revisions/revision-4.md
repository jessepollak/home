# Revision 4

Revision 4 (2026-09-23, run 11) answers Jesse's two FinanceRow review threads and the historical library audit. `FinanceRow` gets one row structure in every variant: the amount on the title line, one 16px trailing slot for the chevron or Retry, Item's 12px side padding, and one-line truncation. The historical review assembled screens from reusable parts: bordered blocks, sheets, keyboards, skeleton rows and sticky footers correspond to `Card`, `Drawer`, `SystemKeyboard`, `ShimmerRow` and `TradeActions`. Current parity is reviewed in Storybook stories against shipped components.
