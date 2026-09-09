import {
  parseShellLocation,
  shellHref,
  type ShellLocation,
  type ShellSearchInput,
} from "@/config/shell-location";
import { resolveMarketPriceAssetIdentity } from "@/server/market-data/codex/history-contract";
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

export function investViewFromSearch(search: ShellSearchInput): InvestView {
  return investViewFromLocation(parseShellLocation(search));
}

export function investHref(view: InvestView): string {
  if (view.screen === "category") {
    return shellHref("/dashboard", { panel: "invest", shelf: view.shelfId });
  }
  if (view.screen === "detail") {
    return shellHref("/dashboard", {
      panel: "invest",
      asset: view.assetId,
      shelf: view.from === "hub" ? null : view.from,
    });
  }
  return shellHref("/dashboard", { panel: "invest" });
}
