# Card design proposal (#636)

**Status:** Unreviewed proposal; Jesse selects.

## Frame

The Card tab covers what a US card customer expects. The capability map puts comparable features in one place and records whether Home v1 includes them. The landing stays lean: Your card holds Lock, Spends from Cash, phone wallet while eligible, and a Card settings entry. The settings screen groups the rest without displaying deferred controls. Lock replaces Freeze with a lock glyph and a Locked pill on muted card art. Outage uses the shipped header status; verification uses staged progress; Not issued offers benefits, a CTA and an illustration slot for #896. Sheets follow one spacing spec. This proposal does not move money or choose a provider (#566). Help offers Lock and Replace; support arrives with #813.

## Capability map

Coinbase Card and Ramp are not on Mobbin; Brex and Mercury stand in as corporate-card comparables. “Provider” means the capability depends on what the #566 provider exposes.

| Capability | Apps with it | Covered | Home v1 | Reason |
| --- | --- | --- | --- | --- |
| Lock / freeze card | Revolut, Monzo, Mercury, Chime, Cash App, PayPal, Starling (N26, Lloyds, Zopa earlier) | yes | **In** | The most-used control. It is instant and reversible. |
| Show number / CVV / expiry | Revolut (Showing card details), Monzo, Mercury (Card detail), Lloyds | yes | **In** | The data appears only in the provider-hosted secure view. |
| Spend source + available | Revolut (Spend from), Monzo (Paying from) | yes | **In** | Available = Cash − pending holds. |
| Phone wallet provisioning | Cash App (Adding a card to Apple Pay), Starling (Mobile wallets) | yes (variant) | **In** where supported | Provider and OS dependent. |
| Replace card / report lost or stolen | Chime (Replacing a card), Starling (Cancel and replace), PayPal (Report lost or stolen) | yes (new) | **In**, conditional | Security response to an unrecognised purchase; a virtual card gets a new number immediately. Needs provider reissue (#566). See Q2. |
| Cancel / terminate card | Revolut (Terminate), Mercury (Canceling), PayPal, Starling | yes (new) | **In**, conditional | Same dependency as Replace. Afterwards the tab returns to Not issued. |
| Spending limits (view / edit) | Revolut (Limit), Mercury (Editing card limit), Monzo (Limits), Wise (Changing spending limits), Starling | no | Out | Limits are set by the provider and unknown until #566. The Spending section reserves a slot. |
| PIN (view / change / reset) | Mercury, Chime (Resetting PIN), Cash App (Change PIN), Starling (PIN reminder), PayPal | no | Out | A virtual-only card has no PIN. It returns with a physical card. |
| Online / ATM / contactless toggles | Wise (Changing card controls), Starling (Card controls), Up, ANZ Plus | no | Out | The virtual card works online and in the wallet only. ATM does not apply. Provider dependent. |
| International / abroad toggle | Chime (Turning on international transactions), Starling (Going abroad?) | no | Out | Provider and region dependent (#566). |
| Merchant / category blocks | Cash App (Blocked businesses), Kit (Blocking a merchant), Starling (Gambling controls) | no | Out | Needs provider merchant controls. Slot reserved in Spending. |
| Subscription blocking | Revolut (Blocking a subscription) | no | Out | Needs provider merchant controls. |
| Name / customise card | Revolut (Customize) | no | Out | There is only one card. |
| Multiple / disposable virtual cards | Monzo, Revolut (Getting a virtual card), Brex (Creating a new virtual card) | no | Out | One card per person in v1. |
| Physical card order / activate | Chime, Cash App (Ordering, Activating), Dave (earlier) | no | Out | Virtual-first. Physical needs provider and fulfilment decisions. |
| ATM locator | Cash App (ATM locations), PayPal (Find an ATM) | no | Out | No physical card. |
| Purchase notifications | Apple Card (Transaction notifications) | no | Out | Home has no push channel today. |
| Transaction detail | Revolut, Apple Card (Transaction detail), Cash App (Receipt detail) | yes | **In** | Recorded Activity events. |
| Pending / refund / reversal states | Revolut, Apple Card (Transaction detail) | yes | **In** | Recorded, with one next step each. |
| Decline with reason + next step | Cash App (payment failed), Zomato, Warby Parker (earlier) | yes | **In** | Declined-locked and declined-insufficient. |
| Self-serve transaction help | Monzo (Transaction help), Cash App (Reporting an issue), Apple Card (Report an issue) | partial | **In, reduced** | Offers Lock and Replace only, the help that exists. |
| Disputes / chargebacks | Chime (File a dispute), Brex (File a dispute), Apple Card (Report an issue) | no | Out | Needs a provider dispute API (#566) and support (#813). |
| Contact support / chat | Cash App (Reporting an issue), Monzo (Transaction help) | no | Out | No in-app support until #813. |
| Receipt download / invoice | Revolut (Downloading an invoice), Cash App (Receipt detail) | partial | Out (download) | The detail sheet is the receipt. There is no export. |
| Statements | Apple Card (Statements), KOHO (Monthly statements) | no | Out | Statements belong to the Cash account across Home, not to Card. |
| Rewards / cash back / offers | Chime (Cash back), Cash App (Offers), Apple Card (Rewards & offers) | no | Out | No rewards programme, so nothing is promised. |
| Card intro / benefits | Cash App (Meet the Cash App Card) | yes (Not issued) | **In** | Borrow the headline, benefit lines and one CTA; no legal copy. |
| Staged verification / card progress | Cash App (Identity verification), bunq (Verifying my account), Wise (Card) | yes (new) | **In** | Uses staged steps, like cash-in and cash-out. |
| Region gate | none | yes | **In** | Unchanged. |

## Settings structure

The landing keeps one Your card block: Lock card, Spends from Cash, Add to phone wallet (only when eligible), and Card settings. The nested Card settings screen keeps the Card tab current, with Back returning to the landing. **Spending** holds Spends from Cash. **Phone wallet**, in wallet variants only, holds Add to phone wallet or a non-actionable In your phone wallet row. **Card** holds Replace card and Cancel card, each opening a confirmation sheet. Deferred limits, international and merchant controls, subscriptions, PIN, physical card, notifications and support do not render as disabled rows.

The Replace card row says “Lost, stolen or not yours”. Replace asks “Replace card?” and says “Your current number stops working now. You'll get a new number to use instead.” Cancel asks “Cancel card?” and warns that the card stops working for good while Cash stays in Home. These provider-dependent actions are proposal-only.

## Locked state

Lock replaces Freeze throughout Card: a legible lock icon instead of a snowflake, a muted card with masked last four, no brand square and a top-left Locked badge on the small card art, a Lock card switch (on = locked), and success toasts “Card locked” / “Card unlocked”. The amount remains available; locking does not move money. The locked decline says “Declined because your card was locked”, “Nothing was charged”, and offers Unlock card followed by Get help. During an outage, Lock and details are disabled but Add money remains available; the header status owns Retry.

Every primary Add money button on Card uses the same “+” glyph as Home, drawn in the primary-foreground color on the primary button (Jesse, 2026-09-25).

## Verification stages

Getting your card shows four ordered steps: Card requested (complete, Today, 9:38 AM), Verify your identity (current, Takes about 2 minutes), Checking your details (upcoming), Card ready (upcoming). Verify is the only CTA. In review, identity is complete at Today, 9:41 AM; Checking your details is current, Started 9:41 AM; there is no CTA or unbacked ETA. The current step is announced via `aria-current="step"`; its icon does not spin. A failed verification stage awaits the provider decision.

## Not issued

One card presents the static illustration slot “Illustration (#896)”, “Spend your Cash with a card”, four short benefits (online spend, instant Lock, Activity, supported phone wallets), and Get your card. The shared feature-intro pattern belongs to #895; the illustration belongs to #896. No animation or legal copy is proposed here.

## Standard sheet spacing

| Part | Spec | Code |
| --- | --- | --- |
| Handle | Drawer default | `showSwipeHandle` |
| Header inset | top and sides `space/4` | `DrawerHeader` default `p-4 pb-0` |
| Title → description | `space/2` | `gap-2` |
| Header → first content block | `space/4` | content `pt-4` |
| Content side inset | `space/4` | `px-4` |
| Unbordered summary → next block | `space/6` | summary `pb-3` + content `gap-3` |
| Bordered block → bordered block | `space/3` | `gap-3` |
| Rows inside a block | flush list card, no dividers, minimum 44px | `CardContent inset="list"`; row `min-h-11 px-3 py-3` |
| Content → footer | `space/4` from footer top padding; `space/1` scroll bleed clearance keeps the final border visible | content `pb-1` |
| Footer | `space/4` sides and top; `space/2` between 44px buttons | `DrawerFooter` default `p-4 gap-2` |
| Bottom safe inset | `space/4` + safe area (Figma frames draw it as `space/8`) | DrawerFooter default safe-area padding |
| No-footer Get help | content `space/4` + safe area | content bottom padding |

Purchase sheets put the amount and badge before any reason alert and then the detail rows. Declines use a destructive reason alert; Pending uses a neutral one. Card details puts large masked art before Name on card and Type; the provider-hosted secure view owns full card data.

## Reconciliation

**Money model (#634):** Available to spend is Cash minus pending card holds, not a holding or another part of Total balance. Home keeps Total balance and Cash as today; held money is counted once in Cash until settlement. The landing shows both the available amount and the Spends from Cash value with the pending hold. Declines move no money and show unsigned muted amounts; reversals release a hold and are also unsigned and muted. Refunds are money in (`market-gain`). No event amount uses `destructive`.

**Activity taxonomy (#637):**

| Event | Row context | Value / tone | Sheet next step |
| --- | --- | --- | --- |
| Pending purchase | `Pending · Today` | `−$6.50` default | Wait for merchant or hold release; Get help |
| Settled purchase | `Today` / date | `−$42.18` default | Get help |
| Declined — locked | `Declined · Yesterday` | `$18.20` muted | Unlock card (only while locked); Get help |
| Declined — not enough | `Declined · Today` | `$64.10` muted | Add money; Get help |
| Reversal | `Reversed · Sep 19` | `$100.00` muted | Released to Cash; Get help |
| Refund | `Refund · Sep 20` | `+$9.99` success | Refunded to Cash, original purchase shown; Get help |

Get help offers only Lock card and Replace card; support is deferred until #813. The entry point for in-app support (#813) is a row appended to the Get help block.

## Open questions

1. Lock or Freeze? This proposal recommends Lock; Jesse selects.
2. Replace and Cancel in v1? Both depend on provider reissue and termination support (#566).
3. Phone wallet entry on iOS: Home row or Apple's required Add to Apple Wallet badge where required?
4. Spending limits: provider-set read-only in v1 or deferred until #566?

The failed verification stage and the state after Cancel depend on the provider; neither is drawn. Jesse's review of the unreviewed proposal is still pending.

## Frames and stories

The Figma Card frames cover the landing and states, settings, confirmations, purchase detail variants, and Get help. There is no separate “Get help (outage)” frame and no settled-purchase frame in Figma; `OutageGetHelp` and `SettledPurchase` are Storybook-only states.

Storybook (`explorations-card--*`, an unwired exploration rather than a production journey) includes: `Active`, `ActiveDesktop`, `Locked`, `LowAvailable`, `Outage`, `Loading`, `NotIssued`, `VerificationRequired`, `VerificationInReview`, `RegionUnavailable`, `WalletEligible`, `WalletAdded`, `CardSettings`, `ReplaceCard`, `CancelCard`, `OutageCardSettings`, `CardDetails`, `DeclinedLocked`, `DeclinedInsufficient`, `PendingPurchase`, `SettledPurchase`, `Refund`, `Reversal`, `GetHelp`, and `OutageGetHelp`. Outage is an orthogonal story arg, so `OutageCardSettings` renders a wallet-eligible customer during an outage with Add to phone wallet, Replace card and Cancel card unavailable.
