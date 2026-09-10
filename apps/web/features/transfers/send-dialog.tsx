"use client";

import { useEffect, useState } from "react";
import { AddressField, AddressText } from "@/components/address";
import type { AccountWalletClient } from "@/features/account/cdp-client";
import {
  MoneyAmountDisplay,
  MoneyConfirmSummary,
  MoneyModal,
  MoneyModalFooter,
  MoneyModalHeader,
  MoneyNumpad,
  isPositiveDecimalAmount,
  useMoneyAssetPricing,
} from "@/features/money-modal";
import { useReactiveExpiry } from "@/features/money-actions/expiry";
import type { MoneyActionKind, PreparedMoneyAction } from "@/features/money-actions/types";
import {
  TRANSFER_ASSETS,
  assertTransferRequest,
  formatSendConfirmAmount,
  isTransferRecipient,
  normalizeTransferRecipient,
  parseTransferAmount,
} from "./transfer-helpers";
import {
  TransferExecutionError,
  type ConfirmedTransfer,
  type PendingTransfer,
  type TransferAssetId,
  type TransferRequest,
} from "./types";
import modal from "@/features/money-modal/money-modal.module.css";

type TransferWallet = Pick<
  AccountWalletClient,
  | "sendTransfer"
  | "checkPendingTransfer"
  | "startNewTransfer"
> & Partial<Pick<AccountWalletClient, "prepareMoneyAction" | "executeMoneyAction">>;

type FetchUnresolvedSends = (signal?: AbortSignal) => Promise<unknown>;

type ComposeStep = "amount" | "address";
type SendStep = ComposeStep | "confirm" | "pending" | "recovery" | "failed" | "error";
type HistoryAdmission =
  | { status: "checking" }
  | { status: "ready" }
  | { status: "fallback" }
  | { status: "unavailable"; reason: "failed" | "malformed" };

const ASSET_OPTIONS = [
  { id: "usdc", label: "USDC" },
  { id: "eth", label: "ETH" },
] as const;

