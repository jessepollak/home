"use client";

import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import type { InvestAsset } from "@/config/invest-assets";
import {
  presentInvestAssetMark,
  type AssetMarkResolution,
} from "@/client/asset-mark/presentation";
import type { MarketDataState } from "@/shared/invest/invest-market";
import { moneyChangeTone } from "@/shared/formatting";
import { useMarketDisplay } from "./use-market-display";
import { AssetIcon } from "./asset-icon";

export function DiscoverAssetRow({
  asset,
  market,
  assetMarkResolution = {},
  onOpen,
}: {
  asset: InvestAsset;
  market: MarketDataState;
  assetMarkResolution?: AssetMarkResolution;
  onOpen: () => void;
}) {
  const price = useMarketDisplay(asset.id, market);
  const mark = presentInvestAssetMark(asset, assetMarkResolution);
  const change = price.changeLabel ?? "—";
  const changeTone = moneyChangeTone(change);

  return (
    <li>
      <Item
        render={<Button variant="ghost" />}
        size="sm"
        className="flex-nowrap cursor-pointer items-center border-0 py-2 text-left hover:bg-muted"
        onClick={onOpen}
        aria-describedby={`${asset.id}-action-hint`}
      >
        <ItemMedia variant="image" className="size-8 self-center translate-y-0 rounded-full bg-muted">
          <AssetIcon mark={mark} />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="text-sm font-medium">{asset.displayName}</ItemTitle>
          <ItemDescription className="text-xs text-muted-foreground">{asset.displaySymbol}</ItemDescription>
        </ItemContent>
        <ItemContent className="items-end text-right">
          <ItemTitle className="text-sm font-medium tabular-nums">{price.value}</ItemTitle>
          {change !== "—" ? (
            <ItemDescription
              className={
                changeTone === "positive"
                  ? "text-xs text-[var(--market-gain)]"
                  : changeTone === "negative"
                    ? "text-xs text-[var(--market-loss)]"
                    : "text-xs text-muted-foreground"
              }
              data-money-change={changeTone}
            >
              {change}
            </ItemDescription>
          ) : null}
        </ItemContent>
        <ItemActions aria-hidden="true">
          <ChevronRight className="size-4" />
        </ItemActions>
        <span id={`${asset.id}-action-hint`} hidden>
          View {asset.displayName} details
        </span>
      </Item>
    </li>
  );
}
