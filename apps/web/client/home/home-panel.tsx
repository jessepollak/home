"use client";

import { useState } from "react";

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
import type { MoneyBreakdownItem, MoneyGroupPresentation } from "@/shared/balances/present";
import type { TransferAssetAvailability } from "@/shared/transfers/types";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { RegionId } from "@/config/regions";
import { ConnectedActivityPanel } from "./activity-panel";
import { HomeMoneyGroups } from "./balances-panel";
import type { HomeAssetBalancesPresentation } from "./home-types";
import { ShimmerRows } from "./panel-shared";

const balanceBarColors: Record<MoneyBreakdownItem["id"], string> = {
  cash: "#0aa852",
  saved: "#0c84fa",
  investments: "#a064db",
};

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
        <Button size="card-action" variant="ghost" onClick={onOpen} aria-label={title}>
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
  const [highlightedBreakdown, setHighlightedBreakdown] = useState<
    MoneyBreakdownItem["id"] | null
>(null);
  const showBalanceStatus =
    assetBalances?.status !== "loading" && Boolean(balanceStatusLabel);

  return (
    <div className="space-y-4">
      <Card
        variant="flush"
        aria-label={heroLabel}
        aria-busy={isLoading || isRevalidating || undefined}
      >
        <CardContent inset="hero">
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
            <div className="space-y-2 pt-1 text-xs text-muted-foreground">
              {assetBalances?.breakdown.length ? (
                <div className="space-y-2" data-balance-breakdown>
                  <div
                    className="flex h-2 w-full cursor-pointer gap-0.5 overflow-visible rounded-sm bg-muted"
                    aria-label="Balance allocation"
                    role="img"
                    onMouseLeave={() => setHighlightedBreakdown(null)}
                  >
                    {assetBalances.breakdown.map((item) => {
                      const highlighted = highlightedBreakdown === item.id;
                      const dimmed = highlightedBreakdown !== null && !highlighted;
                      return (
                        <span
                          className={`min-w-1 origin-center rounded-xs transition-all duration-150 ${
                            highlighted ? "z-10 scale-y-150 shadow-sm" : ""
                          } ${dimmed ? "opacity-70" : "opacity-100"}`.trim()}
                          data-balance-segment={item.id}
                          key={item.id}
                          onMouseEnter={() => setHighlightedBreakdown(item.id)}
                          style={{
                            backgroundColor: balanceBarColors[item.id],
                            flexBasis: 0,
                            flexGrow: item.weight,
                          }}
                        />
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-3 gap-x-2 tabular-nums">
                    {assetBalances.breakdown.map((item) => {
                      const highlighted = highlightedBreakdown === item.id;
                      const dimmed = highlightedBreakdown !== null && !highlighted;
                      return (
                        <span
                          className={`flex min-w-0 cursor-pointer flex-col gap-0.5 text-left leading-tight transition-all duration-150 ${
                            highlighted ? "font-semibold text-foreground" : ""
                          } ${dimmed ? "opacity-70" : "opacity-100"}`.trim()}
                          key={item.id}
                          onMouseEnter={() => setHighlightedBreakdown(item.id)}
                          onMouseLeave={() => setHighlightedBreakdown(null)}
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span
                              className="size-1.5 shrink-0 rounded-xs"
                              style={{ backgroundColor: balanceBarColors[item.id] }}
                              aria-hidden="true"
                            />
                            <span>{item.label}</span>
                          </span>
                          <MoneyTicker
                            className="pl-3"
                            value={item.value}
                            align="start"
                            reserveDigits={false}
                          />
                        </span>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {showBalanceStatus ? (
                <p data-total-status={assetBalances?.totalStatus}>
                  {balanceStatusLabel}
                </p>
              ) : null}
            </div>
          ) : null}
          {isLoading || isRevalidating ? <span className="sr-only">Updating…</span> : null}
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
            regionId={regionId}
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

      <div className="grid grid-cols-2 gap-2">
        <section className="min-w-0 aspect-square sm:aspect-[3/2]" aria-labelledby="save-heading">
          <Card variant="flush" className="h-full">
            <SavingsTeaser headingId="save-heading" onOpen={onOpenSave} regionId={regionId} />
          </Card>
        </section>

        <section className="min-w-0 aspect-square sm:aspect-[3/2]" aria-labelledby="borrow-heading">
          <Card variant="flush" className="h-full">
            <AuthenticatedBorrowTeaser
              headingId="borrow-heading"
              onOpen={onOpenBorrow}
              regionId={regionId}
            />
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