export function SendDialog({
  open,
  address,
  pendingTransfer,
  availableByAsset,
  sendTransfer,
  checkPendingTransfer,
  startNewTransfer,
  prepareMoneyAction,
  executeMoneyAction,
  fetchUnresolvedSends,
  onTransferConfirmed,
  onClose,
}: {
  open: boolean;
  address: `0x${string}` | null;
  pendingTransfer: PendingTransfer | null;
  availableByAsset?: Partial<Record<TransferAssetId, string>>;
  sendTransfer: TransferWallet["sendTransfer"];
  checkPendingTransfer: TransferWallet["checkPendingTransfer"];
  startNewTransfer: TransferWallet["startNewTransfer"];
  prepareMoneyAction?: AccountWalletClient["prepareMoneyAction"];
  executeMoneyAction?: AccountWalletClient["executeMoneyAction"];
  fetchUnresolvedSends?: FetchUnresolvedSends;
  onTransferConfirmed?: (transfer: ConfirmedTransfer) => void;
  onClose: () => void;
}) {
  const [assetId, setAssetId] = useState<TransferAssetId>("usdc");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [request, setRequest] = useState<TransferRequest | null>(null);
  const [intentId, setIntentId] = useState<string | null>(null);
  const [preparedAction, setPreparedAction] = useState<PreparedMoneyAction | null>(null);
  const [recoveringAction, setRecoveringAction] = useState(false);
  const [step, setStep] = useState<SendStep>("amount");
  const [error, setError] = useState<string | null>(null);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [historyAdmission, setHistoryAdmission] = useState<HistoryAdmission>(() =>
    fetchUnresolvedSends ? { status: "checking" } : prepareMoneyAction
      ? { status: "unavailable", reason: "failed" }
      : { status: "fallback" },
  );
  const displayStep = open && pendingTransfer && (step === "amount" || step === "address")
    ? "recovery"
    : step;
  const displayRequest: TransferRequest | PendingTransfer | null =
    request ?? pendingTransfer;
  const displayError =
    error ?? (displayStep === "recovery" && pendingTransfer
      ? messageForPendingTransfer(pendingTransfer)
      : null);
  const { expired: expiredPrepared, recheckExpired } = useReactiveExpiry(
    preparedAction?.expiresAt ?? null,
  );
  const checkOnly = recoveringAction || expiredPrepared || displayStep === "recovery";
  const historyReady = historyAdmission.status === "ready" || historyAdmission.status === "fallback";

  useEffect(() => {
    if (open) return;
    // Resetting a closed modal prevents the previous wallet's compose or recovery state from crossing owners.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAssetId("usdc");
    setRecipient("");
    setAmount("");
    setRequest(null);
    setIntentId(null);
    setPreparedAction(null);
    setRecoveringAction(false);
    setStep("amount");
    setError(null);
    setHistoryAdmission(fetchUnresolvedSends ? { status: "checking" } : prepareMoneyAction
      ? { status: "unavailable", reason: "failed" }
      : { status: "fallback" });
  }, [fetchUnresolvedSends, open, prepareMoneyAction]);

  useEffect(() => {
    if (!open) return;
    if (!fetchUnresolvedSends) return;
    const controller = new AbortController();
    void fetchUnresolvedSends(controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      const parsed = parseSendHistory(value, address);
      if (parsed.status === "malformed") {
        setHistoryAdmission({ status: "unavailable", reason: "malformed" });
        return;
      }
      setHistoryAdmission({ status: "ready" });
      if (parsed.action && parsed.request) {
        setPreparedAction(parsed.action);
        setRequest(parsed.request);
        setAssetId(parsed.request.assetId);
        setRecipient(parsed.request.recipient);
        setRecoveringAction(true);
        setError("This send is still open. Check its status; do not submit it again.");
        setStep("confirm");
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setHistoryAdmission({ status: "unavailable", reason: "failed" });
      }
    });
    return () => controller.abort();
  }, [address, fetchUnresolvedSends, historyAttempt, open, prepareMoneyAction]);

  function reset() {
    setAssetId("usdc");
    setRecipient("");
    setAmount("");
    setRequest(null);
    setIntentId(null);
    setPreparedAction(null);
    setRecoveringAction(false);
    setStep("amount");
    setError(null);
    setHistoryAdmission(fetchUnresolvedSends ? { status: "checking" } : prepareMoneyAction
      ? { status: "unavailable", reason: "failed" }
      : { status: "fallback" });
    setHistoryAttempt((attempt) => attempt + 1);
  }

  function closeIfAllowed() {
    if (step !== "pending" || pendingTransfer) {
      reset();
      onClose();
    }
  }

  function goBack() {
    if (recoveringAction) {
      reset();
      onClose();
      return;
    }
    if (displayStep === "address") {
      setError(null);
      setStep("amount");
      return;
    }
    if (displayStep === "confirm" || displayStep === "error" || displayStep === "failed") {
      setPreparedAction(null);
      setRecoveringAction(false);
      setError(null);
      setStep("address");
    }
  }

  async function continueFromAddress() {
    if (!historyReady) {
      setError(messageForHistoryAdmission(historyAdmission));
      setStep("amount");
      return;
    }
    let nextRequest: TransferRequest;
    try {
      if (!address) throw new TransferExecutionError("unavailable");
      const normalizedRecipient = normalizeTransferRecipient(recipient);
      const amountBaseUnits = parseTransferAmount(
        amount.replace(/\.$/, ""),
        TRANSFER_ASSETS[assetId].decimals,
      );
      nextRequest = {
        assetId,
        recipient: normalizedRecipient,
        amountBaseUnits,
      } satisfies TransferRequest;
      assertTransferRequest(nextRequest);
    } catch {
      setError(
        `Enter a valid Base address and a positive ${TRANSFER_ASSETS[assetId].symbol} amount.`,
      );
      setStep("address");
      return;
    }

    setRequest(nextRequest);
    setIntentId(crypto.randomUUID());
    setError(null);
    if (prepareMoneyAction) {
      setStep("pending");
      try {
        setPreparedAction(await prepareMoneyAction("/api/actions/send/prepare", nextRequest));
      } catch {
        setPreparedAction(null);
        setError("Home couldn’t prepare this send. Your wallet was not asked to submit it. Try again.");
        setStep("address");
        return;
      }
    }
    setStep("confirm");
  }

  async function confirm() {
    if (!request || !intentId || step === "pending") return;
    if (preparedAction && !recoveringAction && recheckExpired()) {
      setError("This send expired. Go back and continue again.");
      return;
    }
    setError(null);
    setStep("pending");
    try {
      if (preparedAction && !executeMoneyAction) {
        setError("Home can’t submit this prepared send right now. Your wallet was not asked to submit it.");
        setStep("error");
        return;
      }
      if (preparedAction && executeMoneyAction) {
        const result = await executeMoneyAction(preparedAction);
        if (result.status === "confirmed") {
          if (!result.transactionHash) {
            setError("The send is confirmed but its transaction hash is unavailable.");
            setStep("error");
            return;
          }
          complete({ ...request, transactionHash: result.transactionHash });
          return;
        }
        if (result.status === "rejected" || result.status === "expired" || result.status === "failed") {
          setError(messageForActionStatus(result.status));
          setStep(result.status === "failed" ? "failed" : "error");
          return;
        }
        setRecoveringAction(true);
        setError("This send is still open. Check its status; do not submit it again.");
        setStep("confirm");
        return;
      }
      complete(await sendTransfer(request, intentId));
    } catch (caught) {
      setError(messageForTransferError(caught, true));
      setStep(
        isRecoverableSubmission(caught)
          ? "recovery"
          : isExplicitSubmissionFailure(caught)
            ? "failed"
            : "error",
      );
    }
  }

  async function checkStatus() {
    if (step === "pending") return;
    setError(null);
    setStep("pending");
    try {
      if (preparedAction && !executeMoneyAction) {
        setError("Home can’t check this saved send right now. Try again later.");
        setStep("confirm");
        return;
      }
      if (preparedAction && executeMoneyAction) {
        const result = await executeMoneyAction(preparedAction);
        if (result.status === "confirmed" && result.transactionHash && request) {
          complete({ ...request, transactionHash: result.transactionHash });
          return;
        }
        setRecoveringAction(true);
        setError(messageForActionStatus(result.status));
        setStep("confirm");
        return;
      }
      complete(await checkPendingTransfer());
    } catch (caught) {
      setError(messageForTransferError(caught, true));
      setStep("recovery");
    }
  }

  function complete(result: ConfirmedTransfer) {
    try {
      onTransferConfirmed?.(result);
    } catch {
      // A parent refresh failure must not relabel a receipt-confirmed transfer.
    }
    reset();
    onClose();
  }

  const title = displayStep === "confirm" ? "Confirm" : "Send";
  const available = availableByAsset?.[assetId];
  const pricing = useMoneyAssetPricing(TRANSFER_ASSETS[assetId].symbol);
  // Max parses this presentation label. HomeAssetBalanceItem has no exact
  // available base units — not a backend gap claim.
  const confirmAmount = displayRequest
    ? formatSendConfirmAmount(displayRequest.amountBaseUnits, displayRequest.assetId)
    : "";

  return (
    <MoneyModal
      open={open}
      labelledBy="send-title"
      describedBy={displayStep === "pending" ? "send-pending" : undefined}
      onCancel={closeIfAllowed}
      onClose={() => {
        reset();
        onClose();
      }}
    >
      <MoneyModalHeader
        title={title}
        titleId="send-title"
        onBack={
          displayStep === "amount" || displayStep === "pending" || displayStep === "recovery"
            ? undefined
            : goBack
        }
        onClose={closeIfAllowed}
        closeDisabled={displayStep === "pending" && !pendingTransfer}
        closeLabel="Close send dialog"
      />

      <div className={modal.body}>
        {displayStep === "amount" ? (
          <>
            <MoneyAmountDisplay
              amount={amount}
              onAmountChange={setAmount}
              availableLabel={available ? `${available} available` : undefined}
              assetId={assetId}
              assetLabel={TRANSFER_ASSETS[assetId].symbol}
              assetOptions={ASSET_OPTIONS}
              onAssetChange={(next) => {
                const nextAsset = next as TransferAssetId;
                setAssetId(nextAsset);
                const maxDecimals = TRANSFER_ASSETS[nextAsset].decimals;
                if (amount.includes(".")) {
                  const [whole, fraction = ""] = amount.split(".");
                  setAmount(fraction.length > maxDecimals ? `${whole}.${fraction.slice(0, maxDecimals)}` : amount);
                }
              }}
              chipSet="quick-local"
              pricing={pricing}
              nativeSymbol={TRANSFER_ASSETS[assetId].symbol}
            />
            <MoneyNumpad
              value={amount}
              maxDecimals={TRANSFER_ASSETS[assetId].decimals}
              onChange={setAmount}
            />
            {historyAdmission.status === "checking" ? (
              <p className={modal.fieldHint} role="status">Checking recent sends…</p>
            ) : historyAdmission.status === "unavailable" ? (
              <p className={modal.error} role="alert">{messageForHistoryAdmission(historyAdmission)}</p>
            ) : null}
          </>
        ) : null}

        {displayStep === "address" ? (
          <div className={modal.fieldBlock}>
            <label className={modal.fieldLabel} htmlFor="send-recipient">To</label>
            <AddressField
              id="send-recipient"
              value={recipient}
              onChange={setRecipient}
              aria-describedby="send-recipient-hint"
            />
            <p id="send-recipient-hint" className={modal.fieldHint}>Base address</p>
          </div>
        ) : null}

        {displayRequest && (displayStep === "confirm" || displayStep === "pending" || displayStep === "recovery" || displayStep === "failed" || displayStep === "error") ? (
          <>
            <MoneyConfirmSummary
              amount={confirmAmount}
              lead={`You're sending ${TRANSFER_ASSETS[displayRequest.assetId].symbol}`}
              rows={[
                { label: "To", value: <AddressText address={displayRequest.recipient} /> },
                { label: "Asset", value: TRANSFER_ASSETS[displayRequest.assetId].symbol },
                { label: "Network", value: "Base" },
              ]}
            />
            {displayStep === "pending" ? (
              <div id="send-pending" className={modal.pending} role="status">
                <span className={modal.spinner} aria-hidden="true" />
                {pendingTransfer || recoveringAction
                  ? "Checking the existing send…"
                  : prepareMoneyAction && !preparedAction
                    ? "Preparing your send…"
                    : "Waiting for your wallet…"}
              </div>
            ) : null}
            {displayError ? <p className={modal.error} role="alert">{displayError}</p> : null}
            {expiredPrepared && displayStep !== "pending" ? (
              <p className={modal.error} role="alert">This send expired. Go back and continue again.</p>
            ) : null}
          </>
        ) : null}

        {displayStep === "amount" || displayStep === "address"
          ? error
            ? <p className={modal.error} role="alert">{error}</p>
            : null
          : null}
      </div>

      {displayStep === "amount" ? (
        <MoneyModalFooter
          primaryLabel={historyAdmission.status === "unavailable"
            ? "Retry recent sends"
            : historyAdmission.status === "checking"
              ? "Checking recent sends…"
              : "Continue"}
          primaryDisabled={historyAdmission.status === "checking" || (
            historyReady && !isPositiveDecimalAmount(amount)
          )}
          onPrimary={() => {
            if (historyAdmission.status === "unavailable") {
              setError(null);
              setHistoryAdmission({ status: "checking" });
              setHistoryAttempt((attempt) => attempt + 1);
              return;
            }
            if (!historyReady) return;
            setError(null);
            setStep("address");
          }}
        />
      ) : null}

      {displayStep === "address" ? (
        <MoneyModalFooter
          primaryLabel="Continue"
          primaryDisabled={!isTransferRecipient(recipient) || !isPositiveDecimalAmount(amount)}
          onPrimary={() => void continueFromAddress()}
        />
      ) : null}

      {displayStep === "confirm" ? (
        <MoneyModalFooter
          primaryLabel={checkOnly ? (expiredPrepared && !recoveringAction ? "Check send status" : "Check status") : `Send ${confirmAmount}`}
          primaryDisabled={false}
          onPrimary={() => void (checkOnly ? checkStatus() : confirm())}
          secondaryLabel="Back"
          onSecondary={goBack}
        />
      ) : null}

      {displayStep === "recovery" ? (
        <>
          <MoneyModalFooter
            primaryLabel="Check existing submission"
            onPrimary={() => void checkStatus()}
            secondaryLabel="Close safely"
            onSecondary={closeIfAllowed}
          />
          <div className={modal.footer}>
            <button
              className={modal.quiet}
              type="button"
              onClick={() => {
                startNewTransfer();
                reset();
              }}
            >
              Start a new send instead
            </button>
          </div>
        </>
      ) : null}

      {displayStep === "failed" ? (
        <MoneyModalFooter
          primaryLabel="Compose a new send"
          onPrimary={() => {
            startNewTransfer();
            reset();
          }}
          secondaryLabel="Close"
          onSecondary={closeIfAllowed}
        />
      ) : null}

      {displayStep === "error" ? (
        <MoneyModalFooter
          primaryLabel="Back"
          onPrimary={goBack}
        />
      ) : null}
    </MoneyModal>
  );
}

