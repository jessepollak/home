"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppChromeProvider, useOptionalAppChrome, type NestedAppChrome } from "@/components/app-chrome";
import { shellDesktopContentClassName } from "@/components/shell-layout";
import { shellHref } from "@/config/shell-location";
import { useOptionalHomeShellRouting } from "./panel-routing";
import { useRouteShellLocation, useShellPage } from "./shell-page-context";
import { useProductOffering } from "./product-offering";
import { HomePanel } from "./home-panel";
import { ActivityPage } from "./activity-panel";
import { CashPanel, InvestPanel, InvestmentsPanel } from "./feature-panels";
import { AuthenticatedBorrowExperience } from "@/client/borrowing/borrowing-experience";
const LazyCardExperience = dynamic(() => import("@/client/cards/card-experience").then((module) => module.AuthenticatedCardExperience));


export function HomePageContent() {
  const page = useShellPage();
  const routing = useOptionalHomeShellRouting();
  const open = routing?.openPanel;
  const investOffered = useProductOffering().products.invest === "on";
  return <div data-shell-panel-id="home"><HomePanel
    assetBalances={page.paintedAssetBalances}
    activitySession={page.activitySession}
    onRetryBalances={page.onRetryBalances}
    sessionSettling={page.sessionSettling}
    sendAvailability={page.sendAvailability}
    assetMarkResolution={page.assetMarkResolution}
    fetchActivity={page.fetchActivity}
    fetchOperations={page.fetchOperations}
    onOpenCash={() => open?.("cash")}
    onOpenInvestments={() => open?.(investOffered && page.paintedAssetBalances.summary?.investments.ownedCount === 0 &&
      page.paintedAssetBalances.summary.investments.status === "complete" ? "invest" : "investments")}
    onOpenBorrow={() => open?.("borrow")}
    initialAddMoney={page.initialAddMoney}
    returnedFromProvider={page.returnedFromProvider}
    initialSendFlow={page.initialSendFlow}
    initialSendActionId={page.initialSendActionId}
    regionId={page.regionId}
    initialRateLabels={page.initialRateLabels}
    regionReady={page.regionReady}
    onDetailsOpenChange={page.onHomeDetailsOpenChange}
  /></div>;
}

export function ActivityPageContent() {
  const page = useShellPage();
  return <div className={shellDesktopContentClassName} data-shell-panel-id="activity"><ActivityPage
    activitySession={page.activitySession}
    fetchActivity={page.fetchActivity}
    fetchOperations={page.fetchOperations}
    regionId={page.regionId}
    showSessionShimmer={page.activitySession ? !page.regionReady : page.sessionSettling ||
      page.paintedAssetBalances.status === "loading" || page.paintedAssetBalances.revalidating === true}
  /></div>;
}

export function CashPageContent() {
  const page = useShellPage();
  const location = useRouteShellLocation();
  const view = location.cashView === "savings" ? "savings" : "cash";
  return <div className={shellDesktopContentClassName} data-shell-panel-id="cash"><CashPanel regionId={page.regionId} isVerified={page.isVerified}
    isChecking={page.isChecking} content={page.cashContent?.({ view, onOpenSavings: page.openCashSavings })} /></div>;
}

export function BorrowPageContent() {
  const page = useShellPage();
  const location = useRouteShellLocation();
  const router = useRouter();
  const routing = useOptionalHomeShellRouting();
  return <div className={shellDesktopContentClassName} data-shell-panel-id="borrow"><AuthenticatedBorrowExperience
    selectedMarketId={location.market} onSelectMarket={(market) => {
      const href = shellHref({ panel: "borrow", market });
      if (market === null) {
        if (routing) routing.leaveRoute(href);
        else router.replace(href);
        return;
      }
      if (routing) routing.pushRoute(href);
      else router.push(href);
    }} regionId={page.regionId} assetMarkResolution={page.assetMarkResolution}
    borrowSummary={page.paintedAssetBalances.summary?.borrow ?? null} /></div>;
}

function ChromeSync({ onChange }: { onChange: (chrome: NestedAppChrome | null) => void }) {
  const chrome = useOptionalAppChrome();
  useEffect(() => onChange(chrome?.nested ?? null), [chrome?.nested, onChange]);
  return null;
}

export function InvestmentsPageContent() {
  const page = useShellPage();
  const location = useRouteShellLocation();
  const changeChrome = page.onInvestmentsChromeChange;
  return <div className={shellDesktopContentClassName} data-shell-panel-id="investments"><AppChromeProvider>
    <ChromeSync onChange={changeChrome} />
    <InvestmentsPanel regionId={page.regionId} content={page.investmentsContent?.({
      holding: location.holding ?? null,
      onOpenHolding: page.openInvestmentHolding,
      onCloseHolding: page.closeInvestmentHolding,
      returnHolding: page.investmentsReturnHolding,
    })} />
  </AppChromeProvider></div>;
}

export function InvestPageContent() {
  const page = useShellPage();
  const investOffered = useProductOffering().products.invest === "on";
  if (!investOffered) return <HomeRedirect />;
  return <div className={shellDesktopContentClassName} data-shell-panel-id="invest"><InvestPanel regionId={page.regionId} content={page.investContent} /></div>;
}

function HomeRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/home"); }, [router]);
  return null;
}

export function CardPageContent() {
  return <div className={shellDesktopContentClassName} data-shell-panel-id="card"><LazyCardExperience /></div>;
}

export function ShellFallbackContent() {
  const page = useShellPage();
  const location = useRouteShellLocation();
  switch (location.panel) {
    case "card":
      return page.cardsEnabled ? <CardPageContent /> : <HomeRedirect />;
    case "activity":
      return <ActivityPageContent />;
    case "cash":
      return <CashPageContent />;
    case "borrow":
      return <BorrowPageContent />;
    case "investments":
      return <InvestmentsPageContent />;
    case "invest":
      return <InvestPageContent />;
    default:
      return <HomePageContent />;
  }
}
