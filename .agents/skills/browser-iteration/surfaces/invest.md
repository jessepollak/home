### `invest`
- **Entry context**: invest · `/invest`, `/invest/stocks|crypto|memes`, `/invest/<assetId>` · same · session + `/api/invest/discover`, `/api/market-prices` fixtures · Main navigation `Invest` button (primary-navigation.tsx), goto path.

- **Live**: read-only
- **Owned paths**: `apps/web/app/invest/**`, `apps/web/client/invest/**`, `apps/web/client/trading/**`, `apps/web/app/api/invest/**`, `apps/web/app/api/market-prices/**`
- **Reach**:
  1. `goto "/invest"`
  2. `expect "Invest"`
- **Notes**: The smoke asset-detail path clicks Main navigation `Invest`, clicks the asset row matching `/^NVIDIA/`, expects `/invest/nvdac`, and reads `NVIDIA` from `[data-shell-header-title]`.
- **Expect**: hub shelves `Stocks`, `Crypto`, `Memes` (`discoverShelves`, client/invest/discover.ts; shelf CardTitle `role=heading aria-level=3`, discover-shelf.tsx); `See all ›` per shelf; empty shelf copy `Loading`/`Unavailable`/`None trending` (discover-shelf.tsx `shelfStatusLabel`); category screen `Back to Invest` (category-screen.tsx); asset detail price (`data-tone`), change (`data-money-change`), `Trade <displayName>` group with disabled `Buy`/`Sell` (client/trading/trade-actions.tsx).
- **States**: hub loading/empty/error per shelf (`MemeShelfStatus`); category pagination error `Retry`; detail status screen variant (asset-detail-screen.tsx `AssetDetailStatusScreen`).
- **Evidence**: screenshot; DOM snapshot; console/errors.
- **Owned by**: `apps/web/client/invest/`, `apps/web/client/trading/trade-actions.tsx`, `/api/invest/discover`, `/api/market-prices`, `/api/market-prices/history`.
- **Unknowns**: meme pagination copy remains unknown because no fixture-backed browser state reaches it; category links expose visible `See all ›` text.
