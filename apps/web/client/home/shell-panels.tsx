"use client";

import type { RefObject, ReactNode } from "react";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { FetchActivity } from "@/client/activity";
import { AccountSettings } from "@/client/account/account-settings";
import { PrimaryNavigation } from "@/components/primary-navigation";
import {
  activityPanelId,
  balancesPanelId,
  isHomeNestedPanelId,
  borrowPanelId,
  savePanelId,
  type ShellPanelId,
} from "@/config/navigation";
import type { RegionId, ResolutionSource } from "@/config/regions";
import type { MoneyGroupId } from "@/config/shell-location";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { BorrowMarketId } from "@/shared/borrowing/config";
import { AuthenticatedBorrowExperience } from "@/client/borrowing/borrowing-experience";
import type { TransferAssetAvailability } from "@/shared/transfers/types";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import { ActivityPage } from "./activity-panel";
import { BalancesPage } from "./balances-panel";
import { SavingsPanel, InvestPanel } from "./feature-panels";
import { HomePanel } from "./home-panel";
import type { HomeAssetBalancesPresentation } from "./home-types";
import { MountedShellPanel } from "./panel-shared";
import {
  shellContentFrameClassName,
  shellScrollContainerClassName,
} from "@/components/shell-layout";

export function DashboardShell({
  mainRef,
  panelStageRef,
  isUnavailable,
  unavailableMessage,
  retrySessionValidation,
  isAccountSettingsOpen,
  isSignedOut,
  isChecking,
  isVerified,
  activeNavigation,
  nestedChromeTitle,
  regionId,
  resolutionSource,
  preferenceMessage,
  isPreferenceReady,
  accountAddress,
  accountOwnerKey,
  selectRegion,
  signOut,
  paintedAssetBalances,
  sendAvailability,
  assetMarkResolution,
  showSmallBalances,
  onShowSmallBalancesChange,
  revealSmallBalances,
  onRevealSmallBalancesChange,
  activitySession,
  fetchActivity,
  fetchOperations,
  navigateTo,
  borrowMarket,
  onSelectBorrowMarket,
  urlAddMoney,
  urlReturnedFromProvider,
  urlSendFlow,
  urlSendActionId,
  mountedPanels,
  balancesMounted,
  balancesReveal,
  savingsContent,
  investContent,
}: {
  mainRef: RefObject<HTMLElement | null>;
  panelStageRef: RefObject<HTMLElement | null>;
  isUnavailable: boolean;
  unavailableMessage: string | null;
  retrySessionValidation: () => Promise<void>;
  isAccountSettingsOpen: boolean;
  isSignedOut: boolean;
  isChecking: boolean;
  isVerified: boolean;
  activeNavigation: ShellPanelId;
  nestedChromeTitle: string | null;
  regionId: RegionId;
  resolutionSource: ResolutionSource;
  preferenceMessage: string;
  isPreferenceReady: boolean;
  accountAddress: string | null;
  accountOwnerKey: string | null;
  selectRegion: (region: RegionId) => void;
  signOut: () => void;
  paintedAssetBalances: HomeAssetBalancesPresentation;
  sendAvailability: readonly TransferAssetAvailability[];
  assetMarkResolution?: AssetMarkResolution;
  showSmallBalances: boolean;
  onShowSmallBalancesChange: (value: boolean) => void;
  revealSmallBalances: boolean;
  onRevealSmallBalancesChange: (value: boolean) => void;
  activitySession: VerifiedAccountSession | null;
  fetchActivity: FetchActivity;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
  navigateTo: (panel: ShellPanelId, group?: MoneyGroupId | null, market?: BorrowMarketId | null) => void;
  borrowMarket: BorrowMarketId | null;
  onSelectBorrowMarket: (market: BorrowMarketId | null) => void;
  urlAddMoney: boolean;
  urlReturnedFromProvider: boolean;
  urlSendFlow: boolean;
  urlSendActionId: string | null;
  mountedPanels: ReadonlySet<ShellPanelId>;
  balancesMounted: boolean;
  balancesReveal: { count: number; extend: () => void };
  savingsContent?: ReactNode;
  investContent?: ReactNode;
}) {
  return (
    <>
      <main
        ref={mainRef}
        className={`app-main-authenticated order-1 min-h-0 flex-1 overscroll-contain overflow-x-hidden bg-muted pb-4 scroll-pb-4 sm:order-2 ${shellScrollContainerClassName}`}
      >
        <div className={`${shellContentFrameClassName} py-4 sm:py-6`}>
        {isUnavailable ? (
          <Alert className="mb-4" role="alert">
            <AlertDescription>{unavailableMessage ?? "Account check unavailable."}</AlertDescription>
            <AlertAction>
              <Button variant="ghost" onClick={() => void retrySessionValidation()}>
                Retry account check
              </Button>
            </AlertAction>
          </Alert>
        ) : null}

        {isAccountSettingsOpen ? (
          <div>
            <AccountSettings
              regionId={regionId}
              onRegionChange={selectRegion}
              resolutionSource={resolutionSource}
              preferenceMessage={preferenceMessage}
              isPreferenceReady={isPreferenceReady}
              accountAddress={isVerified ? accountAddress : null}
              accountOwnerKey={isVerified ? accountOwnerKey : null}
              showSmallBalances={showSmallBalances}
              onShowSmallBalancesChange={onShowSmallBalancesChange}
              onSignOut={signOut}
            />
          </div>
        ) : isSignedOut ? (
          <section aria-busy="true" aria-label="Signed out">
            <span className="sr-only">Signed out</span>
          </section>
        ) : (
          <section
            ref={panelStageRef}
            className="outline-none"
            id="navigation-panel"
            tabIndex={-1}
            aria-labelledby={
              isHomeNestedPanelId(activeNavigation) || nestedChromeTitle
                ? undefined
                : `${activeNavigation}-nav`
            }
            aria-label={
              activeNavigation === savePanelId ? "Savings" : nestedChromeTitle ?? undefined
            }
            aria-busy={isChecking}
          >
            <div>
              {mountedPanels.has("home") ? (
                <MountedShellPanel active={activeNavigation === "home"}>
                  <HomePanel
                    assetBalances={paintedAssetBalances}
                    activitySession={activitySession}
                    sendAvailability={sendAvailability}
                    assetMarkResolution={assetMarkResolution}
                    fetchActivity={fetchActivity}
                    fetchOperations={fetchOperations}
                    onOpenSave={() => navigateTo(savePanelId)}
                    onOpenBorrow={() => navigateTo(borrowPanelId)}
                    onOpenBalances={(group) => navigateTo(balancesPanelId, group ?? null)}
                    onOpenActivity={() => navigateTo(activityPanelId)}
                    initialAddMoney={urlAddMoney}
                    returnedFromProvider={urlReturnedFromProvider}
                    initialSendFlow={urlSendFlow}
                    initialSendActionId={urlSendActionId}
                    regionId={regionId}
                  />
                </MountedShellPanel>
              ) : null}
              {balancesMounted ? (
                <MountedShellPanel active={activeNavigation === balancesPanelId}>
                  <BalancesPage
                    active={activeNavigation === balancesPanelId}
                    assetBalances={paintedAssetBalances}
                    showSmallBalances={showSmallBalances}
                    revealSmallBalances={revealSmallBalances}
                    onRevealSmallBalancesChange={onRevealSmallBalancesChange}
                    isChecking={isChecking}
                    revealedCount={balancesReveal.count}
                    onRevealMore={balancesReveal.extend}
                  />
                </MountedShellPanel>
              ) : null}
              {mountedPanels.has(activityPanelId) ? (
                <MountedShellPanel active={activeNavigation === activityPanelId}>
                  <ActivityPage
                    activitySession={activitySession}
                    fetchActivity={fetchActivity}
                    fetchOperations={fetchOperations}
                    regionId={regionId}
                    showSessionShimmer={!activitySession && (
                      paintedAssetBalances.status === "loading" ||
                      paintedAssetBalances.revalidating === true
                    )}
                  />
                </MountedShellPanel>
              ) : null}
              {mountedPanels.has(savePanelId) ? (
                <MountedShellPanel active={activeNavigation === savePanelId}>
                  <SavingsPanel
                    regionId={regionId}
                    isVerified={isVerified}
                    isChecking={isChecking}
                    content={savingsContent}
                  />
                </MountedShellPanel>
              ) : null}
              {mountedPanels.has(borrowPanelId) ? (
                <MountedShellPanel active={activeNavigation === borrowPanelId}>
                  <AuthenticatedBorrowExperience
                    selectedMarketId={borrowMarket}
                    onSelectMarket={onSelectBorrowMarket}
                    regionId={regionId}
                    assetMarkResolution={assetMarkResolution}
                  />
                </MountedShellPanel>
              ) : null}
              {mountedPanels.has("invest") ? (
                <MountedShellPanel active={activeNavigation === "invest"}>
                  <InvestPanel regionId={regionId} content={investContent} />
                </MountedShellPanel>
              ) : null}
            </div>
          </section>
        )}
        </div>
      </main>
      {!isSignedOut ? (
        <PrimaryNavigation activeNavigation={activeNavigation} onNavigate={navigateTo} />
      ) : null}
    </>
  );
}