const OPERATION_STATUSES = new Set([
  "prepared",
  "submitting",
  "submitted",
  "included",
  "confirmed",
  "rejected",
  "expired",
  "failed",
  "unknown",
]);
const UNRESOLVED_OPERATION_STATUSES = new Set(["submitting", "submitted", "included", "unknown"]);
const MONEY_ACTION_KINDS = new Set<MoneyActionKind>([
  "send",
  "save-deposit",
  "save-withdraw",
  "swap",
  "supply-collateral",
  "borrow",
  "repay",
  "withdraw-collateral",
]);

function parseSendHistory(
  value: unknown,
  address: `0x${string}` | null,
): { status: "ready"; action: PreparedMoneyAction | null; request: TransferRequest | null } | { status: "malformed" } {
  if (
    !isRecord(value) || value.scope !== "unresolved-send" ||
    !Array.isArray(value.operations)
  ) return { status: "malformed" };
  let recovered: { action: PreparedMoneyAction; request: TransferRequest } | null = null;
  for (const candidate of value.operations) {
    if (!isRecord(candidate) || typeof candidate.status !== "string" || !OPERATION_STATUSES.has(candidate.status) ||
      typeof candidate.attemptCount !== "number" || !Number.isSafeInteger(candidate.attemptCount) ||
      candidate.attemptCount < 0 || typeof candidate.createdAt !== "string" ||
      !Number.isFinite(Date.parse(candidate.createdAt)) || typeof candidate.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(candidate.updatedAt)) || !isRecord(candidate.action) ||
      typeof candidate.action.kind !== "string" || !MONEY_ACTION_KINDS.has(candidate.action.kind as MoneyActionKind)) {
      return { status: "malformed" };
    }
    if (!UNRESOLVED_OPERATION_STATUSES.has(candidate.status) || candidate.action.kind !== "send") {
      return { status: "malformed" };
    }
    if (!address || !isPreparedSendAction(candidate.action, address)) return { status: "malformed" };
    const action = candidate.action as unknown as PreparedMoneyAction;
    const request = requestFromSendAction(action);
    if (!request) return { status: "malformed" };
    recovered ??= { action, request };
  }
  return recovered
    ? { status: "ready", ...recovered }
    : { status: "ready", action: null, request: null };
}

