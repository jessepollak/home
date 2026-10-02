"use client";

import { useRef } from "react";
import { Plus } from "lucide-react";
import type { FetchActivity } from "@/client/activity";
import { ActivitySurface } from "@/client/activity/activity-panel";
import { Button } from "@/components/ui/button";
import { FundingActions } from "@/client/funding/funding-actions";
import { preloadAddMoneySheet } from "@/client/funding/funding-experience";
import { prefetchAddMoneyMethods } from "@/client/funding/funding-prefetch";
import { moneySheetIntent } from "@/client/money-modal";
import { browserHomeQueryClient, useHomeQueryClient } from "@/client/query/query-client";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { useHomeRateLabels } from "./use-home-rate-labels";
import { useAccountWallet } from "@/client/account/cdp-client";
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
  onRetryBalances,
  sessionSettling,
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
  regionReady = true,
  onDetailsOpenChange,
}: {
  assetBalances?: HomeAssetBalancesPresentation;
  activitySession: VerifiedAccountSession | null;
  onRetryBalances?: () => void;
  sessionSettling: boolean;
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
  regionReady?: boolean;
  onDetailsOpenChange?: (open: boolean) => void;
}) {
  const isLoading = assetBalances?.status === "loading";
  const isRevalidating = assetBalances?.revalidating === true;
  const resolvedAssetMarks: AssetMarkResolution = assetMarkResolution ?? {
    images: Object.fromEntries(
      sendAvailability.map((asset) => [asset.assetKey, asset.imageUrl ?? null]),
    ),
    pending: false,
  };
  const showSessionShimmer = activitySession
    ? !regionReady
    : sessionSettling || isLoading || isRevalidating;
  const cashRate = useSavingsRateLabel(regionId, regionReady);
  const borrowRate = useBorrowOfferRate({
    enabled: assetBalances?.summary?.borrow.kind === "none",
    regionId,
  });
  const activityHeading = <HomeSectionHeading id="activity-title">Activity</HomeSectionHeading>;
  const routing = useOptionalHomeShellRouting();
  const wallet = useAccountWallet();
  const knownDisplay = assetBalances?.status === "ready";
  const rates = useHomeRateLabels({
    owner: knownDisplay && regionReady && wallet.verification && wallet.session?.smartAccount ? dataOwnerKey(wallet.session) : null,
    region: regionId, cash: cashRate, borrow: borrowRate,
  });
  const queryClient = useHomeQueryClient(browserHomeQueryClient());
  const fundingPromptRef = useRef<HTMLButtonElement>(null);
  const restoreFundingPromptRef = useRef(false);
  const addMoneyPrompt = routing ? (
    <Button
      ref={fundingPromptRef}
      variant="outline"
      size="touch"
      {...moneySheetIntent(preloadAddMoneySheet, () => prefetchAddMoneyMethods(wallet, regionId, regionReady, queryClient))}
      onClick={() => {
        restoreFundingPromptRef.current = routing.setFlow("add-money", { mode: "push" });
      }}
    >
      <Plus className="size-4" aria-hidden="true" />
      Add money
    </Button>
  ) : undefined;

  return (
    <HomeOverview
      accountKey={activitySession?.smartAccount?.address ?? null}
      assetBalances={assetBalances}
      onRetryBalances={onRetryBalances}
      cashRate={rates.cash}
      borrowOfferRate={rates.borrow}
      destinations={{ onOpenCash, onOpenInvestments, onOpenBorrow }}
      actions={
        <>
          <FundingActions
            onClosed={() => {
              if (!restoreFundingPromptRef.current) return;
              const prompt = fundingPromptRef.current;
              if (prompt?.isConnected && !prompt.disabled) prompt.focus();
              restoreFundingPromptRef.current = false;
            }}
            initialOpen={initialAddMoney}
            returnedFromProvider={returnedFromProvider}
            regionId={regionId}
            regionReady={regionReady}
          />
          <PresentationRegionProvider regionId={regionId}>
            <TransferActions
              initialOpen={initialSendFlow}
              initialActionId={initialSendActionId}
              availableAssets={sendAvailability}
              assetMarkResolution={resolvedAssetMarks}
              regionId={regionId}
              regionReady={regionReady}
            />
          </PresentationRegionProvider>
        </>
      }
      activity={showSessionShimmer ? (
        <ActivitySurface heading={activityHeading} labelledBy="activity-title" plain busy>
          <ShimmerRows count={3} variant={knownDisplay ? "reserved" : "rows"} />
          <span className="sr-only">Loading recent activity…</span>
        </ActivitySurface>
      ) : (
        <ConnectedActivityPanel
          density="feed"
          quietLoading={knownDisplay}
          header={activityHeading}
          activitySession={activitySession}
          fetchActivity={fetchActivity}
          fetchOperations={fetchOperations}
          regionId={regionId}
          emptyAction={addMoneyPrompt}
          onDetailsOpenChange={onDetailsOpenChange}
        />
      )}
    />
  );
}
