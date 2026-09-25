"use client";

import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MoneyMotionProvider } from "@/components/money-ticker";
import { useReactiveExpiry } from "@/client/actions/expiry";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  MoneyAmountDisplay,
  MoneyAssetPicker,
  MoneyConfirmSummary,
  moneyConfirmFromRow,
  MoneyConfirmFooter,
  MoneyModal,
  MoneyModalBody,
  MoneyModalFooter,
  MoneyModalHeader,
  MoneyNumpad,
  decimalFromBaseUnits,
  isPositiveDecimalAmount,
  useMoneyAssetPricing,
  type MoneyAmountChangeSource,
} from "@/client/money-modal";
import type {
  MoneyActionOwner,
  OperationResult,
  PreparedMoneyAction,
} from "@/shared/money-actions/types";
import { parseUsdcAmount } from "@/client/savings/format";
import { networkFeeErrorMessage } from "@/shared/money-actions/network-fee";
import { maxAmountAfterNetworkFee, useNetworkFeeReserve } from "@/client/money-modal/network-fee-policy";
import { reportClientError } from "@/client/observability/client-reporter";
import {
  formatExactPresentationTokenAmount,
  formatPresentationDate,
  formatPresentationPercentage,
  formatUsdStablecoinAmount,
} from "@/shared/formatting";
import {
  readSavingsPreparedReview,
  type SavingsPreparedReview,
} from "@/shared/savings/review";
import type { MorphoVaultCandidate } from "@/shared/savings/types";
import { useSavingsDialogFixture } from "./savings-dialog-fixture";

export type SavingsActionMode = "deposit" | "withdraw";

export type SavingsMoneyDialogProps = {
  open: boolean;
  mode: SavingsActionMode;
  session: VerifiedAccountSession;
  candidate: MorphoVaultCandidate;
  availableLabel?: string;
  availableBaseUnits?: string | null;
  availableStale?: boolean;
  fetchAccountResource?: AccountWalletClient["fetchAccountResource"];
  prepareMoneyAction: AccountWalletClient["prepareMoneyAction"];
  executeMoneyAction: AccountWalletClient["executeMoneyAction"];
  onClose: () => void;
  onClosed?: () => void;
  onConfirmed?: (result: OperationResult) => void | Promise<void>;
};

type DialogStep = "amount" | "confirm" | "pending" | "error" | "failed";

export function SavingsMoneyDialog(props: SavingsMoneyDialogProps) {
  const ownerIdentity = savingsDialogOwnerIdentity(props.session);
  return <OwnerBoundSavingsMoneyDialog key={ownerIdentity} {...props} />;
}

