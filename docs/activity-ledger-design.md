# Activity ledger — approved design (#855)

The Activity ledger design approved in #855 is the contract for production Activity and Home's feed adoption in #967, initially for onchain transfers and Home actions. The production components and Activity-panel wiring live under `apps/web/client/activity/`. The [Figma design](https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=308-5918) is section `308:5918` on the [Activity page](https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=333-13088) (`333:13088`); F1 Home `308:5919` (including `Card / Pending` `403:15340`), F2 Activity `308:6253` (`Card / Pending` and `Card / Recent`), detail S1–S7 `309:6495`, `309:6635`, `309:6721`, `309:6806`, `309:6870`, `309:7025`, `309:7100`; desktop D1 `309:7515` (`Card / Pending` and `Card / Recent`), label `309:7500`. Every frame is built from instances of the reconciled Components-page library.

## Source inventory and gaps

| Source | Current owner | Gap to full ledger adoption |
| --- | --- | --- |
| Onchain transfers | `apps/web/app/api/activity/route.ts`, `client/activity/use-activity.ts` | Confirmed transfers only; retain canonical transfer IDs. |
| Home actions | `apps/web/app/api/actions/route.ts`, `client/activity/activity-ledger-items.ts`, `client/activity/activity-feed.ts` | Current operation statuses do not cover provider waits or customer attention. |
| Funding orders | Owner-fenced, all-region `GET /api/activity/orders` and `client/activity/activity-ledger-items.ts` | Funding order rows replace matching onchain receipt transfers by transaction hash. |
| Cash-out orders | Owner-fenced, all-region `GET /api/activity/orders`; current Peer cash-outs remain Home actions carrying provider progress on `/api/actions` | An order matching a Home cash-out action ID is omitted in favor of the action row; older orders outside the action window use the `cash-out-order` family. A linked withdrawal folds into its action deposit. |
| Card | Not implemented | Fixture-only family; no live API or assumed source. |

`client/activity/activity-feed.ts` merges and deduplicates transfers, actions and orders; `client/activity/activity-ledger-items.ts` adapts its output for the production Activity and Home feed. For duplicate family and source-owned IDs, presentation keeps the first list position and selects a snapshot by present/latest `updatedAt`, then later lifecycle stage, then first on a tie. Adapters supply `updatedAt` as an ISO-8601 timestamp; an unparseable value counts as missing. Equal raw IDs from different families stay separate; cross-source reconciliation remains upstream. Source adapters must supply formatted signed amounts, dates and safely authorized next actions.

## Pending and Recent

When anything is pending, Activity shows **Pending** and **Recent** in separate cards (Recent appears only when it has rows); with nothing pending it is one card with no group header. Figma F1 drew Home's embedded feed with Pending in its own card above an uncarded Recent header and rows. Since #1023 Home renders its whole Activity section in one standard section card, so Home's feed shows the Pending header and rows above the Recent header and rows inside that card, without a nested card; without Pending, Home shows its rows without a group header. The group headers use the balances page's treatment. Callers may localize both labels and the accessible attention announcement. Adapters deliver items newest first; each group keeps that order. Jesse's review comments on 2026-09-24 removed the row labels "Needs you" and "Check status".

- **Pending** holds customer, provider, chain and Home waits, ambiguous items, and reversed items whose returned-funds withdrawal is allowed.
- Within Pending, items that need the customer come first: a customer wait or reversal whose next action is allowed. Everything else keeps list order.
- **Recent** holds confirmed, failed, expired, refunded and reversed items with no allowed action. Failed and expired items are finished records even though Try again or Start again exists in their sheet.

## Consecutive transfers

Adjacent confirmed incoming transfers of the same chain and token contract (with matching token decimals so units are never mixed) form a collapsible run. Any other activity, including an outgoing transfer or another token, breaks the run. The summary totals only transfers in loaded pages; it shows a priced fiat total only when every child has a recorded valuation, otherwise it shows the token total alone. Its ordinary-height row shows `Received ×4` on one line (the token remains in the icon, native amount, and assistive description), the compact date range alone beneath, fiat and summed native quantity in the value column, and two overlapping token marks inside one icon footprint. A disclosure chevron rotates on expansion. Recent is a flat virtual list: expansion inserts the original transfers as individual inset rows in order, each opening its normal detail sheet and retaining its own focus/restore key; collapsed children are absent from the DOM. The summary keeps its identity when a page extends the run or a new head arrives, and an interleaving movement splits the run.

## Taxonomy and context