function isPreparedSendAction(value: Record<string, unknown>, address: `0x${string}`): boolean {
  if (
    value.kind !== "send" || typeof value.id !== "string" || typeof value.reviewHash !== "string" ||
    typeof value.title !== "string" || typeof value.createdAt !== "string" ||
    typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) ||
    !Number.isFinite(Date.parse(value.expiresAt)) || !isRecord(value.owner) ||
    typeof value.owner.subject !== "string" || typeof value.owner.address !== "string" ||
    value.owner.address.toLowerCase() !== address.toLowerCase() || value.owner.chainId !== 8453 ||
    typeof value.owner.accountProvider !== "string" || !Array.isArray(value.calls) ||
    !Array.isArray(value.amounts) || !Array.isArray(value.warnings) ||
    !value.warnings.every((warning) => typeof warning === "string")
  ) return false;
  if (!value.calls.every((call) => isRecord(call) && typeof call.to === "string" && /^0x[0-9a-fA-F]{40}$/.test(call.to) &&
    typeof call.data === "string" && /^0x[0-9a-fA-F]*$/.test(call.data) && typeof call.value === "string")) return false;
  return value.amounts.every((amount) => isRecord(amount) && typeof amount.assetId === "string" &&
    typeof amount.symbol === "string" && typeof amount.decimals === "number" &&
    typeof amount.amountBaseUnits === "string" && (amount.direction === "spend" || amount.direction === "receive"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageForHistoryAdmission(admission: HistoryAdmission): string {
  if (admission.status === "checking") return "Recent sends are still being checked. Wait before continuing.";
  if (admission.status === "unavailable" && admission.reason === "malformed") {
    return "Recent sends returned an invalid response. Retry before starting a new send.";
  }
  if (admission.status === "unavailable") {
    return "Recent sends couldn’t be checked. Retry before starting a new send.";
  }
  return "";
}

function requestFromSendAction(action: PreparedMoneyAction): TransferRequest | null {
  if (action.kind !== "send" || action.calls.length !== 1) return null;
  const spend = action.amounts.find((entry) => entry.direction === "spend");
  if (!spend || (spend.assetId !== "usdc" && spend.assetId !== "eth")) return null;
  const call = action.calls[0];
  let recipient: `0x${string}`;
  if (spend.assetId === "eth") {
    recipient = call.to;
  } else {
    if (!call.data.startsWith("0xa9059cbb") || call.data.length !== 138) return null;
    recipient = `0x${call.data.slice(34, 74)}` as `0x${string}`;
  }
  try {
    const request = { assetId: spend.assetId, recipient, amountBaseUnits: spend.amountBaseUnits } satisfies TransferRequest;
    assertTransferRequest(request);
    return request;
  } catch {
    return null;
  }
}

function isExplicitSubmissionFailure(error: unknown): boolean {
  return error instanceof TransferExecutionError && error.reason === "failed";
}

function isRecoverableSubmission(error: unknown): boolean {
  return (
    error instanceof TransferExecutionError &&
    (error.reason === "confirmation-timeout" ||
      error.reason === "submission-unknown" ||
      error.reason === "submission-pending")
  );
}

function messageForPendingTransfer(transfer: PendingTransfer): string {
  return transfer.state === "submitted"
    ? "This send was already submitted. Checking status will only inspect that same submission."
    : "The wallet result is unknown. Check your wallet before starting a separate send.";
}

function messageForActionStatus(status: string): string {
  switch (status) {
    case "rejected": return "The wallet request was rejected.";
    case "expired": return "This send expired. Go back and continue again.";
    case "failed": return "The send did not succeed onchain.";
    default: return "This send is still open. Checking again will not submit it again.";
  }
}

function messageForTransferError(error: unknown, afterDispatch = false): string {
  if (!(error instanceof TransferExecutionError)) {
    return afterDispatch
      ? "The send outcome is unknown. Check your wallet before starting another send."
      : "The send failed before confirmation.";
  }
  switch (error.reason) {
    case "rejected":
      return "The wallet request was rejected. No send was confirmed.";
    case "insufficient-balance":
      return "Your available balance is lower than this amount.";
    case "stale-session":
      return afterDispatch
        ? "Your account changed while confirmation was in progress. Check that wallet before sending again."
        : "Your account changed or signed out before submission.";
    case "confirmation-timeout":
      return "The existing send is still pending. Checking again will not resubmit it.";
    case "submission-unknown":
      return "The wallet result is unknown. Check your wallet before starting a separate send.";
    case "submission-pending":
      return "An earlier send is still open. Check that submission instead of sending it again.";
    case "invalid-request":
      return "The recipient or amount is invalid.";
    default:
      return "The send did not produce a verified receipt. Start a new send only after checking your wallet.";
  }
}
