"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { parseShellLocation, type ShellLocation } from "@/config/shell-location";
import type { NestedAppChrome } from "@/components/app-chrome";
import type { FetchActivity } from "@/client/activity";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { RegionId } from "@/config/regions";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import type { AssetKey } from "@/shared/balances/types";
import type { TransferAssetAvailability } from "@/shared/transfers/types";
import type { HomeExperienceProps, HomeAssetBalancesPresentation } from "./home-types";

type ShellPageContextValue = {
  paintedAssetBalances: HomeAssetBalancesPresentation;
  activitySession: VerifiedAccountSession | null;
  fetchActivity: FetchActivity;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
  regionId: RegionId;
  regionReady: boolean;
  sessionSettling: boolean;
  isChecking: boolean;
  isVerified: boolean;
  sendAvailability: readonly TransferAssetAvailability[];
  assetMarkResolution?: AssetMarkResolution;
  showSmallBalances: boolean;
  cardsEnabled: boolean;
  cashContent?: HomeExperienceProps["cashContent"];
  investContent?: HomeExperienceProps["investContent"];
  investmentsContent?: HomeExperienceProps["investmentsContent"];
  onHomeDetailsOpenChange: (open: boolean) => void;
  openInvestmentHolding: (holding: AssetKey) => void;
  closeInvestmentHolding: () => void;
  investmentsReturnHolding: AssetKey | null;
  openCashSavings: () => void;
  onInvestmentsChromeChange: (chrome: NestedAppChrome | null) => void;
  onRetryBalances?: () => void;
  initialAddMoney: boolean;
  returnedFromProvider: boolean;
  initialSendFlow: boolean;
  initialSendActionId: string | null;
};

const ShellPageContext = createContext<ShellPageContextValue | null>(null);

export function ShellPageProvider({ value, children }: { value: ShellPageContextValue; children: ReactNode }) {
  return <ShellPageContext value={value}>{children}</ShellPageContext>;
}

export function useShellPage(): ShellPageContextValue {
  const value = useContext(ShellPageContext);
  if (!value) throw new Error("A shell page must render inside the shell layout");
  return value;
}

export function useRouteShellLocation(): ShellLocation {
  const pathname = usePathname();
  const [location] = useState(() => parseShellLocation(pathname));
  return location;
}
