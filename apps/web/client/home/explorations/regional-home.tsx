"use client";

import { Banknote, ChartLine, HandCoins, Plus } from "lucide-react";
import { ActivityPanelView } from "@/client/activity";
import type { UseActivityResult } from "@/client/activity/use-activity";
import { HomeSectionHeading } from "@/client/home/home-overview";
import { homeBalancesStatus, HomeHeaderStatus } from "@/client/home/home-status";
import type { HomeAssetBalancesPresentation } from "@/client/home/home-types";
import type { HomeMoneySummary } from "@/shared/balances/present";
import { GlyphMark } from "@/components/currency-mark";
import { MoneyTicker } from "@/components/money-ticker";
import { MoneyBreakdownLegend, SignedBalanceBar } from "@/components/signed-balance-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ProposalBalanceRow } from "./proposal-balance-row";
import { ShimmerRows } from "@/client/home/panel-shared";
import { presentationRegions, type RegionId } from "@/config/regions";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import { formatPresentationPercentage } from "@/shared/formatting";
import { cn } from "@/lib/utils";
import { RegionalShell } from "./regional-shell";

const noop = () => undefined;
const localCashRegions = new Set<RegionId>(["BR", "ID"]);
const unavailableSummary: HomeMoneySummary = {
  cash: { status: "unavailable", value: null },
  investments: { status: "unavailable", value: null, assetCount: 0 },
  borrow: { kind: "unavailable" },
};

type RegionalHomeProps = {
  regionId: "US" | "BR" | "NG" | "ID" | "GLOBAL";
  assetBalances: HomeAssetBalancesPresentation;
  activity: UseActivityResult;
  operations?: RecentMoneyActionOperation[];
  onOpenAccount: () => void;
  onReload: () => void;
  actionLabels?: [string, string, string];
  moneyLabels?: [string, string, string];
  cashContext?: string;
  rtlActivity?: boolean;
};

function SummaryValue({ value }: { value: string | null }) {
  return value === null
    ? <><span aria-hidden="true">—</span><span className="sr-only">Unavailable</span></>
    : <bdi dir="ltr"><MoneyTicker value={value} reserveDigits={false} /></bdi>;
}

