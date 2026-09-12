"use client";

import { ListRow } from "@home/ui";
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
    <ListRow
      leading={<AssetIcon mark={mark} />}
      label={asset.displayName}
      description={asset.displaySymbol}
      value={price.value}
      valueDescription={change !== "—" ? (
        <span className={styles.change} data-money-change={changeTone}>{change}</span>
      ) : undefined}
      onPress={onOpen}
      aria-label={`${asset.displayName} details`}
    />
  );
}
