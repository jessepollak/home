"use client";

import { useEffect, useRef, useState } from "react";
import { LoadErrorCard } from "@/components/load-error";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { dataOwnerKey as ownerDataKey } from "@/client/account/owner-keys";
import { useMoneyActionOutcome } from "@/client/actions/money-action-outcome";
import { openPanelAfterClose, useOptionalHomeShellRouting } from "@/client/home/panel-routing";
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
  MoneyResult,
  MoneyResultFooter,
  decimalFromBaseUnits,
  amountExceedsCeiling,
  isPositiveDecimalAmount,
  useMoneyAssetPricing,
} from "@/client/money-modal";
import {
  browserHomeQueryClient,
  ownerQueryKey,
  useHomeQueryClient,
} from "@/client/query/query-client";
import type { RegionId } from "@/config/regions";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { BorrowAssetRef, BorrowMarketId } from "@/shared/borrowing/config";
import type { BorrowMarketSnapshot } from "@/shared/borrowing/contract";
import type { BorrowOperation } from "@/shared/borrowing/types";
import {
  formatExactPresentationTokenAmount,
  formatWadPercent,
} from "@/shared/formatting";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { networkFeeErrorMessage } from "@/shared/money-actions/network-fee";
import { TransferExecutionError } from "@/shared/transfers/types";
import { maxAmountAfterNetworkFee, useNetworkFeeReserve } from "@/client/money-modal/network-fee-policy";
import { buildBorrowPreparedIntent } from "./borrow-ui";
import {
  BorrowNotice,
  collateralDisplayName,
  LiquidationBufferMeter,
  formatToken,
  openingBorrowAvailableBaseUnits,
  presentBorrowAssetMark,
  recommendedOpeningCollateralBaseUnits,
  recommendedRepayMaximumBaseUnits,
} from "./borrowing-experience";

type PrepareMoneyAction = AccountWalletClient["prepareMoneyAction"];
type ExecuteMoneyAction = AccountWalletClient["executeMoneyAction"];
type FetchAccountResource = AccountWalletClient["fetchAccountResource"];
type ResultSubmission = "submitted" | "ambiguous" | "failed";

const operationLabels: Record<BorrowOperation, string> = {
  "supply-collateral": "Add collateral",
  borrow: "Borrow",
  "supply-and-borrow": "Borrow",
  repay: "Repay",
  "repay-all": "Repay all",
  "withdraw-collateral": "Withdraw collateral",
  "close-position": "Close position",
};

