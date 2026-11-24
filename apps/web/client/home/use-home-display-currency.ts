"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { readAnonymousDisplayCurrencyPreference, writeAnonymousDisplayCurrencyPreference } from "@/config/country-preference";
import type { RegionId } from "@/config/regions";
import { parseDisplayCurrencyChoice, type DisplayCurrencyChoice } from "@/shared/account/display-currency";
import { resolvedRegionalCurrency } from "@/client/account/regional-preferences";

type HeldChoice = { choice: DisplayCurrencyChoice; identity: string | null; owner: string | null };

export function useHomeDisplayCurrency(input: {
  regionId: RegionId;
  accountDisplayCurrency: string | null;
  accountIdentity: string | null;
  accountOwner: string | null;
  accountPreferencePending: boolean;
  signedIn: boolean;
  accountReady: boolean;
  accountSettling: boolean;
  writeAccountDisplayCurrency?: (choice: DisplayCurrencyChoice, adopt: boolean) => Promise<string | null>;
  enqueuePreferenceWrite: (identity: string | null, task: () => Promise<unknown>) => void;
}) {
  const { regionId, accountDisplayCurrency, accountIdentity, accountOwner, accountPreferencePending,
    signedIn, accountReady, accountSettling, writeAccountDisplayCurrency, enqueuePreferenceWrite } = input;
  const [choice, setChoice] = useState<string | null>(accountDisplayCurrency);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [boundary, setBoundary] = useState({ identity: accountIdentity, owner: accountOwner, signedIn });
  const previousBoundary = useRef(boundary);
  const previousPreference = useRef(accountDisplayCurrency);
  const generation = useRef(0);
  const version = useRef(0);
  const held = useRef<HeldChoice | null>(null);
  const latest = useRef<DisplayCurrencyChoice | null>(null);
  const adopted = useRef(false);
  const retryAdoption = useRef(false);
  const mounted = useRef(true);
  const current = useRef({ accountIdentity, accountOwner });
  useLayoutEffect(() => {
    current.current = { accountIdentity, accountOwner };
    const previous = previousBoundary.current;
    if (previous.identity === accountIdentity && previous.owner === accountOwner && previous.signedIn === signedIn) return;
    previousBoundary.current = { identity: accountIdentity, owner: accountOwner, signedIn };
    setBoundary(previousBoundary.current);
    generation.current += 1;
    const pending = held.current;
    const preserve = pending && (pending.identity === null || pending.identity === accountIdentity) &&
      (pending.owner === null || pending.owner === accountOwner);
    if (!preserve) {
      held.current = null;
      latest.current = null;
      version.current = 0;
      setChoice(accountDisplayCurrency);
    }
    adopted.current = false;
    setMessage("");
    setFailed(false);
  }, [accountDisplayCurrency, accountIdentity, accountOwner, signedIn]);
  const [observedPreference, setObservedPreference] = useState(accountDisplayCurrency);
  useLayoutEffect(() => {
    if (previousPreference.current === accountDisplayCurrency) return;
    previousPreference.current = accountDisplayCurrency;
    setObservedPreference(accountDisplayCurrency);
    if (version.current === 0 && held.current === null) setChoice(accountDisplayCurrency);
  }, [accountDisplayCurrency]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const write = useCallback((next: DisplayCurrencyChoice, adopt = false) => {
    const epoch = generation.current;
    const intent = version.current;
    const identity = accountIdentity;
    const owner = accountOwner;
    const isCurrent = () => mounted.current && epoch === generation.current && intent === version.current &&
      identity === current.current.accountIdentity && owner === current.current.accountOwner;
    retryAdoption.current = adopt;
    setFailed(false);
    setMessage("");
    enqueuePreferenceWrite(identity, async () => {
      try {
        if (!isCurrent()) return;
        if (!writeAccountDisplayCurrency) throw new Error("Account unavailable");
        const stored = await writeAccountDisplayCurrency(next, adopt);
        if (!isCurrent()) return;
        setChoice(stored);
        setMessage("Display currency saved to your account.");
      } catch {
        if (isCurrent()) {
          setFailed(true);
          latest.current = next;
          setMessage("Display currency changed for this visit only. Could not save to your account.");
        }
        return null;
      }
    });
  }, [accountIdentity, accountOwner, enqueuePreferenceWrite, writeAccountDisplayCurrency]);

  const writeBrowser = useCallback((next: DisplayCurrencyChoice) => {
    const saved = writeAnonymousDisplayCurrencyPreference(() => window.localStorage, next);
    setFailed(!saved);
    setMessage(saved ? "Display currency saved on this device."
      : "Display currency changed for this visit. Browser storage is unavailable.");
  }, []);

  useLayoutEffect(() => {
    const pending = held.current;
    if (pending) {
      if (pending.owner === null && accountOwner !== null) pending.owner = accountOwner;
      if (pending.identity === null && accountIdentity !== null) pending.identity = accountIdentity;
      if ((pending.owner !== null && pending.owner !== accountOwner) ||
          (pending.identity !== null && pending.identity !== accountIdentity)) return;
      if (signedIn && accountReady && !accountPreferencePending) {
        held.current = null;
        adopted.current = true;
        write(pending.choice);
      } else if (!signedIn && !accountSettling) {
        held.current = null;
        writeBrowser(pending.choice);
      }
      return;
    }
    if (version.current !== 0 || accountPreferencePending || (accountSettling && accountIdentity === null)) return;
    if (signedIn || accountIdentity !== null) {
      setChoice(accountDisplayCurrency);
      if (accountReady && accountDisplayCurrency === null && !adopted.current) {
        const browser = readAnonymousDisplayCurrencyPreference(() => window.localStorage);
        if (browser) {
          adopted.current = true;
          version.current += 1;
          latest.current = browser;
          setChoice(browser);
          write(browser, true);
        }
      }
    } else {
      setChoice(readAnonymousDisplayCurrencyPreference(() => window.localStorage));
    }
  }, [accountDisplayCurrency, accountIdentity, accountOwner, accountPreferencePending, accountReady, accountSettling, signedIn, write, writeBrowser]);

  function selectDisplayCurrency(next: DisplayCurrencyChoice) {
    if (!parseDisplayCurrencyChoice(next)) return;
    version.current += 1;
    latest.current = next;
    setChoice(next);
    setMessage("");
    setFailed(false);
    if ((signedIn && !accountReady) || accountPreferencePending || accountSettling) {
      held.current = { choice: next, identity: accountIdentity, owner: accountOwner };
    } else if (signedIn) write(next);
    else writeBrowser(next);
  }

  function retryDisplayCurrencyWrite() {
    if (!failed || latest.current === null || held.current) return;
    if (signedIn && accountReady && !accountPreferencePending) write(latest.current, retryAdoption.current);
    else if (!signedIn && !accountSettling) writeBrowser(latest.current);
  }

  return {
    isDisplayCurrencyReady: boundary.identity === accountIdentity && boundary.owner === accountOwner &&
      observedPreference === accountDisplayCurrency && !accountPreferencePending,
    displayCurrency: resolvedRegionalCurrency({ country: regionId, displayCurrency: choice }),
    selectDisplayCurrency,
    displayCurrencyMessage: message,
    displayCurrencyWriteFailed: failed,
    retryDisplayCurrencyWrite,
  };
}
