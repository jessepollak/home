import type { ReactNode } from "react";
import type { ShellPanelId } from "@/config/navigation";
import type { RegionId } from "@/config/regions";
import type { TransferAssetAvailability } from "@/shared/transfers/types";
import type { BalancesPresentation } from "@/shared/balances/present";

export type HomeAssetBalancesPresentation = BalancesPresentation;

export type HomeExperienceProps = {
  detectedCountry?: string | null;
  investContent?: ReactNode;
  savingsContent?: ReactNode;
  initialAccountOpen?: boolean;
  initialPanel?: ShellPanelId;
  initialAccountSettingsOpen?: boolean;
  assetBalances?: HomeAssetBalancesPresentation;
  presentAssetBalances?: (showSmallBalances: boolean) => HomeAssetBalancesPresentation;
  sendAvailability?: readonly TransferAssetAvailability[];
  showSmallBalances?: boolean;
  onShowSmallBalancesChange?: (value: boolean) => void;
  landingVisual?: ReactNode;
  routeMode?: "landing" | "dashboard";
  initialAddMoney?: boolean;
  returnedFromProvider?: boolean;
  initialSendFlow?: boolean;
  initialSendActionId?: string | null;
  applyInboundUrlIntent?: boolean;
  /** The request's query string, from the server page, so SSR and hydration read the same URL intent. */
  initialSearch?: string;
  selectedRegionId?: RegionId;
  onRegionChange?: (region: RegionId) => void;
};
