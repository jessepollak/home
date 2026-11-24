"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import {
  readAnonymousCountryPreference,
  writeAnonymousCountryPreference,
} from "@/config/country-preference";
import {
  ALL_REGIONS_OFFER,
  normalizeCountryCode,
  presentedRegionId,
  resolvePresentation,
  type RegionOffer,
  type CountryCode,
  type RegionId,
  type ResolutionSource,
} from "@/config/regions";

import { useHomeDisplayCurrency } from "./use-home-display-currency";
import type { DisplayCurrencyChoice } from "@/shared/account/display-currency";

type AccountPreferenceWriter = (regionId: CountryCode, adopt: boolean) => Promise<CountryCode>;

export function isRegionAccountSignedIn(account: Pick<AccountWalletClient, "status" | "isSignedIn">): boolean {
  return account.status === "verified" || (account.status === "unavailable" && account.isSignedIn);
}

export function useHomeRegion({
  detectedCountry,
  accountPreference = null,
  accountDisplayCurrency = null,
  writeAccountDisplayCurrency,
  accountIdentity = null,
  accountOwner = null,
  accountPreferencePending = false,
  signedIn = false,
  accountReady = false,
  accountSettling = false,
  writeAccountPreference,
  offer = ALL_REGIONS_OFFER,
}: {
  detectedCountry: string | null;
  accountPreference?: CountryCode | null;
  accountDisplayCurrency?: string | null;
  writeAccountDisplayCurrency?: (choice: DisplayCurrencyChoice, adopt: boolean) => Promise<string | null>;
  accountIdentity?: string | null;
  accountOwner?: string | null;
  accountPreferencePending?: boolean;
  signedIn?: boolean;
  accountReady?: boolean;
  accountSettling?: boolean;
  writeAccountPreference?: AccountPreferenceWriter;
  offer?: RegionOffer;
}) {
  const savedAccountPreference = normalizeCountryCode(accountPreference);
  const initial = resolvePresentation({ persistedCountry: savedAccountPreference, detectedCountry, offer });
  const [storedRegionId, setRegionId] = useState<RegionId>(initial.region.id);
  const [storedResolutionSource, setResolutionSource] = useState<ResolutionSource>(initial.source);
  const [readiness, setReadiness] = useState({ identity: accountIdentity, ready: Boolean(savedAccountPreference) });
  const isPreferenceReady = !accountPreferencePending && readiness.identity === accountIdentity && readiness.ready;
  const [preferenceMessage, setPreferenceMessage] = useState("");
  const [browserPreference, setBrowserPreference] = useState<CountryCode | null>(null);
  const selectionVersion = useRef(0);
  const generation = useRef(0);
  const previousSignedIn = useRef(signedIn);
  const adoptionAttempted = useRef(false);
  const adoptionIdentity = useRef<string | null>(null);
  const currentIdentity = useRef(accountIdentity);
  const mounted = useRef(true);
  const pendingWrites = useRef(new Map<string | null, Promise<unknown>>());
  const pendingSettlingSelection = useRef<{ country: CountryCode; identity: string | null; owner: string | null } | null>(null);
  const [heldIdentity, setHeldIdentity] = useState<string | null>(null);
  const [heldSelection, setHeldSelection] = useState<{ identity: string | null; owner: string | null } | null>(null);
  const heldMatchesAccount = heldSelection !== null &&
    (heldSelection.identity === null || heldSelection.identity === accountIdentity) &&
    (heldSelection.owner === null || heldSelection.owner === accountOwner);
  if (accountPreferencePending && accountIdentity !== heldIdentity) {
    setHeldIdentity(accountIdentity);
    if (!heldMatchesAccount) {
      const placeholder = resolvePresentation({ detectedCountry, offer });
      setRegionId(placeholder.region.id);
      setResolutionSource(placeholder.source);
    }
  }
  const awaitingNewIdentity = accountPreferencePending && accountIdentity !== heldIdentity && !heldMatchesAccount;
  const placeholder = awaitingNewIdentity ? resolvePresentation({ detectedCountry, offer }) : null;
  const candidateRegionId = placeholder ? placeholder.region.id : storedRegionId;
  const withdrawn = candidateRegionId !== "GLOBAL" && !offer.offered.includes(candidateRegionId);
  const regionId: RegionId = withdrawn ? "GLOBAL" : candidateRegionId;
  const resolutionSource: ResolutionSource = withdrawn ? "fallback" : placeholder ? placeholder.source : storedResolutionSource;

  const writeExplicitAccountPreference = useCallback((country: CountryCode, version: number) => {
    setPreferenceMessage("");
    const identity = currentIdentity.current;
    const epoch = generation.current;
    const isCurrent = () => mounted.current && identity === currentIdentity.current &&
      version === selectionVersion.current && epoch === generation.current;
    const previousWrite = pendingWrites.current.get(identity);
    const write = (async () => {
      try {
        if (previousWrite) await previousWrite;
        if (!isCurrent()) return;
        if (!writeAccountPreference) throw new Error("Account unavailable");
        const stored = await writeAccountPreference(country, false);
        if (!isCurrent()) return;
        setRegionId(presentedRegionId(stored, offer));
        setPreferenceMessage("Country preference saved to your account.");
      } catch {
        if (isCurrent()) {
          setPreferenceMessage("Country updated for this visit only. Could not save to your account.");
        }
        return null;
      }
    })();
    pendingWrites.current.set(identity, write);
    void write.finally(() => {
      if (pendingWrites.current.get(identity) === write) pendingWrites.current.delete(identity);
    });
  }, [offer, writeAccountPreference]);

  const writeBrowserPreference = useCallback((country: CountryCode) => {
    setBrowserPreference(country);
    const didPersist = writeAnonymousCountryPreference(() => window.localStorage, country);
    setPreferenceMessage(
      didPersist
        ? "Country preference saved on this device."
        : "Country updated for this visit. Browser storage is unavailable.",
    );
  }, []);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useLayoutEffect(() => {
    const held = pendingSettlingSelection.current;
    if (!held || accountOwner === null) return;
    if (held.owner === null) {
      held.owner = accountOwner;
      setHeldSelection({ identity: held.identity, owner: accountOwner });
    } else if (held.owner !== accountOwner) {
      pendingSettlingSelection.current = null;
      generation.current += 1;
      selectionVersion.current = 0;
      setHeldSelection(null);
      const resolved = resolvePresentation({ detectedCountry, offer });
      setRegionId(resolved.region.id);
      setResolutionSource(resolved.source);
    }
  }, [accountOwner, detectedCountry, offer]);

  useLayoutEffect(() => {
    if (currentIdentity.current === accountIdentity) return;
    currentIdentity.current = accountIdentity;
    generation.current += 1;
    const held = pendingSettlingSelection.current;
    if (held && held.identity !== null && held.identity !== accountIdentity) {
      pendingSettlingSelection.current = null;
      setHeldSelection(null);
    }
    if (!pendingSettlingSelection.current) selectionVersion.current = 0;
    if (accountIdentity && accountIdentity !== adoptionIdentity.current) {
      adoptionIdentity.current = accountIdentity;
      adoptionAttempted.current = false;
    }
  }, [accountIdentity]);

  useLayoutEffect(() => {
    if (previousSignedIn.current !== signedIn) {
      generation.current += 1;
      if (!pendingSettlingSelection.current) selectionVersion.current = 0;
      previousSignedIn.current = signedIn;
    }
  }, [signedIn]);

  useLayoutEffect(() => {
    if (savedAccountPreference && selectionVersion.current === 0) {
      const presented = presentedRegionId(savedAccountPreference, offer);
      setRegionId(presented);
      setResolutionSource(presented === "GLOBAL" ? "fallback" : "persisted");
      setReadiness({ identity: accountIdentity, ready: true });
    }
  }, [accountIdentity, offer, savedAccountPreference]);

  useLayoutEffect(() => {
    if (savedAccountPreference || accountPreferencePending || selectionVersion.current !== 0 || pendingSettlingSelection.current) return;
    const browser = readAnonymousCountryPreference(() => window.localStorage);
    const resolved = resolvePresentation({ persistedCountry: browser.country, detectedCountry, offer });
    setRegionId(resolved.region.id);
    setResolutionSource(resolved.source);
    setBrowserPreference(browser.explicit && resolved.source === "persisted" ? normalizeCountryCode(resolved.region.id) : null);
    setReadiness({ identity: accountIdentity, ready: true });
  }, [accountIdentity, accountPreferencePending, detectedCountry, offer, savedAccountPreference]);

  useEffect(() => {
    const held = pendingSettlingSelection.current;
    if (!held) return;
    if ((held.owner !== null && accountOwner !== null && held.owner !== accountOwner) ||
        (held.identity !== null && held.identity !== accountIdentity)) {
      pendingSettlingSelection.current = null;
      setHeldSelection(null);
      return;
    }
    const { country } = held;
    if (signedIn && accountReady) {
      pendingSettlingSelection.current = null;
      adoptionAttempted.current = true;
      setRegionId(country);
      setResolutionSource("explicit");
      writeExplicitAccountPreference(country, selectionVersion.current);
      setReadiness({ identity: accountIdentity, ready: true });
      setHeldSelection(null);
    } else if (!signedIn && !accountSettling) {
      pendingSettlingSelection.current = null;
      setHeldSelection(null);
      writeBrowserPreference(country);
    }
  }, [accountIdentity, accountOwner, signedIn, accountReady, accountSettling, writeExplicitAccountPreference, writeBrowserPreference]);

  useEffect(() => {
    if (pendingSettlingSelection.current || !signedIn || !accountReady || savedAccountPreference || !browserPreference ||
        !writeAccountPreference || selectionVersion.current !== 0 || adoptionAttempted.current) return;
    adoptionAttempted.current = true;
    const version = selectionVersion.current;
    const identity = currentIdentity.current;
    const epoch = generation.current;
    const isCurrent = () => mounted.current && identity === currentIdentity.current &&
      version === selectionVersion.current && epoch === generation.current;
    const previousWrite = pendingWrites.current.get(identity);
    const write = (async () => {
      try {
        if (previousWrite) await previousWrite;
        if (!isCurrent()) return;
        const stored = await writeAccountPreference(browserPreference, true);
        if (isCurrent() && stored !== browserPreference) {
          setRegionId(presentedRegionId(stored, offer));
        }
      } catch {
        if (isCurrent()) adoptionAttempted.current = false;
        return null;
      }
    })();
    pendingWrites.current.set(identity, write);
    void write.finally(() => {
      if (pendingWrites.current.get(identity) === write) pendingWrites.current.delete(identity);
    });
  }, [accountIdentity, accountReady, browserPreference, offer, savedAccountPreference, signedIn, writeAccountPreference]);

  function selectRegion(nextRegionId: RegionId) {
    const country = normalizeCountryCode(nextRegionId);
    if (!country || !offer.offered.includes(country)) return;
    const version = ++selectionVersion.current;
    setRegionId(country);
    setResolutionSource("explicit");
    setReadiness({ identity: accountIdentity, ready: true });
    if ((signedIn && !accountReady) || (!signedIn && accountSettling)) {
      setHeldSelection({ identity: accountIdentity, owner: accountOwner });
      pendingSettlingSelection.current = { country, identity: accountIdentity, owner: accountOwner };
      setPreferenceMessage("");
      return;
    }
    pendingSettlingSelection.current = null;
    setHeldSelection(null);
    if (signedIn) {
      writeExplicitAccountPreference(country, version);
      return;
    }
    writeBrowserPreference(country);
  }

  const enqueuePreferenceWrite = useCallback((identity: string | null, task: () => Promise<unknown>) => {
    const previous = pendingWrites.current.get(identity);
    const promise = (async () => {
      if (previous) await previous;
      return task();
    })();
    pendingWrites.current.set(identity, promise);
    void promise.finally(() => {
      if (pendingWrites.current.get(identity) === promise) pendingWrites.current.delete(identity);
    });
  }, []);
  const { isDisplayCurrencyReady, ...currency } = useHomeDisplayCurrency({ regionId, accountDisplayCurrency, accountIdentity, accountOwner,
    accountPreferencePending, signedIn, accountReady, accountSettling, writeAccountDisplayCurrency, enqueuePreferenceWrite });

  return {
    ...currency,
    regionId,
    resolutionSource,
    isPreferenceReady: isPreferenceReady && isDisplayCurrencyReady,
    preferenceMessage,
    selectRegion,
    offeredCountries: offer.offered,
  };
}

export type HomeRegionState = ReturnType<typeof useHomeRegion>;
