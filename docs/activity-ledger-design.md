# Activity ledger presentation contract

Status: Storybook proposal for #637. It is production-usable presentation only and is not wired to Home, an API, or a store.

## Current source inventory and gaps

| Family | Current source | Identity / correlation available now | Presentation gap |
| --- | --- | --- | --- |
| Onchain transfers | `/api/activity` | chain + token contract + provider log ID; transaction hash | Confirmed transfers only |
| Home Save, Borrow, Trade and Send actions | `/api/actions` | action ID; optional transaction hash | Four operational states; no customer/provider ownership semantics |
| Funding orders | feature-owned funding order APIs | provider + order ID | Open orders resume inside Add money and are not in Activity |
| Cash-out orders | feature-owned action and recovery APIs | action ID, provider deposit ID, optional transaction hash | Recovery stays inside cash-out; no unified row |
| Card purchases | not implemented | provider event ID must remain provider-owned | Future contract only; no events are added by #637 |

The existing feed correlates an action with an onchain transfer by transaction hash and keeps the transfer row. The proposal preserves that assumption. Cross-source composition still needs an owner-fenced integration follow-up; a presentation component must never guess that two records are the same.

## Stable presentation semantics

| Status | List label | Owner / meaning | Allowed next action |
| --- | --- | --- | --- |
| `waiting-customer` | Needs your attention | Customer must continue a known flow | Resume, resume verification, or view payment instructions |
| `waiting-provider` | Waiting for provider | Provider has the work | None |
| `waiting-chain` | Pending on Base | Transaction was submitted | None; explicitly wait rather than retry |
| `waiting-home` | Home is finalizing | Home is reconciling a result | None |
| `confirmed` | Confirmed | Success is established by the authoritative source | None |
| `failed` | Failed | Failure is established; success is not implied | Retry only when the feature explicitly says retry is safe, or contact support |
| `expired` | Expired | The reviewed intent can no longer be used | Start again |
| `ambiguous` | Check status | Outcome is unknown | Contact support; never retry from the ledger |
| `reversed` | Reversed | The original movement was reversed | Withdraw returned funds only when cash-out owns that recovery |
| `refunded` | Refunded | A later return is established | None |

The exported action matrix fails closed: an invalid status/action pair is not rendered. Verification wording reuses the selective shared cause language approved in #635 only when a real funding/provider gate owns it. Chain pending, quote expiry, cash-out withdrawal, card decline and other operational states remain feature-owned.

## Item and detail contracts

Every item supplies:

- a source-owned canonical ID;
- one family: onchain transfer, Home action, funding order, cash-out order, or card;
- an authoritative timestamp plus an already localized display label;
- one status and, only when valid, one next action;
- an already localized **exact** amount string;
- one family-specific detail contract.

The five detail contracts expose only actionable facts:

- transfer: network, from, to, transaction;
- Home action: operation, network, action ID, optional transaction;
- funding: provider, payment method, order ID;
- cash-out: provider, payout method, order ID;
- card: merchant, safe card label, provider reference.

Owner identifiers, provider payloads, compliance prose and internal protocol state do not belong in presentation input. Callers must owner-fence before constructing items and must pass privacy-safe values. The component does not format, round, infer a sign, synthesize an ID, deduplicate, dispatch money, or claim success.

`correlatedSourceCount` is optional presentation evidence for a composition layer that already correlated records. It renders one “Matched confirmation” hint; it is not a deduplication mechanism.

## Home attention affordance

`ActivityNeedsAttention` renders only for `waiting-customer` with an allowed next action. It names the first continuation and optionally states the count. Provider, chain, Home, ambiguous and terminal states render nothing, so Home does not become an alarm wall or an alternate action authority.

## Storybook review matrix

`proposal-activity-ledger` includes deterministic scenarios for mixed chronology; all pending owners and terminal states; upstream deduplication; partial-source failure; all detail families; Home attention; long localized content; 200% text; and 390px, 320px and desktop layouts. Its Back/Close play function asserts focus restoration. The reduced-motion story is a stable target verified separately with real-browser `prefers-reduced-motion` emulation; it does not force that operating-system preference itself. Card rows are future presentation fixtures only.

The stories prove the production components and contracts in isolation. They do not prove routing/history, source integration, reload/relogin, owner fencing, provider behavior, card events, or money recovery. Those remain integration work after design acceptance.
