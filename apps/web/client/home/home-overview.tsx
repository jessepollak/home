"use client";

import type { ReactNode } from "react";
import { Banknote, ChartLine, HandCoins } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BalanceRow } from "@/components/finance-rows";
import { GlyphMark } from "@/components/currency-mark";
import { MoneyTicker } from "@/components/money-ticker";
import {
  MoneyBreakdownLegend,
  SignedBalanceBar,
} from "@/components/signed-balance-bar";
import type { HomeMoneySummary as HomeMoneySummaryModel } from "@/shared/balances/present";
import { cn } from "@/lib/utils";
import type { HomeAssetBalancesPresentation } from "./home-types";
import { ShimmerRows } from "./panel-shared";

export type HomeOverviewDestinations = {
  onOpenCash: () => void;
  onOpenInvestments: () => void;
  onOpenBorrow: () => void;
};

export function HomeOverview({
  assetBalances,
  actions,
  activity,
  cashRate,
  borrowOfferRate,
  destinations,
}: {
  assetBalances?: HomeAssetBalancesPresentation;
  actions: ReactNode;
  activity: ReactNode;
  cashRate: string | null;
  borrowOfferRate: string | null;
  destinations: HomeOverviewDestinations;
}) {
  const isLoading = assetBalances?.status === "loading";
  return (
    <div className="space-y-4">
      <HomeTotalBalance assetBalances={assetBalances} />
      <div className="grid grid-cols-2 gap-2" aria-label="Money actions">
        {actions}
      </div>
      <HomeMoneySummary
        summary={assetBalances?.summary ?? null}
        isLoading={isLoading}
        cashRate={cashRate}
        borrowOfferRate={borrowOfferRate}
        destinations={destinations}
      />
      {activity}
    </div>
  );
}

export function HomeSectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-base leading-6 font-semibold">
      {children}
    </h2>
  );
}

