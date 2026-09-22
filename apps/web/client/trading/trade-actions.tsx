"use client";

import { Button } from "@/components/ui/button";
import type { InvestAsset } from "@/config/invest-assets";
import { getTradeAssetStatus } from "@/shared/trading/assets";

export function TradeActions({
  asset,
  layout = "row",
}: {
  asset: InvestAsset;
  layout?: "row" | "sticky";
}) {
  const status = getTradeAssetStatus(asset.id);
  if (!status) return null;
  if (status.status === "eligibility-required") {
    return (
      <div
        className={layout === "sticky" ? "mt-4 text-sm text-muted-foreground" : "text-right text-sm text-muted-foreground"}
        role="note"
      >
        Stocks aren&apos;t available yet.
      </div>
    );
  }

  return (
    <div className={layout === "sticky" ? "sticky bottom-[env(safe-area-inset-bottom)] z-2 mt-4 space-y-2 bg-background pt-3" : "space-y-2"}>
      <div
        className={layout === "sticky" ? "grid grid-cols-2 gap-2" : "flex justify-end gap-2"}
        aria-label={`Trade ${asset.displayName}`}
      >
        <Button className="h-11" size="lg" disabled>Buy</Button>
        <Button className="h-11" size="lg" variant="secondary" disabled>Sell</Button>
      </div>
      <div className="text-right text-sm text-muted-foreground" role="note">
        Swaps aren&apos;t available right now.
      </div>
    </div>
  );
}
