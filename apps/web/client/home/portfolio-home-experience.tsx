"use client";

import { useCallback, useMemo } from "react";
import { useBalances } from "@/client/balances";
import { useInterruption } from "@/client/status/use-interruption";
import { useAccountWallet } from "@/client/account/cdp-client";
import { presentBalances } from "@/shared/balances/present";
import type { CountryCode } from "@/config/regions";
import { PricedInvestExperienceWithDiscover } from "@/client/invest/priced-invest-experience";
import { investViewFromLocation } from "@/client/invest/invest-location";
import { useInvestDiscover } from "@/client/invest/use-invest-discover";
import { AuthenticatedSavingsExperience } from "@/client/savings/savings-experience";
import type { ShellLocation } from "@/config/shell-location";
import { DashboardShell } from "./shell";
import { deriveAssetMarkResolution, deriveSendAvailability } from "./send-availability";
import { useShowSmallBalances } from "./use-show-small-balances";
import { useHomeRegion } from "./use-home-region";

export function PortfolioHomeExperience({
  detectedCountry,
  initialLocation,
  initialSearch,
}: {
  detectedCountry: CountryCode | null;
  initialLocation: ShellLocation;
  initialSearch?: string;
}) {
  const account = useAccountWallet();
  const discover = useInvestDiscover();
  const [showSmallBalances, setShowSmallBalances] = useShowSmallBalances();
  const region = useHomeRegion({ detectedCountry });
  const initialInvestView = useMemo(
    () => investViewFromLocation(initialLocation),
    [initialLocation],
  );
  const session = account.verification && account.session?.smartAccount
    ? {
        subject: account.session.user.subject,
        smartAccountAddress: account.session.smartAccount.address,
        chainId: account.session.smartAccount.chainId,
        accountProvider: account.session.accountProvider,
      }
    : null;
  const balances = useBalances(session, region.regionId, account.fetchBalances, {
    enabled: account.verification === "server" ||
      (account.verification === "provisional" && account.status === "validating"),
    provisional: account.verification === "provisional" && account.status === "validating",
  });
  const interruptionStatus = useInterruption(
    balances.observation,
    account.status === "verified" && account.verification === "server",
    balances.retry,
  );
  const presentAssetBalances = useCallback(
    (showSmallBalances: boolean) => presentBalances(balances, { showSmallBalances }),
    [balances],
  );
  const sendAvailability = useMemo(
    () => balances.snapshot ? deriveSendAvailability(balances.snapshot) : [],
    [balances.snapshot],
  );
  const assetMarkResolution = useMemo(
    () => deriveAssetMarkResolution(balances.snapshot, balances.status === "loading"),
    [balances.snapshot, balances.status],
  );

  return (
    <DashboardShell
      region={region}
      initialPanel={initialLocation.panel}
      initialLocation={initialLocation}
      investContent={
        <PricedInvestExperienceWithDiscover
          discover={discover}
          initialView={initialInvestView}
        />
      }
      savingsContent={<AuthenticatedSavingsExperience />}
      applyInboundUrlIntent
      initialSearch={initialSearch}
      balancesRevalidating={balances.revalidating === true}
      interruption={interruptionStatus.interruption}
      interruptionAnnouncement={interruptionStatus.announcement}
      onRetryInterruption={interruptionStatus.retry}
      presentAssetBalances={presentAssetBalances}
      sendAvailability={sendAvailability}
      assetMarkResolution={assetMarkResolution}
      showSmallBalances={showSmallBalances}
      onShowSmallBalancesChange={setShowSmallBalances}
    />
  );
}
