import type { ShellLocation } from "@/config/shell-location";
import { shellHref } from "@/config/shell-location";
import { resolveMarketPriceAssetIdentity } from "@/shared/invest/contracts/market-price-history";
import { getDiscoverShelf, type DiscoverShelfId } from "./discover";

export type InvestView =
  | { screen: "hub" }
  | { screen: "category"; shelfId: DiscoverShelfId }
  | { screen: "detail"; assetId: string; from: "hub" | DiscoverShelfId };

export function investViewFromLocation(location: Pick<ShellLocation, "shelf" | "asset">): InvestView {
  const shelf = location.shelf ? getDiscoverShelf(location.shelf) : null;
  const identity = location.asset
    ? resolveMarketPriceAssetIdentity(location.asset)
    : null;
  if (identity) {
    return {
      screen: "detail",
      assetId: identity.assetId,
      from: shelf ? shelf.id : "hub",
    };
  }
  if (shelf) return { screen: "category", shelfId: shelf.id };
  return { screen: "hub" };
}

/**
 * Emits flat canonical Invest paths: /invest, /invest/<category>, or
 * /invest/<assetId>. The category context of an in-app detail view is local
 * state, not a path segment, so history carries one low-cardinality segment.
 */
export function investHref(view: InvestView): string {
  if (view.screen === "category") {
    return shellHref({ panel: "invest", shelf: view.shelfId });
  }
  if (view.screen === "detail") {
    return shellHref({ panel: "invest", asset: view.assetId });
  }
  return shellHref({ panel: "invest" });
}