| Status | Row context | Sheet badge | Permitted action kinds before family restrictions |
| --- | --- | --- | --- |
| waiting-customer | date only; warning icon when an action is allowed | Pending (warning icon when an action is allowed) | resume, resume-verification, complete-payment |
| waiting-provider | date only | Pending | cancel-cash-out |
| waiting-chain | date only | Pending | none |
| waiting-home | date only | Pending | none |
| confirmed | date only | Confirmed | none |
| failed | Failed (card: Declined) | Failed (card: Declined) | retry |
| expired | Expired | Expired | start-again |
| ambiguous | date only | Unconfirmed | clear-order |
| reversed | Reversed; warning icon while withdrawal is allowed | Reversed (warning icon while withdrawal is allowed) | withdraw-returned-funds |
| refunded | Refunded | Refunded | none |

The four owner states stay distinct in the contract so engineering and adapters can reason about them, but the customer sees only whether they need to act. Context kept, and why:

- A warning icon marks the only rows the customer can move forward, announced as "Action needed" in the row's accessible name.
- The **Unconfirmed** badge and sheet sentence warn that money may have moved, so the customer does not send or pay again.
- **Failed / Declined, Expired** explain why nothing arrived.
- **Reversed, Refunded** explain why money came back.
- The provider name appears only in funding and cash-out steps (for example `Waiting on Coinbase`) and the Provider fact, where it explains a delay.

Context removed: `With provider`, `On Base` and `With Home` in rows, and generic sheet sentences such as "No action needed". The Pending header already says the item is in progress. Owner sentences appear only when they change what the customer does next: a deadline, where returned money is, or a warning not to resend. The only built-in defaults are a chain wait ("Still sending" / "No need to send it again.") and ambiguity ("We can't confirm this yet" / "Don't try again until this updates."). Each sentence is one line, or a title plus one instruction line. Sentences say "your balance", not "Cash"; `Cash` stays only as the product name in a fact such as `From: Cash`.

Pending money never uses success tone: customer/provider waits, failed, expired, ambiguous and reversed are muted; chain/Home waits are default, because that money has already left or reached the customer's wallet while a customer or provider wait has not moved it yet. Only confirmed/refunded incoming amounts use success tone. Callers may replace row and sheet status words with `statusLabel`.

Card has no actions. `resume-verification`, `complete-payment`, and `clear-order` are funding-only; `withdraw-returned-funds` is cash-out-only. `clear-order` removes a dispatch-ambiguous funding order without redispatch ([funding seam](funding-provider-seam.md)); it is not Retry. The footer is only a caller callback. No component dispatches money.

`cancel-cash-out` is allowed only while a cash-out waits on the provider (a Home cash-out action or cash-out order), and only when the provider still reports the deposit as withdrawable. Cancel is optional, so it never raises the warning icon. Cash-out progress (`Waiting for a buyer`, `Buyer paying you`, `Returning`) appears as the sheet's current step, not in the row; a withdrawal in progress reads `Returning to your balance`, an unknown provider state is ambiguous, and a return reads `Returned`.

**Order statuses.** `GET /api/activity/orders` maps provider order states to ledger statuses on the server, so the client never reads provider status codes. Funding: awaiting payment is a customer wait (expired once its payment deadline passes); payment received and settling are provider waits (`Waiting on <provider>`); sent but not yet verified on Base is a chain wait; verified receipt is confirmed; reserving, unknown and dispatch-ambiguous are ambiguous; a cleared ambiguous order reads `Cleared` and a provider-cancelled order reads `Cancelled`, both as finished failures. `Complete payment` or `Continue with <provider>` opens Add money only for a waiting-payment order in the customer's current region marked resumable because it is the order selected by the region's open-order lookup; `Clear order` appears once the order's recovery time has passed and calls only the resolve route. Cash-out: waiting for or paying a buyer is a provider wait, delivered is confirmed, a settled return is refunded (`Returned`), returned or failed funds still withdrawable are reversed with `Withdraw`, and an unknown provider state is ambiguous.

**Support.** Home has no customer support feature yet, so no row, sheet or action offers Contact support. Customer support is tracked in #813; when it ships, its entry point is added to the failed and ambiguous sheets as a secondary action, without changing the status rules above.

## Detail contract

