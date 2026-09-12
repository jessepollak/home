"use client";

import type { RefObject, ReactNode } from "react";
import type { FetchActivity } from "@/client/activity";
import { AccountSettings } from "@/client/account/account-settings";
import { PrimaryNavigation } from "@/components/primary-navigation";
import {
  activityPanelId,
  balancesPanelId,
  isHomeNestedPanelId,
  savePanelId,
  type ShellPanelId,
} from "@/config/navigation";
import type { RegionId, ResolutionSource } from "@/config/regions";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { ActivityPage } from "./activity-panel";
import { BalancesPage } from "./balances-panel";
import { SavingsPanel, InvestPanel } from "./feature-panels";
import { HomePanel } from "./home-panel";
import type { HomeAssetBalancesPresentation } from "./home-types";
import { MountedShellPanel } from "./panel-shared";

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
  selectRegion,
  signOut,
  paintedAssetBalances,
  assetMarkResolution,
  activitySession,
  fetchActivity,
  fetchOperations,
  navigateTo,
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
  selectRegion: (region: RegionId) => void;
  signOut: () => void;
  paintedAssetBalances: HomeAssetBalancesPresentation;
  assetMarkResolution?: AssetMarkResolution;
  activitySession: VerifiedAccountSession | null;
  fetchActivity: FetchActivity;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
  navigateTo: (panel: ShellPanelId) => void;
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
      <main ref={mainRef} className="app-main app-main-authenticated">
        {isUnavailable ? (
          <div className="dashboard-notice" role="alert">
            <span>{unavailableMessage ?? "Account check unavailable."}</span>
            <button type="button" onClick={() => void retrySessionValidation()}>
              Retry account check
            </button>
          </div>
        ) : null}

        {isAccountSettingsOpen ? (
          <div className="panel-fade">
            <AccountSettings
              regionId={regionId}
              onRegionChange={selectRegion}
              resolutionSource={resolutionSource}
              preferenceMessage={preferenceMessage}
              isPreferenceReady={isPreferenceReady}
              accountAddress={isVerified ? accountAddress : null}
              onSignOut={signOut}
            />
          </div>
        ) : isSignedOut ? (
          <section className="panel-stage" aria-busy="true" aria-label="Signed out">
            <span className="sr-status">Signed out</span>
          </section>
        ) : (
          <section
            ref={panelStageRef}
            className="panel-stage"
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
            <div className="panel-fade">
              {mountedPanels.has("home") ? (
                <MountedShellPanel active={activeNavigation === "home"}>
                  <HomePanel
                    assetBalances={paintedAssetBalances}
                    assetMarkResolution={assetMarkResolution}
                    activitySession={activitySession}
                    fetchActivity={fetchActivity}
                    fetchOperations={fetchOperations}
                    onOpenSave={() => navigateTo(savePanelId)}
                    onOpenBalances={() => navigateTo(balancesPanelId)}
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
                    assetMarkResolution={assetMarkResolution}
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
                    isVerified={isVerified}
                    isChecking={isChecking}
                    content={savingsContent}
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
      </main>
      {!isSignedOut ? (
        <PrimaryNavigation activeNavigation={activeNavigation} onNavigate={navigateTo} />
      ) : null}
    </>
  );
}
