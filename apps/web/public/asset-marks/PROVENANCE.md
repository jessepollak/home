# Asset brand marks

Color SVG marks from [spothq/cryptocurrency-icons](https://github.com/spothq/cryptocurrency-icons)
v0.18.1 (jsDelivr pin `npm/cryptocurrency-icons@0.18.1/svg/color/<symbol>.svg`),
dedicated to the public domain under [CC0 1.0](./LICENSE.md).

| File | Upstream | Used for |
|---|---|---|
| `usdc.svg` | `color/usdc.svg` | USDC |
| `eth.svg` | `color/eth.svg` | ETH, WETH, and cbETH |
| `btc.svg` | `color/btc.svg` | cbBTC |
| `xrp.svg` | `color/xrp.svg` | cbXRP |
| `doge.svg` | `color/doge.svg` | cbDOGE |
| `ada.svg` | `color/ada.svg` | cbADA |

The files are unmodified. `apps/web/components/currency-mark.tsx` owns the map
from verified Base asset keys (native ETH, canonical USDC, WETH, and the Borrow
collateral registry) to files; a token is never matched by its symbol, so an
unrelated token that reuses a symbol such as `USDC` keeps its provider image or
the symbol fallback. Do not add marks from a different source without updating
this file.

CC0 covers copyright only. These assets' marks remain the trademarks of their
respective owners, and Home shows them only to identify those assets, not to
imply endorsement.