export function BorrowMoneyDialog({
  session,
  snapshot,
  operation,
  fetchAccountResource,
  prepareMoneyAction,
  executeMoneyAction,
  regionId,
  onClose,
  onClosed,
  onLeave,
  assetMarkResolution,
  open = true,
}: {
  session: VerifiedAccountSession;
  snapshot: BorrowMarketSnapshot;
  operation: BorrowOperation;
  fetchAccountResource?: FetchAccountResource;
  prepareMoneyAction: PrepareMoneyAction;
  executeMoneyAction: ExecuteMoneyAction;
  regionId: RegionId;
  onClose: () => void;
  onClosed?: () => void;
  onLeave?: () => void;
  assetMarkResolution?: AssetMarkResolution;
  open?: boolean;
}) {
  const queryClient = useHomeQueryClient(browserHomeQueryClient());
  const routing = useOptionalHomeShellRouting();
  const dataOwnerKey = ownerDataKey(session);
  const closesWithoutDebt = operation === "close-position" && BigInt(snapshot.position.debtAssetsRaw) === BigInt(0);
  const fixedMaximumOperation = operation === "repay-all" || (operation === "close-position" && !closesWithoutDebt);
  const repayOperation = operation === "repay" || fixedMaximumOperation;
  const primaryAsset = selectPrimaryBorrowAsset(snapshot, operation);
  const { reserve, failed: reserveFailed, retry: retryReserve } = useNetworkFeeReserve(session.smartAccount ? dataOwnerKey : null, fetchAccountResource, open);
  const reserveRelevant = (repayOperation && snapshot.market.loanToken.symbol.toUpperCase() === "USDC") || (operation === "supply-collateral" && primaryAsset.symbol.toUpperCase() === "USDC");
  const reservePendingForRepay = repayOperation && snapshot.market.loanToken.symbol.toUpperCase() === "USDC" && reserve === undefined;
  const ceilingPending = reserveRelevant && reserve === undefined;
  const repayWalletBaseUnits = maxAmountAfterNetworkFee(snapshot.wallet.loanBalanceRaw, snapshot.market.loanToken.symbol, reserve) ?? "0";
  const maximumRepayBaseUnits = repayOperation && !reservePendingForRepay
    ? recommendedRepayMaximumBaseUnits(snapshot.position.debtAssetsRaw, repayWalletBaseUnits, snapshot.state.borrowRatePerSecondWad)
    : null;
  const initialAmount = fixedMaximumOperation && maximumRepayBaseUnits && maximumRepayBaseUnits !== "0"
    ? decimalFromBaseUnits(maximumRepayBaseUnits, snapshot.market.loanToken.decimals) ?? ""
    : "";
  const primaryPricing = useMoneyAssetPricing(primaryAsset.symbol);
  const primaryAssetMark = presentBorrowAssetMark(primaryAsset, assetMarkResolution);
  function changeAmount(value: string) {
    setAmount(value);
  }
  const [amount, setAmount] = useState(initialAmount);
  const maximumFilled = useRef(initialAmount !== "");
  useEffect(() => {
    if (maximumFilled.current || !fixedMaximumOperation || !maximumRepayBaseUnits || maximumRepayBaseUnits === "0") return;
    maximumFilled.current = true;
    setAmount((current) => current === "" ? decimalFromBaseUnits(maximumRepayBaseUnits, snapshot.market.loanToken.decimals) ?? "" : current);
  }, [fixedMaximumOperation, maximumRepayBaseUnits, snapshot.market.loanToken.decimals]);
  const [preparedAction, setPreparedAction] = useState<PreparedMoneyAction | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [serverExpiredActionId, setServerExpiredActionId] = useState<string | null>(null);
  const [step, setStep] = useState<"amount" | "confirm" | "pending" | "error" | "result">("amount");
  const [submission, setSubmission] = useState<ResultSubmission | null>(null);
  const [submittedAt, setSubmittedAt] = useState<string | undefined>(undefined);
  const confirming = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const title = step === "amount" || step === "result" ? operationLabels[operation] : "Confirm";
  const requiresPrimaryAmount = !closesWithoutDebt;
  const openingCollateralBaseUnits = operation === "supply-and-borrow" && isPositiveDecimalAmount(amount)
    ? openingCollateralForDecimalAmount(snapshot, amount)
    : null;
  const preparedExpiresAt = preparedAction ? Date.parse(preparedAction.expiresAt) : Number.POSITIVE_INFINITY;
  const preparedExpired = Boolean(preparedAction && (
    serverExpiredActionId === preparedAction.id ||
    !Number.isFinite(preparedExpiresAt) ||
    preparedExpiresAt <= clockNow
  ));

  useEffect(() => {
    if (!preparedAction || !Number.isFinite(preparedExpiresAt) || preparedExpiresAt <= clockNow) return;
    const delay = Math.max(0, preparedExpiresAt - Date.now() + 1);
    if (delay > 2_147_000_000) return;
    const timer = window.setTimeout(() => setClockNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [clockNow, preparedAction, preparedExpiresAt]);

  function goBack() {
    setPreparedAction(null);
    setSubmission(null);
    setSubmittedAt(undefined);
    setServerExpiredActionId(null);
    setAttempted(false);
    setError(null);
    setStep("amount");
  }

  async function prepare() {
    try {
      const amountBaseUnits = requiresPrimaryAmount ? parseClientTokenAmount(amount, primaryAsset.decimals) : undefined;
      const collateralAmountBaseUnits = operation === "supply-and-borrow"
        ? recommendedOpeningCollateralBaseUnits(snapshot, amountBaseUnits ?? "0")
        : undefined;
      if (operation === "supply-and-borrow" && collateralAmountBaseUnits === null) {
        throw new BorrowActionClientError(`That amount needs more ${snapshot.market.collateralToken.symbol} than is currently available in this wallet.`);
      }
      const intent = buildBorrowPreparedIntent({
        snapshot,
        operation,
        amountBaseUnits,
        collateralAmountBaseUnits: collateralAmountBaseUnits ?? undefined,
        maximumRepayBaseUnits: maximumRepayBaseUnits ?? undefined,
      });
      setError(null);
      setStep("pending");
      const action = await prepareMoneyAction(intent.kind, intent.params);
      if (!preparedActionMatches(action, session, snapshot.market.id, intent.kind, intent.operation)) {
        throw new BorrowActionClientError("The prepared action did not match this verified account and Borrow market.");
      }
      setPreparedAction(action);
      setClockNow(() => Date.now());
      setServerExpiredActionId(null);
      setAttempted(false);
      setStep("confirm");
    } catch (caught) {
      setPreparedAction(null);
      setError(readableResourceError(caught));
      setStep("amount");
    }
  }

  async function confirm() {
    if (!preparedAction || step === "pending" || confirming.current) return;
    confirming.current = true;
    setError(null);
    setStep("pending");
    try {
      const result = await executeMoneyAction(preparedAction);
      setAttempted(true);
      if (result.status === "rejected") {
        setError("The wallet request was rejected.");
        setStep("error");
        return;
      }
      if (result.status === "failed") {
        setSubmission("failed");
        setStep("result");
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ownerQueryKey(dataOwnerKey, "borrow") });
      setSubmittedAt(new Date().toISOString());
      setSubmission("submitted");
      setStep("result");
    } catch (caught) {
      if (caught instanceof TransferExecutionError && caught.reason === "submission-unknown") {
        setSubmission("ambiguous");
        setStep("result");
        return;
      }
      if (errorCode(caught) === "ACTION_EXPIRED") {
        setAttempted(false);
        setServerExpiredActionId(preparedAction.id);
        setError("This Borrow review expired. Go back and prepare it again.");
      } else {
        setAttempted(true);
        setError("The dispatch outcome is unresolved. Retry recording this same action; a new dispatch will not be created.");
      }
      setStep("confirm");
    } finally {
      confirming.current = false;
    }
  }

  const availableBaseUnits = operation === "supply-and-borrow"
    ? openingBorrowAvailableBaseUnits(snapshot)
    : operation === "supply-collateral"
      ? snapshot.wallet.collateralBalanceRaw
      : operation === "withdraw-collateral"
        ? snapshot.position.withdrawableCollateralRaw
        : repayOperation
          ? maximumRepayBaseUnits
          : snapshot.position.borrowCapacityAssetsRaw;
  const maxBaseUnits = operation === "supply-collateral" ? maxAmountAfterNetworkFee(availableBaseUnits, primaryAsset.symbol, reserve) : availableBaseUnits;
  const availableAmount = availableBaseUnits === null ? null : decimalFromBaseUnits(maxBaseUnits ?? "0", primaryAsset.decimals);
  const availableLabel = availableBaseUnits === null ? undefined : `${formatToken(availableBaseUnits, primaryAsset, regionId)} available`;
  const overAvailable = !ceilingPending && availableAmount !== null && amountExceedsCeiling(amount, availableAmount);
  const continueDisabled = ceilingPending || (requiresPrimaryAmount && !isPositiveDecimalAmount(amount)) || (operation === "supply-and-borrow" && isPositiveDecimalAmount(amount) && !openingCollateralBaseUnits) || (requiresPrimaryAmount && overAvailable);
  const amountAssetProps = {
    assetId: primaryAsset.id,
    assetLabel: primaryAsset.symbol,
    assetCurrency: primaryAssetMark.currency,
    assetMark: primaryAssetMark,
    locked: true,
  };

  return (
    <MoneyModal open={open} labelledBy="borrow-action-title" pending={step === "pending"} onCancel={onClose} onClose={onClosed ?? onClose}>
      <MoneyModalHeader
        title={title}
        titleId="borrow-action-title"
        {...(step === "amount"
          ? closesWithoutDebt ? {} : { assetControl: <MoneyAssetPicker {...amountAssetProps} /> }
          : step === "pending" || step === "result" ? {} : { onBack: goBack })}
        onClose={onClose}
        closeLabel="Close Borrow action"
      />
      {step === "result" && preparedAction && submission ? <BorrowResult action={preparedAction} submission={submission} submittedAt={submittedAt} snapshot={snapshot} operation={operation} fetchAccountResource={fetchAccountResource} onClose={onClose} onTryAgain={goBack} onViewActivity={() => openPanelAfterClose(routing, "activity", () => { onLeave?.(); onClose(); })} /> : <MoneyModalBody hasFooter={step !== "pending" || Boolean(preparedAction)} className="gap-4 pt-4">
        {step === "amount" ? (
          <>
            {closesWithoutDebt ? (
              <MoneyConfirmSummary amount={formatToken(snapshot.position.collateralRaw, snapshot.market.collateralToken, regionId)} lead="Withdraw all collateral" rows={[{ label: "Debt", value: "No debt" }]} />
            ) : (
              <>
                <MoneyAmountDisplay
                  amount={amount}
                  maxDecimals={primaryAsset.decimals}
                  onAmountChange={changeAmount}
                  overAvailable={overAvailable}
                  onSubmit={continueDisabled ? undefined : () => void prepare()}
                  availableLabel={availableLabel}
                  availableAmount={availableAmount}
                  assetId={primaryAsset.id}
                  assetLabel={primaryAsset.symbol}
                  assetCurrency={primaryAssetMark.currency}
                  assetControl="header"
                  chipSet={availableBaseUnits === null ? "none" : "max"}
                  pricing={primaryPricing}
                  nativeSymbol={primaryAsset.symbol}
                >
                {reserveRelevant && reserveFailed ? (
                  <LoadErrorCard tone="destructive" role="alert" title="Couldn't check the network fee." onRetry={retryReserve} />
                ) : null}
                {operation === "supply-and-borrow" ? (
                  <div className="min-h-[4.5rem] rounded-lg border bg-muted/40 px-3 py-2 text-sm" data-testid="borrow-collateral-preview">
                    <p className="font-medium">{collateralDisplayName(snapshot.market.id)} collateral</p>
                    <p className="text-muted-foreground">
                      {openingCollateralBaseUnits
                        ? `This borrow will lock ${formatToken(openingCollateralBaseUnits, snapshot.market.collateralToken, regionId)} as collateral.`
                        : isPositiveDecimalAmount(amount)
                          ? `That amount needs more ${snapshot.market.collateralToken.symbol} than is available in this wallet.`
                          : `Enter an amount to preview the ${snapshot.market.collateralToken.symbol} that will be locked.`}
                    </p>
                  </div>
                ) : null}
                {fixedMaximumOperation || isFullRepayAmount(amount, snapshot.position.debtAssetsRaw, maximumRepayBaseUnits, snapshot.market.loanToken.decimals) ? (
                  <BorrowNotice title="Maximum repayment">
                    Current debt is {formatToken(snapshot.position.debtAssetsRaw, snapshot.market.loanToken, regionId)}. The actual repayment is determined by current borrow shares and cannot exceed the amount you review.
                  </BorrowNotice>
                ) : null}
                </MoneyAmountDisplay>
              </>
            )}
          </>
        ) : null}

        {preparedAction && step !== "amount" && step !== "result" ? <BorrowPreparedReview action={preparedAction} snapshot={snapshot} regionId={regionId} /> : null}
        {step === "pending" && !preparedAction ? <BorrowNotice title="Preparing Borrow review…" /> : null}
        {error ? <BorrowNotice tone="error" role="alert" title="Borrow action unavailable">{error}</BorrowNotice> : null}
        {preparedExpired && !attempted && step === "confirm" && !error ? (
          <BorrowNotice tone="error" role="alert" title="Borrow review expired">Go back and prepare this action again.</BorrowNotice>
        ) : null}
      </MoneyModalBody>}
      {step === "amount" ? (
        <MoneyModalFooter
          primaryLabel="Continue"
          primaryDisabled={continueDisabled}
          onPrimary={() => void prepare()}
        />
      ) : null}
      {(step === "confirm" || step === "pending") && preparedAction ? <MoneyConfirmFooter action={preparedAction} actionExpired={preparedExpired} submitting={step === "pending"} primaryLabel={attempted ? "Retry" : "Confirm action"} primaryDisabled={preparedExpired && !attempted} onPrimary={() => void confirm()} secondaryLabel="Back" onSecondary={goBack} /> : null}
      {step === "error" ? <MoneyModalFooter primaryLabel="Back" onPrimary={goBack} secondaryLabel="Close" onSecondary={onClose} /> : null}
    </MoneyModal>
  );
}

function BorrowResult({ action, submission, submittedAt, snapshot, operation, fetchAccountResource, onClose, onTryAgain, onViewActivity }: {
  action: PreparedMoneyAction;
  submission: ResultSubmission;
  submittedAt?: string;
  snapshot: BorrowMarketSnapshot;
  operation: BorrowOperation;
  fetchAccountResource?: FetchAccountResource;
  onClose: () => void;
  onTryAgain: () => void;
  onViewActivity: () => void;
}) {
  const { outcome } = useMoneyActionOutcome({
    action,
    submission,
    fetchOperations: (signal) => fetchAccountResource
      ? fetchAccountResource("/api/actions", { signal })
      : Promise.reject(new Error("Actions are unavailable.")),
  });
  return <>
    <MoneyModalBody hasFooter className="gap-4 pt-4"><MoneyResult kind={operation} outcome={outcome} amount={borrowReviewAmount(action, snapshot)} submittedAt={submittedAt} /></MoneyModalBody>
    <MoneyResultFooter outcome={outcome} onDone={onClose} onTryAgain={onTryAgain} onViewActivity={onViewActivity} />
  </>;
}

export function selectPrimaryBorrowAsset(
  snapshot: BorrowMarketSnapshot,
  operation: BorrowOperation,
): BorrowAssetRef {
  const closesWithoutDebt = operation === "close-position" && BigInt(snapshot.position.debtAssetsRaw) === BigInt(0);
  return operation === "supply-collateral" || operation === "withdraw-collateral" || closesWithoutDebt
    ? snapshot.market.collateralToken
    : snapshot.market.loanToken;
}

function borrowReviewAmount(action: PreparedMoneyAction, snapshot: BorrowMarketSnapshot): string {
  const primary = action.amounts.find((entry) => entry.assetId === snapshot.market.loanToken.id && entry.direction === "receive") ??
    action.amounts.find((entry) => !entry.maximum) ?? action.amounts[0];
  return primary
    ? `${primary.maximum ? "Up to " : ""}${formatExactPresentationTokenAmount(primary.amountBaseUnits, primary.decimals, primary.symbol)}`
    : action.title;
}

function BorrowPreparedReview({ action, snapshot, regionId }: { action: PreparedMoneyAction; snapshot: BorrowMarketSnapshot; regionId: RegionId }) {
  const metadata = action.metadata?.product === "borrow" ? action.metadata : null;
  const amount = borrowReviewAmount(action, snapshot);
  const movementRows = action.amounts.map((entry) => {
    const suppliedCollateral = entry.direction === "spend" && entry.assetId === metadata?.collateralAsset.id &&
      (metadata.operation === "supply-collateral" || metadata.operation === "supply-and-borrow");
    return {
      label: `${entry.maximum ? "Maximum repayment" : suppliedCollateral ? "Locked as collateral" : entry.direction === "spend" ? "You spend" : "You receive"} (${entry.symbol})`,
      value: `${entry.estimated ? "Estimated " : ""}${formatExactPresentationTokenAmount(entry.amountBaseUnits, entry.decimals, entry.symbol)}`,
    };
  });
  return (
    <div className="space-y-3">
      <div className="min-w-0 [&_[data-slot=money-ticker]]:overflow-x-auto [&_dd]:wrap-anywhere">
        <MoneyConfirmSummary action={action}
          amount={amount}
          lead={action.title}
          rows={[
            moneyConfirmFromRow(action.owner),
            ...movementRows,
            { label: "Variable rate", value: formatWadPercent(metadata?.borrowAprWad ?? snapshot.state.borrowAprWad, regionId) },
            { label: "Network", value: "Base" },
          ]}
        />
      </div>
      {metadata?.projectedHealthFactorWad ? (
        <LiquidationBufferMeter
          healthFactorWad={metadata.projectedHealthFactorWad}
          liquidationPriceRaw={metadata.projectedLiquidationPriceRaw}
          market={snapshot.market}
          regionId={regionId}
        />
      ) : null}
      {action.warnings.length > 0 ? (
        <BorrowNotice title="Review warnings">
          <ul className="list-disc space-y-1 pl-4">
            {action.warnings.map((warning, index) => <li key={`${index}:${warning}`}>{warning}</li>)}
          </ul>
        </BorrowNotice>
      ) : null}
    </div>
  );
}

function openingCollateralForDecimalAmount(snapshot: BorrowMarketSnapshot, amount: string): string | null {
  try {
    return recommendedOpeningCollateralBaseUnits(snapshot, parseClientTokenAmount(amount, snapshot.market.loanToken.decimals));
  } catch {
    return null;
  }
}

export function parseClientTokenAmount(value: string, decimals: number): string {
  const normalized = value.trim().replace(/\.$/, "");
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) throw new BorrowActionClientError("Enter a positive decimal amount.");
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) throw new BorrowActionClientError(`This asset supports at most ${decimals} decimal places.`);
  const amount = BigInt(whole) * (BigInt(10) ** BigInt(decimals)) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (amount <= BigInt(0)) throw new BorrowActionClientError("Amount must be greater than zero.");
  return amount.toString(10);
}

