"use client";

import { Button } from "@/components/ui/button";
import { moneySheetIntent } from "@/client/money-modal";
import type { InvestAsset } from "@/config/invest-assets";
import { useProductOffering } from "@/client/home/product-offering";
import { resolveTradeAsset } from "@/shared/trading/assets";
import { useAssetTrade } from "./use-asset-trade";
import { StockTradeActions } from "./stock-trade-actions";

export function TradeActions({ asset, layout = "row" }: {
  asset: InvestAsset;
  layout?: "row" | "sticky";
}) {
  const resolution = resolveTradeAsset(asset.id);
  if (!resolution) return null;
  if (resolution.status === "eligibility-required") {
    return <StockTradeActions asset={asset} layout={layout} />;
  }
  return <AvailableTradeActions asset={asset} layout={layout} />;
}

function AvailableTradeActions({ asset, layout }: { asset: InvestAsset; layout: "row" | "sticky" }) {
  const trade = useAssetTrade([{ assetId: asset.id, assetName: asset.displayName }]);
  const investOffered = useProductOffering().products.invest === "on";
  const availability = trade.availability.get(asset.id);
  const holding = availability?.status === "available" ? availability.balanceBaseUnits : null;
  const ready = availability?.status === "available" && !!trade.session?.smartAccount;
  const note = !trade.session?.smartAccount
    ? trade.account?.status === "restoring" || trade.account?.status === "validating"
      ? "Checking trading availability…"
      : trade.account?.status === "verified" ? "Trading isn't available for this account." : "Sign in to trade."
    : availability?.status === "unavailable"
      ? availability.reason === "signer-unsupported"
        ? "Trading isn't available for this account."
        : availability.reason === "token-unreadable"
          ? "This token couldn't be read on Base. You can still send it."
          : availability.reason === "asset-unsupported"
            ? "This asset can't be traded."
            : "Trading isn't available right now. Try again later."
      : availability === null
        ? "Checking trading availability…"
        : availability?.status === "available" && availability.buy === "blocked" ? "Buying is unavailable. You can still sell or send." : null;
  const sellNote = ready && holding === "0" ? `No ${availability.token.symbol} available to sell.` : null;
  const buyNote = ready && trade.cash === "0" ? `No Cash available to buy ${asset.displayName}.` : null;
  const balancesNote = ready && (trade.balances.status === "error" || (trade.balances.status === "ready" && !trade.usableBalances)) ? "Cash balance isn't available right now." : null;
  return <div className={layout === "sticky" ? "sticky bottom-[env(safe-area-inset-bottom)] z-2 mt-4 space-y-2 bg-background pt-3" : "space-y-2"}>
    <div className={layout === "sticky" && investOffered ? "grid grid-cols-2 gap-2" : "flex justify-end gap-2"} aria-label={`Trade ${asset.displayName}`}>
      {investOffered ? <Button size="touch" disabled={!ready || availability.buy === "blocked" || trade.cash === null || trade.cash === "0"} {...moneySheetIntent(() => trade.intent(asset.id, "buy"))} onClick={(event) => trade.open(asset.id, "buy", event.currentTarget)}>Buy</Button> : null}
      <Button size="touch" variant="secondary" disabled={!ready || holding === null || BigInt(holding) === BigInt(0)} {...moneySheetIntent(() => trade.intent(asset.id, "sell"))} onClick={(event) => trade.open(asset.id, "sell", event.currentTarget)}>Sell</Button>
    </div>
    {investOffered && (note || balancesNote || sellNote || buyNote) ? <p className="text-end text-sm text-muted-foreground" role="note">{note ?? balancesNote ?? sellNote ?? buyNote}</p> : !investOffered ? <p className="text-end text-sm text-muted-foreground" role="note">Buying is no longer offered. You can still sell.</p> : null}
    {trade.sheet}
  </div>;
}
