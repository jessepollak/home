"use client";

import { useId, useRef, useState } from "react";
import { SavingsManagementSheet, type SavingsManagement } from "@/client/cash/savings-management";
import { Card, CardContent } from "@/components/ui/card";
import { AssetRow } from "@/components/finance-rows";
import { Button } from "@/components/ui/button";
import { PiggyBank } from "lucide-react";
import { MoneyMotionProvider } from "@/components/money-ticker";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  MoneyModal,
  MoneyModalBody,
  MoneyModalFooter,
  MoneyModalHeader,
  MoneyModalStep,
  MoneyModalStepLoading,
  deferStep,
  useMoneyModalExit,
} from "@/client/money-modal";
import { useIdlePreload } from "@/client/money-modal/deferred-sheet";
import type { OperationResult } from "@/shared/money-actions/types";
import type { MorphoVaultCandidate } from "@/shared/savings/types";
import { StatusMessage } from "./savings-status-message";
import { useSavingsDialogFixture } from "./savings-dialog-fixture";
import { savingsDialogOwnerIdentity } from "./savings-owner-identity";
import type { SavingsJourneyStepProps } from "./savings-journey-step";

const SavingsJourneyStep = deferStep<SavingsJourneyStepProps>(() => import("./savings-journey-step").then((module) => module.SavingsJourneyStep));

export const preloadSavingsJourneyStep = SavingsJourneyStep.preload;

function renderSavingsLoading(mode: SavingsActionMode, titleId: string, onBack: (() => void) | undefined, depth: number, { failed, retry }: { failed: boolean; retry: () => void }) {
  return <MoneyModalStepLoading step="amount-loading" depth={depth} title={mode === "deposit" ? "Deposit" : "Withdraw"}
    titleId={titleId} onBack={onBack} closeLabel={`Close ${mode} dialog`} failed={failed} onRetry={retry} />;
}

export type SavingsActionMode = "deposit" | "withdraw";

export type SavingsJourneyEntry = "management" | "amount";

export type SavingsJourneyProps = {
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

export function SavingsJourney(props: SavingsJourneyProps) {
  return <OwnerBoundSavingsJourney key={savingsDialogOwnerIdentity(props.session)} {...props} />;
}

/** @public Embeddable Save deposit and withdrawal steps for a MoneyModal host. */
export function SavingsMoneyFlow({ depth = 0, onBack, onDone, ...props }: SavingsMoneyFlowProps) {
  const exit = useMoneyModalExit();
  const titleId = "savings-action-title";
  return <SavingsJourneyStep key={`${savingsDialogOwnerIdentity(props.session)}:${props.mode}:${props.candidate.vaultAddress}`} open entry={onBack ? "management" : "amount"}
    management={null} titleId={titleId} depth={depth} {...props}
    onBackToManagement={onBack ?? (() => {})} onClose={onDone ?? exit}
    fallback={renderSavingsLoading.bind(null, props.mode, titleId, onBack, depth)} />;
}

function SavingsVaultPicker({ picker, mode, titleId, onIntent }: {
  picker: NonNullable<SavingsJourneyProps["picker"]>;
  mode: SavingsActionMode;
  titleId: string;
  onIntent: () => void;
}) {
  return (
    <MoneyModalStep step="picker" depth={0}>
      <MoneyModalHeader title="Choose where to save" titleId={titleId} closeLabel={`Close ${mode} dialog`} />
      <MoneyModalBody hasFooter className="gap-4 pt-4">
        {picker.options.length === 0 ? (
          <StatusMessage tone="error" role="alert">
            Savings options aren&apos;t available right now. <Button variant="ghost" size="sm" onClick={picker.onRetryVaults} disabled={!picker.onRetryVaults}>Try again</Button>
          </StatusMessage>
        ) : (
          <Card variant="flush"><CardContent inset="list"><ul className="list-none p-0">
            {picker.options.map((option) => <AssetRow key={option.candidate.vaultAddress} icon={<PiggyBank aria-hidden="true" />}
              label={option.name} value={option.rateLabel}
              onActivate={option.disabled ? undefined : () => picker.onPick(option.candidate)}
              onIntent={onIntent}
              activateLabel={`Deposit to ${option.name}`} />)}
          </ul></CardContent></Card>
        )}
        {picker.cash === "empty" ? <StatusMessage>Add cash to start saving.</StatusMessage> : null}
        {picker.cash === "unavailable" ? (
          <StatusMessage tone="error" role="alert">
            Couldn&apos;t check your cash balance. <Button variant="ghost" size="sm" onClick={picker.onRetryBalances} disabled={!picker.onRetryBalances}>Retry</Button>
          </StatusMessage>
        ) : null}
      </MoneyModalBody>
      {picker.cash === "empty" ? (
        <MoneyModalFooter primaryLabel="Add money" onPrimary={picker.onAddMoney} />
      ) : null}
    </MoneyModalStep>
  );
}

function OwnerBoundSavingsJourney({
  open,
  entry,
  management,
  titleId = "savings-action-title",
  mode,
  session,
  candidate,
  picker,
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
}: SavingsJourneyProps) {
  const { motion = "system" } = useSavingsDialogFixture();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  const managementFocusRef = useRef<HTMLElement>(null);
  const [focusAction, setFocusAction] = useState<SavingsActionMode | null>(null);
  const pickerOpen = picker !== undefined && candidate === null;
  const preloadStep = () => void preloadSavingsJourneyStep();
  useIdlePreload(preloadSavingsJourneyStep, (management !== null && mode === null) || pickerOpen);

  return (
    <MoneyMotionProvider reducedMotion={motion === "reduced" ? true : undefined}>
      <MoneyModal open={open} immediate={motion === "reduced"} labelledBy={titleId} onCancel={onClose} onClose={() => onClosed?.()}>
        {mode === null && management ? <MoneyModalStep step="management" depth={0} initialFocusRef={managementFocusRef}>
          <SavingsManagementSheet management={management} titleId={titleId} detailsId={detailsId}
            detailsOpen={detailsOpen} onDetailsOpenChange={setDetailsOpen} initialFocusRef={managementFocusRef}
            restoreAction={focusAction} onActionIntent={preloadStep}
            onDeposit={() => { if (management.depositCandidate) { setFocusAction("deposit"); preloadStep(); onSelectMode("deposit", management.depositCandidate); } }}
            onWithdraw={() => { if (management.withdrawCandidate) { setFocusAction("withdraw"); preloadStep(); onSelectMode("withdraw", management.withdrawCandidate); } }} />
        </MoneyModalStep> : mode !== null && pickerOpen && picker ? <SavingsVaultPicker
          picker={picker} mode={mode} titleId={titleId} onIntent={preloadStep}
        /> : mode !== null && candidate ? <SavingsJourneyStep
          key={`${mode}:${candidate.vaultAddress}:${management?.address ?? ""}`}
          open={open} entry={entry} management={management} titleId={titleId} mode={mode} session={session} candidate={candidate}
          availableLabel={availableLabel} destinationLabel={destinationLabel} historyBlocked={historyBlocked}
          availableBaseUnits={availableBaseUnits} availableStale={availableStale}
          fetchAccountResource={fetchAccountResource} prepareMoneyAction={prepareMoneyAction} executeMoneyAction={executeMoneyAction}
          onBackToManagement={onBackToManagement} onBackToPicker={picker?.onBack} onClose={onClose} onConfirmed={onConfirmed}
          fallback={renderSavingsLoading.bind(null, mode, titleId, entry === "management" ? onBackToManagement : picker?.onBack, 1)}
        /> : null}
      </MoneyModal>
    </MoneyMotionProvider>
  );
}
