import type { ShellLocation } from "@/config/shell-location";
import { shellHref } from "@/config/shell-location";
import { resolveMarketPriceAssetIdentity } from "@/shared/invest/contracts/market-price-history";
import { isRecord } from "@/shared/guards";
import { getDiscoverShelf, type DiscoverShelfId } from "./discover";

export type InvestView =
  | { screen: "hub" }
  | { screen: "category"; shelfId: DiscoverShelfId }
  | { screen: "detail"; assetId: string; from: "hub" | "search" | DiscoverShelfId };

export function investViewFromLocation(location: Pick<ShellLocation, "shelf" | "asset">): InvestView {
  const shelf = location.shelf ? getDiscoverShelf(location.shelf) : null;
  const identity = location.asset
    ? resolveMarketPriceAssetIdentity(location.asset)
    : null;
  const state: unknown = typeof window === "undefined" ? null : window.history.state;
  const detailFrom = isRecord(state) ? state.investDetailFrom : null;
  const historyShelf = typeof detailFrom === "string" ? getDiscoverShelf(detailFrom) : null;
  if (identity) {
    return {
      screen: "detail",
      assetId: identity.assetId,
      from: detailFrom === "search" ? "search" : historyShelf?.id ?? shelf?.id ?? "hub",
    };
  }
  if (shelf) return { screen: "category", shelfId: shelf.id };
  return { screen: "hub" };
}

export function investHref(view: InvestView): string {
  if (view.screen === "category") {
    return shellHref({ panel: "invest", shelf: view.shelfId });
  }
  if (view.screen === "detail") {
    return shellHref({ panel: "invest", asset: view.assetId });
  }
  return shellHref({ panel: "invest" });
}
