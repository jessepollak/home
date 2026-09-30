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
  MoneyModalStep,
  useMoneyModalExit,
  useMoneyModalPending,
  MoneyResult,
  MoneyResultFooter,
  decimalFromBaseUnits,
  amountExceedsCeiling,
  isPositiveDecimalAmount,
  useMoneyAmountUnit,
  maxAmountAfterNetworkFee,
  useNetworkFeeReserve,
  type MoneyAssetPrice,
} from "@/client/money-modal";
import {
  browserHomeQueryClient,
  ownerQueryKey,
  useHomeQueryClient,
} from "@/client/query/query-client";
import type { RegionId } from "@/config/regions";
import { verifiedCashCurrency } from "@/config/portfolio-assets";
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
import { borrowOperationLabels, buildBorrowPreparedIntent } from "./borrow-ui";
import {
  BorrowNotice,
  LiquidationBufferMeter,
  formatToken,
  formatCash,
  openingBorrowAvailableBaseUnits,
  presentBorrowAssetMark,
  recommendedOpeningCollateralBaseUnits,
  recommendedRepayMaximumBaseUnits,
} from "./borrowing-experience";

type PrepareMoneyAction = AccountWalletClient["prepareMoneyAction"];
type ExecuteMoneyAction = AccountWalletClient["executeMoneyAction"];
type FetchAccountResource = AccountWalletClient["fetchAccountResource"];
type ResultSubmission = "submitted" | "ambiguous" | "failed";

type BorrowMoneyFlowProps = {
  session: VerifiedAccountSession;
  snapshot: BorrowMarketSnapshot;
  operation: BorrowOperation;
  fetchAccountResource?: FetchAccountResource;
  prepareMoneyAction: PrepareMoneyAction;
  executeMoneyAction: ExecuteMoneyAction;
  regionId: RegionId;
  onLeave?: () => void;
  assetMarkResolution?: AssetMarkResolution;
  open?: boolean;
  depth?: number;
  onBack?: () => void;
  onDone?: () => void;
};

export function BorrowMoneyDialog({ onClose, onClosed, ...props }: BorrowMoneyFlowProps & { onClose: () => void; onClosed?: () => void }) {
  return <MoneyModal open={props.open ?? true} labelledBy="borrow-action-title" onCancel={onClose} onClose={onClosed ?? onClose}>
    <BorrowMoneyFlow {...props} />
  </MoneyModal>;
}

