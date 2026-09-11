"use client";

import { useEffect, useRef, useState } from "react";
import type { RegionId } from "@/config/regions";
import { useAccountWallet, type AccountWalletClient } from "@/client/account/cdp-client";
import { useMoneyDataRefresh } from "@/client/money-actions/refresh";
import { AddMoneyDialog, type AddMoneyStep } from "./add-money-dialog";
import {
  FundingRequestError,
  parseIdrxMintResult,
  recoverIdrxAttempt,
  requestHostedOnrampSession,
  requestIdrxMint,
} from "@/shared/funding/funding-client";
import type {
  IdrxFundingRail,
  IdrxMintResult,
  IdrxVaChannel,
} from "@/shared/funding/types";

export type FundingExperienceProps = {
  returnedFromCoinbase?: boolean;
  returnedFromIdrx?: boolean;
  open?: boolean;
  onClose?: () => void;
  initialStep?: AddMoneyStep;
  regionId?: RegionId;
};

type FundingWallet = Pick<
  AccountWalletClient,
  "ownerKey" | "status" | "session" | "fetchAccountResource"
>;

export function FundingExperience(props: FundingExperienceProps) {
  const wallet = useAccountWallet();
  return (
    <FundingExperienceForWallet
      {...props}
      wallet={wallet}
      navigateToHostedOnramp={(url) => window.location.assign(url)}
    />
  );
}

type FundingExperienceForWalletProps = FundingExperienceProps & {
  wallet: FundingWallet;
  navigateToHostedOnramp: (url: string) => void;
};

export function FundingExperienceForWallet(props: FundingExperienceForWalletProps) {
  return (
    <FundingExperienceBoundary
      key={fundingBoundary(props.wallet) ?? "signed-out"}
      {...props}
    />
  );
}

