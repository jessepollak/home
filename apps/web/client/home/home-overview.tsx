"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Banknote, ChartLine, HandCoins } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BalanceRow } from "@/components/finance-rows";
import { GlyphMark } from "@/components/currency-mark";
import { MoneyTicker } from "@/components/money-ticker";
import {
  MoneyBreakdownLegend,
  SignedBalanceBar,
} from "@/components/signed-balance-bar";
import type {
  HomeMoneySummary as HomeMoneySummaryModel,
  MoneyBreakdownItem,
} from "@/shared/balances/present";
import { formatPresentationDate } from "@/shared/formatting";
import type { HomeAssetBalancesPresentation } from "./home-types";
import { ShimmerRows } from "./panel-shared";
import { useProductOffering } from "./product-offering";
import { borrowEntryOffered } from "@/client/borrowing/borrow-offering";
import { BalancesCantLoad } from "@/client/balances/balances-cant-load";

export type HomeOverviewDestinations = {
  onOpenCash: () => void;
  onOpenInvestments: () => void;
  onOpenBorrow: () => void;
};

export function HomeOverview({
  assetBalances,
  accountKey,
  actions,
  sendOffered,
  activity,
  cashRate,
  borrowOfferRate,
  destinations,
  onRetryBalances,
}: {
  assetBalances?: HomeAssetBalancesPresentation;
  accountKey: string | null;
  actions: ReactNode;
  sendOffered?: boolean;
  activity: ReactNode;
  cashRate: string | null;
  borrowOfferRate: string | null;
  destinations: HomeOverviewDestinations;
  onRetryBalances?: () => void;
}) {
  const isLoading = assetBalances?.status === "loading";
  const retryBalances = assetBalances?.needsCountry ? undefined : onRetryBalances;
  const moneyRef = useRef<HTMLDivElement>(null);
  const [stickyFits, setStickyFits] = useState(false);
  useEffect(() => {
    const money = moneyRef.current;
    const main = money?.closest<HTMLElement>("[data-app-main-authenticated]");
    const header = document.querySelector<HTMLElement>("header");
    if (!money || !main) return;
    const updateFit = () => {
      const stickyTop = Math.round(header?.getBoundingClientRect().height ?? 0) + 24;
      money.style.setProperty("--home-money-sticky-top", `${stickyTop}px`);
      setStickyFits(money.scrollHeight + 48 <= window.innerHeight - stickyTop);
    };
    updateFit();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateFit);
    observer?.observe(money);
    if (header) observer?.observe(header);
    window.addEventListener("resize", updateFit);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateFit);
    };
  }, []);
  return (
    <div className="space-y-4 lg:grid lg:grid-cols-[minmax(320px,3fr)_minmax(340px,2fr)] lg:items-start lg:gap-6 lg:space-y-0 xl:gap-8">
      <div ref={moneyRef} data-sticky-fit={stickyFits} className={`space-y-4 self-start ${stickyFits ? "lg:[@media(min-height:640px)]:sticky lg:top-(--home-money-sticky-top)" : ""}`}>
        <HomeTotalBalance assetBalances={assetBalances} accountKey={accountKey} onRetryBalances={retryBalances} />
        {actions ? <div className="@container" role="group" aria-label="Money actions"><div className={sendOffered === undefined
          ? "grid grid-cols-1 gap-2 @xs:grid-flow-col @xs:auto-cols-fr @xs:grid-cols-none"
          : sendOffered
          ? "grid auto-rows-fr grid-cols-[repeat(auto-fit,minmax(min(100%,5rem),1fr))] gap-2 @min-[18rem]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
          : "grid auto-rows-fr grid-cols-[repeat(auto-fit,minmax(min(100%,5rem),1fr))] gap-2 @min-[12rem]:grid-cols-2"}>{actions}</div></div> : null}
        <HomeMoneySummary
          summary={assetBalances?.summary ?? null}
          isLoading={isLoading}
          cashRate={cashRate}
          borrowOfferRate={borrowOfferRate}
          destinations={destinations}
          onRetryBalances={retryBalances}
        />
      </div>
      <div>{activity}</div>
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
  accountKey,
  onRetryBalances,
}: {
  assetBalances?: HomeAssetBalancesPresentation;
  accountKey: string | null;
  onRetryBalances?: () => void;
}) {
  const isLoading = assetBalances?.status === "loading";
  const isRevalidating = assetBalances?.revalidating === true;
  const heroLabel = isLoading ? "Updating…" : "Total balance";
  const breakdown = assetBalances?.breakdown ?? [];
  const displayTotal = assetBalances?.displayTotal;
  return (
    <Card
      variant="flush"
      aria-label={heroLabel}
      aria-busy={isLoading || isRevalidating || undefined}
      data-home-cached-summary={assetBalances?.cachedAt}
    >
      <CardContent inset="hero">
        <p className="text-sm text-muted-foreground">Total balance</p>
        {assetBalances?.cachedAt !== undefined ? <span className="sr-only">Updating balance saved {formatPresentationDate(assetBalances.cachedAt, { style: "date-time-zone" })}.</span> : null}
        <div className="@container flex min-h-10 items-center" data-shimmer={isLoading ? "hero" : undefined}>
        {isLoading ? <><Skeleton className="h-10 w-48" /><span className="sr-only">Updating…</span></> : assetBalances?.status !== "ready" ? <BalancesCantLoad onRetry={onRetryBalances ?? (() => undefined)} /> : displayTotal ? (
          <div className="text-4xl font-semibold tabular-nums" style={{ fontSize: `max(0.75rem, min(2.25rem, calc(100cqi / (${Array.from(displayTotal).length} * 0.65))))` }}>
            <MoneyTicker value={displayTotal} align="start" reserveDigits={false} animated={false} />
          </div>
        ) : assetBalances.needsCountry ? <p className="text-sm text-muted-foreground">Choose a country in Account to set how money is shown</p> : null}
        </div>
        {isLoading ? (
          <div className="space-y-2" aria-hidden="true">
            <Skeleton className="h-2 w-full" />
            <div className="grid grid-cols-3 gap-x-2">
              <Skeleton className="h-9 w-20" /><Skeleton className="h-9 w-20" /><Skeleton className="h-9 w-20" />
            </div>
          </div>
        ) : breakdown.length > 0 ? (
          <HomeBalanceBreakdown key={accountKey ?? ""} items={breakdown} />
        ) : null}
      </CardContent>
    </Card>
  );
}

