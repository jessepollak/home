"use client";

import { useEffect, useRef, useState } from "react";
import { AddressField } from "@/components/address";
import { CopyableValue } from "@/components/copyable-value";
import { formatAddress } from "@/shared/formatting";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import {
  MoneyAmountDisplay,
  MoneyConfirmSummary,
  MoneyModal,
  MoneyModalFooter,
  MoneyModalHeader,
  MoneyNumpad,
  isPositiveDecimalAmount,
  useMoneyAssetPricing,
} from "@/client/money-modal";
import {
  TRANSFER_ASSETS,
  assertTransferRequest,
  formatSendConfirmAmount,
  isTransferRecipient,
  normalizeTransferRecipient,
  parseTransferAmount,
  transferRequestFromAction,
} from "@/shared/transfers/transfer-helpers";
import { TransferExecutionError, type ConfirmedTransfer, type TransferAssetId, type TransferRequest } from "@/shared/transfers/types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import modal from "@/client/money-modal/money-modal.module.css";

type SendStep = "amount" | "address" | "confirm" | "pending" | "error";
const ASSET_OPTIONS = [{ id: "usdc", label: "USDC" }, { id: "eth", label: "ETH" }] as const;

export function SendDialog({
  open,
  address,
  availableByAsset,
  prepareMoneyAction,
  resumeMoneyAction,
  executeMoneyAction,
  ownerBoundary,
  immediate = false,
  resumeActionId = null,
  onReview,
  onInvalidResume,
  onConfirmed,
  onClose,
  onClosed,
}: {
  open: boolean;
  address: `0x${string}` | null;
  availableByAsset?: Partial<Record<TransferAssetId, string>>;
  prepareMoneyAction: AccountWalletClient["prepareMoneyAction"];
  resumeMoneyAction: AccountWalletClient["resumeMoneyAction"];
  executeMoneyAction: AccountWalletClient["executeMoneyAction"];
  ownerBoundary: string | null;
  resumeActionId?: string | null;
  immediate?: boolean;
  onReview?: (actionId: string) => void;
  onInvalidResume?: () => void;
  onConfirmed?: (transfer: ConfirmedTransfer) => void;
  onClose: () => void;
  onClosed?: () => void;
}) {
  const [assetId, setAssetId] = useState<TransferAssetId>("usdc");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [request, setRequest] = useState<TransferRequest | null>(null);
  const [action, setAction] = useState<PreparedMoneyAction | null>(null);
  const [step, setStep] = useState<SendStep>("amount");
  const [error, setError] = useState<string | null>(null);
  const resumedActionRef = useRef<string | null>(null);
  const pricing = useMoneyAssetPricing(TRANSFER_ASSETS[assetId].symbol);

  useEffect(() => {
    if (!open || !ownerBoundary || !resumeActionId) return;
    if (resumedActionRef.current === resumeActionId) return;
    resumedActionRef.current = resumeActionId;
    let cancelled = false;
    setStep("pending");
    setError(null);
    void resumeMoneyAction(resumeActionId).then((resumed) => {
      if (cancelled) return;
      const nextRequest = transferRequestFromAction(resumed);
      if (!nextRequest) throw new TransferExecutionError("unavailable");
      setAssetId(nextRequest.assetId);
      setRecipient(nextRequest.recipient);
      setRequest(nextRequest);
      setAction(resumed);
      setStep("confirm");
    }).catch(() => {
      if (cancelled) return;
      setRequest(null);
      setAction(null);
      setStep("amount");
      onInvalidResume?.();
    });
    return () => {
      cancelled = true;
    };
  }, [onInvalidResume, open, ownerBoundary, resumeActionId, resumeMoneyAction]);

  function reset() {
    setAssetId("usdc"); setRecipient(""); setAmount(""); setRequest(null);
    setAction(null); setStep("amount"); setError(null);
  }
  function close() { reset(); onClose(); }
  function back() {
    setError(null);
    if (step === "address") setStep("amount");
    else { setAction(null); setStep("address"); }
  }

  async function prepare() {
    try {
      if (!address) throw new TransferExecutionError("unavailable");
      const next: TransferRequest = {
        assetId,
        recipient: normalizeTransferRecipient(recipient),
        amountBaseUnits: parseTransferAmount(amount.replace(/\.$/, ""), TRANSFER_ASSETS[assetId].decimals),
      };
      assertTransferRequest(next);
      setRequest(next); setStep("pending"); setError(null);
      const prepared = await prepareMoneyAction("send", next);
      setAction(prepared);
      onReview?.(prepared.id);
      setStep("confirm");
    } catch {
      setError("Enter a valid Base address and positive amount, then try again.");
      setStep("address");
    }
  }

  async function confirm() {
    if (!action || !request) return;
    setStep("pending"); setError(null);
    try {
      const result = await executeMoneyAction(action);
      if (result.status === "confirmed" && result.transactionHash) {
        onConfirmed?.({ ...request, transactionHash: result.transactionHash });
      }
      reset();
      onClose();
    } catch (caught) {
      if (isUnavailableReview(caught)) {
        setAssetId("usdc");
        setRecipient("");
        setAmount("");
        setRequest(null);
        setAction(null);
        setError("This review is no longer available — start again.");
        setStep("amount");
        onInvalidResume?.();
        return;
      }
      setError(messageForError(caught));
      setStep("error");
    }
  }

  const confirmAmount = request ? formatSendConfirmAmount(request.amountBaseUnits, request.assetId) : "";
  return (
    <MoneyModal open={open} labelledBy="send-title" immediate={immediate} onCancel={close} onClose={() => { reset(); (onClosed ?? onClose)(); }}>
      <MoneyModalHeader title={step === "confirm" || step === "pending" || step === "error" ? "Confirm" : "Send"} titleId="send-title" onBack={step === "amount" || step === "pending" ? undefined : back} onClose={close} closeDisabled={step === "pending"} closeLabel="Close send dialog" />
      <div className={modal.body}>
        {step === "amount" ? <>
          <MoneyAmountDisplay amount={amount} onAmountChange={setAmount} availableLabel={availableByAsset?.[assetId] ? `${availableByAsset[assetId]} available` : undefined} assetId={assetId} assetLabel={TRANSFER_ASSETS[assetId].symbol} assetOptions={ASSET_OPTIONS} onAssetChange={(next) => setAssetId(next as TransferAssetId)} chipSet="quick-local" pricing={pricing} nativeSymbol={TRANSFER_ASSETS[assetId].symbol} />
          <MoneyNumpad value={amount} maxDecimals={TRANSFER_ASSETS[assetId].decimals} onChange={setAmount} />
        </> : null}
        {step === "address" ? <div className={modal.fieldBlock}>
          <AddressField id="send-recipient" label="To" value={recipient} onChange={setRecipient} aria-describedby="send-recipient-hint" />
          <p id="send-recipient-hint" className={modal.fieldHint}>Base address</p>
        </div> : null}
        {request && (step === "confirm" || step === "pending" || step === "error") ? <>
          <MoneyConfirmSummary amount={confirmAmount} lead={`You're sending ${TRANSFER_ASSETS[request.assetId].symbol}`} rows={[
            { label: "To", value: <CopyableValue value={request.recipient} display={formatAddress(request.recipient)} valueKind="address" /> },
            { label: "Asset", value: TRANSFER_ASSETS[request.assetId].symbol },
            { label: "Network", value: "Base" },
          ]} />
          {step === "pending" ? <div className={modal.pending} role="status"><span className={modal.spinner} aria-hidden="true" />Waiting for your wallet…</div> : null}
        </> : null}
        {error ? <p className={modal.error} role="alert">{error}</p> : null}
      </div>
      {step === "amount" ? <MoneyModalFooter primaryLabel="Continue" primaryDisabled={!isPositiveDecimalAmount(amount)} onPrimary={() => { setError(null); setStep("address"); }} /> : null}
      {step === "address" ? <MoneyModalFooter primaryLabel="Continue" primaryDisabled={!isTransferRecipient(recipient)} onPrimary={() => void prepare()} /> : null}
      {step === "confirm" ? <MoneyModalFooter primaryLabel={`Send ${confirmAmount}`} onPrimary={() => void confirm()} secondaryLabel="Back" onSecondary={back} /> : null}
      {step === "error" ? <MoneyModalFooter primaryLabel="Try again" onPrimary={() => { setError(null); setStep("confirm"); }} secondaryLabel="Back" onSecondary={back} /> : null}
    </MoneyModal>
  );
}

function isUnavailableReview(error: unknown): boolean {
  if (!(error instanceof TransferExecutionError) || error.reason !== "unavailable") return false;
  const status = (error as TransferExecutionError & { status?: unknown }).status;
  return status === 404 || status === 410;
}

function messageForError(error: unknown): string {
  if (error instanceof TransferExecutionError && error.reason === "stale-session") return "Your account changed before submission. Sign in and try again.";
  if (error instanceof TransferExecutionError && error.reason === "rejected") return "The wallet request was rejected.";
  return "The wallet result is unknown. Check Activity before trying again.";
}
