"use client";

import dynamic from "next/dynamic";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VaultPositionsProvider } from "@/client/balances/vault-positions";
import { useBalances } from "@/client/balances";
import { usePendingCashoutEscrow } from "@/client/balances/pending-cashout";
import { useInterruption } from "@/client/status/use-interruption";
import { isSessionSettling, useAccountWallet } from "@/client/account/cdp-client";
import { recentActionsPath } from "@/client/actions/recent-actions-query";
import { presentHomeBalances } from "@/shared/balances/present";
import { selectOwnedInvestment } from "@/shared/balances/owned-investments";
import type { AssetKey } from "@/shared/balances/types";
import { ALL_REGIONS_OFFER, presentedRegionId, type CountryCode, type RegionOffer } from "@/config/regions";
import { COUNTRY_PREFERENCE_VERSION, parseCountryPreferenceReadResponse, parseCountryPreferenceResponse, type CountryPreferenceRequest, type CountryPreferenceSeed } from "@/shared/account/contracts/country-preference";
import { PricedInvestExperienceWithDiscover } from "@/client/invest/priced-invest-experience";
import { InvestmentsExperience } from "@/client/investments/investments-experience";
import { investViewFromLocation } from "@/client/invest/invest-location";
import { useInvestDiscover } from "@/client/invest/use-invest-discover";
import { AuthenticatedCashExperience } from "@/client/cash/cash-experience";
import type { ShellLocation } from "@/config/shell-location";
import type { InvestSettings } from "@/shared/operator-settings/invest";
import { DashboardShell } from "./shell";
import { ProductOfferingProvider } from "./product-offering";
import { resolveProductOffering, type ProductOffering } from "@/shared/operator-settings/products";
import { deriveAssetMarkResolution, deriveSendAvailability } from "./send-availability";
import { useShowSmallBalances } from "./use-show-small-balances";
import { isRegionAccountSignedIn, useHomeRegion } from "./use-home-region";

const LazyCardExperience = dynamic(() => import("@/client/cards/card-experience").then((module) => module.AuthenticatedCardExperience));

const preferenceReadRetryDelays = [500, 1500] as const;

