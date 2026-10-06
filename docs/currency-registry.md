# Home — currency registry and promotion path

Status: normative registry contract. One reviewed change promotes one exact asset identity.
Checked: 2026-10-04
Related: [regional money](regional-money.md), [currency defaults](currency-defaults.md), [balances](balances.md), [activity valuation](activity-valuation.md), [codex prices](codex-prices.md), [gates](gates.md).

Home keeps one server-owned record per currency representation in `apps/web/shared/currencies/registry.ts`. Cash and portfolio presentation, contract-to-currency lookup, valuation eligibility and conversion eligibility are derived from it; no screen, route or module keeps its own currency list. Adding a currency is a reviewed registry change, not a per-screen edit.

## Admission states

The three states advance independently. A more permissive state never grants a narrower one.

| State | Meaning | Record field |
|---|---|---|
| Observed identity | Home can identify an existing holding exactly: chain, contract, decimals, symbol, display currency, issuer and provenance. | The record exists. |
| Approved Cash representation | Holdings join grouped currency balances, currency details and the direct portfolio inventory. | `cash.state: "approved"` |
| Convertible pair | A verified source/destination route exists for one exact pair, in one region set, with quote and execution support. | A `ConvertPairRecord` with `status: "verified"` |

A record that is approved for funding or Cash display is never implicitly tradable. Pairs are directional: a verified `currency → USDC` exit does not admit `USDC → currency` buys until the reverse pair is independently verified. Both directions must be verified before a currency is selectable in the Convert picker or tradable; the picker still lists every approved Cash currency, and one without both directions stays in Cash with Convert unavailable and an accurate reason. The Convert entry point itself is offered only while at least one local currency is admitted, so pausing every route removes the entry rather than opening an empty picker. A pair can be paused while the balance stays visible.
A record reaching the direct portfolio inventory (Cash approved, paused or withdrawn) must retain approved `send` and `valuation` capabilities. For a paused or withdrawn lifecycle, Cash approval is off; Send and valuation remain approved with evidence for exit and pricing. Pausing Cash removes its grouping but preserves its holding and Send exit; pausing valuation or Send instead fails the registry drift check.

The current model admits exactly one approved Cash representation per currency. The drift check refuses a second approval; supporting several issuers for the same currency requires an explicit model change.

## Registry records

Each record carries the exact chain id, contract address, decimals and token symbol, the display currency code, the issuer and its documentation, dated provenance, a lifecycle state (`active`, `paused`, `withdrawn`), display aliases, and one capability check each for `cash`, `send` and `valuation`. Capability checks are `approved`, `deferred`, `paused` or `withdrawn`; `approved` requires a dated check (`verifiedAt`) and `evidence`, and `deferred`/`paused`/`withdrawn` require a `reason`, with a `reference` when the state is deferred. Provenance and approved-capability verification dates must be real, round-tripping `YYYY-MM-DD` calendar dates and not in the future.

A funding-backed record takes its id, chain, contract, decimals, symbol and display currency from the funding registry (`apps/web/shared/assets/base.ts`), never retyped, so a currency and its funding route cannot drift apart; its display name is the currency's own name, with the token symbol carried separately on the row and in the detail. A currency without a funding route declares its identity directly.

`ConvertPairRecord` carries directional `from` and `to`, provider, region set (`"all"` or explicit region ids), `status`, `verifiedAt`, `evidence`, and a `reason` when not verified. Both endpoints must be Cash-approved representations. A verified pair requires its reverse to be verified as well, and must use `regions: "all"` until availability, preparation and the picker can evaluate a trusted region. Its verification date must be a real, non-future `YYYY-MM-DD` date.

A pair is admitted for at most 180 days (`CONVERT_PAIR_MAX_AGE_DAYS`) before it must be re-verified. Two rules read the same records: **admitting resolution** (`resolveConvertPair`, `convertDirectionAdmitted` and `convertCurrencyTradeable` in `shared/trading/assets.ts`) applies identity, status, region and the dated rule against the server clock, and gates trade availability, preparation and first confirmation; **presentation listing** (`convertPairListed`, `convertCurrencyListed`, `convertPickerEntries`) applies identity, lifecycle, region and pair status only, and the Cash Convert entry, its picker and the recorded-conversion classification never read a clock, so a wrong local clock can neither hide nor invent a conversion there. The invest trade entry points resolve eligibility through the admitting rule, where a device clock behind a pair's verification date hides the action rather than inventing one. Staleness fails the drift check and stops new quotes and first confirmations on the server, while a paused or withdrawn pair removes the Cash Convert entry itself.

