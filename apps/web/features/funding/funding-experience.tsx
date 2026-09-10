"use client";

import { useEffect, useRef, useState } from "react";
import type { RegionId } from "@/config/regions";
import { useAccountWallet, type AccountWalletClient } from "@/features/account/cdp-client";
import {
  AddMoneyDialog,
  type AddMoneyStep,
} from "./add-money-dialog";
import {
  FundingRequestError,
  requestHostedOnrampSession,
} from "./funding-client";
import type { OnrampPaymentMethod } from "./types";

export type FundingExperienceProps = {
  returnedFromCoinbase?: boolean;
  open?: boolean;
  onClose?: () => void;
  initialStep?: AddMoneyStep;
  regionId?: RegionId;
};

type FundingWallet = Pick<
  AccountWalletClient,
  "ownerKey" | "status" | "session" | "fetchAccountResource"
>;

type PaymentSummary = {
  paymentAmount: string;
  paymentMethod: OnrampPaymentMethod;
};

type InlineOnramp = {
  attemptId: number;
  url: string;
};

type PostCheckoutPayment = PaymentSummary;

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

export function FundingExperienceForWallet(
  props: FundingExperienceForWalletProps,
) {
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
  open = true,
  onClose,
  initialStep,
  regionId = "GLOBAL",
}: FundingExperienceForWalletProps) {
  const boundary = fundingBoundary(wallet);
  const session = wallet.status === "verified" ? wallet.session : null;
  const address = session?.smartAccount?.address ?? null;
  const signedOut = !boundary || !session?.smartAccount || !address;
  const startStep: AddMoneyStep =
    initialStep ?? (returnedFromCoinbase && !signedOut ? "receive" : "method");
  const [step, setStep] = useState<AddMoneyStep>(startStep);
  const [openingOnramp, setOpeningOnramp] = useState(false);
  const [onrampError, setOnrampError] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("20");
  const [paymentMethod, setPaymentMethod] =
    useState<OnrampPaymentMethod>("apple-pay");
  const [activePayment, setActivePayment] = useState<PaymentSummary | null>(null);
  const [inlineOnramp, setInlineOnramp] = useState<InlineOnramp | null>(null);
  const [postCheckoutPayment, setPostCheckoutPayment] =
    useState<PostCheckoutPayment | null>(null);
  const requestEpochRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const activeInlineAttemptRef = useRef<number | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const openRef = useRef(open);
  const [renderedOpen, setRenderedOpen] = useState(open);

  if (renderedOpen !== open) {
    setRenderedOpen(open);
    if (!open) {
      setStep(startStep);
      setOpeningOnramp(false);
      setOnrampError(null);
      setPaymentAmount("20");
      setPaymentMethod("apple-pay");
      setActivePayment(null);
      setInlineOnramp(null);
      setPostCheckoutPayment(null);
    }
  }

  useEffect(() => {
    openRef.current = open;
    if (!open) {
      requestEpochRef.current += 1;
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
      activeInlineAttemptRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    return () => {
      openRef.current = false;
      requestEpochRef.current += 1;
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
      activeInlineAttemptRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!open || !inlineOnramp) return;
    const currentOnramp = inlineOnramp;
    const attemptId = currentOnramp.attemptId;

    function onMessage(event: MessageEvent) {
      if (
        event.origin !== "https://pay.coinbase.com" ||
        event.source !== iframeRef.current?.contentWindow ||
        activeInlineAttemptRef.current !== attemptId
      ) {
        return;
      }
      const eventName = readOnrampEventName(event.data);
      if (eventName === "onramp_api.polling_success") {
        const completedPayment = activePayment
          ? { ...activePayment }
          : null;
        cancelOnramp();
        setOnrampError(null);
        if (completedPayment) {
          setPostCheckoutPayment(completedPayment);
          setStep("pending");
        }
      } else if (eventName === "onramp_api.cancel") {
        cancelOnramp();
      } else if (
        eventName === "onramp_api.commit_error" ||
        eventName === "onramp_api.polling_error" ||
        eventName === "onramp_api.load_error" ||
        // Retain the earlier polling_failed spelling for existing checkout sessions.
        eventName === "onramp_api.polling_failed" ||
        eventName === "onramp_api.session_error"
      ) {
        setOnrampError(
          "Coinbase could not complete this payment. No deposit is being confirmed.",
        );
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [activePayment, inlineOnramp, open]);

  function cancelOnramp() {
    requestEpochRef.current += 1;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    activeInlineAttemptRef.current = null;
    setInlineOnramp(null);
    setActivePayment(null);
    setOpeningOnramp(false);
  }

  async function openCoinbase() {
    if (!session?.smartAccount || !boundary || openingOnramp || !openRef.current) return;
    if (!isUsdPaymentAmount(paymentAmount)) {
      setOnrampError("Enter a USD amount between 1 and 9999.99.");
      return;
    }

    cancelOnramp();
    const requestedPayment = { paymentAmount, paymentMethod };
    const controller = new AbortController();
    const requestEpoch = requestEpochRef.current + 1;
    requestEpochRef.current = requestEpoch;
    requestAbortRef.current = controller;
    setActivePayment(requestedPayment);
    setOpeningOnramp(true);
    setOnrampError(null);

    try {
      const onramp = await requestHostedOnrampSession({
        fetchAccountResource: wallet.fetchAccountResource,
        paymentMethod: requestedPayment.paymentMethod,
        paymentAmount: requestedPayment.paymentAmount,
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        requestEpochRef.current !== requestEpoch ||
        !openRef.current
      ) {
        return;
      }
      setOpeningOnramp(false);
      if (onramp.presentation === "iframe") {
        activeInlineAttemptRef.current = requestEpoch;
        setInlineOnramp({ attemptId: requestEpoch, url: onramp.url });
        return;
      }
      navigateToHostedOnramp(onramp.url);
    } catch (caught) {
      if (
        controller.signal.aborted ||
        requestEpochRef.current !== requestEpoch ||
        !openRef.current
      ) {
        return;
      }
      setOnrampError(messageForOnrampError(caught));
      setActivePayment(null);
      setOpeningOnramp(false);
    } finally {
      if (requestEpochRef.current === requestEpoch) {
        requestAbortRef.current = null;
      }
    }
  }

  function close() {
    if (!openRef.current) return;
    openRef.current = false;
    cancelOnramp();
    setStep("method");
    setPostCheckoutPayment(null);
    setOnrampError(null);
    onClose?.();
  }

  function goBack() {
    cancelOnramp();
    openRef.current = true;
    setStep("method");
    setPostCheckoutPayment(null);
    setOnrampError(null);
  }

  return (
    <AddMoneyDialog
      open={open}
      step={signedOut ? "method" : step}
      address={address}
      openingOnramp={openingOnramp}
      onrampError={onrampError}
      paymentAmount={paymentAmount}
      paymentMethod={paymentMethod}
      activePayment={activePayment}
      inlineOnrampUrl={inlineOnramp?.url ?? null}
      inlineOnrampAttemptId={inlineOnramp?.attemptId ?? null}
      iframeRef={iframeRef}
      postCheckoutPayment={postCheckoutPayment}
      signedOut={signedOut}
      regionId={regionId}
      onClose={close}
      onBack={goBack}
      onSelectReceive={() => setStep("receive")}
      onSelectBuy={() => {
        openRef.current = true;
        setPostCheckoutPayment(null);
        setOnrampError(null);
        setStep("buy");
      }}
      onPaymentAmountChange={setPaymentAmount}
      onPaymentMethodChange={setPaymentMethod}
      onEditPayment={() => {
        cancelOnramp();
        setOnrampError(null);
      }}
      onCheckBalance={close}
      onContinueToCoinbase={() => void openCoinbase()}
    />
  );
}

function fundingBoundary(wallet: FundingWallet): string | null {
  const session = wallet.status === "verified" ? wallet.session : null;
  return wallet.ownerKey && session?.smartAccount
    ? `${wallet.ownerKey}\u0000${session.user.subject}\u0000${session.smartAccount.address}\u0000${session.accountProvider}`
    : null;
}

function isUsdPaymentAmount(value: string): boolean {
  return /^(?:[1-9]\d{0,3})(?:\.\d{1,2})?$/.test(value);
}

function readOnrampEventName(data: unknown): string | null {
  const value =
    typeof data === "string"
      ? (() => {
          try {
            return JSON.parse(data) as unknown;
          } catch {
            return null;
          }
        })()
      : data;
  return isRecord(value) && typeof value.eventName === "string"
    ? value.eventName
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageForOnrampError(error: unknown): string {
  if (error instanceof FundingRequestError) {
    if (error.code === "unauthenticated") {
      return "Your verified session changed before Coinbase opened. Sign in again; no Onramp session was used.";
    }
    if (error.code === "not-configured") {
      return "Coinbase Onramp is unavailable because this deployment does not have its existing CDP server credentials configured.";
    }
  }
  return "Coinbase funding is unavailable. This deployment may need Headless Onramp access or its Home origin allowlisted.";
}
