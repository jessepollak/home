import type { HomeRateLabels } from "@/shared/balances/home-summary";
import type { ReactNode } from "react";
import type { ShellPanelId } from "@/config/navigation";
import type { HomeRegionState } from "./use-home-region";
import type { TransferAssetAvailability } from "@/shared/transfers/types";
import type { BalancesPresentation, HomeBalancesPresentation } from "@/shared/balances/present";
import type { ShellLocation } from "@/config/shell-location";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import type { AssetKey } from "@/shared/balances/types";

export type HomeAssetBalancesPresentation = HomeBalancesPresentation;

export type InvestmentsContentProps = {
  holding: AssetKey | null;
  onOpenHolding: (holding: AssetKey) => void;
  onCloseHolding: () => void;
  returnHolding?: AssetKey | null;
};

export type HomeExperienceProps = {
  initialRateLabels?: HomeRateLabels;
  investContent?: ReactNode;
  cardsEnabled?: boolean;
  cashContent?: (props: { view: "cash" | "savings"; onOpenSavings: () => void }) => ReactNode;
  investmentsContent?: (props: InvestmentsContentProps) => ReactNode;
  initialAccountOpen?: boolean;
  initialPanel?: ShellPanelId;
  initialLocation?: ShellLocation;
  initialAccountSettingsOpen?: boolean;
  assetBalances?: HomeBalancesPresentation | BalancesPresentation;
  sendAvailability?: readonly TransferAssetAvailability[];
  canOpenAssetDetail?: (assetKey: string) => boolean;
  assetMarkResolution?: AssetMarkResolution;
  showSmallBalances?: boolean;
  onShowSmallBalancesChange?: (value: boolean) => void;
  landingVisual?: ReactNode;
  routeMode?: "landing" | "dashboard";
  interruption?: { kind: "offline" | "interrupted" } | null;
  interruptionAnnouncement?: "offline" | "interrupted" | null;
  onRetryInterruption?: () => void;
  initialAddMoney?: boolean;
  returnedFromProvider?: boolean;
  initialSendFlow?: boolean;
  initialSendActionId?: string | null;
  applyInboundUrlIntent?: boolean;
  initialSearch?: string;
  region: HomeRegionState;
  regionReady?: boolean;
};
