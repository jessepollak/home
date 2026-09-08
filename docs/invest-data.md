# Invest data boundary

Verified: September 7, 2026

The Invest feature is a read-only presentation surface. It contains no swap, quote, wallet, authentication, persistence, or public API behavior. Prices are absent by default and can only appear when the caller passes a display value with a source label and timestamp.

## Display identity and token representation

The asset registry keeps a deliberately small distinction:

- `displayName` and `displaySymbol` are the familiar primary labels shown in the list, such as Bitcoin / BTC or NVIDIA / NVDA.
- `representation.tokenSymbol`, issuer, decimals when verified, relationship text, Base chain ID, and contract address describe the token that actually exists on Base.
- Contract identity is always `chainId + contractAddress`; neither a display ticker nor a token ticker is a contract identity.
- Price snapshots are labelled per represented token, for example “Per cbBTC token.” Home does not calculate a native-asset conversion, a stock-share multiplier, a stablecoin peg, or an executable redemption amount.

This is enough for the current seam and can also describe a local stablecoin or another tokenized stock without introducing a generalized instrument ontology. It does not change region eligibility or currency defaults. Registry and docs record the exact token symbol, network, and contract for builders. Product list and discovery UI must not surface contract lists, restriction notes, or disclosure blocks; those belong only under Account → Disclosures / Terms. Review or confirm may show the token symbol, network, and other facts needed to complete an action. A Bitcoin / BTC display label must never be treated as permission to send native BTC to a Base address.

## Tokenized stocks

The bounded launch roster follows the official Base stock page and its linked Base explorer contracts. These are Coinbase-issued Regulation S instruments and remain unavailable in the United States. A country preference is presentation only and cannot unlock them.

| Company display | Display symbol | Base token | Base contract |
| --- | --- | --- | --- |
| NVIDIA | NVDA | NVDAc | `0xb20000000000000000000078ee7ce2fE4908108C` |
| Meta | META | METAc | `0xb2000000000000000000008bC8786B856E61707C` |
| Apple | AAPL | AAPLc | `0xb200000000000000000000C2e324d24d7eEcd1fb` |
| Alphabet | GOOGL | GOOGLc | `0xb2000000000000000000002D0BA3164cc74f58B7` |

Primary sources:

- Official Base stock roster: https://www.base.org/stocks
- Base announcement and restriction summary: https://blog.base.org/tokenized-stocks
- Canonical contract identity: the Base explorer link attached to each instrument on the official roster; those links are preserved in `apps/web/config/invest-assets.ts`.

A familiar company ticker is only a display label. Coinbase’s token symbol and exact Base contract stay in the registry and builder docs, not on the Invest list. Corporate actions can alter a token-to-share relationship, and Home does not infer or execute par exchange.

No route, liquidity, wallet compatibility, user eligibility, or trade execution has been verified for Home.

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

The component does not parse, calculate, convert, refresh, or authorize from these values. Missing, loading, empty, and failed data display an em dash and explicit unavailable copy, never zero. The crypto registry now provides identities for pricing consumers, but this lane adds no price provider; live pricing for cbBTC, cbXRP, cbDOGE, cbLTC, and cbADA remains a caller coverage gap.