function preparedActionMatches(action: PreparedMoneyAction, session: VerifiedAccountSession, marketId: BorrowMarketId, kind: PreparedMoneyAction["kind"], operation: BorrowOperation): boolean {
  return Boolean(session.smartAccount && action.kind === kind && action.owner.subject === session.user.subject &&
    action.owner.accountProvider === session.accountProvider &&
    action.owner.address.toLowerCase() === session.smartAccount.address.toLowerCase() &&
    action.metadata?.product === "borrow" && action.metadata.operation === operation &&
    action.metadata.marketId.toLowerCase() === marketId.toLowerCase());
}

function readableResourceError(error: unknown): string {
  const fee = networkFeeErrorMessage(error);
  if (fee) return fee;
  if (error instanceof BorrowActionClientError) return error.message;
  const code = errorCode(error);
  const status = isRecord(error) && typeof error.status === "number" ? error.status : null;
  const serverMessage = isRecord(error) && typeof error.serverMessage === "string" ? error.serverMessage : null;
  const policyStatus: Record<string, number> = { LIMIT_EXCEEDED: 409, INVALID_INPUT: 400, UNSUPPORTED_MARKET: 400, SIMULATION_FAILED: 400 };
  if (code && policyStatus[code] === status) {
    if (serverMessage && isSafePrepareMessage(serverMessage)) return `${serverMessage} No transaction was submitted.`;
    if (code === "INVALID_INPUT") return "Enter valid positive amounts for this Borrow action. No transaction was submitted.";
    if (code === "LIMIT_EXCEEDED") return "That amount exceeds the current verified wallet, position, liquidity, or Home policy limit. No transaction was submitted.";
    if (code === "UNSUPPORTED_MARKET") return "This Borrow market no longer has a verified supported action route. No transaction was submitted.";
    return "The Base simulation could not verify this Borrow action. No transaction was submitted.";
  }
  return "Borrow action preparation is temporarily unavailable. No transaction was submitted.";
}

function isFullRepayAmount(amount: string, debtBaseUnits: string, maximumRepayBaseUnits: string | null, decimals: number): boolean {
  if (!maximumRepayBaseUnits || BigInt(maximumRepayBaseUnits) < BigInt(debtBaseUnits)) return false;
  try {
    return BigInt(parseClientTokenAmount(amount, decimals)) >= BigInt(debtBaseUnits);
  } catch {
    return false;
  }
}

function errorCode(error: unknown): string | null {
  return isRecord(error) && typeof error.code === "string" ? error.code : null;
}

function isSafePrepareMessage(message: string): boolean {
  return message.length > 0 && message.length <= 240 && !/[<>]/.test(message) && !/https?:\/\//i.test(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class BorrowActionClientError extends Error {}
