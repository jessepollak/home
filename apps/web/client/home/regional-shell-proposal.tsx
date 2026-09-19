"use client";

import type { ComponentType } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChartNoAxesCombined,
  CreditCard,
  House,
  Landmark,
  PiggyBank,
  Send,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";

export type RegionalShellNavigationId = "home" | "card" | "invest";

export type RegionalHomeCopy = {
  account: string;
  activity: string;
  addMoney: string;
  card: string;
  cashOut: string;
  countryNeeded: string;
  dollarProducts: string;
  home: string;
  invest: string;
  illustrativeNonCoverage: string;
  localMoney: string;
  localYieldUnavailable: string;
  send: string;
  shownSeparately: string;
  totalBalance: string;
};

export type RegionalHomeComposition = {
  regionLabel: string;
  totalBalance: string;
  localMoney: {
    title: string;
    value: string;
    detail: string;
  };
  dollarProducts: {
    title: string;
    value: string;
    detail: string;
  };
  localYield: {
    title: string;
    detail: string;
    state: "available" | "unavailable" | "choose-country" | "illustrative";
  };
  activity: readonly {
    id: string;
    label: string;
    detail: string;
    amount: string;
  }[];
};

export type RegionalHomeShellProposalProps = {
  activeNavigation?: RegionalShellNavigationId;
  composition: RegionalHomeComposition;
  copy: RegionalHomeCopy;
  onAccount: () => void;
  onAction: (action: "add-money" | "send" | "cash-out") => void;
  onNavigate: (destination: RegionalShellNavigationId) => void;
};

const navigationItems: readonly {
  id: RegionalShellNavigationId;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}[] = [
  { id: "home", icon: House },
  { id: "card", icon: CreditCard },
  { id: "invest", icon: ChartNoAxesCombined },
];

function navigationLabel(id: RegionalShellNavigationId, copy: RegionalHomeCopy) {
  if (id === "card") return copy.card;
  if (id === "invest") return copy.invest;
  return copy.home;
}

function NavigationItems({
  activeNavigation,
  copy,
  onNavigate,
  orientation,
}: {
  activeNavigation: RegionalShellNavigationId;
  copy: RegionalHomeCopy;
  onNavigate: (destination: RegionalShellNavigationId) => void;
  orientation: "horizontal" | "vertical";
}) {
  return navigationItems.map(({ id, icon: Icon }) => {
    const active = id === activeNavigation;
    return (
      <Button
        key={id}
        variant="navigation"
        size="lg"
        className={orientation === "horizontal"
          ? "relative h-full min-h-11 min-w-0 flex-col"
          : "min-h-11 w-full justify-start"}
        aria-current={active ? "page" : undefined}
        onClick={() => onNavigate(id)}
      >
        <Icon className="size-5" aria-hidden />
        <span className={orientation === "horizontal" ? "min-w-0 truncate text-xs" : "truncate"}>
          {navigationLabel(id, copy)}
        </span>
        {active && orientation === "horizontal" ? (
          <span className="absolute inset-x-4 bottom-0 h-0.5 bg-primary" aria-hidden />
        ) : null}
      </Button>
    );
  });
}

const moneyActionTreatment = "outline" as const;

function MoneyAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      className="h-auto min-h-11 min-w-0 flex-col whitespace-normal text-center"
      data-money-action-treatment={moneyActionTreatment}
      variant={moneyActionTreatment}
      onClick={onClick}
    >
      <Icon className="size-4" aria-hidden />
      <span className="min-w-0">{label}</span>
    </Button>
  );
}

