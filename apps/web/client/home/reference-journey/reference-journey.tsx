"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { HomeMark } from "@/components/home-mark";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { ProfileMark } from "@/components/profile-mark";
import { shellContentFrameClassName } from "@/components/shell-layout";
import { ActivityPanelView } from "@/client/activity";
import type { UseActivityResult } from "@/client/activity/use-activity";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { SavingsMoneyDialog } from "@/client/savings/savings-actions";
import type { RegionId } from "@/config/regions";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type {
  MoneyActionMetadata,
  OperationResult,
  PreparedMoneyAction,
} from "@/shared/money-actions/types";
import { isSavingsMetadata } from "@/shared/savings/review";
import {
  ReferenceActivityHeader,
  ReferenceHomeComposition,
  type ReferenceHomeIntent,
} from "./reference-home";
import {
  applyReferenceDeposit,
  presentReferencePosition,
  type ReferenceMoneyPosition,
} from "./reference-position";
import { ReferenceSaveComposition } from "./reference-save";

/**
 * Connected reference journey for [issue #654](https://github.com/jessepollak/home/issues/654).
 *
 * Fixture-level navigation only: this component owns its own view state instead of Next
 * routing, and the deposit executes through injected fixture-backed money-action
 * functions instead of a provider. It composes the production-intended reference
 * compositions with the existing `SavingsMoneyDialog` (amount → review → pending →
 * result) and the production `ActivityPanelView` (row → transaction detail). It is not
 * wired into `HomeShell`, and its `Back` returns to the reference Home view rather than
 * exercising browser history.
 */

export type ReferenceJourneyView = "home" | "save" | "activity";

export type ReferenceJourneyProps = {
  initialPosition: ReferenceMoneyPosition;
  session: VerifiedAccountSession;
  activity: UseActivityResult;
  prepareMoneyAction: AccountWalletClient["prepareMoneyAction"];
  executeMoneyAction: AccountWalletClient["executeMoneyAction"];
  initialView?: ReferenceJourneyView;
  regionId?: RegionId;
};