function FundingExperienceBoundary({
  wallet,
  navigateToHostedOnramp,
  returnedFromCoinbase = false,
  returnedFromIdrx = false,
  open = true,
  onClose,
  initialStep,
  regionId = "GLOBAL",
}: FundingExperienceForWalletProps) {
  const refreshMoneyData = useMoneyDataRefresh();
  const boundary = fundingBoundary(wallet);
  const session = wallet.status === "verified" ? wallet.session : null;
  const address = session?.smartAccount?.address ?? null;
  const signedOut = !boundary || !session?.smartAccount || !address;
  const startStep: AddMoneyStep = initialStep ?? (
    returnedFromIdrx && !signedOut
      ? "idrx"
      : returnedFromCoinbase && !signedOut
        ? "receive"
        : "method"
  );
  const [step, setStep] = useState<AddMoneyStep>(startStep);
  const [openingOnramp, setOpeningOnramp] = useState(false);
  const [onrampError, setOnrampError] = useState<string | null>(null);
  const savedIdrx = readSavedIdrxAttempt(boundary);
  const [idrxResult, setIdrxResult] = useState<IdrxMintResult | null>(savedIdrx.result);
  const [idrxReturned, setIdrxReturned] = useState(
    returnedFromIdrx || savedIdrx.pending,
  );
  const idrxAttemptIdRef = useRef(savedIdrx.attemptId);
  const [reconcileRequested, setReconcileRequested] = useState(false);
  const recoveryStartedRef = useRef(false);
  const requestEpochRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
    return () => {
      openRef.current = false;
      requestEpochRef.current += 1;
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
    };
  }, [open]);

  function cancelPendingOnramp() {
    openRef.current = false;
    requestEpochRef.current += 1;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    setOpeningOnramp(false);
  }

  async function runRequest(
    provider: "coinbase" | "idrx",
    request: (signal: AbortSignal) => Promise<void>,
  ) {
    if (!boundary || openingOnramp || !openRef.current) return;
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    const requestEpoch = requestEpochRef.current + 1;
    requestEpochRef.current = requestEpoch;
    requestAbortRef.current = controller;
    setOpeningOnramp(true);
    setOnrampError(null);
    try {
      await request(controller.signal);
    } catch (caught) {
      if (!isCurrentRequest(controller, requestEpoch, requestEpochRef, openRef)) return;
      setOnrampError(messageForOnrampError(caught, provider));
    } finally {
      if (requestEpochRef.current === requestEpoch) {
        requestAbortRef.current = null;
        setOpeningOnramp(false);
      }
    }
  }

  useEffect(() => {
    if (step !== "idrx" || signedOut || regionId !== "ID" || recoveryStartedRef.current) return;
    recoveryStartedRef.current = true;
    recoverExistingIdrx();
  // Recovery is deliberately one non-dispatching read when the IDRX step mounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openCoinbase() {
    if (!session?.smartAccount) return;
    void runRequest("coinbase", async (signal) => {
      const hosted = await requestHostedOnrampSession({
        fetchAccountResource: wallet.fetchAccountResource,
        signal,
      });
      if (!signal.aborted && openRef.current) navigateToHostedOnramp(hosted.url);
    });
  }

  function createIdrx(options: {
    toBeMinted: string;
    rail: IdrxFundingRail;
    channelId?: IdrxVaChannel;
    consent: true;
  }) {
    if (!session?.smartAccount || regionId !== "ID") return;
    void runRequest("idrx", async (signal) => {
      const attemptId = idrxAttemptIdRef.current;
      saveIdrxAttempt(boundary, { attemptId, pending: true, result: null });
      try {
        const result = await requestIdrxMint({
          fetchAccountResource: wallet.fetchAccountResource,
          attemptId,
          ...options,
          signal,
        });
        if (!signal.aborted && openRef.current) {
          saveIdrxAttempt(boundary, { attemptId, pending: true, result });
          setIdrxResult(result);
          setIdrxReturned(false);
          setReconcileRequested(false);
        }
      } catch (error) {
        if (error instanceof FundingRequestError && error.code === "pending") {
          setIdrxReturned(true);
        }
        throw error;
      }
    });
  }

  function recoverExistingIdrx() {
    if (!session?.smartAccount || regionId !== "ID") return;
    void runRequest("idrx", async (signal) => {
      const recovered = await recoverIdrxAttempt({
        fetchAccountResource: wallet.fetchAccountResource,
        signal,
      });
      if (signal.aborted || !openRef.current) return;
      if (recovered.status === "completed") {
        saveIdrxAttempt(boundary, {
          attemptId: idrxAttemptIdRef.current,
          pending: true,
          result: recovered.result,
        });
        setIdrxResult(recovered.result);
        setIdrxReturned(false);
        return;
      }
      if (recovered.status === "pending") {
        idrxAttemptIdRef.current = recovered.attemptId;
        saveIdrxAttempt(boundary, {
          attemptId: recovered.attemptId,
          pending: true,
          result: null,
        });
        setIdrxResult(null);
        setIdrxReturned(true);
        return;
      }
      clearSavedIdrxAttempt(boundary);
      idrxAttemptIdRef.current = crypto.randomUUID();
      setIdrxResult(null);
      setIdrxReturned(false);
    });
  }

  function checkIdrxFunding() {
    refreshMoneyData();
    setReconcileRequested(true);
    recoverExistingIdrx();
  }

  function resetIdrx() {
    const saved = readSavedIdrxAttempt(boundary);
    setIdrxResult(saved.result);
    setIdrxReturned(saved.pending);
    setReconcileRequested(false);
    setOnrampError(null);
  }

  function close() {
    cancelPendingOnramp();
    setStep("method");
    resetIdrx();
    onClose?.();
  }

  function goBack() {
    cancelPendingOnramp();
    openRef.current = true;
    resetIdrx();
    setStep("method");
  }

  return (
    <AddMoneyDialog
      open={open}
      step={signedOut ? "method" : step}
      address={address}
      openingOnramp={openingOnramp}
      onrampError={onrampError}
      signedOut={signedOut}
      regionId={regionId}
      idrxResult={idrxResult}
      idrxReturned={idrxReturned}
      reconcileRequested={reconcileRequested}
      onClose={close}
      onBack={goBack}
      onSelectReceive={() => setStep("receive")}
      onSelectBuy={() => {
        openRef.current = true;
        setOnrampError(null);
        setStep("buy");
      }}
      onSelectIdrx={() => {
        openRef.current = true;
        resetIdrx();
        setStep("idrx");
        recoverExistingIdrx();
      }}
      onSelectRipio={() => {
        openRef.current = true;
        setOnrampError(null);
        setStep("ripio");
      }}
      onSelectAnotherOnramp={() => {
        openRef.current = true;
        setOnrampError(null);
        setStep("onramps");
      }}
      onContinueToCoinbase={openCoinbase}
      onCreateIdrx={createIdrx}
      onOpenIdrxCheckout={navigateToHostedOnramp}
      onCheckIdrxFunding={checkIdrxFunding}
    />
  );
}