export function PortfolioHomeExperience({
  detectedCountry,
  initialLocation,
  initialSearch,
  accountPreference,
  regionOffer = ALL_REGIONS_OFFER,
  investVisibility,
  productOffering = resolveProductOffering({ kind: "deployment" }),
  cardsEnabled = false,
}: {
  detectedCountry: CountryCode | null;
  regionOffer?: RegionOffer;
  initialLocation: ShellLocation;
  initialSearch?: string;
  accountPreference: CountryPreferenceSeed | null;
  investVisibility?: InvestSettings;
  productOffering?: ProductOffering;
  cardsEnabled?: boolean;
}) {
  const account = useAccountWallet();
  const discover = useInvestDiscover();
  const [showSmallBalances, setShowSmallBalances] = useShowSmallBalances();
  const fetchAccountResource = account.fetchAccountResource;
  const fetchCountryPreference = account.fetchCountryPreference;
  const accountReady = account.status === "verified" && account.verification === "server";
  const provisionalPreference = account.status === "validating" && account.verification === "provisional" &&
    Boolean(account.session?.smartAccount);
  const livePreferenceIdentity = (accountReady || provisionalPreference) && account.ownerKey && account.session
    ? `${account.ownerKey}\u0000${account.session.accountProvider}\u0000${account.session.user.subject}`
    : null;
  const preferenceIdentity = accountReady ? livePreferenceIdentity : null;
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
    status: "pending" | "settled" | "provisional-failed";
  }>({ owner: readOwner, identity: null, regionId: null, status: "pending" });
  if (preferenceState.owner !== readOwner) {
    setPreferenceState({ owner: readOwner, identity: null, regionId: null, status: "pending" });
  }
  const fetchedPreference = preferenceState.owner === readOwner && preferenceState.identity === livePreferenceIdentity
    ? preferenceState : null;
  const preferenceReadTransport = useRef({ fetchAccountResource, fetchCountryPreference, provisionalPreference });
  useEffect(() => {
    preferenceReadTransport.current = { fetchAccountResource, fetchCountryPreference, provisionalPreference };
  }, [fetchAccountResource, fetchCountryPreference, provisionalPreference]);
  const verifiedFallback = accountReady && fetchedPreference?.status === "provisional-failed";
  useEffect(() => {
    if (!livePreferenceIdentity || hasSeed || fetchedPreference?.status === "settled" ||
        (fetchedPreference?.status === "provisional-failed" && !verifiedFallback)) return;
    const provisionalRead = preferenceReadTransport.current.provisionalPreference;
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const attemptRead = (attempt: number) => {
      const read = provisionalRead
        ? preferenceReadTransport.current.fetchCountryPreference(controller.signal)
        : preferenceReadTransport.current.fetchAccountResource("/api/account/country-preference", { signal: controller.signal });
      void read
        .then((value) => {
          const response = parseCountryPreferenceReadResponse(value);
          if (!response) throw new Error("Invalid country preference response");
          if (active) setPreferenceState({ owner: readOwner, identity: livePreferenceIdentity, regionId: response.regionId, status: "settled" });
        })
        .catch(() => { // oxlint-disable-line home/no-silent-catch -- invalidated reads are ignored; active failures mark provisional-failed, retry within the bounded schedule, or settle with no region once retries are exhausted
          if (!active) return;
          if (provisionalRead) {
            setPreferenceState({ owner: readOwner, identity: livePreferenceIdentity, regionId: null, status: "provisional-failed" });
            return;
          }
          const delay = preferenceReadRetryDelays[attempt];
          if (delay === undefined) {
            setPreferenceState({ owner: readOwner, identity: livePreferenceIdentity, regionId: null, status: "settled" });
          } else {
            retryTimer = setTimeout(() => attemptRead(attempt + 1), delay);
          }
        });
    };
    attemptRead(0);
    return () => { active = false; controller.abort(); clearTimeout(retryTimer); };
  }, [hasSeed, fetchedPreference?.status, livePreferenceIdentity, readOwner, verifiedFallback]);
  const preferenceReadSettled = hasSeed || fetchedPreference?.status === "settled";
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
    accountIdentity: livePreferenceIdentity,
    accountOwner: readOwner,
    accountPreferencePending,
    signedIn: isRegionAccountSignedIn(account),
    accountReady: accountReady && preferenceReadSettled,
    accountSettling: isSessionSettling(account),
    writeAccountPreference,
    offer: regionOffer,
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
  const deviceCountryReady = accountPreference === null && region.isPreferenceReady &&
    region.resolutionSource === "persisted";
  const regionMatchesPreference = fetchedPreference?.status !== "settled" || fetchedPreference.regionId === null ||
    region.regionId === presentedRegionId(fetchedPreference.regionId, regionOffer) || region.resolutionSource === "explicit";
  const regionReady = region.isPreferenceReady && regionMatchesPreference && !accountPreferencePending;
  const provisionalPreferenceReady = provisionalPreference && fetchedPreference?.status === "settled" &&
    region.isPreferenceReady && (fetchedPreference.regionId === null || region.regionId === presentedRegionId(fetchedPreference.regionId, regionOffer));
  const provisionalRegionReady = hasSeed ||
    (deviceCountryReady && fetchedPreference?.status !== "settled") || provisionalPreferenceReady;
  const suppressBalances = (account.verification === "server" && !regionReady) ||
    (provisionalBalances && !provisionalRegionReady);
  const balances = useBalances(session, region.regionId, account.fetchBalances, {
    enabled: (account.verification === "server" && regionReady) ||
      (provisionalBalances && provisionalRegionReady),
    provisional: provisionalBalances,
    held: suppressBalances,
    paintCachedWhileHeld: (hasSeed && seedPreference !== null && presentedRegionId(seedPreference, regionOffer) === region.regionId) ||
      (fetchedPreference?.status === "settled" && fetchedPreference.regionId !== null &&
        presentedRegionId(fetchedPreference.regionId, regionOffer) === region.regionId) || region.resolutionSource === "explicit",
  });
  const pendingCashout = usePendingCashoutEscrow(accountReady ? account.session : null, balances.snapshot,
    (signal) => account.fetchAccountResource(recentActionsPath, { signal }));
  const interruptionStatus = useInterruption(
    balances.observation,
    account.status === "verified" && account.verification === "server" && !suppressBalances,
    balances.retry,
  );
  const balanceStatus = balances.status;
  const snapshot = balances.snapshot;
  const revalidating = balances.revalidating;
  const homeBalances = useMemo(() => presentHomeBalances(
    balanceStatus === "ready" && snapshot
      ? { status: balanceStatus, snapshot, error: null }
      : balanceStatus === "error"
        ? { status: balanceStatus, snapshot: null, error: "balances-unavailable" }
        : { status: balanceStatus === "unavailable" ? "unavailable" : "loading", snapshot: null, error: null },
    { pendingCashout },
  ), [balanceStatus, snapshot, pendingCashout]);
  const assetBalances = useMemo(() => revalidating
    ? { ...homeBalances, revalidating } : homeBalances, [homeBalances, revalidating]);
  const sendAvailability = useMemo(
    () => balances.snapshot ? deriveSendAvailability(balances.snapshot) : [],
    [balances.snapshot],
  );
  const assetMarkResolution = useMemo(
    () => deriveAssetMarkResolution(balances.snapshot, balances.status === "loading"),
    [balances.snapshot, balances.status],
  );
  const canOpenAssetDetail = useMemo(() => {
    const snapshot = balances.snapshot;
    return (key: string) => snapshot !== null && selectOwnedInvestment(snapshot, key as AssetKey) !== null;
  }, [balances.snapshot]);

  return (
    <VaultPositionsProvider snapshot={snapshot}>
    <ProductOfferingProvider value={productOffering}>
    <DashboardShell
      region={region}
      regionReady={regionReady}
      initialPanel={initialLocation.panel}
      initialLocation={initialLocation}
      cardsEnabled={cardsEnabled}
      cardContent={cardsEnabled ? <LazyCardExperience /> : undefined}
      investContent={
        <PricedInvestExperienceWithDiscover
          discover={discover}
          initialView={initialInvestView}
          investVisibility={investVisibility}
        />
      }
      // oxlint-disable-next-line react/no-unstable-nested-components -- Shell invokes this render callback as a function, not a component.
      cashContent={({ view, onOpenSavings }) => <AuthenticatedCashExperience view={view} onOpenSavings={onOpenSavings} regionReady={regionReady} pendingCashout={pendingCashout} />}
      // oxlint-disable-next-line react/no-unstable-nested-components -- Shell invokes this render callback as a function, not a component.
      investmentsContent={(props) => <InvestmentsExperience {...props} balances={balances} discover={discover} />}
      applyInboundUrlIntent
      initialSearch={initialSearch}
      balancesRevalidating={balances.revalidating === true}
      interruption={interruptionStatus.interruption}
      interruptionAnnouncement={interruptionStatus.announcement}
      onRetryInterruption={interruptionStatus.retry}
      assetBalances={assetBalances}
      balancesState={balances}
      pendingCashout={pendingCashout}
      sendAvailability={sendAvailability}
      canOpenAssetDetail={canOpenAssetDetail}
      assetMarkResolution={assetMarkResolution}
      showSmallBalances={showSmallBalances}
      onShowSmallBalancesChange={setShowSmallBalances}
    />
    </ProductOfferingProvider>
    </VaultPositionsProvider>
  );
}
