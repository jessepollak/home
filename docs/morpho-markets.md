# Morpho markets

Home's compile-time registry `shared/morpho-markets/config.ts` is transaction authority for five Borrow USDC-loan isolated markets on Base. Market ids are recomputed as `keccak256(abi.encode(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv))`. At a pinned block, the server verifies both the configured id and `idToMarketParams` tuple, reads `decimals()` from the loan and collateral tokens, and rejects any mismatch or unusable oracle price for that market. Price raw units are `10^(36 + loanDecimals - collateralDecimals)` per USD. Morpho API listing and rate data are observations, never authorization.

## Verified Borrow registry

All five use Morpho Blue `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`, USDC loan `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6 decimals), AdaptiveCurve IRM `0x46415998764C29aB2a25CbeA6254146D50D22687`, fee 0, and `capabilities.borrow: enabled`. Entries are ordered by rank and carry collateral `displayName` and `brandMark` from `shared/assets/base.ts`.

| Rank | Collateral | Decimals | Oracle | LLTV | Morpho market id |
|---|---|---:|---|---:|---|
| 1 | cbBTC | 8 | `0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9` | 86% | `0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836` |
| 2 | cbXRP | 6 | `0x031b2EFC8d70042Ac8d9f5c793c4149eC4b60fdE` | 62.5% | `0xd4a903dc6d949519060c7707f9604fdc9772c046e05c2e3a8fce0bd7196e4109` |
| 3 | cbETH | 18 | `0x97FF9CbD7E77348b2B8FfBB883bF29452aD18295` | 77% | `0x0ca10126f6c94cbd9cf0a48cc9516ae5e3dec5aa68303e6d988ee37c5149bf0d` |
| 4 | cbDOGE | 8 | `0xA9D36600Fb9eba7548857e61F836Ec951e3091B2` | 62.5% | `0x73527ddd796e6d4f48387adaae36f6f3d49d606d7f2a15eb0c931416a58875d8` |
| 5 | cbADA | 6 | `0x35D87a743D1F2f7CaFb42D855dC1c5Df857Ce45f` | 62.5% | `0xd7520ad198b497b6eb75bc690268f4597630dbc12e305e9d4105843bab36e41d` |

Finalized Base block **51714405**, hash `0x2de4e4f50c66b50715e05fd60f43edbcb2b735ab28bae2840a2806c19ffb78bd` (2026-09-24T02:49:17Z), established each id/tuple, decimals, oracle, IRM, fee, and liquidity. cbBTC oracle price was $84,324.29 with $160.97m liquidity; cbXRP $1.50474, cbETH $3,059.024445, cbDOGE $0.094108, cbADA $0.23868429. Morpho API listed all four additional markets with no warnings or bad debt. Coinbase asset identity sources are linked from `shared/assets/base.ts`. The four additional markets passed the [admission usefulness floor](borrow.md#admission-usefulness-and-limits), rechecked during implementation: borrowing $10,000 USDC increases the current rate by <1 percentage point and leaves >=$100,000 USDC available. These admission observations are not guarantees about future conditions.

## Reader and product projections

`shared/morpho-markets/math.ts` owns product-neutral exact integer math. `server/morpho-markets/abi.ts` and `rpc.ts` own the isolated-market ABI and pinned reader. One bounded multi-market read verifies Base chain once, pins one block, batches calls in sequential chunks of at most 40 requests, batches IRM borrow rates, and reconfirms the block hash once. Individual market decoding, id, token metadata, params, or oracle failures yield per-market unavailability; block/chain/reorg or transport failures invalidate all. The Borrow overview version 2 exposes the same projected detail snapshot for every available opportunity and the single pinned `discovery.sourceBlock`; it never treats a failed read as zero. Borrow detail remains version 1. `server/chain/coinbase-smart-account.ts` simulates an exact ordered account batch and reconfirms the pinned block after simulation.

Borrow's `server/borrowing` projection owns its health-floor policy, API contracts, and action semantics. Save remains Home's only user-facing lending product and uses a separate MetaMorpho ERC-4626 vault adapter, not the isolated-market Borrow adapter. Morpho's indexed vault state may lag direct reads; the products share compile-time transaction authority, pinned and re-confirmed Base provenance, finite approvals, exact ordered simulation, and thin prepared actions.

## Capability approval

Each verified market declares product capabilities independently. `enabled` permits new product risk and risk reduction; `reducing-only` preserves existing position management while blocking new risk. A market's Borrow admission or future operator warning flips its retained registry entry to `reducing-only`—**never deletes the tuple** needed for repayment and recovery. An omitted capability fails closed. Save's vault registry is independent, lives in `shared/savings/config.ts`, and has its own deposit and withdrawal capability rules. No product inherits another product's approval.

No funded-wallet or real-money test was performed for these markets.
