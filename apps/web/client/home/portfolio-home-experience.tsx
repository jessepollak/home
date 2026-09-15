"use client";

import { useCallback, useMemo, useState } from "react";
import { useBalances } from "@/client/balances";
import { useAccountWallet } from "@/client/account/cdp-client";
import { presentBalances } from "@/shared/balances/present";
import { resolvePresentation, type RegionId } from "@/config/regions";
import { HomeExperience } from "./home-shell-provider";
import { deriveAssetMarkResolution, deriveSendAvailability } from "./send-availability";
import type { HomeExperienceProps } from "./home-types";
import { useShowSmallBalances } from "./use-show-small-balances";

export function PortfolioHomeExperience(
  props: Omit<HomeExperienceProps, "assetBalances" | "sendAvailability" | "assetMarkResolution">,
) {
  const account = useAccountWallet();
  const [showSmallBalances, setShowSmallBalances] = useShowSmallBalances();
  const [selectedRegion, setSelectedRegion] = useState<RegionId>(
    () => resolvePresentation({ detectedCountry: props.detectedCountry }).region.id,
  );
  const session = account.verification && account.session?.smartAccount
    ? {
        subject: account.session.user.subject,
        smartAccountAddress: account.session.smartAccount.address,
        chainId: account.session.smartAccount.chainId,
        accountProvider: account.session.accountProvider,
      }
    : null;
  const balances = useBalances(session, selectedRegion, account.fetchBalances, {
    enabled: account.verification === "server",
  });
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
    <HomeExperience
      {...props}
      balancesRevalidating={balances.revalidating === true}
      presentAssetBalances={presentAssetBalances}
      sendAvailability={sendAvailability}
      assetMarkResolution={assetMarkResolution}
      showSmallBalances={showSmallBalances}
      onShowSmallBalancesChange={setShowSmallBalances}
      selectedRegionId={selectedRegion}
      onRegionChange={setSelectedRegion}
    />
  );
}
