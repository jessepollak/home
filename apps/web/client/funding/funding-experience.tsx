"use client";

import { useEffect, useRef, useState } from "react";
import type { RegionId } from "@/config/regions";
import { useAccountWallet, type AccountWalletClient } from "@/client/account/cdp-client";
import { useMoneyDataRefresh } from "@/client/money-actions/refresh";
import { AddMoneyDialog, type AddMoneyStep } from "./add-money-dialog";
import {
  FundingRequestError,
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
  const [idrxResult, setIdrxResult] = useState<IdrxMintResult | null>(null);
  const [idrxReturned, setIdrxReturned] = useState(returnedFromIdrx);
  const [reconcileRequested, setReconcileRequested] = useState(false);
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

  async function runRequest(request: (signal: AbortSignal) => Promise<void>) {
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
      setOnrampError(messageForOnrampError(caught));
    } finally {
      if (requestEpochRef.current === requestEpoch) {
        requestAbortRef.current = null;
        setOpeningOnramp(false);
      }
    }
  }

  function openCoinbase() {
    if (!session?.smartAccount) return;
    void runRequest(async (signal) => {
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
    void runRequest(async (signal) => {
      const result = await requestIdrxMint({
        fetchAccountResource: wallet.fetchAccountResource,
        ...options,
        signal,
      });
      if (!signal.aborted && openRef.current) {
        setIdrxResult(result);
        setIdrxReturned(false);
        setReconcileRequested(false);
      }
    });
  }

  function checkIdrxFunding() {
    refreshMoneyData();
    setReconcileRequested(true);
  }

  function resetIdrx() {
    setIdrxResult(null);
    setIdrxReturned(false);
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

function fundingBoundary(wallet: FundingWallet): string | null {
  const session = wallet.status === "verified" ? wallet.session : null;
  return wallet.ownerKey && session?.smartAccount
    ? `${wallet.ownerKey}\u0000${session.user.subject}\u0000${session.smartAccount.address}\u0000${session.accountProvider}`
    : null;
}

function messageForOnrampError(error: unknown): string {
  if (error instanceof FundingRequestError) {
    if (error.code === "unauthenticated") {
      return "Your verified session changed before funding opened. Sign in again; no provider request was used.";
    }
    if (error.code === "not-configured") {
      return "This funding method is not configured on this deployment.";
    }
  }
  return "Funding is temporarily unavailable. No payment or funding was confirmed.";
}
