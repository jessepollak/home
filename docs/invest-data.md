# Invest data boundary

Verified: September 25, 2026

The Invest feature is a presentation surface with one execution exception: Bitcoin (cbBTC on Base) can be bought with USDC and sold back to USDC through the shared action flow described in [Execution checkpoint](#execution-checkpoint-cdp-swaps). Every other asset stays read-only, with no swap, quote, or wallet path; stocks display eligibility or not-routed status without offering execution. Prices are absent by default and can only appear when the caller passes a display value with a source label and timestamp. A display price never authorizes a trade; only a server-validated executable quote does.

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

Only the USDC ↔ cbBTC route and liquidity have been checked, by the non-funded checkpoint below. Wallet compatibility, user eligibility and trade execution have not been verified for Home.

## Execution checkpoint: CDP Swaps

Jesse approved the CDP EVM Swaps API as the first execution route, for Base mainnet canonical USDC ↔ cbBTC only (#616). The server-only provider seam lives in `apps/web/server/actions/kinds/trade/` and prepares executable trades through the shared action framework. The session-authorized `GET /api/trades` reports provider, smart-account and signer availability; `POST /api/actions/prepare` issues a verified trade draft. Unavailable credentials never disclose which setting is missing.

- **Contract.** CDP OpenAPI 2.0.0 as shipped in the pinned `@coinbase/cdp-sdk`: `GET /platform/v2/evm/swaps/quote` for a price estimate and `POST /platform/v2/evm/swaps` for an executable quote with a Permit2 payload and transaction. Every request is signed with a fresh 120-second JWT scoped to the method, fixed host and exact path. The POST uses its own random request key, never a Home action id.
- **Untrusted response.** `cdp-swaps.ts` rejects any non-conforming primitive. `quote.ts` accepts an executable quote only when the tokens and spend amount exactly match the requested direction; the minimum receive amount honours the requested slippage (1–300 bps); the quote block is at most 30 blocks older and at most 2 blocks newer than the current Base block; there is no balance issue; `simulationIncomplete` is exactly `false`; the Permit2 typed data matches the canonical Base domain, token, amount and a deadline no more than 30 minutes away and re-hashes to the provider hash; the Permit2 `message.spender` equals the transaction target; any allowance issue names canonical Permit2 (`0x000000000022D473030F116dDEE9F6B43aC78BA3`); preparation reads the taker's balance and Permit2 allowance from chain at the pinned Base block, rejecting insufficient balance (including a reported quote balance issue) and adding an exact approval only when chain allowance is below the spend amount; and the transaction sends zero value to the current taker-submitted 0x Settler published by the 0x Deployer registry (`ownerOf(2)` at `0x00000000000004533Fe15556B1E086BB1A72cEae`). Gas must be positive and at most 3,000,000. A mismatch surfaces as a typed reason (`no-liquidity`, `stale-quote`, `insufficient-balance`, `quote-rejected` or `unverified-actions`), never a partial review.
- **Settler calldata.** The executable quote is Settler `execute(slippage, actions, zid)` before the Permit2 signature is attached, so it is not strictly ABI-decodable: logical action 0 is `TRANSFER_FROM`, placed physically last with a `0xffff` length placeholder and a signature offset pointing past the end of calldata; confirm appends the signature length and bytes there. A strict parser checks that layout (contiguous zero-padded actions, no trailing bytes, exactly one `TRANSFER_FROM`), and the outer slippage record must name the taker as recipient, the pair's receive token and a minimum exactly equal to the reviewed minimum. Every action must then pass a selector-specific validator; an unknown selector or failing action reports `unverified-actions`. Validated selectors: `TRANSFER_FROM` (token, amount, nonce and deadline equal the reviewed permit; recipient is Settler or a pre-funded pool), `BASIC` (either an ERC-20 `transfer` fee whose total matches the provider `protocolFee`, capped at 5%, or a pool swap that avoids the zero address, Permit2, the taker, the pair tokens and Settler as targets, requires whole-byte call data of at least four bytes, rejects token-movement and approval selectors, excludes taker, signer and Permit2 addresses anywhere in call arguments, and patches amounts only after the selector), `UNISWAPV2`, `UNISWAPV3`, `MAVERICKV2`, `RFQ` and `POSITIVE_SLIPPAGE` (receive token only, expected amount at least the quoted receive amount). Swap outputs must return to Settler or a pre-funded next pool, and at least one swap must sell the reviewed input token. Home zeros the inner `UNISWAPV2` `amountOutMin`, `MAVERICKV2` `minBuyAmount` and `UNISWAPV3` `amountOutMin` words in the reviewed call without changing any other calldata, because the outer Settler slippage record binds the reviewed minimum. RFQ maker permits must name the receive token and provide enough capacity in that token's integer base units to cover the reviewed outer minimum plus the larger of the quoted receive-token protocol fee and its fee-rate upper bound. Reused maker nonces are rejected, and RFQ-only routes must offer enough total `maxTakerAmount` to consume the full reviewed input. Mixed RFQ/AMM routes are rejected pending deterministic spend modeling. For AMM routes funded into Settler, one from-token swap must consume 100% of the remaining input; multi-action swaps are rejected. A transfer sent directly into a validated pool does not leave input in Settler. RFQ output sent directly to the taker is rejected because Settler checks only its own receive-token balance before transferring the reviewed minimum to the taker. An expired RFQ maker permit yields `stale-quote`; every maker deadline bounds review expiry. Before issuing review, preparation checks each RFQ maker signature against its Permit2 Consideration witness (EOA recovery or ERC-1271 at the pinned block) and checks that maker's Permit2 nonce bitmap at the same block. A malformed signature or used maker nonce rejects the quote; an unavailable chain read prevents review. The operator checkpoint also requires this check before reporting an RFQ as action-verified. Pools are not allowlisted, so the input leg relies on Settler's atomic final slippage check: if the taker does not receive at least the reviewed minimum of the receive token, the whole transaction, including the Permit2 pull, reverts.
- **Checkpoint result (September 25, 2026).** The non-funded checkpoint ran with the existing server `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` pair and authenticated successfully against both endpoints. For Base USDC → cbBTC (1 and 25 USDC) and cbBTC → USDC (0.00001 and 0.0003 cbBTC), price and executable quotes reported `liquidityAvailable: true`, the retained Permit2 validator accepted the typed data and hash, the Permit2 spender equalled the transaction target and the registry Settler, `simulationIncomplete` was `false`, and every action verified; readiness was `ready` where the quoted taker held the input token and `insufficient-balance` otherwise (exit `0`). A wider sweep of fifteen quotes from 0.5 to 500 USDC and 0.000007 to 0.005 cbBTC verified fourteen; one large sell routed through an unsupported `HANJI` action and correctly reported `unverified-actions`. Routes vary by amount and time, so an unsupported route fails closed and the customer must request a new quote. Fixtures in `quote.test.ts` are synthetic reproductions of the observed shapes, not provider payloads.
- **Execution.** Prepare reads the current Base block and registry Settler after the executable quote, rejects unsupported action selectors, and stores the reconstructed calls, Permit2 hash, signing request and final swap call index with a two-minute-or-earlier expiry bounded by the taker Permit2 deadline and every RFQ maker permit deadline (minus 30 seconds). Optional USDC network fee approval is prepended before any Permit2 approval. Confirm checks the owner signature and appends it to the reviewed swap call; the paymaster callback accepts only the confirmed exact batch commitment. No pool allowlist is applied: exact Permit2 scope, receive binding and Settler atomic slippage protect the reviewed minimum.
- **Customer flow.** Bitcoin detail enables Buy and Sell only when `GET /api/trades` reports availability for the verified session; a failed or unavailable read disables both with a short note. Review shows only server-validated quote facts with a live expiry, and an expired quote requires a new review. Completed trades converge through the shared balances and Activity sources as “Bought Bitcoin” or “Sold Bitcoin”.
- **Remaining.** Bounded live buy and sell proof for #616.

### Run the checkpoint

The checkpoint is non-funded: it requests a price and an executable quote for each direction and never signs, stores or broadcasts anything. Run it only in an already provisioned, authorized operator environment:

```sh
bun run --cwd apps/web cdp-swaps:checkpoint --taker 0x<smart-account-address> [--buy-usdc 1] [--sell-cbbtc 0.00001]
```

It needs `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` from a CDP project with Swaps API access, Base RPC access through the existing `BASE_RPC_URL` setting (the public Base endpoint when unset), and the public address of a Base smart account to quote for. The taker need not hold funds; an unfunded taker is expected to report `insufficient-balance` readiness without counting as an incompatibility.

The command prints sanitized JSON: date, endpoint paths, schema label and, per direction, price and quote `liquidityAvailable`, Permit2 presence and compatibility, whether the Permit2 spender matches the transaction target, whether the target matches the registry Settler and calldata passes the Settler layout and outer slippage checks, `actionSelectors` (lowercase public ABI identifiers in order, or null when the layout does not parse or liquidity is absent), `actionsVerified`, whether any allowance spender is Permit2, whether the outer quote-compatibility check passed and its reason, `simulationIncomplete`, a balance-issue flag and the validator's readiness reason. Compatibility applies every rule above except the balance issue, `simulationIncomplete` and action verification, so an unfunded taker cannot hide a wrong allowance spender, nonzero value, wrong target, invalid calldata, excessive gas, stale block or slippage mismatch. It omits calldata, hashes, nonces, the taker and raw payloads. Exit `0` means both directions quoted liquidity, passed compatibility and reported `ready`, `insufficient-balance` or `unverified-actions` readiness; only `ready` or `insufficient-balance` with `actionsVerified: true` shows a supported route. `2` means incompatibility, no liquidity or a provider/RPC failure; `1` means the credentials are missing. Publish only that sanitized report.

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

## Base-native meme sample

This sample is intentionally small and informational. Inclusion in the registry is not an endorsement and does not imply liquidity, suitability, eligibility, or a Home trading route. Do not put that disclaimer, or any similar compliance essay, on the Invest list.

| Project | Symbol | Base contract | Primary project source | Contract source |
| --- | --- | --- | --- | --- |
| Degen | DEGEN | `0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed` | https://www.degen.tips/ | https://basescan.org/token/0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed |
| Toshi | TOSHI | `0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4` | https://www.toshithecat.com/ | https://basescan.org/token/0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4 |

BRETT was investigated but not added to this bounded roster because a primary project source tied clearly enough to the canonical contract was not established during this lane. It can be added later only with the same project-plus-contract evidence standard.

## Caller-supplied market snapshots

`InvestExperience` accepts separate stock, meme, and crypto `MarketDataState` values. A ready snapshot carries:

- the configured stable asset ID;
- a preformatted display price;
- a source label and source timestamp;
- an optional source URL.

Snapshots remain USD strings at the API. `getMarketDisplay` presents them in the selected local fiat (Jesse lock, #83) using Coinbase FX from `PricedInvestExperience`. Missing FX fail-closes to an em dash — never a silent USD fallback. Currency-balance / cash rows stay native (USDC/IDRX) and are not re-denominated. The experience does not refresh, authorize, or invent a price. Missing, loading, empty, and failed data display an em dash and explicit unavailable copy, never zero. Signing and review stay on exact `formatBaseUnitAmount`. The crypto registry now provides identities for pricing consumers; live pricing for the configured Base roster is caller-supplied.
