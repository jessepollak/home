"use client";

import { AssetDetailScreen } from "@/features/invest/asset-detail-screen";
import {
  getDiscoverAsset,
  marketForAsset,
} from "@/features/invest/discover";
import { useInvestDiscover } from "@/features/invest/use-invest-discover";
import { useMarketPrices } from "@/features/invest/use-market-prices";
import { usePriceHistory } from "@/features/invest/use-price-history";

export function LivelineQaClient({ assetId }: { assetId: string }) {
  const markets = useMarketPrices();
  const discover = useInvestDiscover();
  const history = usePriceHistory(assetId, "1W");
  const asset = getDiscoverAsset(assetId, discover.memeAssets);
  if (!asset) {
    return (
      <main className="app-frame" style={{ maxWidth: 390 }}>
        <p>Unknown asset: {assetId}</p>
      </main>
    );
  }

  const first = history.points[0]?.value;
  const last = history.points[history.points.length - 1]?.value;
  return (
    <main className="app-frame" style={{ maxWidth: 390, paddingBottom: 24 }}>
      <p
        data-qa-codex={`${history.status}:${history.points.length}`}
        style={{
          margin: "8px 0 4px",
          color: "var(--home-muted)",
          fontSize: 11,
        }}
      >
        QA Codex {assetId} 1W · {history.status}
        {history.status === "ready"
          ? ` · ${history.points.length} pts · ${first}→${last}`
          : ""}
      </p>
      <AssetDetailScreen
        asset={asset}
        market={marketForAsset(asset, markets)}
        assetMarkResolution={discover.assetMarkResolution}
        onBack={() => {}}
      />
    </main>
  );
}
