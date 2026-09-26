# Home — regional money and stablecoin mapping

Status: design reference and candidate registry; no token routes enabled or transactions tested.
Checked: 2026-09-07
Related: [architecture](architecture.md), [product strategy](product-strategy.md), [currency defaults](currency-defaults.md), and [contract candidates](stablecoin-candidates.json).

## Currency is the primary UI

Show everyday money as the user's currency: “US dollar”, “Euro”, “Brazilian real”, “Nigerian naira”, “Rupiah”, with normal local currency formatting. The home balance, amount entry, send and add-money screens lead with the currency name/symbol, not stablecoin tickers. Searchable asset selectors pair the currency code with the stablecoin ticker (`USD USDC`, `EUR EURC`, `IDR IDRX`) so the denomination and underlying asset are both explicit. For example, a Portuguese/Brazil configuration shows `R$ 1.234,56`; Indonesian shows `Rp 1.250.000,00`; English/US shows `$1,234.56`. Language/locale controls formatting independently of country; these are illustrative locale choices.

`formatPresentationCashAmount` shows stablecoin cash summaries (balances, debt, available-to-borrow) in their denominated currency with two-decimal truncation, so a summary never overstates an amount; tiny positive amounts display as less than one cent. Exact-amount displays keep `formatUsdStablecoinAmount`, and transaction review and collateral keep token units. The underlying asset remains explicit in account details, receive instructions and transaction review, e.g. “Held as EURC · Circle · Base.” Keep that secondary; do not make users select crypto tickers to get started. If several issuers are held in the same currency, details distinguish them and a spend selects an actual asset or quotes the required conversion. Changing region changes presentation/default funding options, never converts or relabels existing holdings as a different currency.

Native-currency denomination is distinct from valuation. A balance denominated in BRL can lead with reais; USDC valued in BRL belongs to a separately labeled estimated total. No silent FX conversion or assumption that all tokens sell/redeem at par. Keep quote fees/minimum received accurate; show a material peg/valuation discrepancy where it affects the balance or action. Currency formatting does not imply a bank deposit or guaranteed redemption.

## Country resolution

Every visitor resolves to a configured country, so balances always have a quote currency; `GLOBAL` is never an outcome. There is one preference owner at a time: signed-in choices are saved as configured country codes (never `GLOBAL`) to `customer_preferences` on the server and shared across devices; signed-out choices are saved in this browser. A saved account choice wins over any browser choice or detected country on the first server render when available; a slow database read falls back after a short deadline rather than blocking first paint. Walletless verified sessions read their saved account choice from the preference API after verification. Region-scoped balances, activity, funding, and Send's cash-out discovery, preparation, recovery, and resumed reviews wait for the account preference read to settle, retrying a failed read a bounded number of times before falling back; an open Add money flow restarts at method choice if the country changes. If the account has no choice, an explicit browser choice is shown and adopted once into the account without overwriting a concurrent account choice. Otherwise the request's edge geolocation applies, then `US`. A detected or default country is never saved as a preference.

- **Geolocation.** The landing (`/`) and shell (`/[...shell]`) pages read Vercel's `x-vercel-ip-country` header on the server (`apps/web/server/region/request-country.ts`). A missing header, an unknown or reserved code (`XX`, `T1`), or a country not in `countryRegionIds` resolves to `US`.
- **Setting it.** Explicit anonymous selections use versioned `localStorage` key `home.country.v2`; legacy auto-written `home.country.v1` values still display but are never adopted into an account. Authenticated selections write to the account, not the browser. A choice made while the session restores, or while a signed-in account is not yet verified by the server, is held until server verification, then saves to the account; if the session ends signed out instead, it saves to this browser. Neither geolocation nor the `US` fallback writes browser storage.
- **One-time adoption.** When no account preference exists, a valid explicit browser selection is offered to the server as an `onlyIfUnset` write after the account preference read settles; an existing account value wins. An unsupported value or `GLOBAL` falls through to detected country or `US` without adoption.
- **Account boundary.** The server-rendered preference carries the account it was read for and applies only to that account's first session in the page. Signing out returns to the browser choice or detected country; any later sign-in without a reload, including by the same account, reads the preference from the server again, runs adoption once for that account, and discards any write still pending for the previous account.
- **User choice wins.** Geolocation only fills the absence of a usable account or anonymous choice. `customers.country` tracks request country separately and is never the device preference.

The country is presentation and funding-route selection, not a compliance boundary: the user can choose any configured country in Account. Region-gated funding routes follow the resolved country — Coinbase onramp (Apple Pay) and Peer offramp (Cash App, Zelle) in `US`, Peer offramp (Monzo, Revolut) in `GB`, Peer offramp (Revolut, EUR) in the 21 configured euro-area countries (`AT`, `BE`, `BG`, `HR`, `CY`, `EE`, `FI`, `FR`, `DE`, `GR`, `IE`, `IT`, `LV`, `LT`, `LU`, `MT`, `NL`, `PT`, `SK`, `SI`, `ES`), Ripio onramp in `AR`, `BR` and `CO`, and IDRX onramp in `ID`. No euro-area onramp is bound yet. Where a configured country has no route, Add money and Cash out show an empty state only after a successful provider discovery read. A failed read, an unreadable provider catalog, or a matched corridor whose funding mode or binding environment cannot be resolved keeps the route hidden and reports a transient funding error instead of an empty country, because a broken deployment is not evidence that the country has no route. Receive crypto and ordinary sends remain available. Before country resolution changed, every device without a stored choice resolved to `US`, so a non-US visitor with no stored choice now sees their own country's routes (or none) instead of the US routes. Save, Borrow and Invest are not region-gated, and restricted Invest assets stay restricted in every country.

## Roster grounded in Base's dashboard