Every sheet shows the caller's detail amount when supplied (otherwise the row amount) and status Badge, then an owner sentence when one applies (never on confirmed/refunded), then optional funding/cash-out timed steps or a pending Home action's Submitted → Confirming on Base stages, then actionable family facts, then at most one status-and-family-authorized footer action. Transfer and Home action facts include date, network and optionally a copyable hash/explorer link; funding and cash-out facts include provider, payment/payout method and copyable order ID; card facts include date, merchant, card label and optional original purchase/reference. Never expose action IDs, token contracts, block numbers, owner IDs, provider payloads or compliance prose. No success is inferred from the amount sign.

The page owns one selected item, opener and detail sheet; rows pass the exact opener to the page's `onOpen`. Closing returns focus to that opener.

## Transaction names

A row title names the money movement: a verb and an object or counterparty (`Sent to alex.base.eth`, `Borrowed USDC`, `Deposit to Savings`, `Card · Blue Bottle`). It never names a protocol, contract or status. A movement keeps one title through its whole lifecycle, so a pending `Sent to alex.base.eth` does not rename itself when it confirms; whether it happened is carried by the Pending group, the row context and the sheet badge, never by the title. A title without a known counterparty uses the family verb alone (`Send`).

| Source | How the name is produced today | Target | Backend gap |
| --- | --- | --- | --- |
| Home actions | The title stored at prepare time, rendered verbatim by `client/activity/activity-ledger-items.ts`: `Send USDC` (`server/money-actions/prepare-send.ts`), `Deposit USDC into Morpho` (`server/savings/prepare.ts`), `titleFor` in `server/borrowing/prepare.ts`, `Cash out with Peer` (`server/funding/cash-out.ts`) | Present from the action kind and structured metadata: `Send to alex.base.eth`, `Deposit to Savings`, `Borrow USDC`, `Repay USDC`, `Cash out to bank` | The send recipient exists only in a free-text warning; actions need a structured recipient. Stored titles name Morpho and Peer; the kind labels in `client/activity/activity-ledger-items.ts` say `Save` where the product says Savings. |
| Onchain transfers | `Received` / `Sent` / `Self transfer`, with the ledger row title `Received` (`client/activity/activity-ledger-items.ts`); counterparties are addresses | `Received from alex.base.eth`, `Sent to 0x12ab…89cd`, `Moved between your accounts` | No reverse Basename lookup or known-address labels (Savings vaults, provider escrow) in `server/activity`. Only ERC-20 Transfer logs are indexed, so native ETH is missing. |
| Unknown tokens and contracts | A missing symbol renders `unknown token` and the amount as base units (`activity-presenter.ts`, `server/activity/token-metadata.ts`) | `Received a token from 0x12ab…89cd` | Calls that emit no Transfer log are not indexed, so they are invisible rather than misnamed. |
| Funding orders | `Add money` from `/api/activity/orders`, with the method in the Payment method fact | `Add money` | No remaining order-history naming gap. |
| Cash-out orders | `Cash out to <payout app>` from `/api/activity/orders` or the linked Home action | `Cash out to bank` / `Cash out to Venmo` | Payout labels follow the provider's available platform label. |
| Card | No source | `Card · Blue Bottle`, `Card refund · Blue Bottle` | Everything. |

**Fallback.** Use the first available name, in order: a named counterparty or merchant, then a short address, then the family verb alone (`Sent`, `Received`, `Add money`, `Cash out`, `Card purchase`). A missing name never hides a row, and a title is never a raw hex string or "Contract interaction". An unknown amount shows base units until token metadata resolves.

Names are data. Adapters supply each name with the record; the feed never builds one from a hash, order ID, token contract or provider status code. Localization translates the verbs and connectives, not the merchant or account name a source supplied.

## Workshop and limits

Component story ID prefix: `activity-ledger--` (including `mixed-chronology`, `nothing-pending`, `pending-by-owner`, `home-feed`, `home-feed-nothing-pending`, `detail-funding-needs-you`, `detail-ambiguous`, `detail-ambiguous-funding`, `reduced-motion-reference`). Journey prefix: `journeys-activity-ledger--` (`pending-to-detail-and-back`, `reload-restores-pending`). Stories prove deterministic fixture rendering and browser-backed play interactions, not Next routing, source auth, persisted reload, provider status, actual dispatch, wallet behavior, Safari or physical keyboard behavior. The Activity panel connects live transfers, Home actions and owner-fenced funding/cash-out orders; cards remain fixture-only in this workshop.

Follow-ups: retain canonical IDs through adapters; supply structured names per the table above; treat silent resume inside Add money as a separate funding-flow change rather than implementing it here. Card needs a real source before adoption. The approved design governs Home integration.
