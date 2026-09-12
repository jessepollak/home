# Balances inventory architecture

Status: **locked summary** (2026-09-09). Phase A is in the tree via [#77](https://github.com/jessepollak/home/issues/77) / [#80](https://github.com/jessepollak/home/pull/80). Full research (options tables, risks, evidence) stays on [#76](https://github.com/jessepollak/home/issues/76#issuecomment-5594452047) — do not copy it here.

Current tree: [portfolio](portfolio.md) · [CDP SQL](cdp-sql.md) (history only) · [build status](build-status.md). Destination: [target architecture](target-architecture.md).

## Problem

Home’s Balances path used request-time multi-call `eth_call` / `eth_getBalance` against rate-limited public Base RPC. Later batch items hit `-32016` and rendered **Unavailable** on cash rows ([#69](https://github.com/jessepollak/home/issues/69) / [#75](https://github.com/jessepollak/home/pull/75)). CoinbaSeQL cannot replace balances — the public CDP SQL schema has no balances table. Inventory stays separate from pricing/FX and from presentation.

## Locked decisions (2026-09-09)

1. **Q1 Phase A** — CDP Token Balances for allowlisted directs (not Alchemy on the hot path). Impl [#77](https://github.com/jessepollak/home/issues/77) / [#80](https://github.com/jessepollak/home/pull/80). Narrow pinned-block RPC remains for Morpho `asset()` + `convertToAssets`.
2. **Q2 Phase C** — budget Alchemy/QuickNode when CDP multi-address / rate limits are exceeded.
3. **Q3 Ponder** — out unless Jesse later accepts a second runtime.

Fail-closed stays: true provider failure → `unavailable`; successful zero stays ready `0`; never invent balances. A CDP omission is not contract authority for configured ERC-20s: the current Phase A path uses cash-first bounded `balanceOf` recovery only through configured `BASE_RPC_URL` (maximum 20 deduped contracts and two attempts each), retains completed singles across its own stage timeout, propagates caller cancellation, and never falls through to the public default. Session boundary unchanged.

## Phases

- **A** — Kill public-RPC fragility: Token Balances for authoritative listed directs + bounded configured-RPC recovery for omitted ERC-20s + narrow Morpho convert RPC. **Shipped** in #80; authority recovery corrected in #259.
- **B** — Near-real-time after money actions: Neon inventory snapshot; invalidate + refetch on send/trade/fund/Morpho reconcile.
- **C** — Live updates: CDP webhooks first; Alchemy/QuickNode as scale-out. Same inventory snapshot contract.

Full options evidence, risks, and phase detail: [the #76 research comment](https://github.com/jessepollak/home/issues/76#issuecomment-5594452047).