function ProductCard({
  headingId,
  icon: Icon,
  title,
  value,
  detail,
}: {
  headingId: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <section className="h-full" aria-labelledby={headingId}>
      <Card className="h-full">
        <CardHeader>
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Icon className="size-4" aria-hidden />
            </span>
            <CardTitle>
              <h2 id={headingId}>{title}</h2>
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            <p className="text-xl font-semibold tabular-nums">{value}</p>
            <p className="text-sm text-muted-foreground">{detail}</p>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

export function RegionalHomeShellProposal({
  activeNavigation = "home",
  composition,
  copy,
  onAccount,
  onAction,
  onNavigate,
}: RegionalHomeShellProposalProps) {
  return (
    <div className="min-h-svh bg-muted text-foreground" data-regional-shell={composition.regionLabel}>
      <div className="mx-auto flex min-h-svh w-full max-w-screen-2xl bg-background md:grid md:grid-cols-[13rem_minmax(0,1fr)]">
        <aside className="hidden border-r bg-background p-4 md:flex md:flex-col" aria-label="Primary navigation">
          <div className="flex min-h-11 items-center px-3 text-base font-semibold">Home</div>
          <nav className="mt-6 flex flex-col gap-1" aria-label="Primary">
            <NavigationItems
              activeNavigation={activeNavigation}
              copy={copy}
              onNavigate={onNavigate}
              orientation="vertical"
            />
          </nav>
          <Button
            className="mt-auto min-h-11 w-full justify-start"
            variant="ghost"
            onClick={onAccount}
          >
            <UserRound className="size-5" aria-hidden />
            {copy.account}
          </Button>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex min-h-14 items-center justify-between border-b px-4 md:px-8">
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">{copy.home}</h1>
              <p className="truncate text-xs text-muted-foreground">{composition.regionLabel}</p>
            </div>
            <Button className="min-h-11 md:hidden" variant="ghost" onClick={onAccount}>
              <UserRound className="size-5" aria-hidden />
              <span className="sr-only">{copy.account}</span>
            </Button>
          </header>

          <main className="min-w-0 flex-1 px-4 py-5 pb-24 md:px-8 md:py-8 md:pb-8">
            <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-12 lg:gap-5">
              <section className="min-w-0 space-y-4 lg:col-span-7" aria-labelledby="regional-balance-heading">
                <Card variant="flush">
                  <CardContent inset="hero">
                    <p id="regional-balance-heading" className="text-sm text-muted-foreground">
                      {copy.totalBalance}
                    </p>
                    <p className="text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
                      {composition.totalBalance}
                    </p>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-3 gap-2" role="group" aria-label="Money actions">
                  <MoneyAction
                    icon={ArrowDownToLine}
                    label={copy.addMoney}
                    onClick={() => onAction("add-money")}
                  />
                  <MoneyAction
                    icon={Send}
                    label={copy.send}
                    onClick={() => onAction("send")}
                  />
                  <MoneyAction
                    icon={ArrowUpFromLine}
                    label={copy.cashOut}
                    onClick={() => onAction("cash-out")}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <ProductCard
                    headingId="regional-local-money-heading"
                    icon={Landmark}
                    title={composition.localMoney.title || copy.localMoney}
                    value={composition.localMoney.value}
                    detail={composition.localMoney.detail}
                  />
                  <ProductCard
                    headingId="regional-dollar-products-heading"
                    icon={PiggyBank}
                    title={composition.dollarProducts.title || copy.dollarProducts}
                    value={composition.dollarProducts.value}
                    detail={composition.dollarProducts.detail}
                  />
                </div>
              </section>

              <div className="min-w-0 space-y-4 lg:col-span-5">
                <section aria-labelledby="local-yield-heading">
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        <h2 id="local-yield-heading">{composition.localYield.title}</h2>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">{composition.localYield.detail}</p>
                        <p className="text-xs font-medium text-muted-foreground" data-capability-state={composition.localYield.state}>
                          {composition.localYield.state === "available"
                            ? copy.shownSeparately
                            : composition.localYield.state === "unavailable"
                              ? copy.localYieldUnavailable
                              : composition.localYield.state === "illustrative"
                                ? copy.illustrativeNonCoverage
                                : copy.countryNeeded}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </section>

                <section aria-labelledby="regional-activity-heading">
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        <h2 id="regional-activity-heading">{copy.activity}</h2>
                      </CardTitle>
                    </CardHeader>
                    <CardContent inset="list">
                      <div role="list">
                        {composition.activity.map((item) => (
                          <Item key={item.id} role="listitem">
                            <ItemMedia variant="avatar">
                              <ArrowDownToLine aria-hidden />
                            </ItemMedia>
                            <ItemContent className="min-w-0">
                              <ItemTitle truncate={false} className="whitespace-normal">{item.label}</ItemTitle>
                              <ItemDescription>{item.detail}</ItemDescription>
                            </ItemContent>
                            <p className="max-w-full text-right text-sm font-medium tabular-nums">{item.amount}</p>
                          </Item>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </section>
              </div>
            </div>
          </main>

          <nav className="fixed inset-x-0 bottom-0 z-10 grid min-h-16 grid-cols-3 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Primary">
            <NavigationItems
              activeNavigation={activeNavigation}
              copy={copy}
              onNavigate={onNavigate}
              orientation="horizontal"
            />
          </nav>
        </div>
      </div>
    </div>
  );
}