function OwnerBoundSavingsMoneyDialog({
  open,
  mode,
  session,
  candidate,
  availableLabel,
  availableBaseUnits,
  availableStale = false,
  fetchAccountResource,
  prepareMoneyAction,
  executeMoneyAction,
  onClose,
  onClosed,
  onConfirmed,
}: SavingsMoneyDialogProps) {
  const {
    motion = "system",
    assetId: selectedAssetId,
    assetLabel: selectedAssetLabel,
    assetDecimals: selectedAssetDecimals,
    assetOptions,
    onAssetChange,
  } = useSavingsDialogFixture();
  const [amount, setAmount] = useState("");
  const [amountChangeSource, setAmountChangeSource] =
    useState<MoneyAmountChangeSource>("programmatic");
  const [amountBaseUnits, setAmountBaseUnits] = useState<string | null>(null);
  const [preparedAction, setPreparedAction] = useState<PreparedMoneyAction | null>(null);
  const [attemptedAction, setAttemptedAction] = useState(false);
  const [serverExpiredActionId, setServerExpiredActionId] = useState<string | null>(null);
  const [step, setStep] = useState<DialogStep>("amount");
  const [error, setError] = useState<string | null>(null);
  const ownerIdentity = savingsDialogOwnerIdentity(session);
  const currentPreparationIdentity = useRef(ownerIdentity);
  const preparedReview = preparedAction
    ? readSavingsPreparedReview(preparedAction)
    : null;
  const {
    expired: expiredPrepared,
    recheckExpired,
  } = useReactiveExpiry(preparedAction?.expiresAt ?? null);
  const actionExpired = expiredPrepared || serverExpiredActionId === preparedAction?.id;
  const confirmAmount = amountBaseUnits ? formatUsdStablecoinAmount(amountBaseUnits) : "";
  const configuredAssetId = candidate.asset.symbol.toLocaleLowerCase();
  const assetId = selectedAssetId ?? configuredAssetId;
  const assetLabel = selectedAssetLabel ?? candidate.asset.symbol;
  const assetDecimals = selectedAssetDecimals ?? candidate.asset.decimals;
  const assetRouteConfigured = assetId === configuredAssetId
    && assetLabel.toLocaleUpperCase() === candidate.asset.symbol.toLocaleUpperCase()
    && assetDecimals === candidate.asset.decimals;
  const knownAvailable = !availableStale && availableBaseUnits != null && /^\d+$/.test(availableBaseUnits)
    ? BigInt(availableBaseUnits)
    : null;
  const nothingAvailable = knownAvailable === BigInt(0);
  const amountExceedsAvailable = amountExceedsKnownAvailable(amount, knownAvailable);
  const pricing = useMoneyAssetPricing(assetLabel);
  const reserve = useNetworkFeeReserve(session.smartAccount ? savingsDialogOwnerIdentity(session) : null, fetchAccountResource, open);
  const title = step === "confirm" || step === "pending" || step === "error" || step === "failed"
    ? "Confirm"
    : mode === "deposit"
      ? "Deposit"
      : "Withdraw";

  function changeAmount(value: string, source: MoneyAmountChangeSource) {
    setAmountChangeSource(source);
    setAmount(value);
  }

  function reset() {
    changeAmount("", "programmatic");
    setAmountBaseUnits(null);
    setPreparedAction(null);
    setAttemptedAction(false);
    setServerExpiredActionId(null);
    setStep("amount");
    setError(null);
  }

  function goBack() {
    if (step === "confirm" || step === "error" || step === "failed") {
      setPreparedAction(null);
      setServerExpiredActionId(null);
      setError(null);
      setStep("amount");
    }
  }

  async function continueFromAmount() {
    try {
      if (!assetRouteConfigured) {
        throw new SavingsActionClientError(
          `${assetLabel} is available for presentation review only. Savings actions remain ${candidate.asset.symbol}-only.`,
        );
      }
      if (!session.smartAccount) {
        throw new SavingsActionClientError("Verify a Base smart account to continue.");
      }
      const nextAmount = parseUsdcAmount(amount);
      if (knownAvailable !== null && BigInt(nextAmount) > knownAvailable) {
        throw Object.assign(new Error("limit"), { status: 409, code: "SAVINGS_ACTION_LIMIT_EXCEEDED" });
      }
      const preparationIdentity = ownerIdentity;
      setAmountBaseUnits(nextAmount);
      setError(null);
      setStep("pending");
      const action = await prepareMoneyAction(mode === "withdraw" ? "savings-withdraw" : "savings-deposit", {
        kind: mode,
        vaultAddress: candidate.vaultAddress,
        amountBaseUnits: nextAmount,
      });
      const review = readSavingsPreparedReview(action);
      if (
        currentPreparationIdentity.current !== preparationIdentity ||
        action.kind !== (mode === "deposit" ? "savings-deposit" : "savings-withdraw") ||
        action.owner.subject !== session.user.subject ||
        action.owner.accountProvider !== session.accountProvider ||
        action.owner.address.toLowerCase() !== session.smartAccount.address.toLowerCase() ||
        !review ||
        review.operation !== mode ||
        review.vaultAddress.toLowerCase() !== candidate.vaultAddress.toLowerCase() ||
        review.exactUsdcBaseUnits !== nextAmount
      ) {
        throw new SavingsActionClientError(
          "The prepared action did not match the verified account or requested savings action.",
        );
      }
      setPreparedAction(action);
      setAttemptedAction(false);
      setServerExpiredActionId(null);
      setStep("confirm");
    } catch (caught) {
      setPreparedAction(null);
      setError(messageForPrepareError(caught));
      setStep("amount");
    }
  }

  async function confirm() {
    if (!preparedAction || !preparedReview || step === "pending") return;
    if (recheckExpired()) {
      setError(`This ${mode} expired. Go back and continue again.`);
      return;
    }
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
      try {
        await onConfirmed?.(result);
      } catch (error) {
        void reportClientError({
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : "The post-confirm refresh failed.",
          route: window.location.pathname,
        });
      }
      reset();
      onClose();
    } catch (caught) {
      if (isRecord(caught) && caught.code === "ACTION_EXPIRED") {
        setAttemptedAction(false);
        setServerExpiredActionId(preparedAction.id);
      } else {
        setAttemptedAction(true);
        setError("The dispatch outcome is unresolved. Retry recording this same action; a new dispatch will not be created.");
      }
      setStep("confirm");
    }
  }

  const selectedAssetOption = assetOptions?.find((option) => option.id === assetId);
  const amountAssetProps = {
    assetId,
    assetLabel,
    assetCurrency: selectedAssetOption?.currency,
    assetMark: selectedAssetOption?.mark,
    assetOptions,
    onAssetChange,
    locked: !assetOptions || !onAssetChange,
  };

  return (
    <MoneyMotionProvider reducedMotion={motion === "reduced" ? true : undefined}>
      <MoneyModal
        open={open}
        immediate={motion === "reduced"}
        labelledBy="savings-action-title"
        describedBy={step === "pending" ? "savings-action-pending" : undefined}
        pending={step === "pending"}
        onCancel={onClose}
        onClose={() => {
          reset();
          onClose();
          onClosed?.();
        }}
      >
        <MoneyModalHeader
          title={title}
          titleId="savings-action-title"
          {...(step === "amount"
            ? { assetControl: <MoneyAssetPicker {...amountAssetProps} /> }
            : step === "pending"
              ? {}
              : { onBack: goBack })}
          onClose={onClose}
          closeLabel={`Close ${mode} dialog`}
        />

        <MoneyModalBody hasFooter={step !== "pending"} className="gap-4 pt-4">
          {step === "amount" ? (
            <>
              <MoneyAmountDisplay
                amount={amount}
                amountChangeSource={amountChangeSource}
                onAmountChange={changeAmount}
                availableLabel={availableLabel}
                availableAmount={decimalFromBaseUnits(maxAmountAfterNetworkFee(availableBaseUnits, mode === "deposit" ? candidate.asset.symbol : "vault shares", reserve) ?? "", assetDecimals)}
                assetId={assetId}
                assetLabel={assetLabel}
                assetControl="header"
                chipSet="max"
                pricing={pricing}
                nativeSymbol={assetLabel}
              />
              <MoneyNumpad value={amount} maxDecimals={assetDecimals} onChange={changeAmount} />
              {assetRouteConfigured && nothingAvailable ? (
                <StatusMessage>
                  {mode === "withdraw" ? "Nothing saved to withdraw." : `No ${assetLabel} available to deposit.`}
                </StatusMessage>
              ) : assetRouteConfigured && amountExceedsAvailable ? (
                <StatusMessage>That&apos;s more than you have available.</StatusMessage>
              ) : null}
              {!assetRouteConfigured ? (
                <StatusMessage>
                  {assetLabel} is available for presentation review only. Savings actions remain {candidate.asset.symbol}-only.
                </StatusMessage>
              ) : null}
            </>
          ) : null}

          {amountBaseUnits && step !== "amount" ? (
            <>
              <MoneyConfirmSummary action={preparedAction}
                amount={confirmAmount}
                lead={mode === "deposit" ? "Deposit to Save" : "Withdraw from Save"}
                rows={preparedReview && preparedAction ? savingsReviewRows(preparedReview, preparedAction.owner) : [
                  { label: "Review", value: "Prepared facts unavailable" },
                ]}
              />
              {step === "pending" ? (
                <StatusMessage id="savings-action-pending"><span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Waiting for your wallet…</span></StatusMessage>
              ) : null}
            </>
          ) : null}

          {error ? <StatusMessage tone="error" role="alert">{error}</StatusMessage> : null}
          {actionExpired && !attemptedAction && step === "confirm" ? (
            <StatusMessage tone="error" role="alert">
              This {mode} expired. Go back and continue again.
            </StatusMessage>
          ) : null}
        </MoneyModalBody>

        {step === "amount" ? (
          <MoneyModalFooter
            primaryLabel="Continue"
            primaryDisabled={!assetRouteConfigured || !isPositiveDecimalAmount(amount) || amountExceedsAvailable}
            onPrimary={() => void continueFromAmount()}
          />
        ) : null}

        {step === "confirm" && preparedAction ? (
          <MoneyConfirmFooter action={preparedAction}
            actionExpired={actionExpired}
            primaryLabel={attemptedAction ? "Retry" : `${mode === "deposit" ? "Deposit" : "Withdraw"} ${confirmAmount}`}
            primaryDisabled={!preparedReview || (actionExpired && !attemptedAction)}
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
            onSecondary={onClose}
          />
        ) : null}

        {step === "error" ? (
          <MoneyModalFooter
            primaryLabel="Back"
            onPrimary={goBack}
          />
        ) : null}
      </MoneyModal>
    </MoneyMotionProvider>
  );
}

