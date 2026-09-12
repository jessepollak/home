# Base wallet balances and supported valuation

Status: the original `/api/portfolio` USDC/native-ETH quantity contract remains unchanged for transfer compatibility. A separate authenticated `/api/portfolio/valuation?region=...` read and Home presentation are integrated locally with deterministic fixtures. No private-wallet live read was performed during implementation.
Updated: 2026-09-10

## What this reads

Home reads two explicit assets for the smart account returned by the verified CDP session boundary:

- Native ETH on Base mainnet (chain ID `8453`), 18 decimals.
- Circle USDC on Base at `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, 6 decimals.

Circle's primary USDC contract-address registry lists that Base mainnet contract: [Circle — USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses). Circle's native-USDC precision documentation specifies six decimal places: [Circle — USDC-backed stablecoin reference specification](https://developers.circle.com/xreserve/concepts/usdc-backed-stablecoin-specification). Base's primary RPC documentation lists mainnet chain ID 8453 and the public `https://mainnet.base.org` endpoint: [Base — RPC overview](https://docs.base.org/base-chain/api-reference/rpc-overview).

These identities were rechecked on 2026-09-07. Home does not include ticker-matched or locally issued stablecoins in this response. The response is token quantity only: it does not provide fiat valuation, net worth, price data, or a redemption/parity claim.

## Server configuration and behavior

`GET /api/portfolio` runs on the Node runtime and remains dynamic. It passes the original `Request` directly to the existing `createSessionHandler` in process, preserving request headers and query parameters for the shared Base Account authentication boundary. It does not call `/api/session` over loopback and does not accept a wallet address from the browser as authority.

A successful session response is parsed again at the feature boundary. Only the verified `smartAccount.address` on chain 8453 reaches the RPC reader. A session with no smart account returns `SMART_ACCOUNT_UNAVAILABLE`; it never falls back to an EOA. Session 401/503 responses are relayed directly. Portfolio failures return an unavailable error, never synthetic zero balances. Every private response uses:

```text
Cache-Control: private, no-store, max-age=0
Pragma: no-cache
Vary: Authorization, X-Home-Account-Provider
```

By default the reader uses Base's public mainnet endpoint:

```text
https://mainnet.base.org
```