The published records admit USD ↔ EUR, IDR, ARS, BRL and COP. EUR/IDR retain their shipped-route dates; ARS/BRL/COP carry the October 4, 2026 [read-only quote and execution-shape check](invest-data.md#ars-brl-and-cop-convert-verification). Only USD-paired directions are offered, never local-to-local. Every further pair needs its own dated check.

## Promotion path

1. **Verify first.** Confirm the contract address, decimals and symbol on Base, the issuer's redemption/peg model, the balance-indexing path, the valuation source, and region eligibility on the date of the review. Record the source and date. Do not promote from a ticker or a symbol match.
2. **Add or edit one record.** Set the identity, issuer, provenance (`source`, dated `verifiedAt`) and the capability checks. Approve `cash` only with an approved `valuation`; approve `send` only when the holding has a real exit path.
3. **Leave conversion alone.** Do not add a pair in the same change. Conversion is added by its own pair record after a dated quote and execution check for that exact pair, or the currency stays visible in Cash with Convert unavailable and an accurate reason (`pair-missing`, `pair-paused`, `pair-stale`, `region-ineligible`).
4. **Run the drift checks.** `bun run test` runs the registry drift test; `bun check` runs it with the rest of CI. Inconsistent approved data fails the build rather than silently omitting a currency.
5. **Publish the operator facts.** A new currency with funding implications updates [regional money](regional-money.md) and the provider coverage it depends on.

### Operator verification checklist

Only checked capabilities become actionable. Check, do not assume:

- **Contract provenance** — issuer-published Base address, exact decimals measured onchain, symbol read from the token, and a documented issuer/issuance source.
- **Issuer redemption and peg** — how the representation is minted, redeemed and backed, and what happens if it depegs from the display currency.
- **Balance indexing** — the holding is enumerated by the balances universe and validates against the snapshot contract (id, key, name, symbol, decimals, contract, Cash currency).
- **Valuation** — an approved price source exists for the contract, so a promoted holding is priced rather than shown unpriced.
- **Region eligibility** — the currency is a configured display currency and the operator's regions setting allows it; publish verified pairs only with `regions: "all"` until the trade execution path has a trusted region.
- **Provider quote and liquidity** — a quote exists for that exact pair on the exact pair record, with minimum received and expiry, and the operator's policy allows it.
- **Exact execution path** — the pair's route is the reviewed one (source asset, destination asset, spender and calldata), never a runtime-discovered route.
- **Error, recovery and rollback** — the failure and retry states, and the pause path below, are exercised before promotion.

## Drift checks

`apps/web/shared/currencies/drift.ts` validates records and pairs; `apps/web/shared/currencies/drift.test.ts` runs it over the published registry and over synthetic fixtures for each finding. Findings:

- `missing-funding-record` — a funding asset with no registry disposition.
- `unknown-funding-id` — a record's funding id is unknown, or its identity differs from the funding registry's.
- `duplicate-identity` — a repeated record id or contract address.
- `duplicate-alias` — an alias claimed twice, a bare currency code on a record that is not the approved Cash record for that currency, or two approved records for one currency.
- `undispositioned-record` — any deferred, paused or withdrawn capability lacks a reason, or a deferred capability lacks a reference.
- `invalid-identity` — a record whose contract address is not a valid Base address because of bad length, hex, or mixed-case checksum.
- `invalid-decimals` — a record whose decimal scale is not a safe integer in 0..255.
- `invalid-provenance` — a missing source, invalid or future verification date, or untraceable source on a non-funding record.
- `missing-capability-evidence` — an approved capability with missing, invalid or future dated evidence, or a verified pair through a paused or withdrawn asset.
- `lifecycle-conflict` — a paused or withdrawn record still has approved Cash.
- `missing-valuation` — an inventory record without approved valuation.
- `missing-exit-capability` — an inventory record without approved Send exit.
- `unknown-pair-asset` — a pair referencing an unknown asset.
- `undispositioned-pair` — a paused or withdrawn pair without a reason.
- `invalid-pair` — a self-pair, a duplicate pair key, or a verified pair with missing, invalid or future dated evidence.
- `stale-pair` — a verified pair older than the maximum age.
- `pair-incomplete` — a verified pair without a verified reverse direction.
- `region-scoped-pair` — a verified pair with a region set other than `"all"`.

## Lifecycle, pause and rollback

| From | To | Action hidden | Existing holding |
|---|---|---|---|
| Pair verified | Pair paused | Convert for that currency; first confirmation re-evaluates admission from stored metadata and fails closed; already-confirmed actions replay stored calls | Visible; no exit change |
| Pair verified | Pair withdrawn | Convert for that currency; first confirmation re-evaluates admission from stored metadata and fails closed; already-confirmed actions replay stored calls | Visible; no exit change |
| Pair verified | Untouched, 180 days old | New quotes and first confirmations (`pair-stale`) on the server; the dated evidence is refreshed before CI passes | Visible |
| Cash approved | Cash paused or withdrawn | Cash grouping and new acquisition | Still in the portfolio inventory for exit |
| Any record | Record removed | Cash grouping and Convert; a prepared trade refuses its first confirmation (`TRADE_ADMISSION_REVOKED`, 409) from the stored currency identity | Shown through catalog/wallet discovery; the promotion is reverted; an already-confirmed action replays its stored calls |

Pausing or withdrawing a pair blocks new prepares and the first confirmation, which re-evaluates admission from the stored metadata and fails closed with `TRADE_ADMISSION_REVOKED` (409), distinct from quote or review expiry (`ACTION_EXPIRED`). The client shows the conversion as unavailable with a way back and no automatic re-quote or Get new quote; already prepared calls are not rewritten, and an already-confirmed action replays its stored calls subject to the existing replay checks. A trade records the registry currency it was prepared against, so the first confirmation still fails closed after that record is removed, while a genuine non-registry token keeps its existing gates. A known-identity or deferred currency has no generic trade exit: it needs verified routes or a record rollback. Pausing or withdrawing Cash removes grouping but retains the portfolio holding, approved valuation and approved Send exit. Removing a record rolls back promotion and drops that holding from the registry inventory; catalog/wallet discovery may still display it, and a draft prepared before that identity was stored keeps the previous behaviour for the rest of its review window. Outside the hot window, the server refuses a stored balances row whose registry inventory differs from the current registry and performs a full re-observation before serving it. During the short hot-snapshot window after an action, the registry portion is re-read; a stored catalog/wallet holding for a now-registry-owned contract is dropped instead of merged, so the fresh registry holding wins without forcing a full observation. Every conditional-write winner is also checked against the current registry before it can be served; a mismatched winner gives way to the fresh observation.
Admission is compiled into each deployment, so when [Skew Protection](vercel-deploy.md#skew-protection) is enabled, a request pinned to an older deployment uses that deployment's registry until the pin expires, and a pause reaches pinned clients within that window rather than instantly.

The direct inventory asserts one entry per asset key and projected id, and the balances universe and expectation map assert the same across direct assets and vaults, so a promotion whose identity collides with an invest or vault id fails before any snapshot is served rather than overwriting an entry. Historical transfer valuation keeps a record's peg when support is paused or withdrawn and drops it only for a record that was never promoted (deferred), and historical conversion classification matches the exact preserved, non-deferred registry identities plus a declared pair record for that direction, so pausing or withdrawing a currency's Cash representation, lifecycle or pair leaves recorded conversions labelled `Converted <from> to <to>` while a never-promoted (deferred) record or a currency that never had a pair record is never classified as a conversion.

## Consumers and migration status

| Consumer | Source | Status |
|---|---|---|
| Cash grouping and currency order (`shared/balances/select.ts`) | registry via the portfolio projection | migrated |
| Direct portfolio inventory, transfers and Send (`config/portfolio-assets.ts`, `shared/transfers/transfer-helpers.ts`) | registry | migrated |
| Balances universe and snapshot expectations (`server/balances/universe.ts`, `shared/balances/contract.ts`) | registry-derived inventory | migrated |
| Activity peg currency and valuation (`shared/activity/valuation.ts`) | `pegCurrencyForContract` (identity: keeps a paused or withdrawn peg) | migrated |
| Amount units in borrowing and savings (`client/borrowing/borrow-money-dialog.tsx`, `client/savings/savings-journey-step.tsx`) | `cashCurrencyForContract` (current Cash presentation) | migrated |
| Add money's supported regional asset (`client/funding/add-money-dialog.tsx`) | registry | migrated |
| Trade and Convert asset admission (`shared/trading/assets.ts`) | registry pair admission | migrated; a registry cash contract is tradable only with both directions verified |
| Cash Convert entry, destinations and review (`shared/trading/cash-conversion.ts`, `client/cash/cash-overview.tsx`, `client/cash/cash-currency-sheet.tsx`) | `convertCurrencyListed` for each currency's `convertOffered`, and the published pair records for classification | migrated; a paused, withdrawn, unverified or half-verified pair removes the Convert action for that currency and shows the accurate reason in its place, the currency stays listed in the picker and in Cash, and the holding stays visible |
| Invest holdings, stock eligibility and market prices (`config/invest-assets.ts`) | separate product catalog | exception: financial instruments, not currencies; not part of this registry |
| Save vaults (`BASE_MORPHO_USDC_VAULTS`) | separate vault inventory | exception: USDC vault shares, not a currency identity |

## Current dispositions

USD (USDC), EUR (EURC), IDR (IDRX), ARS (wARS), BRL (wBRL) and COP (wCOP) are approved Cash representations with approved valuation and exit. The Argentine peso, Brazilian real and Colombian peso identities come from the funding registry with the currency name from the presentation regions and the token symbol on the row and in the detail; their promotion is the ARS/BRL/COP expansion (#1494). Five bidirectional pairs are verified: USD ↔ EUR, IDR, ARS, BRL and COP. The ARS/BRL/COP admission (#1636) uses their exact funding-registry Base identities (18 decimals each) and dated checks at 1 and 10 USDC reference sizes. Their Convert picker rows are selectable when private trade availability allows them; holdings, Send and valuation are unchanged. Quotes remain amount- and time-dependent, and every prepare still validates the complete money-path invariants. No local-to-local route is admitted. The verification is read-only: no signature, broadcast or funded conversion was performed.
