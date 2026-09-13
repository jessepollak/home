"use client";

import { StatusMessage, Text } from "@home/ui";
import { MoneyTicker } from "@home/ui/money-ticker";
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
  assertTransferRequest,
  formatSendConfirmAmount,
  getTransferAsset,
  isTransferRecipient,
  normalizeTransferRecipient,
  parseTransferAmount,
  transferRequestFromAction,
} from "@/shared/transfers/transfer-helpers";
import {
  TransferExecutionError,
  type ConfirmedTransfer,
  type TransferAssetAvailability,
  type TransferRequest,
} from "@/shared/transfers/types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import modal from "@/client/money-modal/money-modal.module.css";

type SendStep = "amount" | "address" | "confirm" | "pending" | "error";

export function SendDialog({
  open,
  address,
  availableAssets,
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
  availableAssets?: readonly TransferAssetAvailability[];
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
  const [assetId, setAssetId] = useState<string | null>(() => availableAssets?.[0]?.id ?? null);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [request, setRequest] = useState<TransferRequest | null>(null);
  const [action, setAction] = useState<PreparedMoneyAction | null>(null);
  const [step, setStep] = useState<SendStep>("amount");
  const [error, setError] = useState<string | null>(null);
  const resumedActionRef = useRef<string | null>(null);
  const activeAssetId = assetId && availableAssets?.some((asset) => asset.id === assetId)
    ? assetId
    : availableAssets?.[0]?.id ?? null;
  const selectedAsset = activeAssetId ? getTransferAsset(activeAssetId) : null;
  const pricing = useMoneyAssetPricing(selectedAsset?.symbol ?? "");
  const selectedAvailability = availableAssets?.find((asset) => asset.id === activeAssetId);
  const assetOptions = availableAssets?.map((asset) => ({ id: asset.id, label: asset.symbol })) ?? [];

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
    setAssetId(availableAssets?.[0]?.id ?? null); setRecipient(""); setAmount(""); setRequest(null);
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
      if (!address || !selectedAsset || !activeAssetId) throw new TransferExecutionError("unavailable");
      const next: TransferRequest = {
        assetId: activeAssetId,
        recipient: normalizeTransferRecipient(recipient),
        amountBaseUnits: parseTransferAmount(amount.replace(/\.$/, ""), selectedAsset.decimals),
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
        setAssetId(availableAssets?.[0]?.id ?? null);
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
  const requestAsset = request ? getTransferAsset(request.assetId) : null;
  return (
    <MoneyModal open={open} labelledBy="send-title" immediate={immediate} onCancel={close} onClose={() => { reset(); (onClosed ?? onClose)(); }}>
      <MoneyModalHeader title={step === "confirm" || step === "pending" || step === "error" ? "Confirm" : "Send"} titleId="send-title" onBack={step === "amount" || step === "pending" ? undefined : back} onClose={close} closeDisabled={step === "pending"} closeLabel="Close send dialog" />
      <div className={modal.body}>
        {step === "amount" ? <>
          <MoneyAmountDisplay amount={amount} onAmountChange={setAmount} availableLabel={selectedAvailability ? `${selectedAvailability.balanceLabel} available` : undefined} assetId={activeAssetId ?? undefined} assetLabel={selectedAsset?.symbol} assetCurrency={selectedAsset?.cashCurrency} assetOptions={assetOptions} onAssetChange={(next) => { setAssetId(next); setAmount(""); }} chipSet={pricing.status === "priced" ? "quick-local" : "none"} pricing={pricing} nativeSymbol={selectedAsset?.symbol ?? ""} />
          {selectedAsset ? <MoneyNumpad value={amount} maxDecimals={selectedAsset.decimals} onChange={setAmount} /> : <StatusMessage>No catalog balance is available to send.</StatusMessage>}
        </> : null}
        {step === "address" ? <div className={modal.fieldBlock}>
          <AddressField id="send-recipient" label="To" value={recipient} onChange={setRecipient} aria-describedby="send-recipient-hint" />
          <Text id="send-recipient-hint" textStyle="metadata" tone="muted" className={modal.fieldHint}>Base address</Text>
        </div> : null}
        {request && requestAsset && (step === "confirm" || step === "pending" || step === "error") ? <>
          <MoneyConfirmSummary amount={confirmAmount} lead={`You're sending ${requestAsset.symbol}`} rows={[
            { label: "To", value: <CopyableValue value={request.recipient} display={formatAddress(request.recipient)} valueKind="address" /> },
            { label: "Asset", value: requestAsset.symbol },
            { label: "Network", value: "Base" },
          ]} />
          {step === "pending" ? <StatusMessage className={modal.pending}><span className={modal.spinner} aria-hidden="true" />Waiting for your wallet…</StatusMessage> : null}
        </> : null}
        {error ? <StatusMessage className={modal.error} tone="error" role="alert">{error}</StatusMessage> : null}
      </div>
      {step === "amount" ? <MoneyModalFooter primaryLabel="Continue" primaryDisabled={!selectedAsset || !isPositiveDecimalAmount(amount)} onPrimary={() => { setError(null); setStep("address"); }} /> : null}
      {step === "address" ? <MoneyModalFooter primaryLabel="Continue" primaryDisabled={!isTransferRecipient(recipient)} onPrimary={() => void prepare()} /> : null}
      {step === "confirm" ? <MoneyModalFooter primaryLabel={<>Send <MoneyTicker value={confirmAmount} /></>} onPrimary={() => void confirm()} secondaryLabel="Back" onSecondary={back} /> : null}
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
