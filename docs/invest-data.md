# Invest data boundary

Verified: September 25, 2026

In Invest, any exact Base ERC-20 other than canonical USDC or a tokenized stock can request USDC-paired buys and sells through the shared action flow described in [Execution checkpoint](#execution-checkpoint-cdp-swaps). Each amount requires its own executable provider quote; catalog membership and a minimum-liquidity floor do not gate trading. Stocks display server-owned eligibility or not-routed status without offering execution through this path. Display prices require a source and timestamp but never authorize a trade; only chain execution identity and a verified quote can. Risk screening is deferred to #964.

## Display identity and token representation

The asset registry keeps a deliberately small distinction:

- `displayName` and `displaySymbol` are the familiar primary labels shown in the list, such as Bitcoin / BTC or NVIDIA / NVDA.
- `representation.tokenSymbol`, issuer, decimals when verified, relationship text, Base chain ID, and contract address describe the token that actually exists on Base.
- Contract identity is always `chainId + contractAddress`; neither a display ticker nor a token ticker is a contract identity.
- Price snapshots are labelled per represented token, for example “Per cbBTC token.” Home does not calculate a native-asset conversion, a stock-share multiplier, a stablecoin peg, or an executable redemption amount.

This is enough for the current seam and can also describe a local stablecoin or another tokenized stock without introducing a generalized instrument ontology. It does not change region eligibility or currency defaults. Registry and docs record the exact token symbol, network, and contract for builders. Product list and discovery UI must not surface contract lists, restriction notes, or disclosure blocks; those belong only under Account → Disclosures / Terms. Review or confirm may show the token symbol, network, and other facts needed to complete an action. A Bitcoin / BTC display label must never be treated as permission to send native BTC to a Base address.

## Tokenized stocks

The bounded launch roster follows the official Base stock page and its linked Base explorer contracts. These are Coinbase-issued Regulation S instruments. The server permits stock buys only when a trusted edge request country is present, valid, and outside the US and its territories (PR, GU, VI, AS, MP, UM); missing or invalid country fails closed. Stock sells to Base USDC remain allowed regardless of country. A country preference cannot unlock trading. The provider currently refuses stock routes, so eligible customers see a not-routed state rather than a trade control. Invest hub Stocks preview is the first `STOCK_PREVIEW_COUNT` (6) catalog entries; the Stocks category lists the full curated roster. COINc, CRCLc, and INTCc stay out until they appear on the product roster page.

| Company display | Display symbol | Base token | Base contract |
| --- | --- | --- | --- |
| NVIDIA | NVDA | NVDAc | `0xb20000000000000000000078ee7ce2fE4908108C` |
| Meta | META | METAc | `0xb2000000000000000000008bC8786B856E61707C` |
| Apple | AAPL | AAPLc | `0xb200000000000000000000C2e324d24d7eEcd1fb` |
| Alphabet | GOOGL | GOOGLc | `0xb2000000000000000000002D0BA3164cc74f58B7` |
| Amazon | AMZN | AMZNc | `0xb200000000000000000000d9192b6B456483C2E8` |
| Microsoft | MSFT | MSFTc | `0xB200000000000000000000Ab99cFa739E253872B` |
| Strategy | MSTR | MSTRc | `0xb2000000000000000000004884b426556b92883d` |
| SanDisk | SNDK | SNDKc | `0xb200000000000000000000397293Cb8cda9a10c5` |
| SpaceX | SPCX | SPCXc | `0xb2000000000000000000007b9fcbd005511aCBd5` |
| Tesla | TSLA | TSLAc | `0xb2000000000000000000001e800a7f5189430cD0` |

Primary sources:

- Official Base stock roster: https://www.base.org/stocks
- Base announcement and restriction summary: https://blog.base.org/tokenized-stocks
- Canonical contract identity: the Base explorer link attached to each instrument on the official roster; those links are preserved in `apps/web/config/invest-assets.ts`.

A familiar company ticker is only a display label. Coinbase’s token symbol and exact Base contract stay in the registry and builder docs, not on the Invest list. Corporate actions can alter a token-to-share relationship, and Home does not infer or execute par exchange.

The September 25, 2026 non-funded checkpoint checked only USDC ↔ cbBTC. Quotes, wallet compatibility, user eligibility and funded execution for other tokens remain unverified; a quotable route is not a completed trade.

## Execution checkpoint: CDP Swaps

CDP EVM Swaps is the first execution provider for exact Base ERC-20 ↔ canonical USDC (#616, #980). Server-only preparation uses the shared action framework. Private `GET /api/trades?assetId=<id>` reports provider, smart-account, signer, chain readability, token balance and buy-only operator policy; `POST /api/actions/prepare` issues a draft only after quote validation. Provider failures disclose no credential or raw provider details.

- **Contract.** CDP OpenAPI 2.0.0 as shipped in the pinned `@coinbase/cdp-sdk`: `GET /platform/v2/evm/swaps/quote` for a price estimate and `POST /platform/v2/evm/swaps` for an executable quote with a Permit2 payload and transaction. Every request is signed with a fresh 120-second JWT scoped to the method, fixed host and exact path. The POST uses its own random request key, never a Home action id.
- **Untrusted response.** `cdp-swaps.ts` rejects any non-conforming primitive. `quote.ts` accepts an executable quote only when the tokens and spend amount exactly match the requested direction; the minimum receive amount honours the requested slippage (1–300 bps); the quote block is at most 30 blocks older and at most 2 blocks newer than the current Base block; there is no balance issue; `simulationIncomplete` is exactly `false`; the Permit2 typed data matches the canonical Base domain, token, amount and a deadline no more than 30 minutes away and re-hashes to the provider hash; the Permit2 `message.spender` equals the transaction target; any allowance issue names canonical Permit2 (`0x000000000022D473030F116dDEE9F6B43aC78BA3`); preparation reads the taker's balance and Permit2 allowance from chain at the pinned Base block, rejecting insufficient balance (including a reported quote balance issue) and adding an exact approval only when chain allowance is below the spend amount; and the transaction sends zero value to the current taker-submitted 0x Settler published by the 0x Deployer registry (`ownerOf(2)` at `0x00000000000004533Fe15556B1E086BB1A72cEae`). Gas must be positive and at most 3,000,000. A mismatch surfaces as a typed reason (`below-minimum`, `no-liquidity`, `stale-quote`, `insufficient-balance`, `quote-rejected` or `unverified-actions`), never a partial review.
- **Settler calldata.** The executable quote is Settler `execute(slippage, actions, zid)` before the Permit2 signature is attached, so it is not strictly ABI-decodable: logical action 0 is `TRANSFER_FROM`, placed physically last with a `0xffff` length placeholder and a signature offset pointing past the end of calldata; confirm appends the signature length and bytes there. A strict parser checks that layout (contiguous zero-padded actions, no trailing bytes, exactly one `TRANSFER_FROM`), and the outer slippage record must name the taker as recipient, the pair's receive token and a minimum exactly equal to the reviewed minimum. Every action must then pass a selector-specific validator; an unknown selector or structurally invalid action reports `unverified-actions`, while a non-exact input-spend result reports `stale-quote`. Validated selectors: `TRANSFER_FROM` (token, amount, nonce and deadline equal the reviewed permit; recipient is Settler or a pre-funded pool), `BASIC` (either an ERC-20 `transfer` fee whose total matches the provider `protocolFee`, capped at 5%, or a pool swap that avoids the zero address, Permit2, the taker, the pair tokens and Settler as targets, requires whole-byte call data of at least four bytes, rejects token-movement and approval selectors, excludes taker, signer and Permit2 addresses anywhere in call arguments, and patches amounts only after the selector), `UNISWAPV2`, `UNISWAPV3`, `MAVERICKV2`, `RFQ` and `POSITIVE_SLIPPAGE` (receive token only, expected amount at least the quoted receive amount). Swap outputs must return to Settler or a pre-funded next pool, and at least one swap must sell the reviewed input token. Home zeros the inner `UNISWAPV2` `amountOutMin`, `MAVERICKV2` `minBuyAmount` and `UNISWAPV3` `amountOutMin` words in the reviewed call without changing any other calldata, because the outer Settler slippage record binds the reviewed minimum. RFQ maker permits must name the receive token on every route. On RFQ-only routes, maker permits must provide enough capacity in that token's integer base units to cover the reviewed outer minimum plus the larger of the quoted receive-token protocol fee and its fee-rate upper bound. Reused maker nonces are rejected on every RFQ route; RFQ-only routes must have enough input-spend coverage. For input held by Settler, Home walks actions in order from the reviewed amount: fees and AMM legs spend floor(balance × ppm / 1,000,000), while RFQ legs spend the lesser of their `maxTakerAmount` and the remaining balance. Every swap must sell the input token; multi-leg routes model only `UNISWAPV3` legs ending at the receive token and RFQ legs. A leg with no balance or a non-final RFQ above the remaining balance overfills; residual input underfills, and only the final RFQ may be clamped. RFQ in a pool-funded route is not modeled. Any non-exact result yields `stale-quote` so the user requests a fresh quote. The model assumes each AMM leg consumes its allotted input; pool liquidity or tick exhaustion cannot be proven from calldata and remains bounded by the outer slippage check. A transfer sent directly into a validated pool does not leave input in Settler. RFQ output sent directly to the taker is rejected because Settler checks only its own receive-token balance before transferring the reviewed minimum to the taker. An expired RFQ maker permit yields `stale-quote`; every maker deadline bounds review expiry. Before issuing review, preparation checks each RFQ maker signature against its Permit2 Consideration witness (EOA recovery or ERC-1271 at the pinned block) and checks that maker's Permit2 nonce bitmap at the same block. A malformed signature or used maker nonce rejects the quote; an unavailable chain read prevents review. The operator checkpoint also requires this check before reporting an RFQ as action-verified. Pools are not allowlisted, so the input leg relies on Settler's atomic final slippage check: if the taker does not receive at least the reviewed minimum of the receive token, the whole transaction, including the Permit2 pull, reverts.
- **Checkpoint result (September 25, 2026).** The non-funded checkpoint ran with the existing server `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` pair and authenticated successfully against both endpoints. For Base USDC → cbBTC (1 and 25 USDC) and cbBTC → USDC (0.00001 and 0.0003 cbBTC), price and executable quotes reported `liquidityAvailable: true`, the retained Permit2 validator accepted the typed data and hash, the Permit2 spender equalled the transaction target and the registry Settler, `simulationIncomplete` was `false`, and every action verified; readiness was `ready` where the quoted taker held the input token and `insufficient-balance` otherwise (exit `0`). A wider sweep of fifteen quotes from 0.5 to 500 USDC and 0.000007 to 0.005 cbBTC verified fourteen; one large sell routed through an unsupported `HANJI` action and correctly reported `unverified-actions`. Routes vary by amount and time, so an unsupported route fails closed and the customer must request a new quote. Fixtures in `quote.test.ts` are synthetic reproductions of the observed shapes, not provider payloads.
- **Execution.** Prepare reads the current Base block and registry Settler after the executable quote, rejects unsupported action selectors, and stores the reconstructed calls, Permit2 hash, signing request and final swap call index with a two-minute-or-earlier expiry bounded by the taker Permit2 deadline and every RFQ maker permit deadline (minus 30 seconds). Optional USDC network fee approval is prepended before any Permit2 approval. Confirm checks the owner signature and appends it to the reviewed swap call; the paymaster callback accepts only the confirmed exact batch commitment. No pool allowlist is applied: exact Permit2 scope, receive binding and Settler atomic slippage protect the reviewed minimum.
- **Customer flow.** An eligible token detail enables Buy and Sell only when private per-asset `GET /api/trades?assetId=` availability allows it for the verified session. A transient transport failure (network, 429 or 5xx) is retried twice with short backoff while the page keeps showing “Checking trading availability…”; a definitive unavailable answer or an exhausted retry disables trading with a short note, and a failed check is retried on refocus, reconnect and every 30 seconds without a reload. A buy-only operator block still leaves the sell path available. Review shows the spent amount, estimated `You get` and the USDC `Network fee` up front; `Details` reveals the traded contract with its full-address reveal, so a token with a lookalike name stays identifiable before confirming, plus the validated minimum, rate, max slippage, protocol fee (if any), live quote expiry, network and From address. An expired quote requires a new review. Completed trades converge through shared balances, Activity and the per-asset availability read (which carries the chain sell balance): each is refreshed when the transaction is submitted and again when balances settle. Activity details name the traded contract address, so two tokens that declare the same symbol stay distinguishable.
- **Remaining.** Bounded live buy and sell proof for #616.

### Any-token sweep at the live-rung size (September 26, 2026)

A read-only sweep (`--sweep --buy-usdc 0.10`, unfunded taker) quoted 14 tokens: cbBTC, cbXRP, cbDOGE, cbLTC, cbADA, cbZEC, cbHYPE, cbMEGA, DEGEN, TOSHI, BRETT, AERO, VIRTUAL and WETH. The provider returned an executable 0.10 USDC buy quote and a sell quote for every token. The configured Base RPC rejected every chain read (HTTP 401), so registry Settler matching and full action verification did not run. The only checks were the provider response, Permit2 compatibility and the parsed action selectors.

- **Known actions only (8 buys):** cbBTC, cbADA, cbZEC, cbMEGA, TOSHI, AERO, VIRTUAL and WETH buys routed through validated selectors only; so did cbBTC, cbMEGA and WETH sells.
- **`unverified-actions` (6 buys):** cbXRP, cbDOGE, cbLTC, cbHYPE, DEGEN and BRETT buys included Settler `UNISWAPV4` (`0xaf72634f`), which has no validator. Those routes fail closed as route-unavailable until a `UNISWAPV4` decoder with fixture tests lands.
- **Sells for an unfunded taker:** most sell quotes reported a balance issue, and their actions could not be inspected.

Every token is quote-verified only, not traded. No non-cbBTC funded trade has run.

### Borrow collateral sweep (September 27, 2026)

Borrow's Buy action trades the exact collateral contract from the Borrow registry, so the five collaterals were re-quoted with the same read-only sweep and an unfunded taker. Buys were quoted at 0.10 USDC, and cbXRP and cbDOGE also at 1 and 10 USDC. The configured Base RPC again rejected chain reads, so registry Settler matching and full action verification did not run.

| Collateral | Contract | 0.10 USDC buy route | Other sizes | Status |
| --- | --- | --- | --- | --- |
| cbBTC | `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` | `TRANSFER_FROM`, `BASIC`, `UNISWAPV2`, `POSITIVE_SLIPPAGE` | — | quote-verified, known actions only |
| cbETH (Staked ETH) | `0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22` | `TRANSFER_FROM`, `BASIC`, `UNISWAPV3`, `POSITIVE_SLIPPAGE` | — | quote-verified, known actions only |
| cbADA | `0xcbADA732173e39521CDBE8bf59a6Dc85A9fc7b8c` | `TRANSFER_FROM`, `BASIC`, `UNISWAPV3`, `POSITIVE_SLIPPAGE` | — | quote-verified, known actions only |
| cbXRP | `0xcb585250f852C6c6bf90434AB21A00f02833a4af` | includes `UNISWAPV4` (`0xaf72634f`) | 1 and 10 USDC: `BASIC` and `UNISWAPV3` only | provider routes; 0.10 USDC fails closed in Home |
| cbDOGE | `0xcbD06E5A2B0C65597161de254AA074E489dEb510` | includes `UNISWAPV4` | 1 USDC: `UNISWAPV4`; 10 USDC: `UNISWAPV4` and unrecognised `0xd92aadfb` | provider routes; Home fails closed as route-unavailable |

The provider returned executable buy and sell quotes with liquidity and a compatible Permit2 request for all five. The cbDOGE and small cbXRP blocker is Home's missing `UNISWAPV4` validator, not provider coverage. Sells for the unfunded taker reported a balance issue, so only the cbBTC sell route could be inspected (known actions). cbETH keeps its own identity: the Buy uses the cbETH contract, chain decimals (18) and the quoted cbETH amount, and it is never priced or shown as ETH. None of these has been traded.

### Run the checkpoint

The checkpoint is non-funded: it requests a price and an executable quote for each direction and never signs, stores or broadcasts anything. Run it only in an already provisioned, authorized operator environment:

```sh
bun run --cwd apps/web cdp-swaps:checkpoint --taker 0x<smart-account-address> [--token 0x<token-address>] [--buy-usdc 1] [--sell 0.00001]
```

Sweep multiple tokens with `--sweep --tokens 0x<token-a>,0x<token-b> --buy-usdc 0.10`; sell size is the token amount estimated by the buy-side price. Chain failure does not erase provider liquidity or parsed action selectors: `actionsVerified` is null, `chain` is unavailable and the command exits `2`. An unsupported Settler action is explicitly `unverified-actions` and exits `2`.

Execution trust boundary: token code, decimals and sell-all balance come from direct Base RPC at latest; configured catalog decimals must match chain decimals, and execution never uses market prices or wallet-index balances. Only a contract revert or a malformed answer makes a token unreadable; any other RPC error (rate limit, capacity, internal) is a temporary chain failure that availability retries. Before review, the current pinned block must still cover the exact full spend and Permit2 checks. A buy-only operator-removal seam is initially empty; selling remains attempted even when buying is blocked. The quote is a proposed execution, not evidence of a completed trade: only finalized chain activity can claim traded status. Customers receive distinct recovery for route unavailable, below minimum, token unreadable, blocked buy, insufficient balance, stale quote and temporary provider or chain failure.
It needs `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` from a CDP project with Swaps API access, Base RPC access through the existing `BASE_RPC_URL` setting (the public Base endpoint when unset), and the public address of a Base smart account to quote for. The taker need not hold funds; an unfunded taker is expected to report `insufficient-balance` readiness without counting as an incompatibility.

The command prints sanitized JSON: date, endpoint paths, schema label and, per direction, price and quote `liquidityAvailable`, Permit2 presence and compatibility, whether the Permit2 spender matches the transaction target, whether the target matches the registry Settler and calldata passes the Settler layout and outer slippage checks, `actionSelectors` (lowercase public ABI identifiers in order, or null when the layout does not parse or liquidity is absent), `actionsVerified`, `inputSpend` (the calldata input-spend model result: `exact`, `underfill`, `overfill` or `unmodeled`; null when the quote is illiquid, calldata or target does not match, actions fail structural checks, or chain data is unavailable; `exact` alone does not establish RFQ maker authorization), whether any allowance spender is Permit2, whether the outer quote-compatibility check passed and its reason, `simulationIncomplete`, a balance-issue flag and the validator's readiness reason. Compatibility applies every rule above except the balance issue, `simulationIncomplete` and action verification, so an unfunded taker cannot hide a wrong allowance spender, nonzero value, wrong target, invalid calldata, excessive gas, stale block or slippage mismatch. It omits calldata, hashes, nonces, the taker and raw payloads. Exit `0` means both directions quoted liquidity, passed compatibility and reported `ready` or `insufficient-balance` readiness with `actionsVerified: true`; `unverified-actions` is recorded but fails closed with exit `2`. `2` means incompatibility, no liquidity or a provider/RPC failure; `1` means the credentials are missing. Publish only that sanitized report.

## Coinbase-wrapped crypto majors on Base

The bounded roster includes only Coinbase-wrapped assets for which the current Coinbase issuer page identifies a Base deployment and publishes the exact Base contract. Coinbase describes the included wrapped assets as transferable tokens representing underlying assets it holds 1:1. That issuer statement is recorded as representation metadata; it is not a Home quote, guarantee, swap route, or redemption flow.

| Primary display | Display symbol | Base token | Decimals | Base contract |
| --- | --- | --- | ---: | --- |
| Bitcoin | BTC | cbBTC | 8 | `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` |
| XRP | XRP | cbXRP | 6 | `0xcb585250f852C6c6bf90434AB21A00f02833a4af` |
| Dogecoin | DOGE | cbDOGE | 8 | `0xcbD06E5A2B0C65597161de254AA074E489dEb510` |
| Litecoin | LTC | cbLTC | 8 | `0xcb17C9Db87B595717C857a08468793f5bAb6445F` |
| Cardano | ADA | cbADA | 6 | `0xcbADA732173e39521CDBE8bf59a6Dc85A9fc7b8c` |

Verification sources and method:

- Coinbase issuer roster, Base network availability, contract addresses, and backing semantics: https://www.coinbase.com/campaigns/cbbtc
- Contract explorer links: the BaseScan token page for each Coinbase-published address, preserved in `apps/web/config/invest-assets.ts`.
- ERC-20 token names, symbols, and decimals were read from those exact contracts on Base chain 8453 with `eth_call` (`name()`, `symbol()`, and `decimals()`) on September 7, 2026. The returned names were Coinbase Wrapped BTC/DOGE/XRP/LTC/ADA and the returned token symbols and decimals match the table.

These are Base ERC-20 representations, not native BTC, XRP Ledger, Dogecoin, Litecoin, or Cardano deposits. The registry records the `cb…` token symbol, Base 8453, decimals, and contract for builders. Product list and discovery UI must not surface those as contract lists, backing essays, or source roster walls. List rows may keep a short asset identity so a familiar ticker is not mistaken for a native-network deposit; legal and eligibility copy stays under Account → Disclosures / Terms.

### Investigated but excluded

- **cbETH:** Coinbase’s issuer page explicitly says cbETH is structured differently from its 1:1 wrapped assets. cbETH represents staked ETH and has a variable conversion relationship. It is omitted because the current price seam does not carry a separate per-cbETH versus per-ETH denomination or exchange-rate snapshot; presenting it as ordinary ETH would be unsafe.
- **cbSOL:** no Coinbase-published Base representation or Base contract was established on the current issuer roster, so no address or availability was assumed.

On Balances, held Base tokens outside the catalog with no price appear by quantity in an Unpriced section after priced Investments. This separates possible spam from priced holdings; unpriced tokens have no displayed value and are never counted in valued totals.

## Base-native meme sample

This sample is intentionally small and informational. Inclusion in the registry is not an endorsement and does not imply liquidity, suitability, eligibility, or a Home trading route. Do not put that disclaimer, or any similar compliance essay, on the Invest list.

| Project | Symbol | Base contract | Primary project source | Contract source |
| --- | --- | --- | --- | --- |
| Degen | DEGEN | `0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed` | https://www.degen.tips/ | https://basescan.org/token/0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed |
| Toshi | TOSHI | `0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4` | https://www.toshithecat.com/ | https://basescan.org/token/0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4 |

BRETT was investigated but not added to this bounded roster because a primary project source tied clearly enough to the canonical contract was not established during this lane. It can be added later only with the same project-plus-contract evidence standard.

## Asset search

The search field at the top of Invest discovery calls the public `GET /api/invest/search?q=<query>&offset=<n>` read. `apps/web/shared/invest/contracts/search.ts` owns the versioned request parser, wire response, and client parser. Coverage and bounds are in [Codex prices](codex-prices.md#asset-search).

- **Configured assets win.** Queries are normalized (NFKC, collapsed whitespace, case-insensitive) and matched against each registry asset's ID, display name, display symbol, token symbol, and contract. Bitcoin / BTC / cbBTC resolve to `cbbtc`; Apple / AAPL / AAPLc resolve to `aaplc`. Configured results carry only their stable ID, and the client renders them from the registry and the existing market-price read. A provider row with a configured contract is dropped, so the configured identity and metadata always apply.
- **Other Base tokens** use the same informational identity shape as trending memes: `base:<lowercase contract>`, the token symbol, and Codex metadata. Distinct contracts that share a symbol stay separate. The client shows a short contract discriminator only when two rows would otherwise look identical.
- **Phrase results exclude pairs.** Each provider row that survives the configured, duplicate, and relevance filters gets the same `token0()` pair check as an exact contract, so an indexed LP token whose own name or symbol matches (for example `UNI-V2`) never appears. Definitive pair checks are cached per process and independently bounded to a small number of concurrent RPC calls, rather than firing one `eth_call` per page row at once. A pair is dropped. An inconclusive check also drops the row and marks the page `provider: "error"` with `coverage: "partial"`; verified rows and configured matches remain, Load more still works, and the page is not cached.
- **Search ordering.** One shared relevance rule ranks results across all loaded pages, preserving provider trending order within each relevance tier. Provider pages arrive in `trendingScore24` order, so an exact match on a later page appears only after Load more; the first page cannot guarantee every exact match. Malformed pagination metadata is a partial provider failure and is not cached.
- **Exact contracts.** When the query is a full Base contract, a registry contract returns the configured asset. Otherwise the server runs a one-row exact Codex read for identity, image, and price and accepts it only when the returned token address equals the query on Base. Only when Codex definitively returns no matching token does the server read the contract's ERC-20 `symbol` and `decimals` onchain. Provider errors, timeouts, and malformed responses return no contract result and partial coverage with Retry; they never trigger onchain fallback or cache the failure. On both paths, the server first asks Base whether the contract answers `token0()`. A decodable address answer (a pair or pool) is rejected. Only a call revert, or a successful call that returns no decodable address, proves the contract is not a pair. When the check or the onchain identity read times out or fails with an RPC error, the search returns no contract result and reports partial coverage with a retry instead of accepting the identity. Search never opens a pool, a pair, or a different token. An indexed exact contract carries its current price when the provider returns one. An onchain-only identity has no price or chart.
- **Detail deep links.** A `base:0x…` detail URL that is not in the trending catalog resolves on reload through `GET /api/invest/asset?assetId=<canonical-id>` and `useResolvedAsset`, without calling paginated search. The shared server `resolveAsset` service owns configured identity priority, the exact indexed read, pair exclusion, and onchain fallback for both detail and exact-address search. Its bounded cache and in-flight coalescing share canonical IDs across both callers; only successful positive identities are cached. A definitive miss shows the unavailable state; a failed resolution offers the exact-address fallback. Chart history for that identity is admitted only by server reads (see [Codex prices](codex-prices.md#public-contracts)), never by client-supplied metadata.
- **Read-only identity.** A search result, provider name, symbol, image, or decimals grants no trade eligibility, quote, or signing authority. Trade availability and stock eligibility still come from their existing server gates, and holdings exits are unchanged. Search applies no liquidity floor or curated admission gate. Operator discovery visibility (#923) does not exist yet, so search applies no extra visibility filter.

## Asset detail market statistics

Market price history reserves half of the Codex reader's in-flight capacity for active range reads; speculative chart and Stats reads reuse cached or pending history but cannot fill the reserved slots. When a range is selected while its speculative read is still pending, the client cancels that read and refetches at active priority, so the selected chart never inherits a speculative overload rejection.

The read-only `GET /api/market-prices/stats?assetId=...` reads Codex market cap, 24-hour volume, and liquidity for Base tokens in USD. A dynamic `base:0x…` identity is admitted by the same server check as chart history ([Codex prices](codex-prices.md#public-contracts)), so a search-only token that shows a chart also shows its stats. Missing or invalid values are omitted. Tokenized stocks are unsupported because a DEX token market cap is not the company's market cap. The Past 24h and Past year ranges are drawn from the chart history's candle closes and are labelled as closing prices, not intraperiod highs and lows. These display statistics provide no trade authority; only a server-validated executable quote can authorize a trade.

Asset detail shows a held position from the wallet balances read: the exact token quantity and, for crypto and memes, the priced value. A failed balances read shows the balance as unavailable, never zero. An asset absent from a snapshot counts as unheld only when the relevant inventory coverage is complete (the configured registry for listed assets, the wallet catalog for dynamic memes); otherwise the balance is unavailable. Opening an owned holding from Home Investments shows that holding's balance card in the same position slot below the chart. Tokenized-stock positions show their quantity with the value explicitly unavailable until the stock holding valuation lands; the Codex USD market chart is never used as a stock holding value. No return, profit or loss, or cost basis is shown.

## Caller-supplied market snapshots


`InvestExperience` accepts separate stock, meme, and crypto `MarketDataState` values. A ready snapshot carries:

- the configured stable asset ID;
- a preformatted display price;
- a source label and source timestamp;
- an optional source URL.

Snapshots remain USD strings at the API. `getMarketDisplay` presents them in the selected local fiat (Jesse lock, #83) using Coinbase FX from `PricedInvestExperience`. Missing FX fail-closes to an em dash — never a silent USD fallback. Currency-balance / cash rows stay native (USDC/IDRX) and are not re-denominated. The experience does not refresh, authorize, or invent a price. Missing, loading, empty, and failed data display an em dash and explicit unavailable copy, never zero. Signing and review stay on exact `formatBaseUnitAmount`. The crypto registry now provides identities for pricing consumers; live pricing for the configured Base roster is caller-supplied.

### Identity resolution boundary

`shared/invest/contracts/asset-resolution.ts` owns the versioned detail contract. Configured IDs retain registry metadata; dynamic Base IDs remain informational. Failed quote reads preserve the resolved indexed identity without inventing a price. An inconclusive pair check returns an error without an asset. Onchain-only metadata has no quote. Resolution grants no trading, transfer, or history eligibility. Chart admission remains a separate indexed/trending policy: it does not require quote resolution or onchain metadata reads. Asset grouping and additional networks are outside this contract.
