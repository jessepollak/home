"use client";

import { Button } from "@/components/ui/button";
import type { InvestAsset } from "@/config/invest-assets";
import { getTradeAssetStatus } from "@/shared/trading/assets";
import { useBitcoinTrade } from "./use-bitcoin-trade";
import { StockTradeActions } from "./stock-trade-actions";

export function TradeActions({ asset, layout = "row" }: {
  asset: InvestAsset;
  layout?: "row" | "sticky";
}) {
  const status = getTradeAssetStatus(asset.id);
  if (!status) return null;
  if (status.status === "eligibility-required") {
    return <StockTradeActions asset={asset} layout={layout} />;
  }
  if (asset.id !== "cbbtc") return <UnavailableActions asset={asset} layout={layout} />;
  return <BitcoinTradeActions asset={asset} layout={layout} />;
}

function UnavailableActions({ asset, layout }: { asset: InvestAsset; layout: "row" | "sticky" }) {
  return <div className={layout === "sticky" ? "sticky bottom-[env(safe-area-inset-bottom)] z-2 mt-4 space-y-2 bg-background pt-3" : "space-y-2"}>
    <div className={layout === "sticky" ? "grid grid-cols-2 gap-2" : "flex justify-end gap-2"} aria-label={`Trade ${asset.displayName}`}>
      <Button size="touch" disabled>Buy</Button>
      <Button size="touch" variant="secondary" disabled>Sell</Button>
    </div>
    <div className="text-end text-sm text-muted-foreground" role="note">Swaps aren&apos;t available right now.</div>
  </div>;
}

function BitcoinTradeActions({ asset, layout }: { asset: InvestAsset; layout: "row" | "sticky" }) {
  const { availability, balances, usableBalances, cash, holding, ready, open, preload, sheet } = useBitcoinTrade();
  const note = availability?.status === "unavailable"
    ? availability.reason === "signer-unsupported"
      ? "Trading isn't available for this account."
      : "Trading isn't available right now."
    : availability === null ? "Checking trading availability…" : null;
  const sellNote = ready && holding === "0" ? "No Bitcoin available to sell." : null;
  const buyNote = ready && cash === "0" ? "No Cash available to buy Bitcoin." : null;
  const balancesNote = ready && (balances.status === "error" || (balances.status === "ready" && !usableBalances)) ? "Balances aren't available right now." : null;
  return <div className={layout === "sticky" ? "sticky bottom-[env(safe-area-inset-bottom)] z-2 mt-4 space-y-2 bg-background pt-3" : "space-y-2"}>
    <div className={layout === "sticky" ? "grid grid-cols-2 gap-2" : "flex justify-end gap-2"} aria-label={`Trade ${asset.displayName}`}>
      <Button size="touch" disabled={!ready || cash === null || cash === "0"} onPointerDown={preload} onClick={(event) => open("buy", event.currentTarget)}>Buy</Button>
      <Button size="touch" variant="secondary" disabled={!ready || holding === null || holding === "0"} onPointerDown={preload} onClick={(event) => open("sell", event.currentTarget)}>Sell</Button>
    </div>
    {note || balancesNote || sellNote || buyNote ? <p className="text-end text-sm text-muted-foreground" role="note">{note ?? balancesNote ?? sellNote ?? buyNote}</p> : null}
    {sheet}
  </div>;
}
