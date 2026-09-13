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
import styles from "./invest-experience.module.css";

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
    <li className={styles.assetRow}>
      <Item
        render={<Button variant="ghost" />}
        className="min-h-13 flex-nowrap border-0 text-left"
        onClick={onOpen}
        aria-describedby={`${asset.id}-action-hint`}
      >
        <ItemMedia><AssetIcon mark={mark} /></ItemMedia>
        <ItemContent>
          <ItemTitle className="text-row-label!">{asset.displayName}</ItemTitle>
          <ItemDescription className="text-metadata!">{asset.displaySymbol}</ItemDescription>
        </ItemContent>
        <ItemContent className="items-end text-right">
          <ItemTitle className="font-mono text-row-value!">{price.value}</ItemTitle>
          {change !== "—" ? (
            <ItemDescription
              className={`${styles.change} text-metadata`}
              data-money-change={changeTone}
            >
              {change}
            </ItemDescription>
          ) : null}
        </ItemContent>
        <ItemActions aria-hidden="true"><ChevronRight /></ItemActions>
        <span id={`${asset.id}-action-hint`} hidden>
          View {asset.displayName} details
        </span>
      </Item>
    </li>
  );
}