export function HomeBalanceBreakdown({ items }: { items: readonly MoneyBreakdownItem[] }) {
  const [selectedId, setSelectedId] = useState<MoneyBreakdownItem["id"] | null>(null);
  if (selectedId !== null && !items.some((item) => item.id === selectedId)) {
    setSelectedId(null);
  }
  const onSelect = (id: MoneyBreakdownItem["id"]) => {
    setSelectedId((current) => current === id ? null : id);
  };
  return (
    <div className="space-y-2" data-balance-breakdown="">
      <SignedBalanceBar items={items} selectedId={selectedId} onSelect={onSelect} />
      <MoneyBreakdownLegend items={items} selectedId={selectedId} onSelect={onSelect} />
    </div>
  );
}

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
  onRetryBalances?: () => void;
}) {
  const offering = useProductOffering();
  if (!isLoading && !summary) return null;
  return (
    <section aria-labelledby="your-money-heading" aria-busy={isLoading || undefined}>
      <Card className="gap-3">
        <CardHeader>
          <HomeSectionHeading id="your-money-heading">Your money</HomeSectionHeading>
        </CardHeader>
        <CardContent inset="list">
          {!summary ? (
            <ShimmerRows count={3} />
          ) : (
            <ul className="list-none p-0" data-money-summary="">
              <CashRow
                summary={summary.cash}
                rate={cashRate}
                onOpen={destinations.onOpenCash}
              />
              {(offering.products.invest === "on" || summary.investments.ownedCount > 0) ? (
                <InvestmentsRow
                  summary={summary.investments}
                  onOpen={destinations.onOpenInvestments}
                  />
              ) : null}
              {(borrowEntryOffered(offering) || summary.borrow.kind !== "none" || summary.borrow.hasCollateral) ? (
                <BorrowRow
                  summary={summary.borrow}
                  offerRate={borrowOfferRate}
                  onOpen={destinations.onOpenBorrow}
                  />
              ) : null}
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
  onRetryBalances?: () => void;
}) {
  return (
    <BalanceRow
      icon={<GlyphMark size="sm"><Banknote /></GlyphMark>}
      iconTone="mark"
      label="Cash"
      context={rate ?? undefined}
      reserveContext
      value={summaryValue(summary.value)}
      valueTone={summaryTone(summary.value)}
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
  onRetryBalances?: () => void;
}) {
  const empty = summary.ownedCount === 0;
  return (
    <BalanceRow
      icon={<GlyphMark size="sm"><ChartLine /></GlyphMark>}
      iconTone="mark"
      label="Investments"
      reserveContext
      context={summary.assetCount === 0
        ? empty ? "Start investing" : undefined
        : `Across ${summary.assetCount} ${summary.assetCount === 1 ? "asset" : "assets"}`}
      value={empty ? undefined : summaryValue(summary.value)}
      valueTone={summaryTone(summary.value)}
      onActivate={onOpen}
      activateLabel={empty ? "Open Invest" : "Open Investments"}
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
  onRetryBalances?: () => void;
}) {
  const offering = useProductOffering();
  const icon = <GlyphMark size="sm"><HandCoins /></GlyphMark>;
  if (summary.kind === "position") {
    return (
      <BalanceRow
        icon={icon}
        iconTone="mark"
        label="Borrow Cash"
        context="Against your investments"
        value={summaryValue(summary.value)}
        valueTone={summaryTone(summary.value)}
        valueContext={summary.rate ?? undefined}
        onActivate={onOpen}
        activateLabel="Open Borrow"
        chevron={summary.value !== null}
      />
    );
  }
  if (summary.kind === "none" && summary.hasCollateral && !borrowEntryOffered(offering)) {
    return (
      <BalanceRow
        icon={icon}
        iconTone="mark"
        label="Collateral"
        context="Manage in Borrow"
        onActivate={onOpen}
        activateLabel="Open Borrow"
        chevron
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
        : undefined}
      reserveContext
      valueTone="muted"
      onActivate={onOpen}
      activateLabel="Open Borrow"
      chevron={summary.kind === "none"}
    />
  );
}

function summaryTone(value: string | null): "default" | "muted" {
  return value === null ? "muted" : "default";
}

function summaryValue(value: string | null): ReactNode {
  return value ? <MoneyTicker value={value} reserveDigits={false} animated={false} /> : null;
}
