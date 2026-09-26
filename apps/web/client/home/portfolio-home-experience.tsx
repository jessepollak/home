"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useBalances } from "@/client/balances";
import { useInterruption } from "@/client/status/use-interruption";
import { isSessionSettling, useAccountWallet } from "@/client/account/cdp-client";
import { presentBalances } from "@/shared/balances/present";
import type { CountryCode } from "@/config/regions";
import { COUNTRY_PREFERENCE_VERSION, parseCountryPreferenceReadResponse, parseCountryPreferenceResponse, type CountryPreferenceRequest, type CountryPreferenceSeed } from "@/shared/account/contracts/country-preference";
import { PricedInvestExperienceWithDiscover } from "@/client/invest/priced-invest-experience";
import { investViewFromLocation } from "@/client/invest/invest-location";
import { useInvestDiscover } from "@/client/invest/use-invest-discover";
import { AuthenticatedSavingsExperience } from "@/client/savings/savings-experience";
import type { ShellLocation } from "@/config/shell-location";
import { DashboardShell } from "./shell";
import { deriveAssetMarkResolution, deriveSendAvailability } from "./send-availability";
import { useShowSmallBalances } from "./use-show-small-balances";
import { isRegionAccountSignedIn, useHomeRegion } from "./use-home-region";

const preferenceReadRetryDelays = [500, 1500] as const;

export function PortfolioHomeExperience({
  detectedCountry,
  initialLocation,
  initialSearch,
  accountPreference,
}: {
  detectedCountry: CountryCode | null;
  initialLocation: ShellLocation;
  initialSearch?: string;
  accountPreference: CountryPreferenceSeed | null;
}) {
  const account = useAccountWallet();
  const discover = useInvestDiscover();
  const [showSmallBalances, setShowSmallBalances] = useShowSmallBalances();
  const fetchAccountResource = account.fetchAccountResource;
  const accountReady = account.status === "verified" && account.verification === "server";
  const preferenceIdentity = accountReady && account.ownerKey && account.session
    ? `${account.ownerKey}\u0000${account.session.accountProvider}\u0000${account.session.user.subject}`
    : null;
  const readOwner = account.status === "signed-out" ? null : account.ownerKey;
  const seedApplies = accountPreference !== null && account.status !== "signed-out" && (!account.session ||
    (account.session.accountProvider === accountPreference.accountProvider &&
      account.session.user.subject === accountPreference.subject));
  const [seedRetired, setSeedRetired] = useState(false);
  if (accountPreference && !seedApplies && !seedRetired) setSeedRetired(true);
  const hasSeed = Boolean(accountPreference && seedApplies && !seedRetired);
  const seedPreference = hasSeed ? accountPreference?.regionId ?? null : null;
  const [preferenceState, setPreferenceState] = useState<{
    owner: string | null;
    identity: string | null;
    regionId: CountryCode | null;
  }>({ owner: readOwner, identity: null, regionId: null });
  if (preferenceState.owner !== readOwner) {
    setPreferenceState({ owner: readOwner, identity: null, regionId: null });
  }
  const fetchedPreference = preferenceState.owner === readOwner ? preferenceState : null;
  useEffect(() => {
    if (!preferenceIdentity || hasSeed || fetchedPreference?.identity === preferenceIdentity) return;
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const attemptRead = (attempt: number) => {
      void fetchAccountResource("/api/account/country-preference", { signal: controller.signal })
        .then((value) => {
          const response = parseCountryPreferenceReadResponse(value);
          if (!response) throw new Error("Invalid country preference response");
          if (active) setPreferenceState({ owner: readOwner, identity: preferenceIdentity, regionId: response.regionId });
        })
        .catch(() => {
          if (!active) return;
          const delay = preferenceReadRetryDelays[attempt];
          if (delay === undefined) {
            setPreferenceState({ owner: readOwner, identity: preferenceIdentity, regionId: null });
          } else {
            retryTimer = setTimeout(() => attemptRead(attempt + 1), delay);
          }
        });
    };
    attemptRead(0);
    return () => { active = false; controller.abort(); clearTimeout(retryTimer); };
  }, [hasSeed, fetchAccountResource, fetchedPreference?.identity, preferenceIdentity, readOwner]);
  const preferenceReadSettled = hasSeed || fetchedPreference?.identity === preferenceIdentity;
  const accountPreferencePending = Boolean(preferenceIdentity && !preferenceReadSettled);
  const writeAccountPreference = useCallback(async (regionId: CountryCode, adopt: boolean) => {
    const body: CountryPreferenceRequest = { version: COUNTRY_PREFERENCE_VERSION, regionId, adopt };
    const value = await fetchAccountResource("/api/account/country-preference", { method: "PUT", body });
    const response = parseCountryPreferenceResponse(value);
    if (!response) throw new Error("Invalid country preference response");
    return response.regionId;
  }, [fetchAccountResource]);
  const region = useHomeRegion({
    detectedCountry,
    accountPreference: hasSeed ? seedPreference : preferenceReadSettled ? fetchedPreference?.regionId ?? null : null,
    accountIdentity: preferenceIdentity,
    accountOwner: readOwner,
    accountPreferencePending,
    signedIn: isRegionAccountSignedIn(account),
    accountReady: accountReady && preferenceReadSettled,
    accountSettling: isSessionSettling(account),
    writeAccountPreference,
  });
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
  const provisionalBalances = account.verification === "provisional" && account.status === "validating";
  const suppressBalances = (account.verification === "server" && (!region.isPreferenceReady || accountPreferencePending)) ||
    (provisionalBalances && !hasSeed);
  const balances = useBalances(session, region.regionId, account.fetchBalances, {
    enabled: (account.verification === "server" && region.isPreferenceReady && !accountPreferencePending) ||
      (provisionalBalances && hasSeed),
    provisional: provisionalBalances,
    held: suppressBalances,
  });
  const interruptionStatus = useInterruption(
    balances.observation,
    account.status === "verified" && account.verification === "server" && !suppressBalances,
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
      regionReady={region.isPreferenceReady && !accountPreferencePending}
      initialPanel={initialLocation.panel}
      initialLocation={initialLocation}
      investContent={
        <PricedInvestExperienceWithDiscover
          discover={discover}
          initialView={initialInvestView}
        />
      }
      savingsContent={<AuthenticatedSavingsExperience regionReady={region.isPreferenceReady && !accountPreferencePending} />}
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
