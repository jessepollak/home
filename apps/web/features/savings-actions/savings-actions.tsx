"use client";

import { useEffect, useState } from "react";
import type { AccountWalletClient } from "@/features/account/cdp-client";
import type { VerifiedAccountSession } from "@/features/account/session-types";
import {
  MoneyAmountDisplay,
  MoneyConfirmSummary,
  MoneyModal,
  MoneyModalFooter,
  MoneyModalHeader,
  MoneyNumpad,
  isPositiveDecimalAmount,
} from "@/features/money-modal";
import type {
  OperationResult,
  PreparedMoneyAction,
} from "@/features/money-actions/types";
import { formatApy, formatUsdcUsd, parseUsdcAmount } from "@/features/savings/format";
import type { MorphoVaultCandidate } from "@/server/morpho/types";
import modal from "@/features/money-modal/money-modal.module.css";
import styles from "./savings-actions.module.css";

export type SavingsActionMode = "deposit" | "withdraw";

export type SavingsMoneyDialogProps = {
  open: boolean;
  mode: SavingsActionMode;
  session: VerifiedAccountSession;
  candidate: MorphoVaultCandidate;
  availableLabel?: string;
  availableBaseUnits?: string | null;
  prepareMoneyAction: AccountWalletClient["prepareMoneyAction"];
  executeMoneyAction: AccountWalletClient["executeMoneyAction"];
  onClose: () => void;
  onConfirmed?: (result: OperationResult) => void | Promise<void>;
};

type DialogStep = "amount" | "confirm" | "pending" | "error" | "failed";