function HomeTotalBalance({
  assetBalances,
}: {
  assetBalances?: HomeAssetBalancesPresentation;
}) {
  const isLoading = assetBalances?.status === "loading";
  const isRevalidating = assetBalances?.revalidating === true;
  const heroLabel = isLoading
    ? "Updating…"
    : assetBalances?.status === "unavailable"
      ? "Balance unavailable"
      : "Total balance";
  const breakdown = assetBalances?.breakdown ?? [];
  const totalStatus = isLoading ? undefined : assetBalances?.totalStatus ?? "unavailable";
  return (
    <Card
      variant="flush"
      aria-label={heroLabel}
      aria-busy={isLoading || isRevalidating || undefined}
    >
      <CardContent inset="hero">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">Total balance</p>
          {!isLoading && totalStatus === "partial" ? (
            <Badge variant="secondary">{assetBalances?.statusLabel}</Badge>
          ) : null}
        </div>
        {isLoading ? (
          <div className="space-y-3 pt-1" data-shimmer="hero">
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-2 w-full" />
            <div className="grid grid-cols-3 gap-x-2">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-20" />
            </div>
            <span className="sr-only">Updating…</span>
          </div>
        ) : (
          <div
            className={cn(
              "text-4xl font-semibold tabular-nums",
              totalStatus !== "complete" && "text-muted-foreground",
            )}
            data-total-status={totalStatus === "complete" ? undefined : totalStatus}
          >
            <MoneyTicker
              value={assetBalances?.displayTotal ?? "—"}
              align="start"
              reserveDigits={false}
            />
          </div>
        )}
        {!isLoading && breakdown.length > 0 ? (
          <div className="space-y-2" data-balance-breakdown="">
            <SignedBalanceBar items={breakdown} />
            <MoneyBreakdownLegend items={breakdown} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

const unavailableSummary: HomeMoneySummaryModel = {
  cash: { status: "unavailable", value: null },
  investments: { status: "unavailable", value: null, assetCount: 0 },
  borrow: { kind: "unavailable" },
};

export function HomeMoneySummary({
  summary,
  isLoading,
  cashRate,
  borrowOfferRate,
  destinations,
}: {
  summary: HomeMoneySummaryModel | null;
  isLoading: boolean;
  cashRate: string | null;
  borrowOfferRate: string | null;
  destinations: HomeOverviewDestinations;
}) {
  return (
    <section aria-labelledby="your-money-heading" aria-busy={isLoading || undefined}>
      <Card className="gap-3">
        <CardHeader>
          <HomeSectionHeading id="your-money-heading">Your money</HomeSectionHeading>
        </CardHeader>
        <CardContent inset="list">
          {isLoading && !summary ? (
            <ShimmerRows count={3} />
          ) : (
            <ul className="list-none p-0" data-money-summary="">
              <CashRow
                summary={(summary ?? unavailableSummary).cash}
                rate={cashRate}
                onOpen={destinations.onOpenCash}
              />
              <InvestmentsRow
                summary={(summary ?? unavailableSummary).investments}
                onOpen={destinations.onOpenInvestments}
              />
              <BorrowRow
                summary={(summary ?? unavailableSummary).borrow}
                offerRate={borrowOfferRate}
                onOpen={destinations.onOpenBorrow}
              />
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function CashRow({
  summary,
  rate,
  onOpen,
}: {
  summary: HomeMoneySummaryModel["cash"];
  rate: string | null;
  onOpen: () => void;
}) {
  return (
    <BalanceRow
      icon={<GlyphMark size="sm"><Banknote /></GlyphMark>}
      iconTone="mark"
      label="Cash"
      context={rate ?? undefined}
      value={summaryValue(summary.value)}
      valueTone={summary.status === "complete" ? "default" : "muted"}
      onActivate={onOpen}
      activateLabel="Open Cash"
      chevron={summary.value !== null}
    />
  );
}

function InvestmentsRow({
  summary,
  onOpen,
}: {
  summary: HomeMoneySummaryModel["investments"];
  onOpen: () => void;
}) {
  const empty = summary.assetCount === 0 && summary.status === "complete";
  return (
    <BalanceRow
      icon={<GlyphMark size="sm"><ChartLine /></GlyphMark>}
      iconTone="mark"
      label="Investments"
      context={summary.assetCount === 0
        ? empty ? "Start investing" : undefined
        : summary.assetCount === 1
          ? "Across 1 asset"
          : `Across ${summary.assetCount} assets`}
      value={empty ? undefined : summaryValue(summary.value)}
      valueTone={summary.status === "complete" ? "default" : "muted"}
      onActivate={onOpen}
      activateLabel="Open Invest"
      chevron={empty || summary.value !== null}
    />
  );
}

function BorrowRow({
  summary,
  offerRate,
  onOpen,
}: {
  summary: HomeMoneySummaryModel["borrow"];
  offerRate: string | null;
  onOpen: () => void;
}) {
  const icon = <GlyphMark size="sm"><HandCoins /></GlyphMark>;
  if (summary.kind === "position") {
    return (
      <BalanceRow
        icon={icon}
        iconTone="mark"
        label="Borrow Cash"
        context="Against your investments"
        value={summaryValue(summary.value)}
        valueTone={summary.status === "complete" ? "default" : "muted"}
        valueContext={summary.rate ?? undefined}
        onActivate={onOpen}
        activateLabel="Open Borrow"
        chevron={summary.value !== null}
      />
    );
  }
  return (
    <BalanceRow
      icon={icon}
      iconTone="mark"
      label="Borrow Cash"
      context={summary.kind === "none" && offerRate
        ? `Borrow at ${offerRate}`
        : "Against your investments"}
      value={summary.kind === "unavailable" ? summaryValue(null) : undefined}
      valueTone="muted"
      onActivate={onOpen}
      activateLabel="Open Borrow"
      chevron={summary.kind === "none"}
    />
  );
}

function summaryValue(value: string | null): ReactNode {
  return value === null
    ? (
        <>
          <span aria-hidden="true">—</span>
          <span className="sr-only">Unavailable</span>
        </>
      )
    : <MoneyTicker value={value} reserveDigits={false} />;
}