function amountExceedsKnownAvailable(amount: string, available: bigint | null): boolean {
  if (available === null) return false;
  let parsedAmount: string;
  try {
    parsedAmount = parseUsdcAmount(amount);
  } catch {
    return false;
  }
  return BigInt(parsedAmount) > available;
}

function savingsDialogOwnerIdentity(session: VerifiedAccountSession): string {
  return `${session.user.subject}\u0000${session.smartAccount?.address.toLowerCase() ?? ""}\u0000${session.smartAccount?.chainId ?? ""}\u0000${session.accountProvider}`;
}

function savingsReviewRows(review: SavingsPreparedReview, owner: MoneyActionOwner) {
  const apy = review.discoveryRate.status === "unavailable"
    ? "Unavailable"
    : `${formatPresentationPercentage(Number(review.discoveryRate.netApy))} · ${review.discoveryRate.status}`;
  const fee = `${formatWadPercent(review.feeWad)} (current)`;
  const preview = formatExactPresentationTokenAmount(
    review.previewSharesBaseUnits,
    review.shareDecimals,
    "vault shares",
  );
  return [
    moneyConfirmFromRow(owner),
    { label: "Vault", value: review.vaultName },
    { label: "Network", value: `${review.network.name} (${review.network.chainId})` },
    { label: "Discovery APY", value: apy },
    { label: "Current vault fee", value: fee },
    { label: "Amount", value: formatUsdStablecoinAmount(review.exactUsdcBaseUnits) },
    { label: "Share preview", value: preview },
    ...(review.operation === "deposit" && review.minimumSharesBaseUnits !== null
      ? [{ label: "Minimum shares", value: formatExactPresentationTokenAmount(
          review.minimumSharesBaseUnits, review.shareDecimals, "vault shares",
        ) }]
      : [{ label: "Exchange constraint", value: "Exact USDC; reverts if shares are insufficient" }]),
    { label: "Valid until", value: formatPresentationDate(review.expiresAt, { style: "date-time-zone" }) },
  ];
}

function formatWadPercent(value: string): string {
  const wad = BigInt(value);
  const scaled = wad * BigInt(100_000_000) / BigInt("1000000000000000000");
  const whole = scaled / BigInt(1_000_000);
  const fraction = (scaled % BigInt(1_000_000))
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}%` : `${whole}%`;
}

function StatusMessage({
  children,
  tone = "neutral",
  role,
  ...props
}: Omit<ComponentProps<typeof Alert>, "children"> & {
  children: ReactNode;
  tone?: "neutral" | "error";
}) {
  return (
    <Alert variant={tone === "error" ? "destructive" : "default"} role={role ?? (tone === "error" ? "alert" : "status")} {...props}>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
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
  const fee = networkFeeErrorMessage(error);
  if (fee) return fee;
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