export function SavingsMoneyDialog({
  open,
  mode,
  session,
  candidate,
  availableLabel,
  availableBaseUnits,
  prepareMoneyAction,
  executeMoneyAction,
  onClose,
  onConfirmed,
}: SavingsMoneyDialogProps) {
  const [amount, setAmount] = useState("");
  const [amountBaseUnits, setAmountBaseUnits] = useState<string | null>(null);
  const [preparedAction, setPreparedAction] = useState<PreparedMoneyAction | null>(null);
  const [step, setStep] = useState<DialogStep>("amount");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ mode: SavingsActionMode; amount: string } | null>(null);
  const [openedAt] = useState(() => Date.now());
  const expiredPrepared = preparedAction
    ? Date.parse(preparedAction.expiresAt) <= openedAt
    : false;
  const confirmAmount = amountBaseUnits ? formatUsdcUsd(amountBaseUnits) : "";
  const title = step === "confirm" || step === "pending" || step === "error" || step === "failed"
    ? "Confirm"
    : mode === "deposit"
      ? "Deposit"
      : "Withdraw";

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(null), 6000);
    return () => window.clearTimeout(timer);
  }, [success]);

  function reset() {
    setAmount("");
    setAmountBaseUnits(null);
    setPreparedAction(null);
    setStep("amount");
    setError(null);
  }

  function closeIfAllowed() {
    if (step !== "pending") {
      reset();
      onClose();
    }
  }

  function goBack() {
    if (step === "confirm" || step === "error" || step === "failed") {
      setPreparedAction(null);
      setError(null);
      setStep("amount");
    }
  }

  async function continueFromAmount() {
    try {
      if (!session.smartAccount) {
        throw new SavingsActionClientError("Verify a Base smart account to continue.");
      }
      const nextAmount = parseUsdcAmount(amount);
      if (availableBaseUnits) {
        const available = BigInt(availableBaseUnits);
        if (BigInt(nextAmount) > available) {
          throw Object.assign(new Error("limit"), { status: 409, code: "SAVINGS_ACTION_LIMIT_EXCEEDED" });
        }
      }
      setAmountBaseUnits(nextAmount);
      setError(null);
      setStep("pending");
      const action = await prepareMoneyAction("/api/savings/actions", {
        kind: mode,
        vaultAddress: candidate.vaultAddress,
        amountBaseUnits: nextAmount,
      });
      if (
        action.kind !== (mode === "deposit" ? "save-deposit" : "save-withdraw") ||
        action.owner.subject !== session.user.subject ||
        action.owner.accountProvider !== session.accountProvider ||
        action.owner.address.toLowerCase() !== session.smartAccount.address.toLowerCase()
      ) {
        throw new SavingsActionClientError(
          "The prepared action did not match the verified account or requested savings action.",
        );
      }
      setPreparedAction(action);
      setStep("confirm");
    } catch (caught) {
      setPreparedAction(null);
      setError(messageForPrepareError(caught));
      setStep("amount");
    }
  }

  async function confirm() {
    if (!preparedAction || step === "pending") return;
    setError(null);
    setStep("pending");
    try {
      const result = await executeMoneyAction(preparedAction);
      if (result.status === "confirmed") {
        const confirmedAmount = confirmAmount;
        try {
          await onConfirmed?.(result);
        } catch {
          // A parent refresh failure must not relabel a receipt-confirmed action.
        }
        setSuccess({ mode, amount: confirmedAmount });
        reset();
        onClose();
        return;
      }
      if (result.status === "rejected" || result.status === "expired" || result.status === "failed") {
        setError(messageForActionStatus(result.status, mode));
        setStep(result.status === "failed" ? "failed" : "error");
        return;
      }
      setError("This action is still open. Checking again will not submit it again.");
      setStep("confirm");
    } catch {
      setError("The outcome is unknown. Check your wallet before starting another action.");
      setStep("error");
    }
  }

  async function checkStatus() {
    if (!preparedAction || step === "pending") return;
    setError(null);
    setStep("pending");
    try {
      const result = await executeMoneyAction(preparedAction);
      if (result.status === "confirmed") {
        try {
          await onConfirmed?.(result);
        } catch {
          // Keep the confirmed receipt even if refresh fails.
        }
        setSuccess({ mode, amount: confirmAmount });
        reset();
        onClose();
        return;
      }
      setError(messageForActionStatus(result.status, mode));
      setStep("confirm");
    } catch {
      setError("The existing submission is unresolved. Check its status; do not submit it again.");
      setStep("confirm");
    }
  }

  const checkOnly = expiredPrepared && step === "confirm";

  return (
    <>
      <MoneyModal
        open={open}
        labelledBy="savings-action-title"
        describedBy={step === "pending" ? "savings-action-pending" : undefined}
        onCancel={closeIfAllowed}
        onClose={() => {
          reset();
          onClose();
        }}
      >
        <MoneyModalHeader
          title={title}
          titleId="savings-action-title"
          onBack={step === "amount" || step === "pending" ? undefined : goBack}
          onClose={closeIfAllowed}
          closeDisabled={step === "pending"}
          closeLabel={`Close ${mode} dialog`}
        />

        <div className={modal.body}>
          {step === "amount" ? (
            <>
              <MoneyAmountDisplay
                amount={amount}
                prefix="$"
                availableLabel={availableLabel}
              />
              <MoneyNumpad value={amount} maxDecimals={6} onChange={setAmount} />
            </>
          ) : null}

          {amountBaseUnits && step !== "amount" ? (
            <>
              <MoneyConfirmSummary
                amount={confirmAmount}
                lead={mode === "deposit" ? "Deposit to Save" : "Withdraw from Save"}
                rows={[
                  { label: "Vault", value: candidate.name },
                  { label: "APY", value: formatApy(candidate.netApy) },
                  { label: "Amount", value: confirmAmount },
                ]}
              />
              {step === "pending" ? (
                <div id="savings-action-pending" className={modal.pending} role="status">
                  <span className={modal.spinner} aria-hidden="true" />
                  Waiting for your wallet…
                </div>
              ) : null}
            </>
          ) : null}

          {error ? <p className={modal.error} role="alert">{error}</p> : null}
          {expiredPrepared && step === "confirm" ? (
            <p className={modal.error} role="alert">
              This {mode} expired. Go back and continue again.
            </p>
          ) : null}
        </div>

        {step === "amount" ? (
          <MoneyModalFooter
            primaryLabel="Continue"
            primaryDisabled={!isPositiveDecimalAmount(amount)}
            onPrimary={() => void continueFromAmount()}
          />
        ) : null}

        {step === "confirm" ? (
          <MoneyModalFooter
            primaryLabel={checkOnly ? "Check status" : `${mode === "deposit" ? "Deposit" : "Withdraw"} ${confirmAmount}`}
            onPrimary={() => void (checkOnly ? checkStatus() : confirm())}
            secondaryLabel="Back"
            onSecondary={goBack}
          />
        ) : null}

        {step === "failed" ? (
          <MoneyModalFooter
            primaryLabel="Back"
            onPrimary={goBack}
            secondaryLabel="Close"
            onSecondary={closeIfAllowed}
          />
        ) : null}

        {step === "error" ? (
          <MoneyModalFooter
            primaryLabel="Back"
            onPrimary={goBack}
          />
        ) : null}
      </MoneyModal>

      {success ? (
        <div className={styles.toast} role="status">
          <span className={styles.toastMark} aria-hidden="true">✓</span>
          <div>
            <strong>
              {success.mode === "deposit" ? "Deposited" : "Withdrew"} {success.amount}
            </strong>
            <p>Save · {candidate.name}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}

function messageForActionStatus(status: string, mode: SavingsActionMode): string {
  switch (status) {
    case "rejected":
      return "The wallet request was rejected.";
    case "expired":
      return `This ${mode} expired. Go back and continue again.`;
    case "failed":
      return `The ${mode} did not succeed onchain.`;
    default:
      return "This action is still open. Checking again will not submit it again.";
  }
}

function messageForPrepareError(error: unknown): string {
  if (error instanceof SavingsActionClientError) return error.message;
  const status = isRecord(error) && typeof error.status === "number" ? error.status : null;
  const code = isRecord(error) && typeof error.code === "string" ? error.code : null;
  const serverMessage = isRecord(error) && typeof error.serverMessage === "string"
    ? error.serverMessage
    : null;
  if (code === "SAVINGS_ACTION_INVALID" || status === 400) {
    return "Enter a valid positive USDC amount for a configured vault.";
  }
  if (code === "SAVINGS_ACTION_LIMIT_EXCEEDED" || status === 409) {
    return "That amount exceeds the current onchain account balance or vault limit. No transaction was submitted.";
  }
  if (code === "SAVINGS_ACTION_UNSUPPORTED" || status === 422) {
    return "This vault no longer has a verified supported canonical-USDC action route.";
  }
  if (code === "UNAUTHENTICATED") {
    return "Your verified account changed. Sign in again to prepare this savings action.";
  }
  if (code === "AUTH_UNAVAILABLE") {
    return "Authentication is temporarily unavailable. No transaction was submitted.";
  }
  if (code === "SAVINGS_ACTION_ISSUE") {
    return "The savings review could not be stored for this account. No transaction was submitted.";
  }
  if (code && serverMessage && isSafePrepareMessage(serverMessage)) {
    return `${serverMessage} (${code}) No transaction was submitted.`;
  }
  if (code && code !== "SAVINGS_ACTION_UNAVAILABLE") {
    return `Savings action preparation failed (${code}). No transaction was submitted.`;
  }
  return "Savings action preparation is temporarily unavailable. No transaction was submitted.";
}

function isSafePrepareMessage(message: string): boolean {
  return message.length > 0 && message.length <= 240 && !/[<>]/.test(message) && !/https?:\/\//i.test(message);
}

class SavingsActionClientError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
