# Home — currency defaults

Status: product defaults confirmed on 2026-09-07, including CADD for Canada and wARS for Argentina. No live routes enabled.
Reviewed: 2026-09-07
Related: [regional money rules](regional-money.md), [contract candidates](stablecoin-candidates.json).

## Recommendation

Select one default per currency, keeping issuer choice out of everyday onboarding. The app displays the native currency name and symbol; the selected token is the implementation underneath it. Prioritize documented issuance/redemption, understandable token behavior and Base integration. A working Onramper route may change a close choice, but no authenticated Onramper routes have been tested here.

All selections are confirmed product defaults. “Verification pending” means integration checks remain, not that the product choice is unconfirmed. “Additional verification” needs an additional material fact resolved. “Hold” means keep the currency presentation available, but do not enable funding until the identified issue is resolved. These recommendations cover the dashboard roster plus USD, not every stablecoin now available globally.

| Currency / region | Confirmed default | Integration status | Reason / nearest alternative |
|---|---|---|---|
| USD · United States | USDC · Circle | Verification pending | Matches our CDP funding/saving stack; issuer-published Base contract. [Circle](https://developers.circle.com/stablecoins/usdc-contract-addresses) |
| EUR · Euro area | EURC · Circle | Verification pending | Same issuer integration as USD, documented Base support and clear euro denomination. Prefer over EURAU/VEUR for the initial stack. [Circle](https://www.circle.com/eurc) |
| GBP · United Kingdom | tGBP · BCP Technologies | Verification pending | Issuer publishes Base evidence, reserve attestations and contract audits. Prefer over VGBP for the local-pound account. This is BCP's token, not unrelated assets with a similar ticker. [Issuer](https://www.tokenisedgbp.com/transparency) |
| BRL · Brazil | BRZ · Transfero | Verification pending | Documented Base support and established payment/conversion infrastructure. BRLA is the alternative if its actual funding route is better. Do not select BRLY as a cash default. [Transfero](https://transfero.com/brz-stablecoin) |
| MXN · Mexico | MXNB · Juno / Bitso | Verification pending | Mexican financial-rail integration is a good fit for Home. Prefer over MXNE as the default; check actual route availability. Issuer transparency page lists Base despite an older FAQ omitting it. [Juno](https://mxnb.mx/en-US/transparency), [issuer model](https://mxnb.mx/whitepaper.pdf) |
| ARS · Argentina | wARS · Ripio | Additional verification | Selected default; aligns with the Ripio local-currency suite used for COP/CLP/PEN. Verify Base contract, reserves/redemption and funding route. [Ripio](https://www.ripio.com/es/assets/wars/whitepaper), [Base registry](https://dune.com/queries/4780995) |
| AUD · Australia | AUDD · AUDC | Verification pending | Issuer explicitly supports Base, buying/selling and reserve transparency. Prefer over AUDF for this first integration. [AUDD](https://www.audd.digital/) |
| CAD · Canada | CADD | Additional verification | Selected default; Moneda documents CADD as its Canadian-dollar balance on Base. Verify exact issuer, canonical contract and funding route; CADC remains an alternative asset only. [CADD](https://moneda.com/faqs/what-is-cadd), [Base registry](https://dune.com/queries/4780995) |
| CHF · Switzerland | VCHF · VNX | Additional verification | Dashboard-listed CHF candidate; VNX documents CHF redemption APIs. Confirm current Base issuance/redemption and contract before enabling. [VNX API](https://docs.vnx.io/), [Base registry](https://dune.com/queries/4780995) |
| SGD · Singapore | XSGD · StraitsX | Verification pending | Issuer provides a Base contract and SGD redemption model. [StraitsX](https://www.straitsx.com/xsgd) |
| IDR · Indonesia | IDRX | Verification pending | Issuer confirms Base `0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22` and **2** decimals — preserve token precision; do not infer from IDR fiat digits. Mint API researched; keep `enabled: false` until #60 is smokeable and IDRX sandbox keys exist. [IDRX](https://docs.idrx.co/introduction/supported-chain-and-contract-address), [research](idrx-onramp.md) |
| NGN · Nigeria | cNGN | Verification pending | Documented bank-account deposits/redemption and integration APIs. Prefer over NGNC for the initial naira account. [cNGN](https://docs.cngn.co/) |
| ZAR · South Africa | ZARP | Verification pending | Issuer publishes the Base contract and transparency material. [ZARP](https://www.zarpstablecoin.com/transparency/) |
| NZD · New Zealand | NZDD | Verification pending | Issuer documents Base availability, NZD backing and local buy/sell channels. [NZDD](https://nzdd.com/) |
| MYR · Malaysia | MYRC · BLOX | Verification pending | Issuer docs cover Base and local payment-gateway integration. Verify eligibility and the exact Home funding route. [BLOX](https://docs.blox.my/) |
| COP · Colombia | wCOP · Ripio | Additional verification | Fits Ripio's local-currency suite and is listed in Base's registry; confirm Base-specific issuer mapping and funding. [Ripio suite](https://action.ripio.com/es/blog/las-stablecoins-wfiat-ya-estan-disponibles-en-celo), [Base registry](https://dune.com/queries/4780995) |
| CLP · Chile | wCLP · Ripio | Additional verification | Same issuer family as COP/PEN, reducing integration variation. Base route still needs verification. [Ripio suite](https://action.ripio.com/es/blog/las-stablecoins-wfiat-ya-estan-disponibles-en-celo), [Base registry](https://dune.com/queries/4780995) |
| PEN · Peru | wPEN · Ripio | Additional verification | Same local-currency suite; prefer the roster's candidate pending Base contract and redemption checks. [Ripio suite](https://action.ripio.com/es/blog/las-stablecoins-wfiat-ya-estan-disponibles-en-celo), [Base registry](https://dune.com/queries/4780995) |
| TRY · Türkiye | TRYB · BiLira | Verification pending | Issuer-published Base contract confirmed: `0xfb8718a69aed7726afb3f04d2bd4bfde1bdcb294`, decimals 6 (verified onchain). Source: [bilira.co/tr/tryb-kullanimi](https://www.bilira.co/tr/tryb-kullanimi), [BiLira](https://www.bilira.co/). |
| TZS · Tanzania | nTZS · NEDA Labs | Hold | Candidate fits local mobile-money usage, but issuer repository describes sandbox scope and unfinished audit/control items. Confirm current production readiness before funding. [Issuer repository](https://github.com/NEDA-LABS/ntzs) |
| UGX · Uganda | UGXC | Hold | Only candidate in the reviewed roster; insufficient primary issuer/redemption evidence found to recommend live use. Keep as the review candidate. [Base registry](https://dune.com/queries/4780995) |
| THB · Thailand | THBT | Hold | Ticker/issuer identity unresolved. STBLE.FI describes Ethereum/USDT collateral, while TrueMoney also uses THBT; neither establishes which issuer owns the dashboard's Base contract. Resolve before using it. [STBLE.FI](https://stble.fi/), [TrueMoney terms](https://www.truemoney.com/wp-content/uploads/2025/07/truemoney-thbt-TC_THBT-20250730-1.pdf) |

## Selection rationale and remaining checks

**Brazil: BRZ.** Crown's current whitepaper calls BRLY a rebasing representation of reserves used in the background, and identifies BRLV as its customer-facing token. The dashboard's large BRLY supply therefore does not make it Home's appropriate default cash asset. Crown could be a separate later integration; BRLA remains a plausible funding-driven alternative. [Crown whitepaper](https://crown-2b36dce9.mintlify.app/whitepaper)

**Argentina: wARS.** Confirmed product choice. Preserve the actual Base asset identity; Ripio's deployment on another chain is not evidence of Home's Base funding route.

**Canada: CADD.** Confirmed product choice. Reconcile the dashboard candidate against the current issuer's Base deployment before using the address. No CADC funding observations establish CADD readiness.

**TRY, THB, UGX and TZS need explicit follow-up.** TRY needs the precise contract; the other three stay out of live funding until issuer/production questions are answered. This does not prevent showing their native currency in a clearly non-funded regional preview.

## Implementation of confirmed defaults

These selections establish product defaults for implementation; they do not assert that providers are integrated or automatically enable live routes. Bind confirmed defaults to Base chain ID and verified contract/decimals, then test the exact funding route. No issuer changes happen silently after confirmation.

Suggested first demo candidates: USD/USDC, BRL/BRZ and IDR/IDRX. EUR/EURC is the simpler fallback if either local funding integration is not ready. This balances the local-money story with the existing CDP dollar flow; the choice of demo regions remains separate from approving the full mapping.