Read the [International Stablecoins dashboard](https://dune.com/base_ds/international-stablecoins) and its [source registry query](https://dune.com/queries/4780995) directly. The source lists 34 contract rows, 33 unique token names and 21 non-USD currencies, including two TRYB contracts with different decimals; the issuer-confirmed deployment is `0xfb8718a69aed7726afb3f04d2bd4bfde1bdcb294` (6 decimals). Its displayed last-run age was four days; the aggregate coverage table was older and omitted some source entries. Use the underlying registry for discovery, then verify selected issuers/contracts rather than treating supply charts as live routing evidence.

The table below is a candidate mapping, not a blanket decision that every token is suitable. Ordering within a currency is not a preference. USDC is added separately from Circle's official Base address documentation.

| Country/region | Native currency | Base candidates |
|---|---|---|
| Argentina | ARS | ARST, ARGT, wARS, ARSX |
| Australia | AUD | AUDD, AUDF |
| Brazil | BRL | BRZ, BRLA, BRLY |
| Canada | CAD | CADC, CADD |
| Chile | CLP | WCLP |
| Colombia | COP | WCOP |
| Euro area | EUR | EURC, EURAU, VEUR |
| Indonesia | IDR | IDRX |
| Malaysia | MYR | MYRC |
| Mexico | MXN | MXNE, MXNB |
| New Zealand | NZD | NZDD |
| Nigeria | NGN | CNGN, NGNC |
| Peru | PEN | WPEN |
| Singapore | SGD | XSGD |
| South Africa | ZAR | ZARP |
| Switzerland | CHF | VCHF |
| Tanzania | TZS | nTZS |
| Thailand | THB | THBT |
| Türkiye | TRY | TRYB |
| Uganda | UGX | UGXC |
| United Kingdom | GBP | VGBP, TGBP |
| United States | USD | USDC |

“Euro area” must map to explicitly maintained country codes that use EUR, not every EU country. The dashboard labels it “EU”; Home must not copy that as a blanket country rule. Other currency-using territories need explicit region configuration. A country absent from this roster can still get localized formatting, but Home must not invent a local stablecoin or silently call USDC its local money.

Presentation implementation status (2026-09-07): EUR maps to the 21 current euro-area members — `AT`, `BE`, `BG`, `HR`, `CY`, `EE`, `FI`, `FR`, `DE`, `GR`, `IE`, `IT`, `LV`, `LT`, `LU`, `MT`, `NL`, `PT`, `SK`, `SI`, and `ES`. This includes Bulgaria, which [adopted the euro on 1 January 2026](https://economy-finance.ec.europa.eu/euro/eu-countries-and-euro/bulgaria-and-euro_en). The maintained membership source is the European Union's [Countries using the euro](https://european-union.europa.eu/institutions-law-budget/euro/countries-using-euro_en) page (last updated 12 January 2026). `EU` is not configured as a country code, and non-euro EU members are not mapped to EUR. Overseas and territory mappings remain out of this implementation scope.

## Choosing the default asset

The [defaults for all 22 currencies](currency-defaults.md) are confirmed: Canada uses CADD and Argentina uses wARS. Additional verification and live-funding holds remain separate from confirmed product choices. No routes are enabled yet.

Use one explicit default asset per enabled country/currency and keep alternatives in the registry. Select based on an issuer-confirmed Base contract, supported funding route, actual quote and usable liquidity/transfer behavior. Do not select automatically by ticker, dashboard supply rank or whichever token the API returns first. A default change requires a reviewed config edit; existing holdings retain their original asset identity.

Proposed first mappings to validate end to end: USD → USDC, EUR → EURC, IDR → IDRX. These have issuer-published Base addresses checked during design research. This is an integration starting point, not a replacement for the final demo-region selection. Confirmed choices for Brazil, Nigeria, Mexico and other multiple-issuer markets are recorded in the defaults document; actual provider routes still need verification before enabling funding.

- [Circle USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses): Base `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- [Circle EURC on Base](https://www.circle.com/es/blog/eurc-is-coming-to-base): `0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42`, matching the dashboard.
- [IDRX issuer contracts](https://docs.idrx.co/introduction/supported-chain-and-contract-address): Base `0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22`, matching the dashboard. [Issuer denomination](https://docs.idrx.co/) identifies IDR.

The JSON preserves dashboard addresses/decimals as candidates with `enabled: false`. Those are source observations, not RPC checks or a production allowlist. USDC decimals remain unchecked in that file. Do not promote the file directly to runtime configuration.

## Verification belongs to the relevant build chunk

Chunk 1 implements country → currency mapping and native-currency labels/formatting with fixtures. Before chunk 2 enables actual holdings, confirm each selected contract against its issuer, read bytecode/decimals/symbol on Base 8453, and record issuer/asset identity. Never infer token decimals from currency fraction digits: IDRX is listed with 2, while other assets use 6, 8 or 18. The issuer-confirmed Base deployment is `0xfb8718a69aed7726afb3f04d2bd4bfde1bdcb294` (6 decimals, verified onchain via bilira.co/tr/tryb-kullanimi).

Before chunk 4 or local-funding expansion enables a route, match the provider's network and asset ID to that exact contract; fetch a real country/payment-method quote; verify settlement to the smart account. Record buy/sell support separately, fees/limits and the check date. A token's existence on Base does not establish a one-to-one onramp. These provider checks remain pending; no authenticated Onramper route request was made in this review.

Acceptance checks: each enabled region resolves to the intended currency and exact token; two assets with the same ticker remain distinct; country switching does not mutate balances; formatting follows the selected locale; small positive balances are not rendered as zero; input precision converts losslessly into the token's base units; unsupported routes stay unavailable; transaction review exposes the actual asset.
