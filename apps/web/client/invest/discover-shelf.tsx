import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { SectionHeader } from "@/components/section-header";
import type { InvestAsset } from "@/config/invest-assets";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import type { MarketDataState } from "@/shared/invest/invest-market";
import type { MemeShelfStatus } from "./discover";
import { DiscoverAssetRow } from "./discover-asset-row";

export function DiscoverShelf({
  title,
  headingLevel = 3,
  assets,
  market,
  status = "ready",
  assetMarkResolution = {},
  onSeeAll,
  onOpenAsset,
}: {
  title: string;
  headingLevel?: 2 | 3;
  assets: readonly InvestAsset[];
  market: MarketDataState;
  status?: MemeShelfStatus;
  assetMarkResolution?: AssetMarkResolution;
  onSeeAll: () => void;
  onOpenAsset: (asset: InvestAsset) => void;
}) {
  const titleId = `${title.toLowerCase()}-shelf-title`;

  return (
    <section aria-labelledby={titleId}>
      <Card>
        <CardHeader>
          <SectionHeader
            headingId={titleId}
            title={title}
            ariaLevel={headingLevel}
            action={
              <Button variant="ghost" size="card-action" onClick={onSeeAll}>
                See all ›
              </Button>
            }
          />
        </CardHeader>
        <CardContent inset="list">
          {assets.length > 0 ? (
            <ul className="m-0 list-none p-0">
              {assets.map((asset) => (
                <DiscoverAssetRow
                  key={asset.id}
                  asset={asset}
                  market={market}
                  assetMarkResolution={assetMarkResolution}
                  onOpen={() => onOpenAsset(asset)}
                />
              ))}
            </ul>
          ) : (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {shelfStatusLabel(status)}
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function shelfStatusLabel(status: MemeShelfStatus) {
  if (status === "loading") return "Loading";
  if (status === "error" || status === "unavailable") return "Unavailable";
  return "None trending";
}
