"use client";

import { PiggyBank } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyTicker } from "@/components/money-ticker";
import type { FetchActivity } from "@/client/activity";
import { FundingActions } from "@/client/funding/funding-actions";
import { TransferActions } from "@/client/transfers";
import { previewHomeBalanceItems } from "@/client/portfolio";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { RegionId } from "@/config/regions";
import { ConnectedActivityPanel } from "./activity-panel";
import { HomeBalancesList } from "./balances-panel";
import type { HomeAssetBalancesPresentation } from "./home-types";
import { ShimmerRows } from "./panel-shared";
import { deriveSendAvailability } from "./send-availability";

function SectionTapIn({
  headingId,
  title,
  onOpen,
}: {
  headingId: string;
  title: "Balances" | "Activity";
  onOpen: () => void;
}) {
  return (
    <Button
      className="section-tap-in"
      variant="ghost"
      onClick={onOpen}
      aria-label={title}
    >
      <h2 className="text-metadata" id={headingId}>{title}</h2>
      <span className="section-tap-in-affordance" aria-hidden="true">›</span>
    </Button>
  );
}

export function HomePanel({
  assetBalances,
  assetMarkResolution,
  activitySession,
  fetchActivity,
  fetchOperations,
  onOpenSave,
  onOpenBalances,
  onOpenActivity,
  initialAddMoney = false,
  returnedFromProvider = false,
  initialSendFlow = false,
  initialSendActionId = null,
  regionId,
}: {
  assetBalances?: HomeAssetBalancesPresentation;
  assetMarkResolution?: AssetMarkResolution;
  activitySession: VerifiedAccountSession | null;
  fetchActivity: FetchActivity;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
  onOpenSave: () => void;
  onOpenBalances: () => void;
  onOpenActivity: () => void;
  initialAddMoney?: boolean;
  returnedFromProvider?: boolean;
  initialSendFlow?: boolean;
  initialSendActionId?: string | null;
  regionId: RegionId;
}) {
  const isLoading = assetBalances?.status === "loading";
  const isRevalidating = assetBalances?.revalidating === true;
  const showSessionShimmer = !activitySession && (isLoading || isRevalidating);
  const heroLabel = isLoading
    ? "Updating…"
    : assetBalances?.status === "unavailable"
      ? "Balance unavailable"
      : "Total balance";
  const balanceItems = assetBalances?.items ?? [];
  const balanceStatusLabel =
    assetBalances?.totalStatus === "partial" ? undefined : assetBalances?.statusLabel;
  const showBalanceStatus =
    assetBalances?.status !== "loading" &&
    balanceStatusLabel !== "Updating…" &&
    Boolean(balanceStatusLabel);

  return (
    <div className="home-panel">
      <section
        className="balance-hero"
        aria-label={heroLabel}
        aria-busy={isLoading || isRevalidating || undefined}
      >
        {isLoading ? (
          <Skeleton
            className="balance-hero-shimmer"
            data-shimmer="hero"
          />
        ) : (
          <div className="balance-hero-total text-amount font-mono">
            <MoneyTicker value={assetBalances?.displayTotal ?? "—"} />
          </div>
        )}
        {showBalanceStatus ? (
          <p className="balance-status text-metadata" data-total-status={assetBalances?.totalStatus}>
            {balanceStatusLabel}
          </p>
        ) : null}
        {isLoading || isRevalidating ? <span className="sr-status">Updating…</span> : null}
      </section>

      <div className="action-row" aria-label="Money actions">
        <FundingActions
          initialOpen={initialAddMoney}
          returnedFromProvider={returnedFromProvider}
          regionId={regionId}
        />
        <TransferActions
          initialOpen={initialSendFlow}
          initialActionId={initialSendActionId}
          availableAssets={deriveSendAvailability(balanceItems)}
        />
      </div>

      <section className="balances-panel" aria-labelledby="balances-heading">
        <SectionTapIn
          headingId="balances-heading"
          title="Balances"
          onOpen={onOpenBalances}
        />
        <HomeBalancesList
          items={previewHomeBalanceItems(balanceItems)}
          isLoading={isLoading}
          isUnavailable={assetBalances?.status === "unavailable"}
          assetMarkResolution={assetMarkResolution}
        />
      </section>

      {showSessionShimmer ? (
        <Button className="save-teaser rounded-xl border border-border bg-background" variant="secondary" onClick={onOpenSave} aria-label="Save">
          <Skeleton className="shimmer-save-icon" />
          <Skeleton className="shimmer-line shimmer-line-save" />
          <Skeleton className="shimmer-pill" />
        </Button>
      ) : (
        <Button className="save-teaser rounded-xl border border-border bg-background" variant="secondary" onClick={onOpenSave} aria-label="Save">
          <span className="save-teaser-icon" aria-hidden="true">
            <PiggyBank size={20} strokeWidth={1.9} />
          </span>
          <span className="save-teaser-label">Save</span>
          <span className="save-teaser-action">Earn <span aria-hidden="true">›</span></span>
        </Button>
      )}

      {showSessionShimmer ? (
        <section className="activity-panel" aria-labelledby="activity-title" aria-busy="true">
          <SectionTapIn headingId="activity-title" title="Activity" onOpen={onOpenActivity} />
          <ShimmerRows count={2} />
        </section>
      ) : (
        <div className="activity-panel activity-panel-slot">
          <ConnectedActivityPanel
            density="teaser"
            header={
              <SectionTapIn headingId="activity-title" title="Activity" onOpen={onOpenActivity} />
            }
            activitySession={activitySession}
            fetchActivity={fetchActivity}
            fetchOperations={fetchOperations}
            regionId={regionId}
          />
        </div>
      )}
    </div>
  );
}