export function BorrowMoneyFlow({
  session,
  snapshot,
  operation,
  fetchAccountResource,
  prepareMoneyAction,
  executeMoneyAction,
  regionId,
  onLeave,
  assetMarkResolution,
  open = true,
  depth = 0,
  onBack,
  onDone,
}: BorrowMoneyFlowProps) {
  const exit = useMoneyModalExit();
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
  const loanCurrency = verifiedCashCurrency(snapshot.market.loanToken.address);
  const oraclePrice = snapshot.state.oraclePriceRaw;
  const oracleScale = 36 + snapshot.market.loanToken.decimals - snapshot.market.collateralToken.decimals;
  const collateralPrice: MoneyAssetPrice | null = primaryAsset.id === snapshot.market.collateralToken.id && loanCurrency && oraclePrice !== "0"
    ? { currency: loanCurrency, perUnit: oracleScale >= 0
      ? { atoms: oraclePrice, scale: oracleScale }
      : { atoms: (BigInt(oraclePrice) * BigInt(10) ** BigInt(-oracleScale)).toString(), scale: 0 } }
    : null;
  const primaryUnit = useMoneyAmountUnit(verifiedCashCurrency(primaryAsset.address), collateralPrice, regionId);
  const primaryAssetMark = presentBorrowAssetMark(primaryAsset, assetMarkResolution);
  const prepareGeneration = useRef(0);
  function changeAmount(value: string) {
    prepareGeneration.current += 1;
    setAmount(value);
  }
  useEffect(() => () => { prepareGeneration.current += 1; }, [dataOwnerKey, snapshot.market.id, operation]);
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
  const inFlight = useRef(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  useMoneyModalPending(step === "pending" || preparing);
  const title = step === "amount" || step === "result" ? borrowOperationLabels[operation] : "Confirm";
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
    const timer = window.setTimeout(() => setClockNow(Date.now()), Math.max(delay, 1));
    return () => window.clearTimeout(timer);
  }, [clockNow, preparedAction, preparedExpiresAt]);

  function goBack() {
    prepareGeneration.current += 1;
    setPreparedAction(null);
    setSubmission(null);
    setSubmittedAt(undefined);
    setServerExpiredActionId(null);
    setAttempted(false);
    setError(null);
    setStep("amount");
  }

  async function prepare() {
    if (inFlight.current) return;
    inFlight.current = true;
    const generation = ++prepareGeneration.current;
    setPreparing(true);
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
      const outcome = await prepareMoneyAction(intent.kind, intent.params).then((prepared) => ({ prepared }), (failure: unknown) => ({ failure }));
      if (generation !== prepareGeneration.current) return;
      if ("failure" in outcome) throw outcome.failure;
      const action = outcome.prepared;
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
    } finally {
      inFlight.current = false;
      setPreparing(false);
    }
  }

  async function confirm() {
    if (!preparedAction || step === "pending" || inFlight.current) return;
    inFlight.current = true;
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
      if (caught instanceof TransferExecutionError && (caught.reason === "submission-unknown" || caught.reason === "dispatch-unknown")) {
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
      inFlight.current = false;
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
  const availableLabel = availableBaseUnits === null ? undefined : `${formatCash(availableBaseUnits, primaryAsset, regionId)} available`;
  const overAvailable = !ceilingPending && availableAmount !== null && amountExceedsCeiling(amount, availableAmount);
  const insufficientCollateral = operation === "supply-and-borrow" && isPositiveDecimalAmount(amount) && !openingCollateralBaseUnits;
  const continueDisabled = ceilingPending || (requiresPrimaryAmount && !isPositiveDecimalAmount(amount)) || insufficientCollateral || (requiresPrimaryAmount && overAvailable);
  const amountAssetProps = {
    assetId: primaryAsset.id,
    assetLabel: primaryAsset.symbol,
    assetCurrency: primaryAssetMark.currency,
    assetMark: primaryAssetMark,
    locked: true,
  };

  return (
    <MoneyModalStep step={step === "amount" ? "amount" : step === "result" ? "result" : "review"} depth={depth + (step === "amount" ? 0 : step === "result" ? 2 : 1)}>
      <MoneyModalHeader
        title={title}
        titleId="borrow-action-title"
        {...(step === "amount"
          ? onBack ? { onBack, backDisabled: preparing } : closesWithoutDebt ? {} : { assetControl: <MoneyAssetPicker {...amountAssetProps} /> }
          : step === "pending" || step === "result" ? {} : { onBack: goBack })}
        closeLabel="Close Borrow action"
      />
      {step === "result" && preparedAction && submission ? <BorrowResult action={preparedAction} submission={submission} submittedAt={submittedAt} snapshot={snapshot} operation={operation} fetchAccountResource={fetchAccountResource} onClose={onDone ?? exit} onTryAgain={goBack} onViewActivity={() => openPanelAfterClose(routing, "activity", () => { onLeave?.(); exit(); })} /> : <MoneyModalBody hasFooter className="gap-4 pt-4">
        {step === "amount" ? (
          <>
            {closesWithoutDebt ? (
              <MoneyConfirmSummary amount={formatToken(snapshot.position.collateralRaw, snapshot.market.collateralToken, regionId)} lead="Withdraw all collateral" rows={[{ label: "Debt", value: "No debt" }]} />
            ) : (
              <MoneyAmountDisplay
                amount={amount}
                maxDecimals={primaryAsset.decimals}
                onAmountChange={changeAmount}
                readOnly={preparing}
                overAvailable={overAvailable}
                amountError={insufficientCollateral ? `That amount needs more ${snapshot.market.collateralToken.symbol} than is available in this wallet.` : undefined}
                onSubmit={continueDisabled || preparing ? undefined : () => void prepare()}
                availableLabel={availableLabel}
                availableAmount={availableAmount}
                assetId={primaryAsset.id}
                assetLabel={primaryAsset.symbol}
                assetCurrency={primaryAssetMark.currency}
                assetControl={onBack ? "body" : "header"}
                assetLocked={Boolean(onBack)}
                chipSet={availableBaseUnits === null ? "none" : "max"}
                unit={primaryUnit}
                nativeSymbol={primaryAsset.symbol}
              >
                {reserveRelevant && reserveFailed ? (
                  <LoadErrorCard tone="destructive" role="alert" title="Couldn't check the network fee." onRetry={retryReserve} />
                ) : null}
                {fixedMaximumOperation || isFullRepayAmount(amount, snapshot.position.debtAssetsRaw, maximumRepayBaseUnits, snapshot.market.loanToken.decimals) ? (
                  <BorrowNotice title="Maximum repayment">
                    Current debt is {formatToken(snapshot.position.debtAssetsRaw, snapshot.market.loanToken, regionId)}. The actual repayment is determined by current borrow shares and cannot exceed the amount you review.
                  </BorrowNotice>
                ) : null}
              </MoneyAmountDisplay>
            )}
          </>
        ) : null}

        {preparedAction && step !== "amount" && step !== "result" ? <BorrowPreparedReview action={preparedAction} snapshot={snapshot} regionId={regionId} /> : null}
        {error ? <BorrowNotice tone="error" role="alert" title="Borrow action unavailable">{error}</BorrowNotice> : null}
        {preparedExpired && !attempted && step === "confirm" && !error ? (
          <BorrowNotice tone="error" role="alert" title="Borrow review expired">Go back and prepare this action again.</BorrowNotice>
        ) : null}
      </MoneyModalBody>}
      {step === "amount" ? (
        <MoneyModalFooter
          primaryLabel="Continue"
          primaryDisabled={continueDisabled}
          primaryLoading={preparing}
          onPrimary={() => void prepare()}
        />
      ) : null}
      {(step === "confirm" || step === "pending") && preparedAction ? <MoneyConfirmFooter action={preparedAction} actionExpired={preparedExpired} submitting={step === "pending"} primaryLabel={attempted ? "Retry" : "Confirm action"} primaryDisabled={preparedExpired && !attempted} onPrimary={() => void confirm()} secondaryLabel="Back" onSecondary={goBack} /> : null}
      {step === "error" ? <MoneyModalFooter primaryLabel="Back" onPrimary={goBack} secondaryLabel="Close" onSecondary={exit} /> : null}
    </MoneyModalStep>
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
      <div className="min-w-0 [&_dd]:wrap-anywhere">
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
            {[...new Set(action.warnings)].map((warning) => <li key={warning}>{warning}</li>)}
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
