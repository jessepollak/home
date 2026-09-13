"use client";

import { useMemo, useState } from "react";
import {
  presentPortfolioValuation,
  usePortfolioValuation,
} from "@/client/portfolio";
import { useAccountWallet } from "@/client/account/cdp-client";
import { resolvePresentation, type RegionId } from "@/config/regions";
import { HomeExperience } from "./home-shell-provider";
import type { HomeExperienceProps } from "./home-types";

export function PortfolioHomeExperience(
  props: Omit<HomeExperienceProps, "assetBalances">,
) {
  const account = useAccountWallet();
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
  const valuation = usePortfolioValuation(
    session,
    selectedRegion,
    account.fetchPortfolioValuation,
    { enabled: account.verification === "server" },
  );
  const presentedValuation = useMemo(() => {
    const presented = presentPortfolioValuation(valuation);
    return valuation.revalidating && presented.status === "ready"
      ? { ...presented, revalidating: true as const, statusLabel: "Updating…" }
      : presented;
  }, [valuation]);

  return (
      <HomeExperience
        {...props}
        assetBalances={presentedValuation}
        selectedRegionId={selectedRegion}
        onRegionChange={setSelectedRegion}
      />
  );
}
