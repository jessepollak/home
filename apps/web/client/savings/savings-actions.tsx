"use client";

import { useId, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { SavingsManagementSheet, formatWadPercent, type SavingsManagement } from "@/client/cash/savings-management";
import { Card, CardContent } from "@/components/ui/card";
import { AssetRow } from "@/components/finance-rows";
import { CircleAlertIcon, PiggyBank } from "lucide-react";
import { Alert, AlertIcon, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { MoneyMotionProvider } from "@/components/money-ticker";
import { useReactiveExpiry } from "@/client/actions/expiry";
import { useMoneyActionOutcome } from "@/client/actions/money-action-outcome";
import { recentActionsPath } from "@/client/actions/recent-actions-query";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { openPanelAfterClose, useOptionalHomeShellRouting } from "@/client/home/panel-routing";
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
  MoneyModalStep,
  decimalFromBaseUnits,
  isPositiveDecimalAmount,
  useMoneyAmountUnit,
  useMoneyModalExit,
  useMoneyModalPending,
  MoneyResult,
  MoneyResultFooter,
  maxAmountAfterNetworkFee,
  useNetworkFeeReserve,
} from "@/client/money-modal";
import type {
  MoneyActionOwner,
  OperationResult,
  PreparedMoneyAction,
} from "@/shared/money-actions/types";
import { parseUsdcAmount } from "@/client/savings/format";
import { networkFeeErrorMessage } from "@/shared/money-actions/network-fee";
import { reportClientError } from "@/client/observability/client-reporter";
import { TransferExecutionError } from "@/shared/transfers/types";
import {
  formatPresentationDate,
  formatPresentationPercentage,
  formatUsdStablecoinAmount,
} from "@/shared/formatting";
import {
  readSavingsPreparedReview,
  type SavingsPreparedReview,
} from "@/shared/savings/review";
import type { MorphoVaultCandidate } from "@/shared/savings/types";
import { verifiedCashCurrency } from "@/config/portfolio-assets";
import { useSavingsDialogFixture } from "./savings-dialog-fixture";

export type SavingsActionMode = "deposit" | "withdraw";

export type SavingsJourneyEntry = "management" | "amount";

export type SavingsJourneyProps = {
  opener?: HTMLElement | null;
  open: boolean;
  entry: SavingsJourneyEntry;
  management: SavingsManagement | null;
  titleId?: string;
  mode: SavingsActionMode | null;
  session: VerifiedAccountSession;
  candidate: MorphoVaultCandidate | null;
  picker?: {
    options: { candidate: MorphoVaultCandidate; name: string; rateLabel: string; disabled: boolean }[];
    cash: "ready" | "empty" | "unavailable";
    onPick: (candidate: MorphoVaultCandidate) => void;
    onBack: () => void;
    onAddMoney: () => void;
    onRetryBalances?: () => void;
    onRetryVaults?: () => void;
  };
  availableLabel?: string;
  destinationLabel?: string;
  historyBlocked?: boolean;
  availableBaseUnits?: string | null;
  availableStale?: boolean;
  fetchAccountResource?: AccountWalletClient["fetchAccountResource"];
  prepareMoneyAction: AccountWalletClient["prepareMoneyAction"];
  executeMoneyAction: AccountWalletClient["executeMoneyAction"];
  onSelectMode: (mode: SavingsActionMode, candidate: MorphoVaultCandidate) => void;
  onBackToManagement: () => void;
  onClose: () => void;
  onClosed?: () => void;
  onConfirmed?: (result: OperationResult) => void | Promise<void>;
};

export type SavingsMoneyFlowProps = Pick<SavingsJourneyProps, "session" | "availableLabel" | "availableBaseUnits" | "availableStale" | "historyBlocked" | "fetchAccountResource" | "prepareMoneyAction" | "executeMoneyAction" | "onConfirmed"> & {
  mode: SavingsActionMode;
  candidate: MorphoVaultCandidate;
  depth?: number;
  onBack?: () => void;
  onDone?: () => void;
};

type DialogStep = "amount" | "confirm" | "pending" | "error" | "result";
type Submission = "submitted" | "ambiguous" | "failed";

export function SavingsJourney(props: SavingsJourneyProps) {
  const candidate = props.candidate ?? props.picker?.options[0]?.candidate ?? null;
  return <OwnerBoundSavingsJourney key={savingsDialogOwnerIdentity(props.session)} {...props} candidate={candidate} pickerOpen={props.candidate === null} />;
}

/** @public Embeddable Save deposit and withdrawal steps for a MoneyModal host. */
export function SavingsMoneyFlow({ depth = 0, onBack, onDone, ...props }: SavingsMoneyFlowProps) {
  const exit = useMoneyModalExit();
  return <OwnerBoundSavingsJourney key={savingsDialogOwnerIdentity(props.session)} {...props} open entry={onBack ? "management" : "amount"}
    management={null} pickerOpen={false} onSelectMode={() => {}} onBackToManagement={onBack ?? (() => {})} onClose={onDone ?? exit} embeddedDepth={depth} />;
}

function OwnerBoundSavingsJourney({
  open,
  opener = null,
  entry,
  management,
  titleId = "savings-action-title",
  mode,
  session,
  candidate,
  picker,
  pickerOpen,
  availableLabel,
  destinationLabel,
  historyBlocked = false,
  availableBaseUnits,
  availableStale = false,
  fetchAccountResource,
  prepareMoneyAction,
  executeMoneyAction,
  onSelectMode,
  onBackToManagement,
  onClose,
  onClosed,
  onConfirmed,
  embeddedDepth,
}: SavingsJourneyProps & { candidate: MorphoVaultCandidate | null; pickerOpen: boolean; embeddedDepth?: number }) {
  const {
    motion = "system",
    assetId: selectedAssetId,
    assetLabel: selectedAssetLabel,
    assetDecimals: selectedAssetDecimals,
    assetOptions,
    onAssetChange,
  } = useSavingsDialogFixture();
  const routing = useOptionalHomeShellRouting();
  const [amount, setAmount] = useState("");
  const [amountBaseUnits, setAmountBaseUnits] = useState<string | null>(null);
  const [preparedAction, setPreparedAction] = useState<PreparedMoneyAction | null>(null);
  const [attemptedAction, setAttemptedAction] = useState(false);
  const [serverExpiredActionId, setServerExpiredActionId] = useState<string | null>(null);
  const [step, setStep] = useState<DialogStep>("amount");
  const [preparing, setPreparing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  const managementFocusRef = useRef<HTMLElement>(null);
  const [focusAction, setFocusAction] = useState<SavingsActionMode | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [submittedAt, setSubmittedAt] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const preparation = useRef(0);
  const [previousMode, setPreviousMode] = useState(mode);
  if (mode !== previousMode) {
    setPreviousMode(mode);
    setAmount("");
    setAmountBaseUnits(null);
    setPreparedAction(null);
    setAttemptedAction(false);
    setServerExpiredActionId(null);
    setSubmission(null);
    setSubmittedAt(undefined);
    setError(null);
    setStep("amount");
    setPreparing(false);
  }
  useLayoutEffect(() => {
    preparation.current += 1;
  }, [mode]);
  const confirmingGeneration = useRef<number | null>(null);
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
  const activeCandidate = candidate ?? management?.depositCandidate ?? management?.withdrawCandidate;
  const configuredAssetId = activeCandidate?.asset.symbol.toLocaleLowerCase() ?? "usdc";
  const assetId = selectedAssetId ?? configuredAssetId;
  const assetLabel = selectedAssetLabel ?? activeCandidate?.asset.symbol ?? "USDC";
  const assetDecimals = selectedAssetDecimals ?? activeCandidate?.asset.decimals ?? 6;
  const assetRouteConfigured = assetId === configuredAssetId
    && assetLabel.toLocaleUpperCase() === activeCandidate?.asset.symbol.toLocaleUpperCase()
    && assetDecimals === activeCandidate.asset.decimals;
  const knownAvailable = !availableStale && availableBaseUnits != null && /^\d+$/.test(availableBaseUnits)
    ? BigInt(availableBaseUnits)
    : null;
  const nothingAvailable = knownAvailable === BigInt(0);
  const amountExceedsAvailable = amountExceedsKnownAvailable(amount, knownAvailable);
  const overAvailable = assetRouteConfigured && amountExceedsAvailable;
  const canContinue = assetRouteConfigured && isPositiveDecimalAmount(amount) && !amountExceedsAvailable;
  const unit = useMoneyAmountUnit(assetRouteConfigured && activeCandidate ? verifiedCashCurrency(activeCandidate.asset.address) : null);
  const { reserve, failed: reserveFailed, retry: retryReserve } = useNetworkFeeReserve(session.smartAccount ? savingsDialogOwnerIdentity(session) : null, fetchAccountResource, open && mode !== null);
  const inPicker = Boolean(picker && pickerOpen);
  const title = inPicker ? "Choose where to save" : step === "amount" ? mode === "deposit" ? "Deposit" : "Withdraw" : step === "result" ? (mode === "deposit" ? "Deposit" : "Withdraw") : "Confirm";
  useMoneyModalPending(embeddedDepth !== undefined && (step === "pending" || preparing));
  const baseDepth = embeddedDepth ?? 1;

  function changeAmount(value: string) {
    if (preparing) {
      preparation.current += 1;
      setPreparing(false);
    }
    setAmount(value);
  }

  function reset() {
    preparation.current += 1;
    changeAmount("");
    setAmountBaseUnits(null);
    setPreparedAction(null);
    setAttemptedAction(false);
    setServerExpiredActionId(null);
    setSubmission(null);
    setSubmittedAt(undefined);
    setStep("amount");
    setPreparing(false);
    setError(null);
  }

  function close() {
    onClose();
  }

  function backToManagement() {
    reset();
    onBackToManagement();
  }

  function goBack() {
    if (step === "amount" && picker) {
      reset();
      picker.onBack();
    } else if (step === "confirm" || step === "error") {
      setPreparedAction(null);
      setServerExpiredActionId(null);
      setError(null);
      setStep("amount");
    }
  }

  function tryAgain() {
    setPreparedAction(null);
    setServerExpiredActionId(null);
    setAttemptedAction(false);
    setSubmission(null);
    setSubmittedAt(undefined);
    setError(null);
    setStep("amount");
  }

  function viewActivity() {
    openPanelAfterClose(routing, "activity", close);
  }

  async function continueFromAmount() {
    if (!mode || !candidate || preparing) return;
    const generation = ++preparation.current;
    try {
      if (historyBlocked) return;
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
      setPreparing(true);
      const action = await prepareMoneyAction(mode === "withdraw" ? "savings-withdraw" : "savings-deposit", {
        kind: mode,
        vaultAddress: candidate.vaultAddress,
        amountBaseUnits: nextAmount,
      });
      if (generation !== preparation.current) return;
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
      setPreparing(false);
      setStep("confirm");
    } catch (caught) { // oxlint-disable-line home/no-silent-catch -- a stale preparation fenced by a newer journey generation has no state to report
      if (generation !== preparation.current) return;
      setPreparedAction(null);
      setError(messageForPrepareError(caught));
      setPreparing(false);
      setStep("amount");
    }
  }

  async function confirm() {
    if (!mode || !candidate || !preparedAction || !preparedReview || step !== "confirm") return;
    if (confirmingGeneration.current === preparation.current) return;
    if (historyBlocked) return;
    if (preparedReview.operation !== mode || preparedReview.vaultAddress.toLowerCase() !== candidate.vaultAddress.toLowerCase()) return;
    if (recheckExpired()) {
      setError(`This ${mode} expired. Go back and continue again.`);
      return;
    }
    const generation = preparation.current;
    confirmingGeneration.current = generation;
    setError(null);
    setStep("pending");
    try {
      const result = await executeMoneyAction(preparedAction);
      if (generation !== preparation.current) return;
      setAttemptedAction(true);
      if (result.status === "rejected") {
        setError(messageForActionStatus(result.status, mode));
        setStep("error");
        return;
      }
      if (result.status === "failed") {
        setSubmission("failed");
        setStep("result");
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
      if (generation !== preparation.current) return;
      setSubmittedAt(new Date().toISOString());
      setSubmission("submitted");
      setStep("result");
    } catch (caught) { // oxlint-disable-line home/no-silent-catch -- a stale dispatch fenced by a newer journey generation has no state to report
      if (generation !== preparation.current) return;
      if (caught instanceof TransferExecutionError && (caught.reason === "submission-unknown" || caught.reason === "dispatch-unknown")) {
        setAttemptedAction(true);
        setSubmission("ambiguous");
        setStep("result");
      } else {
        if (isRecord(caught) && caught.code === "ACTION_EXPIRED") {
          setAttemptedAction(false);
          setServerExpiredActionId(preparedAction.id);
        } else {
          setAttemptedAction(true);
          setError("The dispatch outcome is unresolved. Retry recording this same action; a new dispatch will not be created.");
        }
        setStep("confirm");
      }
    } finally {
      if (confirmingGeneration.current === generation) confirmingGeneration.current = null;
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

  const content = mode === null && management ? <MoneyModalStep step="management" depth={0} initialFocusRef={managementFocusRef}>
          <SavingsManagementSheet management={management} titleId={titleId} detailsId={detailsId}
            detailsOpen={detailsOpen} onDetailsOpenChange={setDetailsOpen} initialFocusRef={managementFocusRef}
            restoreAction={focusAction}
            onDeposit={() => { if (management.depositCandidate) { setFocusAction("deposit"); onSelectMode("deposit", management.depositCandidate); } }}
            onWithdraw={() => { if (management.withdrawCandidate) { setFocusAction("withdraw"); onSelectMode("withdraw", management.withdrawCandidate); } }} />
        </MoneyModalStep> : mode !== null && (candidate || inPicker) ? <MoneyModalStep step={inPicker ? "picker" : step === "pending" || step === "error" ? "confirm" : step} depth={inPicker ? 0 : baseDepth + (step === "amount" ? 0 : step === "result" ? 2 : 1)}>
        <MoneyModalHeader
          title={title}
          titleId={titleId}
          {...(inPicker ? {}
            : step === "amount"
              ? entry === "management" ? { onBack: backToManagement } : picker ? { onBack: goBack } : { assetControl: <MoneyAssetPicker {...amountAssetProps} /> }
            : step === "pending" || step === "result"
              ? {}
              : { onBack: goBack })}
          closeLabel={`Close ${mode} dialog`}
        />

        <MoneyModalBody hasFooter className="gap-4 pt-4">
          {inPicker && picker ? (
            <>
              {picker.options.length === 0 ? (
                <StatusMessage tone="error" role="alert">
                  Savings options aren&apos;t available right now. <Button variant="ghost" size="sm" onClick={picker.onRetryVaults} disabled={!picker.onRetryVaults}>Try again</Button>
                </StatusMessage>
              ) : (
                <Card variant="flush"><CardContent inset="list"><ul className="list-none p-0">
                  {picker.options.map((option) => <AssetRow key={option.candidate.vaultAddress} icon={<PiggyBank aria-hidden="true" />}
                    label={option.name} value={option.rateLabel}
                    onActivate={option.disabled ? undefined : () => picker.onPick(option.candidate)}
                    activateLabel={`Deposit to ${option.name}`} />)}
                </ul></CardContent></Card>
              )}
              {picker.cash === "empty" ? <StatusMessage>Add cash to start saving.</StatusMessage> : null}
              {picker.cash === "unavailable" ? (
                <StatusMessage tone="error" role="alert">
                  Couldn&apos;t check your cash balance. <Button variant="ghost" size="sm" onClick={picker.onRetryBalances} disabled={!picker.onRetryBalances}>Retry</Button>
                </StatusMessage>
              ) : null}
            </>
          ) : null}
          {!inPicker && step === "amount" && candidate ? (
            <>
              <MoneyAmountDisplay
                amount={amount}
                maxDecimals={assetDecimals}
                onAmountChange={changeAmount}
                readOnly={preparing}
                overAvailable={overAvailable}
                onSubmit={canContinue ? () => void continueFromAmount() : undefined}
                availableLabel={availableLabel}
                topLine={mode === "deposit" ? destinationLabel : undefined}
                availableAmount={decimalFromBaseUnits(maxAmountAfterNetworkFee(availableBaseUnits, mode === "deposit" ? candidate.asset.symbol : "vault shares", reserve) ?? "", assetDecimals)}
                assetId={assetId}
                assetLabel={assetLabel}
                assetControl={entry === "management" ? "body" : "header"}
                chipSet="max"
                unit={unit}
                nativeSymbol={assetLabel}
              >
                {mode === "deposit" && assetRouteConfigured && candidate.asset.symbol.toUpperCase() === "USDC" && reserveFailed ? (
                  <StatusMessage tone="error" role="alert">
                    Couldn&apos;t check the network fee. <Button variant="ghost" size="sm" onClick={retryReserve}>Retry</Button>
                  </StatusMessage>
                ) : null}
                {assetRouteConfigured && nothingAvailable ? (
                  <StatusMessage>
                    {mode === "withdraw" ? "Nothing saved to withdraw." : `No ${assetLabel} available to deposit.`}
                  </StatusMessage>
                ) : null}
                {!assetRouteConfigured ? (
                  <StatusMessage>
                    {assetLabel} is available for presentation review only. Savings actions remain {candidate.asset.symbol}-only.
                  </StatusMessage>
                ) : null}
              </MoneyAmountDisplay>
            </>
          ) : null}

          {amountBaseUnits && step !== "amount" && step !== "result" ? (
            <MoneyConfirmSummary action={preparedAction}
              amount={confirmAmount}
              lead={mode === "deposit" ? "Deposit to Save" : "Withdraw from Save"}
              rows={preparedReview && preparedAction ? savingsReviewRows(preparedReview, preparedAction.owner) : [
                { label: "Review", value: "Prepared facts unavailable" },
              ]}
            />
          ) : null}

          {step === "result" && preparedAction && submission ? (
            <SavingsResult action={preparedAction} submission={submission} fetchAccountResource={fetchAccountResource}
              amount={confirmAmount} submittedAt={submittedAt} onDone={close} onTryAgain={tryAgain} onViewActivity={viewActivity} />
          ) : null}

          {error ? <StatusMessage tone="error" role="alert">{error}</StatusMessage> : null}
          {actionExpired && !attemptedAction && step === "confirm" ? (
            <StatusMessage tone="error" role="alert">
              This {mode} expired. Go back and continue again.
            </StatusMessage>
          ) : null}
        </MoneyModalBody>

        {inPicker && picker && picker.cash === "empty" ? (
          <MoneyModalFooter primaryLabel="Add money" onPrimary={picker.onAddMoney} />
        ) : null}
        {!inPicker && step === "amount" ? (
          <MoneyModalFooter
            primaryLabel="Continue"
            primaryDisabled={!canContinue || historyBlocked}
            primaryLoading={preparing}
            onPrimary={() => void continueFromAmount()}
          />
        ) : null}

        {!inPicker && (step === "confirm" || step === "pending") && preparedAction ? (
          <MoneyConfirmFooter action={preparedAction}
            actionExpired={actionExpired}
            submitting={step === "pending"}
            primaryLabel={attemptedAction ? "Retry" : `${mode === "deposit" ? "Deposit" : "Withdraw"} ${confirmAmount}`}
            primaryDisabled={!preparedReview || historyBlocked || (actionExpired && !attemptedAction)}
            onPrimary={() => void confirm()}
            secondaryLabel="Back"
            onSecondary={goBack}
          />
        ) : null}

        {!inPicker && step === "result" && preparedAction && submission ? (
          <SavingsResultActions action={preparedAction} submission={submission} fetchAccountResource={fetchAccountResource}
            onDone={close} onTryAgain={tryAgain} onViewActivity={viewActivity} />
        ) : null}

        {!inPicker && step === "error" ? (
          <MoneyModalFooter
            primaryLabel="Back"
            onPrimary={goBack}
          />
        ) : null}
        </MoneyModalStep> : null;

  if (embeddedDepth !== undefined) return content;
  return (
    <MoneyMotionProvider reducedMotion={motion === "reduced" ? true : undefined}>
      <MoneyModal
        open={open}
        opener={opener}
        immediate={motion === "reduced"}
        labelledBy={titleId}
        pending={step === "pending" || preparing}
        onCancel={onClose}
        onClose={() => {
          reset();
          onClosed?.();
        }}
      >
        {content}
      </MoneyModal>
    </MoneyMotionProvider>
  );
}

function SavingsResult({ action, submission, fetchAccountResource, amount, submittedAt }: {
  action: PreparedMoneyAction;
  submission: Submission;
  fetchAccountResource?: AccountWalletClient["fetchAccountResource"];
  amount: string;
  submittedAt?: string;
  onDone: () => void;
  onTryAgain: () => void;
  onViewActivity: () => void;
}) {
  const { outcome } = useMoneyActionOutcome({ action, submission, fetchOperations: (signal) =>
    fetchAccountResource ? fetchAccountResource(recentActionsPath, { signal }) : Promise.reject(new Error("Actions unavailable")) });
  return <MoneyResult kind={action.kind as "savings-deposit" | "savings-withdraw"} outcome={outcome} amount={amount} submittedAt={submittedAt} />;
}

function SavingsResultActions({ action, submission, fetchAccountResource, onDone, onTryAgain, onViewActivity }: {
  action: PreparedMoneyAction;
  submission: Submission;
  fetchAccountResource?: AccountWalletClient["fetchAccountResource"];
  onDone: () => void;
  onTryAgain: () => void;
  onViewActivity: () => void;
}) {
  const { outcome } = useMoneyActionOutcome({ action, submission, fetchOperations: (signal) =>
    fetchAccountResource ? fetchAccountResource(recentActionsPath, { signal }) : Promise.reject(new Error("Actions unavailable")) });
  return <MoneyResultFooter outcome={outcome} onDone={onDone} onTryAgain={onTryAgain} onViewActivity={onViewActivity} />;
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
    : `${formatPresentationPercentage(Number(review.discoveryRate.netApy))} APY${review.discoveryRate.status === "stale" ? " at last update" : ""}`;
  const fee = formatWadPercent(review.feeWad);
  return [
    moneyConfirmFromRow(owner),
    { label: "Vault", value: review.vaultName },
    { label: "Network", value: `${review.network.name} (${review.network.chainId})` },
    { label: "Rate", value: apy },
    { label: "Vault fee", value: fee },
    { label: "Amount", value: formatUsdStablecoinAmount(review.exactUsdcBaseUnits) },
    ...(review.operation === "withdraw" ? [{ label: "Exchange constraint", value: "Exact USDC; reverts if shares are insufficient" }] : []),
    { label: "Valid until", value: formatPresentationDate(review.expiresAt, { style: "date-time-zone" }) },
  ];
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
      {tone === "error" ? <AlertIcon><CircleAlertIcon /></AlertIcon> : null}
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
