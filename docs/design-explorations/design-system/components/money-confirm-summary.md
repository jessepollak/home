# MoneyConfirmSummary and MoneyConfirmRow

| Item | Code | Story and historical design | MVP | Built on | Owner | P |
| --- | --- | --- | --- | --- | --- | --- |
| MoneyConfirmSummary + MoneyConfirmRow | yes | Review the send and trade confirmation stories against `client/money-modal/confirm-summary.tsx`. Revision 3 grouped rows into a standard block with no per-row dividers. Per Jesse’s #945 decision, send `To` renders inline like `From`, using `CopyableValue presentation="reveal"`: a condensed one-line address opens the full address and Copy action. `Resolves to` and Account address use the same treatment. A trade summary keeps slippage and minimum received as rows. | yes | Auto-fit plain-text headline, dl | `client/money-modal/confirm-summary.tsx` | P0 |
