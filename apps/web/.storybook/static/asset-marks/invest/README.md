# Invest logo snapshots

These are unmodified PNG bytes from the production asset-icon resolver's public image URLs, captured on 2026-10-04 for the Invest library compositions. The URL and configured asset-ID mapping is in `stories/review/explorations/library/invest-logos.ts`.

Production source: `server/market-data/asset-icons/resolve.ts`, `getResolvedAssetIcons()`, which prefers Codex token-image metadata and falls back to onchain `contractURI` metadata. The snapshots retain that resolver's images rather than approximating company logos. Stocks use their configured token IDs and contract addresses from `config/invest-assets.ts`; Bitcoin reuses the shared asset-detail fixture's configured `cbbtc` asset.

The composition passes the same asset-key-to-image-URL metadata the production presenter consumes. MSW handles each real URL using these local bytes so stories make no live image-provider requests. Refresh the URL mapping and corresponding PNG together if the upstream metadata changes.
