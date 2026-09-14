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
        className="flex-nowrap cursor-pointer items-center text-left"
        onClick={onOpen}
        aria-describedby={`${asset.id}-action-hint`}
      >
        <ItemMedia variant="avatar">
          <AssetIcon mark={mark} />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle>{asset.displayName}</ItemTitle>
          <ItemDescription>{asset.displaySymbol}</ItemDescription>
        </ItemContent>
        <ItemContent className="items-end text-right">
          <ItemTitle numeric>{price.value}</ItemTitle>
          {change !== "—" ? (
            <span
              className={
                changeTone === "positive"
                  ? "text-sm text-market-gain"
                  : changeTone === "negative"
                    ? "text-sm text-market-loss"
                    : "text-sm text-muted-foreground"
              }
              data-money-change={changeTone}
            >
              {change}
            </span>
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
