"use client";

import { useMemo, useState } from "react";
import { useBalances } from "@/client/balances";
import { useAccountWallet } from "@/client/account/cdp-client";
import { presentBalances } from "@/shared/balances/present";
import { resolvePresentation, type RegionId } from "@/config/regions";
import { HomeExperience } from "./home-shell-provider";
import { deriveSendAvailability } from "./send-availability";
import type { HomeExperienceProps } from "./home-types";

export function PortfolioHomeExperience(
  props: Omit<HomeExperienceProps, "assetBalances" | "sendAvailability">,
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
  const balances = useBalances(session, selectedRegion, account.fetchBalances, {
    enabled: account.verification === "server",
  });
  const presentation = useMemo(() => presentBalances(balances), [balances]);
  const sendAvailability = useMemo(
    () => balances.snapshot ? deriveSendAvailability(balances.snapshot) : [],
    [balances.snapshot],
  );

  return (
    <HomeExperience
      {...props}
      assetBalances={presentation}
      sendAvailability={sendAvailability}
      selectedRegionId={selectedRegion}
      onRegionChange={setSelectedRegion}
    />
  );
}
