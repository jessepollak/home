"use client";

import { Plus } from "lucide-react";
import type { FetchActivity } from "@/client/activity";
import { Button } from "@/components/ui/button";
import { FundingActions } from "@/client/funding/funding-actions";
import { useSavingsRateLabel } from "@/client/savings/use-savings-rate-label";
import { useBorrowOfferRate } from "@/client/borrowing/borrowing-experience";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { TransferActions } from "@/client/transfers";
import type { TransferAssetAvailability } from "@/shared/transfers/types";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { RegionId } from "@/config/regions";
import { ConnectedActivityPanel } from "./activity-panel";
import { HomeOverview, HomeSectionHeading } from "./home-overview";
import type { HomeAssetBalancesPresentation } from "./home-types";
import { ShimmerRows } from "./panel-shared";
import { useOptionalHomeShellRouting } from "./panel-routing";

export function HomePanel({
  assetBalances,
  activitySession,
  sendAvailability,
  assetMarkResolution,
  fetchActivity,
  fetchOperations,
  onOpenCash,
  onOpenInvestments,
  onOpenBorrow,
  initialAddMoney = false,
  returnedFromProvider = false,
  initialSendFlow = false,
  initialSendActionId = null,
  regionId,
}: {
  assetBalances?: HomeAssetBalancesPresentation;
  activitySession: VerifiedAccountSession | null;
  sendAvailability: readonly (TransferAssetAvailability & { imageUrl?: string })[];
  assetMarkResolution?: AssetMarkResolution;
  fetchActivity: FetchActivity;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
  onOpenCash: () => void;
  onOpenInvestments: () => void;
  onOpenBorrow: () => void;
  initialAddMoney?: boolean;
  returnedFromProvider?: boolean;
  initialSendFlow?: boolean;
  initialSendActionId?: string | null;
  regionId: RegionId;
}) {
  const isLoading = assetBalances?.status === "loading";
  const isRevalidating = assetBalances?.revalidating === true;
  const resolvedAssetMarks: AssetMarkResolution = assetMarkResolution ?? {
    images: Object.fromEntries(
      sendAvailability.map((asset) => [asset.assetKey, asset.imageUrl ?? null]),
    ),
    pending: false,
  };
  const showSessionShimmer = !activitySession && (isLoading || isRevalidating);
  const cashRate = useSavingsRateLabel(regionId);
  const borrowOfferRate = useBorrowOfferRate({
    enabled: assetBalances?.summary?.borrow.kind === "none",
    regionId,
  });
  const activityHeading = <HomeSectionHeading id="activity-title">Activity</HomeSectionHeading>;
  const routing = useOptionalHomeShellRouting();
  const addMoneyPrompt = routing ? (
    <Button
      variant="outline"
      size="lg"
      className="h-11"
      onClick={() => routing.setFlow("add-money", { mode: "push" })}
    >
      <Plus className="size-4" aria-hidden="true" />
      Add money
    </Button>
  ) : undefined;

  return (
    <HomeOverview
      assetBalances={assetBalances}
      cashRate={cashRate}
      borrowOfferRate={borrowOfferRate}
      destinations={{ onOpenCash, onOpenInvestments, onOpenBorrow }}
      actions={
        <>
          <FundingActions
            initialOpen={initialAddMoney}
            returnedFromProvider={returnedFromProvider}
            regionId={regionId}
          />
          <PresentationRegionProvider regionId={regionId}>
            <TransferActions
              initialOpen={initialSendFlow}
              initialActionId={initialSendActionId}
              availableAssets={sendAvailability}
              assetMarkResolution={resolvedAssetMarks}
              regionId={regionId}
            />
          </PresentationRegionProvider>
        </>
      }
      activity={showSessionShimmer ? (
        <section className="space-y-3" aria-labelledby="activity-title" aria-busy="true">
          <div className="px-4">{activityHeading}</div>
          <div className="px-1"><ShimmerRows count={3} /></div>
        </section>
      ) : (
        <ConnectedActivityPanel
          density="feed"
          header={activityHeading}
          activitySession={activitySession}
          fetchActivity={fetchActivity}
          fetchOperations={fetchOperations}
          regionId={regionId}
          emptyAction={addMoneyPrompt}
        />
      )}
    />
  );
}