export function ReferenceJourney({
  initialPosition,
  session,
  activity,
  prepareMoneyAction,
  executeMoneyAction,
  initialView = "home",
  regionId = "US",
}: ReferenceJourneyProps) {
  const [view, setView] = useState<ReferenceJourneyView>(initialView);
  const [position, setPosition] = useState(initialPosition);
  const [operations, setOperations] = useState<readonly RecentMoneyActionOperation[]>([]);
  const [depositOpen, setDepositOpen] = useState(false);
  const [intentNotice, setIntentNotice] = useState<string | null>(null);
  const [resultNotice, setResultNotice] = useState<string | null>(null);
  // The preferred first candidate is selectable even before anything is saved.
  const [selectedVaultAddress, setSelectedVaultAddress] = useState<string | null>(
    () => presentReferencePosition(initialPosition).saved.vaults[0]?.vaultAddress ?? null,
  );
  // The dialog owns review/pending/result; the fixture only needs the prepared action
  // that produced the confirmed result so it can move the same exact amount.
  const preparedDepositRef = useRef<PreparedMoneyAction | null>(null);
  const positionView = useMemo(() => presentReferencePosition(position), [position]);
  const savedSlice = position.saved.status === "available" ? position.saved : null;
  const selectedCandidate = savedSlice
    ? savedSlice.metadata.candidates.find(
        (candidate) => candidate.vaultAddress.toLowerCase() === (selectedVaultAddress ?? "").toLowerCase(),
      ) ?? null
    : null;

  const clearNotices = useCallback(() => {
    setIntentNotice(null);
    setResultNotice(null);
  }, []);

  const openSave = useCallback((vaultAddress?: string) => {
    if (vaultAddress) setSelectedVaultAddress(vaultAddress);
    clearNotices();
    setView("save");
  }, [clearNotices]);

  const openActivity = useCallback(() => {
    clearNotices();
    setView("activity");
  }, [clearNotices]);

  const openHome = useCallback(() => {
    clearNotices();
    setView("home");
  }, [clearNotices]);

  const referenceIntent = useCallback((label: string) => {
    setResultNotice(null);
    setIntentNotice(
      `Reference intent — ${label} keeps its existing production flow. This fixture wires the Save deposit and Activity detail only.`,
    );
  }, []);

  const onIntent = useCallback((intent: ReferenceHomeIntent) => {
    referenceIntent(intent === "add-money" ? "Add money" : intent === "send" ? "Send" : "Cash out");
  }, [referenceIntent]);

  const confirmFixtureDeposit = useCallback(async (result: OperationResult) => {
    const action = preparedDepositRef.current;
    preparedDepositRef.current = null;
    if (!action) return;
    setOperations((current) => [recordedDepositOperation(action, result), ...current]);
    setIntentNotice(null);
    setView("save");
    // Only a confirmed result moves fixture balances; submitted, pending, and unknown
    // outcomes record the action without inventing a completed deposit.
    if (result.status !== "confirmed") {
      setResultNotice(
        `Fixture only — deposit ${labelForFixtureStatus(result)}; balances stay unchanged until it confirms.`,
      );
      return;
    }
    const spend = action.amounts.find(
      (amount) => amount.symbol === "USDC" && amount.direction === "spend",
    );
    const vaultAddress = savingsVaultAddress(action.metadata) ?? selectedVaultAddress;
    if (!spend || !vaultAddress) return;
    const next = applyReferenceDeposit(position, {
      vaultAddress,
      amountBaseUnits: spend.amountBaseUnits,
    });
    const nextView = presentReferencePosition(next);
    setPosition(next);
    setResultNotice(
      `Fixture only — deposit simulated. Cash ${nextView.cash.subtotalLabel} · Saved ${nextView.saved.totalLabel} · Net position ${nextView.netPositionLabel} unchanged.`,
    );
  }, [position, selectedVaultAddress]);

  const appView = (
    <div className="flex min-h-svh flex-col bg-muted">
      <header className="order-0 w-full shrink-0 bg-background">
        <div
          className={`${shellContentFrameClassName} flex min-h-14 items-center justify-between gap-4 border-b py-2`}
        >
          <div className="flex min-w-0 items-center gap-2">
            {view === "home" ? (
              <HomeMark onClick={openHome} />
            ) : (
              <Button
                variant="ghost"
                size="icon-lg"
                className="size-11"
                aria-label="Back"
                onClick={openHome}
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
              </Button>
            )}
            {/* The panel hero keeps the page's single h1; the shell label is not a heading. */}
            <span className="min-w-0 truncate text-base font-semibold">
              {view === "home" ? "Home" : view === "save" ? "Save" : "Activity"}
            </span>
          </div>
          {/* Fixture account control: no address, so the Basename query stays disabled. */}
          <ProfileMark status="ready" ownerKey="reference-journey-fixture" />
        </div>
      </header>
      <main className="order-1 min-h-0 flex-1 overflow-x-hidden bg-muted pb-4">
        <div className={`${shellContentFrameClassName} py-4`}>
          {intentNotice ? (
            <Alert className="mb-4" role="status">
              <AlertDescription>{intentNotice}</AlertDescription>
            </Alert>
          ) : null}
          {resultNotice ? (
            <Alert className="mb-4" role="status">
              <AlertDescription>{resultNotice}</AlertDescription>
            </Alert>
          ) : null}
          {view === "home" ? (
            <ReferenceHomeComposition
              variant="ledger"
              position={positionView}
              activityContent={
                <ActivityPanelView
                  density="teaser"
                  header={<ReferenceActivityHeader onOpen={openActivity} />}
                  activity={activity}
                  operations={operations}
                  regionId={regionId}
                />
              }
              onIntent={onIntent}
              onOpenSave={openSave}
              onOpenBorrow={() => referenceIntent("Borrow")}
              onOpenMoney={() => referenceIntent("Your money")}
            />
          ) : null}
          {view === "save" ? (
            <ReferenceSaveComposition
              variant="ledger"
              position={positionView}
              selectedVaultAddress={selectedVaultAddress}
              onSelectVault={setSelectedVaultAddress}
              onDeposit={() => {
                setIntentNotice(null);
                setDepositOpen(true);
              }}
              onWithdraw={() => referenceIntent("Withdraw")}
            />
          ) : null}
          {view === "activity" ? (
            <ActivityPanelView
              density="page"
              header={<h1 className="text-base leading-snug font-medium">Activity</h1>}
              activity={activity}
              operations={operations}
              regionId={regionId}
            />
          ) : null}
        </div>
      </main>
      <PrimaryNavigation
        activeNavigation={view === "activity" ? "activity" : view === "save" ? "save" : "home"}
        onNavigate={(navigation) => {
          if (navigation === "home") {
            openHome();
            return;
          }
          referenceIntent("Invest");
        }}
      />
      {selectedCandidate && session ? (
        <SavingsMoneyDialog
          open={depositOpen}
          mode="deposit"
          session={session}
          candidate={selectedCandidate}
          availableLabel={
            positionView.availableLabel ? `${positionView.availableLabel} available` : undefined
          }
          availableBaseUnits={position.cash.status === "available" ? position.cash.baseUnits : null}
          prepareMoneyAction={async (kind, input) => {
            const action = await prepareMoneyAction(kind, input);
            preparedDepositRef.current = action;
            return action;
          }}
          executeMoneyAction={executeMoneyAction}
          onClose={() => setDepositOpen(false)}
          onConfirmed={confirmFixtureDeposit}
        />
      ) : null}
    </div>
  );

  return <PresentationRegionProvider regionId={regionId}>{appView}</PresentationRegionProvider>;
}

function savingsVaultAddress(metadata: MoneyActionMetadata | undefined): string | null {
  return isSavingsMetadata(metadata) ? metadata.vaultAddress : null;
}

function recordedDepositOperation(
  action: PreparedMoneyAction,
  result: OperationResult,
): RecentMoneyActionOperation {
  return {
    action: {
      id: action.id,
      kind: action.kind,
      title: action.title,
      amounts: [...action.amounts],
      warnings: [...action.warnings],
      expiresAt: action.expiresAt,
      ...(action.metadata ? { metadata: action.metadata } : {}),
      createdAt: action.createdAt,
    },
    status: recordStatus(result),
    createdAt: action.createdAt,
    updatedAt: action.createdAt,
    ...(result.transactionHash ? { transactionHash: result.transactionHash } : {}),
  };
}

function recordStatus(result: OperationResult): RecentMoneyActionOperation["status"] {
  if (result.status === "confirmed") return "confirmed";
  if (result.status === "unknown") return "unknown";
  if (result.status === "failed" || result.status === "rejected") return "failed";
  // `submitted` is dispatched, not settled; the record contract has no "submitted" status.
  return "pending";
}

function labelForFixtureStatus(result: OperationResult): string {
  switch (result.status) {
    case "submitted": return "submitted";
    case "pending": return "pending";
    case "unknown": return "outcome unknown";
    case "failed": return "failed";
    case "rejected": return "rejected";
    default: return "recorded";
  }
}