Base documents its public endpoints as rate-limited and unsuitable for production traffic. The default is appropriate for local development and bounded checks. **Vercel Production and Preview should set** the server-only `BASE_RPC_URL` to a [CDP Node](https://docs.cdp.coinbase.com/data/node/quickstart) HTTPS JSON-RPC URL for Base mainnet (or another managed HTTPS endpoint). Home does not fail the process when the variable is unset — local `bun dev` keeps the public default — but hosted money paths that omit it keep hitting public Base rate limits.

Operator steps (no secrets in git or chat):

1. In [CDP Portal](https://portal.cdp.coinbase.com) open **Node**, select **Base Mainnet**, and copy the HTTPS endpoint. The documented shape is `https://api.developer.coinbase.com/rpc/v1/base/<CLIENT_API_KEY>` — the key is the last path segment, not URL userinfo.
2. Set `BASE_RPC_URL` on the Vercel project (`home-web`) for **Production** and **Preview**. The same name is the Cloud Agent secret when agents need a live money-path smoke.
3. Never commit the value. Never give it a `NEXT_PUBLIC_` prefix. It is not the Embedded Wallet / client RPC.

The value must use HTTPS. Plain HTTP is accepted only for a loopback hostname such as `http://127.0.0.1:8545`. User info, URL fragments, non-HTTP schemes, and non-loopback plaintext endpoints are rejected. A CDP-style key-in-path HTTPS URL is accepted. Never expose this value with a `NEXT_PUBLIC_` prefix.

An opt-in live smoke (skipped in CI) posts `eth_chainId` plus a dummy-account portfolio read through `resolveBaseRpcUrl`. It reports only redacted source/host class — never the URL:

```sh
BASE_RPC_LIVE_SMOKE=1 bun test apps/web/server/portfolio/rpc.live.test.ts
```

The RPC reader has one finite six-second deadline, no retries, no polling, no background work, and no shared private-response cache. It:

1. calls `eth_chainId` and rejects any chain other than 8453;
2. obtains one latest block number/hash/timestamp;
3. batches exactly one `eth_getBalance` and one USDC `balanceOf(address)` `eth_call`, both pinned to that block number;
4. checks the source block again and rejects a hash change during the read.

HTTP errors, RPC errors, missing batch entries, malformed JSON, malformed/canonical hex failures, a changed source block, and values outside uint256 all fail closed. Provider response bodies and configured endpoint credentials are not logged.

## API contract

A successful response has this shape:

```json
{
  "walletAddress": "0x...",
  "chainId": 8453,
  "blockNumber": "35123456",
  "blockHash": "0x...",
  "blockTimestamp": "1788811200",
  "fetchedAt": "2026-09-07T20:30:00.000Z",
  "assets": [
    {
      "id": "usdc",
      "symbol": "USDC",
      "decimals": 6,
      "kind": "erc20",
      "tokenAddress": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "balanceBaseUnits": "1234500"
    },
    {
      "id": "eth",
      "symbol": "ETH",
      "decimals": 18,
      "kind": "native",
      "balanceBaseUnits": "42000000000000000"
    }
  ]
}
```

`blockNumber`, `blockTimestamp`, and `balanceBaseUnits` are canonical decimal integer strings. `blockTimestamp` is Unix seconds. Amounts are converted from RPC hex with `BigInt`; no monetary quantity passes through JavaScript floating point.

## Client composition contract

The portfolio feature exports:

```ts
type VerifiedPortfolioSession = {
  subject: string;
  smartAccountAddress: `0x${string}`;
  chainId: 8453;
};

type FetchPortfolio = (signal: AbortSignal) => Promise<unknown>;

usePortfolio(
  session: VerifiedPortfolioSession | null,
  fetchPortfolio: FetchPortfolio,
): PortfolioState;
```

The original `usePortfolio` quantity hook and `/api/portfolio` contract remain available for transfer preflight and funding compatibility, but Home does not run that quantity request in parallel with its valuation request. `PortfolioHomeExperience` uses the verified session with `/api/portfolio/valuation`; the shared authenticated client still obtains the CDP access token internally and sends the same `accountProvider` selector used for session validation. The portfolio route continues to pass the original request through `createSessionHandler`, require the successful response's provider to match the request selector, and validate the exact USDC/native ETH response identities.

Home presents the formatted USDC token amount as the dominant **USD/USDC balance** and explicitly says ETH is shown separately. The USDC amount is not labeled as total net worth, is not relabeled to the selected country's currency, and does not include an invented ETH valuation. ETH remains a separate native token amount. Missing, malformed, or failed data stays unknown; a successful RPC zero remains visibly `0`.

## Device presentation cache

Home may persist the last **ready** `HomeAssetBalancesPresentation` (formatted total + cash/asset rows only) in `localStorage` under `home.balances.v1:{subject}:{smartAccount}:{region}`. This is a device hint so Checking / restoring can paint last-known hero and Balances while valuation reloads. It is not a source of truth.

- Persist presentation DTOs only — never OTPs, tokens, Authorization headers, raw CDP / valuation snapshots, or harness payloads.
- Read is allowlisted and fail-open: corrupt, expired (24h), envelope-version-mismatched, presentation-semantic-version-mismatched, or owner/region mismatch is a miss; the network path is unchanged. The semantic version is separate from the storage envelope so a formatting-meaning change safely misses old rows without changing identity or retention.
- Paint only when the SDK `ownerKey` matches the stored record. No global last-user flash before the SDK owner is known. Activity stays live/shimmer; the address stays hidden until verified.
- Wipe every `home.balances.v1:*` key on sign-out. Delete the current key after a confirmed money action (`MoneyDataRefreshProvider` / transfer confirm) so pre-send totals cannot linger.
- A live-ready valuation may carry only transient unavailable-row IDs for native or nonselected cash holdings whose current read failed. With an exact verified owner/subject/account/region cache match, Home keeps a previously known row in its prior position but replaces the stale amount with `Unavailable`; first-time unknown rows are not invented. Ready zero removes the old row, and newly ready nonzero holdings appear normally. The reconciled presentation is persisted without the transient IDs, and repeat writes for the same live snapshot are skipped.

States are `loading`, `ready`, `error`, and `unavailable`. Logout and account changes hide the previous snapshot immediately. Each request receives an abort signal, and sequence guards prevent late A-account or logged-out responses from becoming visible. A real successful zero is `ready`; malformed, failed, and unavailable responses retain unknown state and are never converted to zero.

`formatBaseUnitAmount(baseUnits, decimals)` performs exact decimal placement and strips only insignificant trailing fractional zeroes. It does not round. For example, one wei displays as `0.000000000000000001`, not zero.

## Supported portfolio valuation

`GET /api/portfolio/valuation?region=<RegionId>` is a separate versioned read contract. It preserves the original `/api/portfolio` parser and response because confirmed transfers continue to use that fresh USDC/native-ETH quantity read for preflight checks and signing safety.

The valuation route accepts exactly one validated region and obtains the account solely from the same verified in-process session boundary. It is private, no-store, provider-bound, and never accepts a browser-supplied wallet as authority. Region/account changes abort the old client request and hide its snapshot before the replacement resolves.

The supported inventory is intentionally fixed and incomplete:

- native ETH on Base;
- canonical Base USDC;
- the 11 exact Invest contracts;
- the enabled EURC and IDRX contracts in every region, with only their Cash-bucket roles varying by selected currency;
- three configured Morpho USDC vault positions.

Direct holdings (ETH + allowlisted ERC-20s) are read from CDP Onchain Data Token Balances (`GET /platform/v2/data/evm/token-balances/base/{address}`) for the session-verified smart account, authenticated with the same server CDP API-key JWT family as other CDP server reads. Home registry decimals and symbols are used; provider metadata is ignored. A listed fresh CDP quantity is authoritative for that contract, but omission is not proof of zero because the provider inventory may not support every configured token. Every configured ERC-20 without a fresh CDP match is therefore recovered through `latest` `balanceOf` singles on the explicitly configured server-only `BASE_RPC_URL`, with a deduped hard bound of 20 contracts and at most two attempts per unresolved contract (40 calls maximum). Cash contracts run first in stable registry order, followed by Invest contracts, so a slow Invest call cannot consume the cash recovery window. The public default is never used for this recovery. A transport miss marks only that single unresolved; if the helper's bounded stage deadline aborts a later call, completed singles are retained and remaining contracts stay unavailable, while caller/request cancellation still rejects immediately. RPC `0` stays ready `0`, a nonzero quantity is used, and a failed recovery stays unavailable — never an invented zero. Recovery runs before Morpho vault RPC and remains bound to the session-verified owner. A later-page Token Balances failure keeps already-authoritative directs; checkpoint quantities are not trusted unless freshly observed or RPC-recovered. The previous public-RPC batch reader remains in `valuation-rpc.ts` but is no longer the valuation hot path. Phase B/C (materialized store, webhooks, live updates) are locked in [balances inventory](balances-inventory-architecture.md); research detail on [#76](https://github.com/jessepollak/home/issues/76#issuecomment-5594452047). Do not treat this document as the live-update design.

Vault holdings still use pinned-block RPC (`asset()` + `convertToAssets`, and share `balanceOf`) for the three Morpho vaults, preferring dedicated `BASE_RPC_URL` when set. JSON-RPC vault calls are chunked and matched by validated IDs. A missing/failed vault read is unavailable; a successful zero remains zero. Each vault contributes once through its onchain share balance converted to verified canonical USDC at the pinned block. Indexed Morpho assets and vault shares are not separately added. A wallet that holds USDC only in Morpho (direct USDC/IDRX `balanceOf` is 0) is not a Token Balances omit bug: cash buckets stay ready `0` and the vault row stays on Save — do not copy vault underlying into cash.

Exact-contract Codex quotes retain the raw decimal coefficient, chain/address, provider timestamp and retrieval timestamp. The quote request uses the same fixed supported contract set in every region, including EURC and IDRX, independent of wallet holdings or nonzero balances. Source age is re-evaluated at fetch completion and on cache hits without changing provenance, so a cached quote cannot remain fresh after its provider timestamp exceeds the five-minute budget. Missing, stale, invalid, duplicate, wrong-contract, or unavailable quotes remain unpriced; Home never assumes a stablecoin peg.

The version-2 response now carries a bounded additive `nativeCashValuations` extension for canonical USDC, EURC, and IDRX. Each entry is bound to one configured direct holding, its exact-contract USD quote, and the Coinbase USD→denomination FX quote, with both sources and statuses retained. The server computes `token quantity × exact-contract USD price × denomination FX`; selected Cash buckets reuse the same result, and nonselected configured cash uses it for its Balances row. The extension is presentation-only and never contributes a second time to `lines` or `total`. Legacy version-2 responses may omit it; a present extension is parsed strictly for complete bounded membership, holding/contract/currency binding, status/value consistency, and source provenance.

When a cash quantity is known but its native-denomination valuation is unavailable, Home keeps the bounded formatted token amount and unit rather than implying par—for example `109.43 EURC`, never a manufactured `€109.43`. Selected Cash rows keep only the numeric quantity visible with the token unit in accessible detail; nonselected cash asset rows retain the token unit visibly. A successfully read zero remains native-currency zero, positive fiat dust remains a bound such as `<€0.01`, failed reads remain `Unavailable`, and unknown quantities remain a muted dash. Canonical currency flags remain keyed by the configured cash denomination. None of these fallbacks changes valuation status or adds an unpriced holding to the aggregate.

One public Coinbase USD exchange-rate response supplies the configured 19 fiat rates plus the reciprocal ETH input. Decimal strings are preserved, cached for 60 seconds, and labeled with retrieval-time provenance because the response has no provider `asOf`. Valuation uses BigInt rational arithmetic, sums exact fractions before half-even rounding, and never parses display strings or uses JavaScript `number` for money math.

Home labels the aggregate **Supported portfolio value** and explicitly marks partial results. The configured registry is a read/recovery allowlist, not row membership: a fresh asset row appears only after an authoritative positive balance, confirmed zero/absence creates no asset row, and an unread catalog entry does not create a phantom `Unavailable` row. Same-owner cached positive membership may be retained as `Updating…` or `Unavailable`; owner/account/region changes cannot reuse it, and the presentation semantic version invalidates older catalog-seeded records. Cash buckets remain visible because they are product roles rather than discovered asset rows. An incomplete valuation is unavailable rather than a false zero when none of the successfully valued holdings contributes a nonzero subtotal; a complete, successfully read zero portfolio remains zero. Positive fiat values below display precision render as a bound such as `USD <0.01`, and server serialization increases precision when needed so a positive rational is not rounded into zero at the normal scale. USD regions have one USDC Cash bucket with both canonical-USD and selected-local roles, so the balance contributes once. EUR and IDR regions add their verified local token as a separate Cash row in its own denomination; the other enabled local token remains in the existing Assets presentation rather than disappearing. Other preserved candidates—including CADD and wARS—remain visibly unavailable, and TRYB remains unresolved. `GLOBAL` asks the user to choose a country and never implies USD.

The response does not claim complete wallet net worth. NFTs, arbitrary ERC-20s, LPs, bridges, and unconfigured protocols remain outside the inventory.

## Verification boundary

All automated RPC tests use controlled transport fixtures; they exercise the production parser/reader without making network calls. Hook tests mount the production React hook with controlled HTTP callbacks and cover A-to-B switching, logout, aborts, late responses, mismatched wallets, and actual zero results. Production-owner/Home integration tests cover embedded and Base provider propagation, exact USDC/ETH display, country-label isolation, and clearing the prior wallet amount before a new owner resolves. No funded or private user wallet was queried during implementation. The first real Base Account balance read remains part of the security-reviewed manual compatibility smoke described in `docs/base-account.md`.
