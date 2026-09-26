"use client";

import type { InvestAsset } from "@/config/invest-assets";
import { isServerVerified, useAccountWallet } from "@/client/account/cdp-client";
import { useStockTradeEligibility } from "./use-stock-trade-eligibility";

export function StockTradeActions({ asset, layout }: { asset: InvestAsset; layout: "row" | "sticky" }) {
  const account = useAccountWallet();
  const session = isServerVerified(account) ? account.session : null;
  const eligibility = useStockTradeEligibility(session, account.fetchAccountResource);
  const note = !session?.smartAccount ? "Stocks aren't available yet."
    : eligibility === null ? "Checking stock trading…"
    : eligibility === "unavailable" ? "Stock trading isn't available right now."
    : eligibility.buy === "restricted" ? "Stock buys aren't available in your location."
    : "Stocks can't be traded in Home yet.";
  return <div className={layout === "sticky" ? "mt-4 text-sm text-muted-foreground" : "text-end text-sm text-muted-foreground"} role="status" aria-label={`${asset.displayName} trading`}>{note}</div>;
}
