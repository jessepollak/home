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
} from "@/features/money-modal";
import type { PreparedMoneyAction } from "@/features/money-actions/types";
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
> & Partial<Pick<AccountWalletClient, "prepareMoneyAction" | "executeMoneyAction" | "fetchOperations">>;

type ComposeStep = "amount" | "address";
type SendStep = ComposeStep | "confirm" | "pending" | "recovery" | "failed" | "error";

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
  fetchOperations,
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
  fetchOperations?: AccountWalletClient["fetchOperations"];
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
  const [openedAt] = useState(() => Date.now());
  const displayStep = open && pendingTransfer && (step === "amount" || step === "address")
    ? "recovery"
    : step;
  const displayRequest: TransferRequest | PendingTransfer | null =
    request ?? pendingTransfer;
  const displayError =
    error ?? (displayStep === "recovery" && pendingTransfer
      ? messageForPendingTransfer(pendingTransfer)
      : null);
  const expiredPrepared = preparedAction
    ? Date.parse(preparedAction.expiresAt) <= openedAt
    : false;
  const checkOnly = recoveringAction || expiredPrepared || displayStep === "recovery";

  useEffect(() => {
    if (!open || !fetchOperations || preparedAction || step !== "amount") return;
    let active = true;
    void fetchOperations().then((value) => {
      if (!active || !value || typeof value !== "object" || !("operations" in value) || !Array.isArray(value.operations)) return;
      const operation = value.operations.find((candidate) =>
        candidate && typeof candidate === "object" && "status" in candidate &&
        ["submitting", "submitted", "included", "unknown"].includes(String(candidate.status)) &&
        "action" in candidate && candidate.action && typeof candidate.action === "object" &&
        "kind" in candidate.action && candidate.action.kind === "send",
      ) as { action?: PreparedMoneyAction } | undefined;
      const recoveredRequest = operation?.action ? requestFromSendAction(operation.action) : null;
      if (operation?.action && recoveredRequest) {
        setPreparedAction(operation.action);
        setRequest(recoveredRequest);
        setAssetId(recoveredRequest.assetId);
        setRecipient(recoveredRequest.recipient);
        setRecoveringAction(true);
        setError("This send is still open. Check its status; do not submit it again.");
        setStep("confirm");
      }
    }).catch(() => {
      // Recent-operation recovery is best effort; composing remains available.
    });
    return () => { active = false; };
  }, [fetchOperations, open, preparedAction, step]);

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
    try {
      if (!address) throw new TransferExecutionError("unavailable");
      const normalizedRecipient = normalizeTransferRecipient(recipient);
      const amountBaseUnits = parseTransferAmount(
        amount.replace(/\.$/, ""),
        TRANSFER_ASSETS[assetId].decimals,
      );
      const nextRequest = {
        assetId,
        recipient: normalizedRecipient,
        amountBaseUnits,
      } satisfies TransferRequest;
      assertTransferRequest(nextRequest);
      setRequest(nextRequest);
      setIntentId(crypto.randomUUID());
      setError(null);
      if (prepareMoneyAction) {
        setStep("pending");
        setPreparedAction(await prepareMoneyAction("/api/actions/send/prepare", nextRequest));
      }
      setStep("confirm");
    } catch {
      setError(
        `Enter a valid Base address and a positive ${TRANSFER_ASSETS[assetId].symbol} amount.`,
      );
      setStep("address");
    }
  }

  async function confirm() {
    if (!request || !intentId || step === "pending") return;
    setError(null);
    setStep("pending");
    try {
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
              prefix={assetId === "usdc" ? "$" : ""}
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
            />
            <MoneyNumpad
              value={amount}
              maxDecimals={TRANSFER_ASSETS[assetId].decimals}
              onChange={setAmount}
            />
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
                {pendingTransfer
                  ? "Checking the existing send…"
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
          primaryLabel="Continue"
          primaryDisabled={!isPositiveDecimalAmount(amount)}
          onPrimary={() => {
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