function isCurrentRequest(
  controller: AbortController,
  epoch: number,
  epochRef: { current: number },
  openRef: { current: boolean },
): boolean {
  return !controller.signal.aborted && epochRef.current === epoch && openRef.current;
}

type SavedIdrxAttempt = {
  attemptId: string;
  pending: boolean;
  result: IdrxMintResult | null;
};

function readSavedIdrxAttempt(boundary: string | null): SavedIdrxAttempt {
  const fresh = { attemptId: crypto.randomUUID(), pending: false, result: null };
  if (!boundary || typeof window === "undefined") return fresh;
  try {
    const raw = window.sessionStorage.getItem(idrxStorageKey(boundary));
    if (!raw) return fresh;
    const parsed = JSON.parse(raw) as Partial<SavedIdrxAttempt>;
    if (
      typeof parsed.attemptId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(parsed.attemptId) ||
      typeof parsed.pending !== "boolean"
    ) return fresh;
    let result: IdrxMintResult | null = null;
    if (parsed.result) result = parseIdrxMintResult(parsed.result);
    return { attemptId: parsed.attemptId, pending: parsed.pending, result };
  } catch {
    return fresh;
  }
}

function saveIdrxAttempt(boundary: string | null, value: SavedIdrxAttempt): void {
  if (!boundary || typeof window === "undefined") return;
  window.sessionStorage.setItem(idrxStorageKey(boundary), JSON.stringify(value));
}

function clearSavedIdrxAttempt(boundary: string | null): void {
  if (!boundary || typeof window === "undefined") return;
  window.sessionStorage.removeItem(idrxStorageKey(boundary));
}

function idrxStorageKey(boundary: string): string {
  return `home.idrx-attempt.v1:${boundary}`;
}

function fundingBoundary(wallet: FundingWallet): string | null {
  const session = wallet.status === "verified" ? wallet.session : null;
  return wallet.ownerKey && session?.smartAccount
    ? `${wallet.ownerKey}\u0000${session.user.subject}\u0000${session.smartAccount.address}\u0000${session.accountProvider}`
    : null;
}

function messageForOnrampError(
  error: unknown,
  provider: "coinbase" | "idrx",
): string {
  if (error instanceof FundingRequestError) {
    if (error.code === "unauthenticated") {
      return provider === "coinbase"
        ? "Your verified session changed before Coinbase opened. Sign in again; no hosted session was used."
        : "Your verified session changed before funding opened. Sign in again; no provider request was used.";
    }
    if (error.code === "not-configured") {
      return provider === "coinbase"
        ? "Coinbase Onramp is unavailable because this deployment does not have its existing CDP server credentials configured."
        : "This funding method is not configured or is not linked to this verified IDRX customer.";
    }
    if (provider === "idrx" && error.code === "pending") {
      return "This attempt may already exist at IDRX. Check balance and activity; Home will not create another order.";
    }
  }
  return provider === "coinbase"
    ? "Coinbase hosted funding is unavailable. The existing CDP project may need Onramp access or this Home return origin allowlisted."
    : "Funding is temporarily unavailable. No payment or funding was confirmed.";
}
