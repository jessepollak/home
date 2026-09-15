# Borrow

Jesse-locked September 13, 2026 ([#395](https://github.com/jessepollak/home/issues/395)). Updated September 14, 2026 for the direct market-card and MoneyModal experience.

## Launch boundary

Borrow projects its approved markets from the operator-controlled, compile-time [verified Morpho registry](morpho-markets.md) on Base. The registry—not Morpho API discovery, protocol listing state, or a permissionless catalog—controls which markets Home shows and enables for new risk. Launch enables only the verified Morpho USDC/cbBTC isolated market. The reader, shared integer math, calldata builders, and action preparation remain market-parameterized.

Removing or warning a market must not remove management access for an existing position. Operators retain its trusted registry tuple and change it to `reducing-only`; repay (including full repayment), add-collateral, and zero-debt collateral withdrawal remain available when their required reads verify, while borrow-more and debt-bearing collateral withdrawal remain blocked. Repay-all and atomic close remain supported backend operations, but are not separate visible actions.

Every market read and action prepare verifies `idToMarketParams` against the trusted registry tuple at a pinned block. The server derives the owner, `onBehalf`, receiver, Morpho deployment, tokens, oracle, IRM, and LLTV. It simulates the exact ordered Coinbase smart-account batch and reconfirms the pinned block hash. The client sends only a configured market id, an operation, and decimal-integer base-unit amounts.

## Borrow interface

Signed-in users open Borrow at `/borrow`. The overview shows one friendly card for every enabled registry market, whether or not the owner has debt. The Bitcoin card uses the Bitcoin display name while exact token amounts continue to say `cbBTC`. A missing cbBTC balance leaves the market visible but disables Borrow; it does not redirect to another product.

An active position stays on the same market card. Borrow more and Repay are the primary actions; Add collateral and Withdraw are the only management actions. The same minimum action set remains visible when liquidation risk is urgent, with risk-increasing actions disabled. Partial and unavailable reads remain explicit and are never presented as zero.

The `market` query parameter is still accepted for configured registry ids, but it opens the direct Borrow MoneyModal rather than the deprecated dense market inspector. Home does not show LLTV, raw protocol-limit rows, contract facts, or a separate detail dashboard on the Borrow product surface.

## Opening and reviewing a position

A user without a position enters the USDC amount first. Available borrowing is derived with pure shared bigint math from the verified wallet cbBTC balance, current market liquidity, Morpho share rounding, and Home's `1.25` hard health-factor floor.

Home automatically derives the least collateral that targets health factor `1.50`. If the requested amount cannot reach `1.50` with the wallet balance but can still satisfy the `1.25` hard floor, Home uses the available wallet collateral. It does not lock the whole wallet by default. Before review, the modal states the exact cbBTC amount that will be locked and that collateral cannot be withdrawn while it backs the debt. The existing atomic supply-and-borrow action still sends an explicit collateral amount.

Liquidation risk is presented as price-drop buffer: `buffer bps = (health factor - WAD) * 10000 / health factor`. With no debt there is no meter. The visual meter clamps at 50%, includes 20% floor and approximately 33% healthy ticks, and exposes an accessible meter value. User copy says “Bitcoin can fall X% before liquidation,” with liquidation price as optional secondary information. Numeric health factor is secondary position text only.

Borrow review is concise and server-authored. It shows the primary amount, exact spend/receive or repay movements, the projected liquidation buffer, the variable rate from the fresh prepared snapshot, Network Base, and compact server warnings. Prepared reviews expire after two minutes and must be prepared again before confirmation.

Repay is one smart flow. An amount below current estimated debt prepares an exact partial repayment and warns that debt remains. Max, or an entered amount at or above current estimated debt, prepares repay-all with current borrow shares and a finite wallet-bounded maximum, so it does not show the partial-repayment warning. If wallet USDC is below debt, Max remains an exact partial repayment. The full-repayment client buffer is approximately one hour of rate-based debt accrual plus one base unit; the server remains authoritative over exact borrow shares, finite approval, simulation, and the reviewed maximum. Atomic close remains backend-supported but is not presented as a separate user primitive.

## Private APIs

- `GET /api/borrow` returns version `1`: configured opportunities, verified non-zero positions, owner/provider scope, and truthful complete/partial discovery. A failed market read is `unavailable`; it is never a zero balance or zero position.
- `GET /api/borrow/markets/:marketId` returns version `1`: exact market identity, pinned source block, market state, wallet state, accrued position, raw protocol limits, and Home policy-adjusted limits. The product uses this data to power the card and direct modal, not a detail inspector.
- `POST /api/actions/prepare` supports add collateral, borrow, atomic supply-and-borrow, partial repay, capped share-based repay-all, collateral withdrawal, and atomic close. Borrow prepared metadata includes the fresh `borrowAprWad` used by confirmation.

Confirmation stays the shared thin commit of the stored calls. It performs no Borrow-only preflight.

## Risk and approvals

Risk-increasing actions that leave debt must have projected health factor `>= 1.25`. The opening flow targets `1.50`; `1.25` is a hard floor, not the default target. The shared `1.10` critical threshold is retained. Zero-debt closes and withdrawals are not subject to the floor.

Approvals are finite and exact. Home does not issue unlimited approvals and does not issue `approve(0)` before `approve(exact)`; incompatible assets are not enabled.

## Current limitations

The bounded overview verifies registry candidates only. With one launch market this is complete for the supported product boundary. Adding recovery for positions outside the retained registry requires a separately trusted candidate source and must not turn third-party discovery into transaction authority. There are no background liquidation alerts, live-provider tests, or funded-wallet CI tests.
