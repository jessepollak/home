"use client";

import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyTicker } from "@/components/money-ticker";
import type { FetchActivity } from "@/client/activity";
import { FundingActions } from "@/client/funding/funding-actions";
import { SavingsTeaser } from "@/client/savings/savings-teaser";
import { AuthenticatedBorrowTeaser } from "@/client/borrowing/borrowing-experience";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { TransferActions } from "@/client/transfers";
import type { MoneyGroupPresentation } from "@/shared/balances/present";
import type { TransferAssetAvailability } from "@/shared/transfers/types";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { RegionId } from "@/config/regions";
import { ConnectedActivityPanel } from "./activity-panel";
import { HomeMoneyGroups } from "./balances-panel";
import type { HomeAssetBalancesPresentation } from "./home-types";
import { ShimmerRows } from "./panel-shared";

function SectionHeader({
  headingId,
  title,
  onOpen,
  actionLabel = "See all",
}: {
  headingId: string;
  title: "Your money" | "Save" | "Activity";
  onOpen: () => void;
  actionLabel?: "See all" | "Earn";
}) {
  return (
    <>
      <CardTitle id={headingId} role="heading" aria-level={2}>{title}</CardTitle>
      <CardAction>
        <Button size="sm" variant="ghost" onClick={onOpen} aria-label={title}>
          {actionLabel}
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </CardAction>
    </>
  );
}

export function HomePanel({
  assetBalances,
  activitySession,
  sendAvailability,
  fetchActivity,
  fetchOperations,
  onOpenSave,
  onOpenBorrow,
  onOpenBalances,
  onOpenActivity,
  initialAddMoney = false,
  returnedFromProvider = false,
  initialSendFlow = false,
  initialSendActionId = null,
  regionId,
}: {
  assetBalances?: HomeAssetBalancesPresentation;
  activitySession: VerifiedAccountSession | null;
  sendAvailability: readonly (TransferAssetAvailability & { imageUrl?: string })[];
  fetchActivity: FetchActivity;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
  onOpenSave: () => void;
  onOpenBorrow: () => void;
  onOpenBalances: (group?: MoneyGroupPresentation["id"]) => void;
  onOpenActivity: () => void;
  initialAddMoney?: boolean;
  returnedFromProvider?: boolean;
  initialSendFlow?: boolean;
  initialSendActionId?: string | null;
  regionId: RegionId;
}) {
  const isLoading = assetBalances?.status === "loading";
  // Send's asset picker takes its marks from the same holdings the rows do (no Invest dependency).
  const sendAssetMarkResolution: AssetMarkResolution = {
    images: Object.fromEntries(
      sendAvailability.map((asset) => [asset.assetKey, asset.imageUrl ?? null]),
    ),
    pending: false,
  };
  const isRevalidating = assetBalances?.revalidating === true;
  const showSessionShimmer = !activitySession && (isLoading || isRevalidating);
  const heroLabel = isLoading
    ? "Updating…"
    : assetBalances?.status === "unavailable"
      ? "Balance unavailable"
      : "Total balance";
  const moneyGroups = assetBalances?.groups ?? [];
  const balanceStatusLabel = assetBalances?.statusLabel;
  const showBalanceStatus =
    assetBalances?.status !== "loading" && Boolean(balanceStatusLabel);

  return (
    <div className="space-y-4">
      <Card
        aria-label={heroLabel}
        aria-busy={isLoading || isRevalidating || undefined}
      >
        <CardContent>
          <div className="space-y-2 py-1 sm:px-1 sm:py-2">
            <p className="text-sm text-muted-foreground">Total balance</p>
            {isLoading ? (
              <Skeleton className="h-10 w-48" data-shimmer="hero" />
            ) : (
              <div className="text-4xl font-semibold tabular-nums">
                <MoneyTicker
                  value={assetBalances?.displayTotal ?? "—"}
                  align="start"
                  reserveDigits={false}
                />
              </div>
            )}
            {assetBalances?.breakdown.length || showBalanceStatus ? (
              <div className="flex w-full flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
                {assetBalances?.breakdown.length ? (
                  <p className="flex flex-wrap items-center gap-x-1 text-xs tabular-nums sm:text-sm">
                    {assetBalances.breakdown.map((item, index) => (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap" key={item.id}>
                        <span>{item.label}</span>
                        <MoneyTicker value={item.value} reserveDigits={false} />
                        {index < assetBalances.breakdown.length - 1 ? <span aria-hidden="true">·</span> : null}
                      </span>
                    ))}
                  </p>
                ) : <span />}
                {showBalanceStatus ? (
                  <p className="text-right" data-total-status={assetBalances?.totalStatus}>
                    {balanceStatusLabel}
                  </p>
                ) : null}
              </div>
            ) : null}
            {isLoading || isRevalidating ? <span className="sr-only">Updating…</span> : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-2" aria-label="Money actions">
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
            assetMarkResolution={sendAssetMarkResolution}
          />
        </PresentationRegionProvider>
      </div>

      <section aria-labelledby="your-money-heading">
        <Card>
          <CardHeader>
            <SectionHeader
              headingId="your-money-heading"
              title="Your money"
              onOpen={() => onOpenBalances()}
            />
          </CardHeader>
          <CardContent inset="list">
            <HomeMoneyGroups
              groups={moneyGroups}
              hiddenRows={assetBalances?.hiddenRows}
              isLoading={isLoading}
              isUnavailable={assetBalances?.status === "unavailable"}
              onOpenGroup={onOpenBalances}
            />
          </CardContent>
        </Card>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <section aria-labelledby="save-heading">
          <Card className="h-full">
            <CardHeader>
              <CardTitle id="save-heading" role="heading" aria-level={2}>Save</CardTitle>
            </CardHeader>
            <CardContent inset="list">
              <SavingsTeaser onOpen={onOpenSave} regionId={regionId} />
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="borrow-heading">
          <Card className="h-full">
            <CardHeader>
              <CardTitle id="borrow-heading" role="heading" aria-level={2}>Borrow</CardTitle>
            </CardHeader>
            <CardContent inset="list">
              <AuthenticatedBorrowTeaser onOpen={onOpenBorrow} regionId={regionId} />
            </CardContent>
          </Card>
        </section>
      </div>

      {showSessionShimmer ? (
        <section aria-labelledby="activity-title" aria-busy="true">
          <Card>
            <CardHeader>
              <SectionHeader headingId="activity-title" title="Activity" onOpen={onOpenActivity} />
            </CardHeader>
            <CardContent inset="list"><ShimmerRows count={2} /></CardContent>
          </Card>
        </section>
      ) : (
        <ConnectedActivityPanel
          density="teaser"
          header={
            <SectionHeader headingId="activity-title" title="Activity" onOpen={onOpenActivity} />
          }
          activitySession={activitySession}
          fetchActivity={fetchActivity}
          fetchOperations={fetchOperations}
          regionId={regionId}
        />
      )}
    </div>
  );
}
