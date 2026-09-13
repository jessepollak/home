"use client";

import { useState } from "react";
import { StatusMessage, Text, Toast, ToastViewport } from "@home/ui";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  MoneyAmountDisplay,
  MoneyConfirmSummary,
  MoneyModal,
  MoneyModalFooter,
  MoneyModalHeader,
  MoneyNumpad,
  decimalFromBaseUnits,
  isPositiveDecimalAmount,
  useMoneyAssetPricing,
} from "@/client/money-modal";
import type {
  OperationResult,
  PreparedMoneyAction,
} from "@/shared/money-actions/types";
import { formatApy, formatUsdcUsd, parseUsdcAmount } from "@/client/savings/format";
import type { MorphoVaultCandidate } from "@/shared/savings/types";
import modal from "@/client/money-modal/money-modal.module.css";

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
  const [attemptedAction, setAttemptedAction] = useState(false);
  const [step, setStep] = useState<DialogStep>("amount");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ mode: SavingsActionMode; amount: string } | null>(null);
  const [openedAt] = useState(() => Date.now());
  const expiredPrepared = preparedAction
    ? Date.parse(preparedAction.expiresAt) <= openedAt
    : false;
  const confirmAmount = amountBaseUnits ? formatUsdcUsd(amountBaseUnits) : "";
  const pricing = useMoneyAssetPricing(candidate.asset.symbol);
  const title = step === "confirm" || step === "pending" || step === "error" || step === "failed"
    ? "Confirm"
    : mode === "deposit"
      ? "Deposit"
      : "Withdraw";

  function reset() {
    setAmount("");
    setAmountBaseUnits(null);
    setPreparedAction(null);
    setAttemptedAction(false);
    setStep("amount");
    setError(null);
  }

  function closeIfAllowed() {
    if (step === "pending") return false;
    onClose();
    return true;
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
      const action = await prepareMoneyAction(mode === "withdraw" ? "savings-withdraw" : "savings-deposit", {
        kind: mode,
        vaultAddress: candidate.vaultAddress,
        amountBaseUnits: nextAmount,
      });
      if (
        action.kind !== (mode === "deposit" ? "savings-deposit" : "savings-withdraw") ||
        action.owner.subject !== session.user.subject ||
        action.owner.accountProvider !== session.accountProvider ||
        action.owner.address.toLowerCase() !== session.smartAccount.address.toLowerCase()
      ) {
        throw new SavingsActionClientError(
          "The prepared action did not match the verified account or requested savings action.",
        );
      }
      setPreparedAction(action);
      setAttemptedAction(false);
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
      setAttemptedAction(true);
      if (result.status === "rejected" || result.status === "failed") {
        setError(messageForActionStatus(result.status, mode));
        setStep(result.status === "failed" ? "failed" : "error");
        return;
      }
      const confirmedAmount = confirmAmount;
      try {
        await onConfirmed?.(result);
      } catch {
        // A parent refresh failure must not relabel a dispatched action.
      }
      setSuccess({ mode, amount: confirmedAmount });
      reset();
      onClose();
    } catch {
      setAttemptedAction(true);
      setError("The dispatch outcome is unresolved. Retry recording this same action; a new dispatch will not be created.");
      setStep("confirm");
    }
  }

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
                onAmountChange={setAmount}
                availableLabel={availableLabel}
                availableAmount={decimalFromBaseUnits(availableBaseUnits ?? "", 6)}
                assetId="usdc"
                assetLabel="USDC"
                assetLocked
                chipSet="max"
                pricing={pricing}
                nativeSymbol="USDC"
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
                <StatusMessage id="savings-action-pending" className={modal.pending}>
                  <span className={modal.spinner} aria-hidden="true" />
                  Waiting for your wallet…
                </StatusMessage>
              ) : null}
            </>
          ) : null}

          {error ? <StatusMessage tone="error" role="alert">{error}</StatusMessage> : null}
          {expiredPrepared && !attemptedAction && step === "confirm" ? (
            <StatusMessage tone="error" role="alert">
              This {mode} expired. Go back and continue again.
            </StatusMessage>
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
            primaryLabel={attemptedAction ? "Retry" : `${mode === "deposit" ? "Deposit" : "Withdraw"} ${confirmAmount}`}
            primaryDisabled={expiredPrepared && !attemptedAction}
            onPrimary={() => void confirm()}
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
        <ToastViewport>
          <Toast key={`${success.mode}:${success.amount}`} tone="success" duration={6000} onDismiss={() => setSuccess(null)}>
            <Text as="strong" textStyle="row-label">
              {success.mode === "deposit" ? "Deposited" : "Withdrew"} {success.amount}
            </Text>
            <Text textStyle="metadata" tone="muted">Save · {candidate.name}</Text>
          </Toast>
        </ToastViewport>
      ) : null}
    </>
  );
}

function messageForActionStatus(status: string, mode: SavingsActionMode): string {
  switch (status) {
    case "rejected":
      return "The wallet request was rejected.";
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
  if (code === "SAVINGS_ACTION_RATE_LIMITED" || status === 429) {
    return "Base RPC is rate limited. Try again shortly. No transaction was submitted.";
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