function MoneySummary({ regionId, balances, labels, cashContext }: { regionId: RegionId; balances: HomeAssetBalancesPresentation; labels: [string, string, string]; cashContext?: string }) {
  const summary = balances.summary ?? unavailableSummary;
  const emptyInvestments = summary.investments.assetCount === 0 && summary.investments.status === "complete";
  const isLoading = balances.status === "loading";
  const local = localCashRegions.has(regionId) ? presentationRegions[regionId] : null;
  return (
    <section aria-label="Your money" aria-busy={isLoading || undefined}>
      <Card className="gap-3">
        <CardHeader><HomeSectionHeading id="regional-your-money">Your money</HomeSectionHeading></CardHeader>
        <CardContent inset="list">
          {isLoading ? <ShimmerRows count={3} /> : (
            <ul className="list-none p-0">
              <ProposalBalanceRow icon={<GlyphMark size="sm"><Banknote /></GlyphMark>}
                label={labels[0]} context={cashContext ?? (local ? `${local.currency.name} and US dollars` : <>US dollars · <bdi dir="ltr">{formatPresentationPercentage(0.042, regionId)} APY</bdi></>)} value={<SummaryValue value={summary.cash.value} />}
                valueContext={local ? <bdi dir="ltr">{formatPresentationPercentage(0.042, regionId)} APY on dollars</bdi> : undefined}
                valueTone={summary.cash.status === "complete" ? "default" : "muted"}
                onActivate={noop} activateLabel="Open Cash" chevron={summary.cash.value !== null} />
              <ProposalBalanceRow icon={<GlyphMark size="sm"><ChartLine /></GlyphMark>}
                label={labels[1]} context={summary.investments.assetCount === 0
                  ? emptyInvestments ? "Start investing" : undefined
                  : `Across ${summary.investments.assetCount} asset${summary.investments.assetCount === 1 ? "" : "s"}`}
                value={emptyInvestments ? undefined : <SummaryValue value={summary.investments.value} />}
                valueTone={summary.investments.status === "complete" ? "default" : "muted"}
                onActivate={noop} activateLabel="Open Invest" chevron={emptyInvestments || summary.investments.value !== null} />
              <ProposalBalanceRow icon={<GlyphMark size="sm"><HandCoins /></GlyphMark>}
                label={labels[2]} context={summary.borrow.kind === "none"
                  ? <>Borrow at <bdi dir="ltr">{formatPresentationPercentage(0.051, regionId)} APR</bdi></>
                  : "Against your investments"}
                value={summary.borrow.kind === "position" ? <SummaryValue value={summary.borrow.value} />
                  : summary.borrow.kind === "unavailable" ? <SummaryValue value={null} /> : undefined}
                valueTone={summary.borrow.kind === "position" && summary.borrow.status === "complete" ? "default" : "muted"}
                valueContext={summary.borrow.kind === "position" ? <bdi dir="ltr">{summary.borrow.rate ?? `${formatPresentationPercentage(0.051, regionId)} APR`}</bdi> : undefined}
                onActivate={noop} activateLabel="Open Borrow"
                chevron={summary.borrow.kind === "none" || (summary.borrow.kind === "position" && summary.borrow.value !== null)} />
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

export function RegionalHomeProposal({ regionId, assetBalances, activity, operations = [], onOpenAccount, onReload,
  actionLabels = ["Add money", "Send", "Cash out"], moneyLabels = ["Cash", "Investments", "Borrow Cash"], cashContext, rtlActivity = false,
}: RegionalHomeProps) {
  const status = homeBalancesStatus(assetBalances);
  const loading = assetBalances.status === "loading";
  const totalStatus = loading ? undefined : assetBalances.totalStatus ?? "unavailable";
  return (
    <RegionalShell active="Home" title="Home" status={status ? <HomeHeaderStatus status={status} onRetry={onReload} onOpenAccount={onOpenAccount} /> : null}>
        <main className="mx-auto w-full max-w-160 min-w-0 px-4 py-4 lg:px-0 lg:py-6">
          <div className="grid min-w-0 gap-6">
            <div className="min-w-0 space-y-4">
              <Card variant="flush" aria-label={loading ? "Updating…" : totalStatus === "unavailable" ? "Balance unavailable" : "Total balance"} aria-busy={loading || undefined}>
                <CardContent inset="hero">
                  <p className="text-sm text-muted-foreground">Total balance</p>
                  {loading ? <div className="space-y-3 pt-1"><Skeleton className="h-10 w-48" /><Skeleton className="h-2 w-full" /></div> : (
                    <div className="@container"><div className={cn("text-3xl font-semibold tabular-nums @xs:text-4xl", totalStatus !== "complete" && "text-muted-foreground")} data-total-status={totalStatus === "complete" ? undefined : totalStatus}><bdi dir="ltr"><MoneyTicker value={assetBalances.displayTotal ?? "—"} reserveDigits={false} /></bdi></div></div>
                  )}
                  {!loading && assetBalances.breakdown.length > 0 ? (
                    <div className="space-y-2"><SignedBalanceBar items={assetBalances.breakdown} />
                      <div className="@container [&_ul]:grid-cols-1 @xs:[&_ul]:grid-cols-3 [&_[data-slot=money-ticker]]:[direction:ltr] [&_[data-slot=money-ticker]]:[unicode-bidi:isolate]"><MoneyBreakdownLegend items={assetBalances.breakdown} /></div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
              <div className="@container" aria-label="Money actions">
                <div className="grid grid-cols-1 gap-2 @xs:grid-cols-3">
                  {actionLabels.map((label, index) => (
                    <Button key={index} variant={index === 0 ? "default" : "outline"} size="lg" className="min-h-11 min-w-0 whitespace-normal @xs:whitespace-nowrap" >
                      {index === 0 ? <Plus className="size-4 shrink-0 @xs:hidden" aria-hidden="true" /> : null}{label}
                    </Button>
                  ))}
                </div>
              </div>
              <MoneySummary regionId={regionId} balances={assetBalances} labels={moneyLabels} cashContext={cashContext} />
            </div>
            <div className={rtlActivity ? "min-w-0 [&_[data-slot=money-ticker]]:[direction:ltr] [&_[data-slot=money-ticker]]:[unicode-bidi:isolate]" : "min-w-0"}>
              <ActivityPanelView activity={activity} operations={operations} regionId={regionId}
                density="feed" header={<HomeSectionHeading id="activity-title">Activity</HomeSectionHeading>}
                emptyAction={<Button variant="outline" size="lg" className="min-h-11"><Plus aria-hidden="true" />Add money</Button>} />
            </div>
          </div>
        </main>
    </RegionalShell>
  );
}
