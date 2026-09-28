"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { networkFeeErrorMessage } from "@/shared/money-actions/network-fee";
import { isCashoutPrepareErrorCode } from "@/shared/actions/contracts/prepare";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { TransferExecutionError } from "@/shared/transfers/types";
import type { RegionId } from "@/config/regions";
import { announceActionFailure } from "@/client/home/action-toast-events";

type Step = "details" | "confirm" | "pending" | "result";
type Submission = "submitted" | "ambiguous" | "failed";

export function useCashOutWithdrawJourney({ wallet, ownerKey, onDispatched }: {
  wallet: AccountWalletClient | null;
  ownerKey: string | null;
  onDispatched: () => void;
}) {
  const [step, setStep] = useState<Step>("details");
  const [preparedAction, setPreparedAction] = useState<PreparedMoneyAction | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [submittedAt, setSubmittedAt] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const attempt = useRef(0);
  const inFlight = useRef(false);
  const identity = useRef(ownerKey);
  useLayoutEffect(() => () => { attempt.current += 1; inFlight.current = false; }, []);
  useLayoutEffect(() => {
    if (identity.current === ownerKey) return;
    identity.current = ownerKey;
    reset();
  }, [ownerKey]);

  function reset() {
    attempt.current += 1;
    inFlight.current = false;
    setStep("details");
    setPreparedAction(null);
    setSubmission(null);
    setSubmittedAt(undefined);
    setError(null);
    setPreparing(false);
  }

  async function prepare(providerId: string, region: string, depositId: string) {
    if (!wallet || !ownerKey || inFlight.current || step !== "details") return;
    inFlight.current = true;
    const token = ++attempt.current;
    setPreparing(true);
    setError(null);
    try {
      const prepared = await wallet.prepareMoneyAction("cash-out-withdraw", {
        providerId,
        region: region as RegionId,
        depositId,
      });
      if (token !== attempt.current || ownerKey !== identity.current) return;
      if (prepared.kind !== "cash-out-withdraw" || prepared.metadata?.product !== "cashout" || prepared.metadata.operation !== "withdraw") {
        throw new Error("Cash-out withdrawal review is unavailable. Try again.");
      }
      if (!prepared.amounts.some((entry) => entry.direction === "receive")) {
        throw new Error("Cash-out withdrawal review is unavailable. Try again.");
      }
      setPreparedAction(prepared);
      setStep("confirm");
    } catch (caught) {
      if (token !== attempt.current || ownerKey !== identity.current) return { ok: false as const, message: null };
      const failure = caught as { code?: unknown; serverMessage?: unknown };
      const message = networkFeeErrorMessage(caught) ?? (isCashoutPrepareErrorCode(failure.code) && typeof failure.serverMessage === "string"
        ? failure.serverMessage
        : caught instanceof Error && caught.message === "Cash-out withdrawal review is unavailable. Try again."
          ? caught.message
          : "Could not prepare the withdrawal. Try again.");
      setError(message);
      announceActionFailure("cash-out-withdraw", message);
      return { ok: false as const, message };
    } finally {
      if (token === attempt.current && ownerKey === identity.current) {
        inFlight.current = false;
        setPreparing(false);
      }
    }
  }

  function abandon(message: string) {
    setPreparedAction(null);
    setSubmission(null);
    setSubmittedAt(undefined);
    setStep("details");
    setError(message);
  }

  async function confirm() {
    if (!wallet || !ownerKey || !preparedAction || inFlight.current || step !== "confirm") return;
    if (!Number.isFinite(Date.parse(preparedAction.expiresAt)) || Date.parse(preparedAction.expiresAt) <= Date.now()) {
      abandon("This review is no longer available — start again.");
      return;
    }
    inFlight.current = true;
    const token = ++attempt.current;
    setError(null);
    setStep("pending");
    try {
      const result = await wallet.executeMoneyAction(preparedAction);
      if (token !== attempt.current || ownerKey !== identity.current) return;
      if (result.status === "rejected") {
        setError("The wallet request was rejected. Your reviewed cash-out is still ready to retry.");
        setStep("confirm");
        return;
      }
      if (result.status === "failed") {
        setSubmission("failed");
      } else {
        onDispatched();
        setSubmittedAt(new Date().toISOString());
        setSubmission("submitted");
      }
      setStep("result");
    } catch (caught) {
      if (token !== attempt.current || ownerKey !== identity.current) return { ok: false as const };
      if (caught instanceof TransferExecutionError && (caught.reason === "submission-unknown" || caught.reason === "dispatch-unknown")) {
        onDispatched();
        setSubmission("ambiguous");
        setStep("result");
        return { ok: false as const };
      }
      if (caught instanceof TransferExecutionError && caught.reason === "unavailable" && ((caught as TransferExecutionError & { status?: unknown }).status === 404 || (caught as TransferExecutionError & { status?: unknown }).status === 410)) {
        abandon("This review is no longer available — start again.");
        return { ok: false as const };
      }
      if (caught instanceof TransferExecutionError && caught.reason === "stale-session") {
        abandon("Your account changed before submission. Sign in and try again.");
        return { ok: false as const };
      }
      if ((caught as { code?: unknown })?.code === "ACTION_EXPIRED") {
        abandon("This review is no longer available — start again.");
        return { ok: false as const };
      }
      setError("The wallet result is unknown. Check Activity before trying again.");
      setStep("confirm");
      return { ok: false as const };
    } finally {
      if (token === attempt.current && ownerKey === identity.current) inFlight.current = false;
    }
  }

  function retry() { reset(); }
  function back() {
    if (step === "confirm") reset();
  }

  return { step, preparedAction, submission, submittedAt, error, preparing, prepare, confirm, retry, back, reset };
}

export type CashOutWithdrawJourney = ReturnType<typeof useCashOutWithdrawJourney>;
