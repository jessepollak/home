"use client";

import { useMemo, useState } from "react";
import { ActivityPanelView } from "@/client/activity";
import type { UseActivityResult } from "@/client/activity/use-activity";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { MoneyMotionProvider } from "@/components/money-ticker";
import type { NavigationId } from "@/config/navigation";
import type { RegionId } from "@/config/regions";
import { ReferenceActivityHeader, type ReferenceHomeIntent } from "./reference-home";
import {
  ReferenceDirectionsFrame,
  type ReferenceDirectionsSurfaceId,
} from "./reference-directions-frame";
import {
  ReferenceOverviewHome,
  ReferenceStatementHome,
  ReferenceTabbedHome,
} from "./reference-directions-home";
import {
  ReferenceStatementSave,
  ReferenceTabbedSave,
  ReferenceWorkspaceSave,
} from "./reference-directions-save";
import {
  presentReferencePosition,
  type ReferenceMoneyPosition,
} from "./reference-position";

/**
 * Fixture-level paired Home + Save surface for the three direction examples in
 * [issue #654](https://github.com/jessepollak/home/issues/654).
 *
 * It owns the proposal's view and selected-vault state, renders the production
 * `PrimaryNavigation` frame, and forwards the same action contract the connected
 * reference journey uses (`onIntent`, `onDeposit`, `onWithdraw`, `onSelectVault`), so a
 * selected direction can be wired to the existing money sheet without a provider here.
 * Home and Save stories render this same component, which is what keeps the pair in one
 * direction on the same fixture and presenter.
 */

export type ReferenceDirectionId = "overview" | "statement" | "workspace";

export type ReferenceDirectionsSurfaceProps = {
  direction: ReferenceDirectionId;
  position: ReferenceMoneyPosition;
  activity: UseActivityResult;
  initialSurface?: ReferenceDirectionsSurfaceId;
  regionId?: RegionId;
  /** Deterministic review override; production still follows `prefers-reduced-motion`. */
  reducedMotion?: boolean;
  onIntent?: (intent: ReferenceHomeIntent) => void;
  onOpenActivity?: () => void;
  onNavigate?: (navigation: NavigationId) => void;
  onDeposit?: () => void;
  onWithdraw?: () => void;
};

export function ReferenceDirectionsSurface({
  direction,
  position,
  activity,
  initialSurface = "home",
  regionId = "US",
  reducedMotion = false,
  onIntent,
  onOpenActivity,
  onNavigate,
  onDeposit,
  onWithdraw,
}: ReferenceDirectionsSurfaceProps) {
  const view = useMemo(() => presentReferencePosition(position), [position]);
  const [surface, setSurface] = useState<ReferenceDirectionsSurfaceId>(initialSurface);
  const [selectedVaultAddress, setSelectedVaultAddress] = useState<string | null>(
    () =>
      view.saved.vaults.find((vault) => vault.funded)?.vaultAddress ??
      view.saved.vaults[0]?.vaultAddress ??
      null,
  );

  const openSave = (vaultAddress?: string) => {
    if (vaultAddress) setSelectedVaultAddress(vaultAddress);
    setSurface("save");
  };

  const activityTeaser = (
    <ActivityPanelView
      density="teaser"
      header={<ReferenceActivityHeader onOpen={onOpenActivity} />}
      activity={activity}
      operations={[]}
      regionId={regionId}
    />
  );
  // The tabbed Home owns Activity as a destination, so its panel is the full page view.
  const activityPage = (
    <ActivityPanelView
      density="page"
      header={<ReferenceActivityHeader />}
      activity={activity}
      operations={[]}
      regionId={regionId}
    />
  );

  const homeContent =
    direction === "overview" ? (
      <ReferenceOverviewHome
        position={view}
        activityContent={activityTeaser}
        onIntent={onIntent}
        onOpenSave={openSave}
      />
    ) : direction === "statement" ? (
      <ReferenceStatementHome
        position={view}
        activityContent={activityTeaser}
        onIntent={onIntent}
        onOpenSave={openSave}
      />
    ) : (
      <ReferenceTabbedHome
        position={view}
        activityContent={activityPage}
        onIntent={onIntent}
        onOpenSave={openSave}
      />
    );

  const saveContent =
    direction === "overview" ? (
      <ReferenceWorkspaceSave
        position={view}
        selectedVaultAddress={selectedVaultAddress}
        onSelectVault={setSelectedVaultAddress}
        onDeposit={onDeposit}
        onWithdraw={onWithdraw}
      />
    ) : direction === "statement" ? (
      <ReferenceStatementSave
        position={view}
        selectedVaultAddress={selectedVaultAddress}
        onSelectVault={setSelectedVaultAddress}
        onDeposit={onDeposit}
        onWithdraw={onWithdraw}
      />
    ) : (
      <ReferenceTabbedSave
        position={view}
        selectedVaultAddress={selectedVaultAddress}
        onSelectVault={setSelectedVaultAddress}
        onDeposit={onDeposit}
        onWithdraw={onWithdraw}
      />
    );

  const frame = (
    <ReferenceDirectionsFrame
      surface={surface}
      onBack={() => setSurface("home")}
      onNavigate={(navigation) => {
        if (navigation === "home") {
          setSurface("home");
          return;
        }
        // Invest stays visible context in these examples; its flow is out of scope.
        onNavigate?.(navigation);
      }}
    >
      {surface === "home" ? homeContent : saveContent}
    </ReferenceDirectionsFrame>
  );

  return (
    <PresentationRegionProvider regionId={regionId}>
      {reducedMotion ? <MoneyMotionProvider reducedMotion>{frame}</MoneyMotionProvider> : frame}
    </PresentationRegionProvider>
  );
}
