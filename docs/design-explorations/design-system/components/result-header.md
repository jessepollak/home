# ResultHeader

| Item | Code | Figma | MVP | Built on | Owner | P |
| --- | --- | --- | --- | --- | --- | --- |
| ResultHeader | yes (#948) | `166:1884` outcome=success\|pending\|failed\|unknown. `unknown` (revision 3) is the sent-unknown money outcome: a confirmed action with no transaction hash after 15 minutes ([actions](../../../actions.md)). It never says failed or not sent, keeps the amount in the title ("We can't confirm $25.00") and points to Activity | yes | Empty media | `components/ui/result-header.tsx`, composed by `client/money-modal/money-result.tsx` (#948) | P0 |
