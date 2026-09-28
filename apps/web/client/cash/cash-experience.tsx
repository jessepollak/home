"use client";

import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import {
  isServerVerified,
  useAccountWallet,
  type AccountWalletClient,
} from "@/client/account/cdp-client";
import { useBalances } from "@/client/balances";
import { preloadAddMoneySheet } from "@/client/funding/funding-experience";
import { prefetchAddMoneyMethods } from "@/client/funding/funding-prefetch";
import { browserHomeQueryClient, useHomeQueryClient } from "@/client/query/query-client";
import { useOptionalHomeShellRouting } from "@/client/home/panel-routing";
import { usePresentationRegionId } from "@/client/invest/presentation-quote";
import { moneySheetIntent } from "@/client/money-modal";
import { SavingsJourney, type SavingsActionMode, type SavingsJourneyEntry } from "@/client/savings/savings-actions";
import {
  nextSavingsRateExpiryAt,
  summarizeSavingsPortfolio,
  getSavingsRateState,
} from "@/client/savings/portfolio-summary";
import { savingsTeaserApyLabel } from "@/client/savings/savings-teaser-apy";
import { useSavingsVaults } from "@/client/savings/use-savings-vaults";
import type { SavingsGrowthAuthority } from "@/client/savings/use-estimated-growth";
import { selectVaultPositions } from "@/shared/balances/select";
import type { BalancesSnapshot } from "@/shared/balances/types";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type {
  OperationResult,
  PreparedMoneyAction,
} from "@/shared/money-actions/types";
import { formatUsdStablecoinAmount } from "@/shared/formatting";
import {
  BASE_USDC_ADDRESS,
  BASE_USDC_DECIMALS,
  MORPHO_V1_CANDIDATE_ADDRESSES,
} from "@/shared/savings/config";
import type { MorphoVaultCandidate } from "@/shared/savings/types";
import { CashOverview, SavingsDetail } from "./cash-overview";
import { savingsWithdrawTargets } from "./savings-withdraw-targets";
import { savingsManagement, type SavingsManagement } from "./savings-management";

const SAVINGS_JOURNEY_TITLE_ID = "savings-journey-title";
type View = "cash" | "savings";
type Mode = SavingsActionMode;

export type CashExperienceProps = {
  view: View;
  onOpenSavings: () => void;
  session: VerifiedAccountSession | null;
  snapshot: BalancesSnapshot | null;
  balanceStatus: "ready" | "loading" | "failed";
  balanceStale?: boolean;
  onRetryBalances?: () => void;
  onAddMoney: () => void;
  onAddMoneyIntent?: () => void;
  fetchVaults?: (signal?: AbortSignal) => Promise<unknown>;
  now?: () => number;
  prepareMoneyAction: (
    endpoint: string,
    input: unknown
  ) => Promise<PreparedMoneyAction>;
  executeMoneyAction: (action: PreparedMoneyAction) => Promise<OperationResult>;
  fetchAccountResource?: AccountWalletClient["fetchAccountResource"];
};

export function CashExperience({
  view,
  onOpenSavings,
  session,
  snapshot,
  balanceStatus,
  balanceStale = false,
  onRetryBalances,
  onAddMoney,
  onAddMoneyIntent,
  fetchVaults,
  now = Date.now,
  prepareMoneyAction,
  executeMoneyAction,
  fetchAccountResource,
}: CashExperienceProps) {
  const routing = useOptionalHomeShellRouting();
  const ownerIdentity = session ? `${session.user.subject}:${session.smartAccount?.address.toLowerCase() ?? ""}:${session.accountProvider}` : "signed-out";
  const [rateNowMs, setRateNowMs] = useState(() => now());
  const query = useSavingsVaults({ fetchVaults });
  const metadata = query.data ?? null;
  const vaultStatus = metadata ? "ready" : query.isError ? "failed" : "loading";
  const liveSnapshot = balanceStatus === "failed" ? null : snapshot;
  const positions = useMemo(
    () => (liveSnapshot ? selectVaultPositions(liveSnapshot) : null),
    [liveSnapshot]
  );
  const summary = useMemo(
    () =>
      metadata && positions
        ? summarizeSavingsPortfolio({
            supportedVaultAddresses: MORPHO_V1_CANDIDATE_ADDRESSES,
            requiredAsset: metadata.asset,
            candidates: metadata.candidates,
            positions,
            metadataFetchedAt: metadata.source.fetchedAt,
            metadataStale: metadata.stale,
            nowMs: rateNowMs,
          })
        : null,
    [metadata, positions, rateNowMs]
  );
  const rateLabel = metadata
    ? savingsTeaserApyLabel({
        summary,
        candidates: metadata.candidates,
        metadata,
        nowMs: rateNowMs,
      })
    : null;
  const growthAuthority: SavingsGrowthAuthority | null =
    liveSnapshot && session
      ? {
          accountIdentity: `${
            session.user.subject
          }:${liveSnapshot.owner.address.toLowerCase()}`,
          assetIdentity: `${BASE_USDC_ADDRESS.toLowerCase()}:8453:${BASE_USDC_DECIMALS}`,
          blockNumber: liveSnapshot.block.number,
          blockHash: liveSnapshot.block.hash,
          blockTimestamp: liveSnapshot.block.timestamp,
          snapshotStale: liveSnapshot.stale === true || balanceStale,
          registryCoverageComplete:
            liveSnapshot.coverage.registry === "complete",
        }
      : null;
  useEffect(() => {
    if (!metadata) return;
    let active = true;
    queueMicrotask(() => {
      if (active) setRateNowMs(now());
    });
    return () => {
      active = false;
    };
  }, [metadata, now]);
  useEffect(() => {
    if (!metadata) return;
    const expiresAt = nextSavingsRateExpiryAt(
      metadata.candidates,
      metadata.source.fetchedAt,
      rateNowMs
    );
    if (expiresAt === null || expiresAt <= rateNowMs) return;
    const timeout = setTimeout(
      () => setRateNowMs(now()),
      expiresAt - rateNowMs
    );
    return () => clearTimeout(timeout);
  }, [metadata, now, rateNowMs]);

  const [localMode, setLocalMode] = useState<Mode | null>(null);
  const [targetSelection, setTargetSelection] = useState<{ owner: string; candidate: MorphoVaultCandidate } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [managementSelection, setManagementSelection] = useState<{ owner: string; address: string } | null>(null);
  const [entry, setEntry] = useState<SavingsJourneyEntry>("amount");
  const [closingManagement, setClosingManagement] = useState<SavingsManagement | null>(null);
  const [journeyGeneration, setJourneyGeneration] = useState(0);
  const latestJourneyGeneration = useRef(0);
  const previousOwner = useRef(ownerIdentity);
  const opener = useRef<HTMLElement | null>(null);
  const autoClosed = useRef<{ mode: Mode; target: MorphoVaultCandidate } | null>(null);
  const initialRoute = useRef(
    routing &&
      view === "savings" &&
      (routing.state.flow === "save-deposit" ||
        routing.state.flow === "save-withdraw")
      ? routing.state.flow
      : null
  );
  const normalized = useRef(false);
  const previousView = useRef(view);
  const restoreSavingsFocus = useRef(false);
  const target = targetSelection?.owner === ownerIdentity ? targetSelection.candidate : null;
  const managementAddress = managementSelection?.owner === ownerIdentity ? managementSelection.address : null;
  const routeMode =
    routing?.state.flow === "save-deposit"
      ? "deposit"
      : routing?.state.flow === "save-withdraw"
      ? "withdraw"
      : null;
  const mode = routing ? routeMode : localMode;
  const usdc = liveSnapshot?.holdings.find((holding) => holding.id === "usdc")?.balance;
  const management = useMemo(() => managementAddress ? savingsManagement({
    address: managementAddress,
    snapshot: liveSnapshot,
    metadata,
    nowMs: rateNowMs,
    actionsAvailable: Boolean(session?.smartAccount),
    usdcBaseUnits: usdc?.status === "ready" ? usdc.baseUnits : null,
    usdcUnavailable: usdc?.status !== "ready" || balanceStatus === "failed",
  }) : null, [managementAddress, liveSnapshot, metadata, rateNowMs, session?.smartAccount, usdc, balanceStatus]);
  const activeManagement = management ?? closingManagement;

  useEffect(() => {
    if (!routing || !initialRoute.current || normalized.current) return;
    normalized.current = true;
    if (window.history.state?.__cashSavingsFlowPushed === true) return;
    routing.clearFlow({ mode: "replace", normalizeInbound: true });
    routing.setFlow(initialRoute.current);
  }, [routing]);
  useEffect(() => {
    const previous = previousOwner.current;
    if (previous === ownerIdentity) return;
    previousOwner.current = ownerIdentity;
    if (previous === "signed-out") return;
    latestJourneyGeneration.current += 1;
    setJourneyGeneration(latestJourneyGeneration.current);
    setTargetSelection(null);
    setManagementSelection(null);
    setClosingManagement(null);
    setConfirmed(false);
    setLocalMode(null);
    autoClosed.current = null;
    opener.current = null;
    if (routing) routing.clearFlow({ mode: "replace" });
  }, [ownerIdentity, routing]);
  useEffect(() => {
    if (previousView.current === "savings" && view === "cash")
      restoreSavingsFocus.current = true;
    previousView.current = view;
    if (!restoreSavingsFocus.current || view !== "cash") return;
    const row = document.querySelector<HTMLButtonElement>(
      'main [aria-labelledby="cash-savings-heading"] button'
    );
    if (row) {
      restoreSavingsFocus.current = false;
      row.focus();
    }
  });

  const available =
    mode === "deposit"
      ? liveSnapshot?.holdings.find((holding) => holding.id === "usdc")?.balance
      : liveSnapshot?.holdings.find(
          (holding) =>
            holding.kind === "vault-share" &&
            holding.contractAddress?.toLowerCase() ===
              target?.vaultAddress.toLowerCase()
        )?.underlyingBalance;
  const availableBaseUnits =
    available?.status === "ready" ? available.baseUnits : null;
  const withdrawable = useMemo(
    () => savingsWithdrawTargets(liveSnapshot, metadata),
    [liveSnapshot, metadata]
  );
  const best =
    metadata?.candidates.reduce<MorphoVaultCandidate | null>(
      (current, candidate) => {
        const rate = getSavingsRateState(candidate, {
          metadataFetchedAt: metadata.source.fetchedAt,
          metadataStale: metadata.stale,
          nowMs: rateNowMs,
        });
        const bestRate =
          current &&
          getSavingsRateState(current, {
            metadataFetchedAt: metadata.source.fetchedAt,
            metadataStale: metadata.stale,
            nowMs: rateNowMs,
          });
        return rate.status !== "unavailable" &&
          (!bestRate ||
            bestRate.status === "unavailable" ||
            rate.value > bestRate.value)
          ? candidate
          : current;
      },
      null
    ) ?? null;

  useEffect(() => {
    if (!routing || view !== "savings" || !routeMode || target || autoClosed.current?.mode === routeMode) return;
    if (balanceStatus === "failed" || (routeMode === "deposit" && query.isError)) {
      routing.clearFlow({ mode: "replace" });
      return;
    }
    if (!liveSnapshot || !session?.smartAccount || (!metadata && !query.isError)) return;
    if (routeMode === "deposit") {
      if (!metadata) return;
      const usdc = liveSnapshot.holdings.find(
        (holding) => holding.id === "usdc"
      )?.balance;
      if (best && usdc?.status === "ready")
        queueMicrotask(() => {
          setTargetSelection({ owner: ownerIdentity, candidate: best });
          setEntry("amount");
        });
      else routing.clearFlow({ mode: "replace" });
      return;
    }
    if (withdrawable.length === 1) {
      queueMicrotask(() => {
        setTargetSelection({ owner: ownerIdentity, candidate: withdrawable[0]!.candidate });
        setEntry("amount");
      });
    } else {
      routing.clearFlow({ mode: "replace" });
    }
  }, [
    routing,
    view,
    routeMode,
    target,
    balanceStatus,
    query.isError,
    liveSnapshot,
    metadata,
    session,
    ownerIdentity,
    best,
    withdrawable,
  ]);

  function close() {
    setClosingManagement(management);
    setManagementSelection(null);
    setConfirmed(false);
    if (routing) {
      if (mode && autoClosed.current?.mode === mode) return;
      routing.clearFlow({ mode: "replace" });
    } else setLocalMode(null);
  }
  function open(nextMode: Mode, candidate: MorphoVaultCandidate) {
    autoClosed.current = null;
    if (managementAddress === null) {
      latestJourneyGeneration.current += 1;
      setJourneyGeneration(latestJourneyGeneration.current);
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setEntry("amount");
    }
    setTargetSelection({ owner: ownerIdentity, candidate });
    setConfirmed(false);
    if (routing)
      routing.setFlow(
        nextMode === "deposit" ? "save-deposit" : "save-withdraw"
      );
    else setLocalMode(nextMode);
  }
  function openManagement(address: string) {
    latestJourneyGeneration.current += 1;
    setJourneyGeneration(latestJourneyGeneration.current);
    setClosingManagement(null);
    setManagementSelection({ owner: ownerIdentity, address });
    setEntry("management");
    setTargetSelection(null);
    setLocalMode(null);
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirmed(false);
  }
  function backToManagement() {
    setLocalMode(null);
    routing?.clearFlow();
  }
  function restoreFocus() {
    setClosingManagement(null);
    setManagementSelection(null);
    const element = opener.current;
    opener.current = null;
    setTargetSelection(null);
    if (element?.isConnected && !element.matches(":disabled")) element.focus();
    else
      document
        .querySelector<HTMLButtonElement>(
          "[data-shell-back] button:not(:disabled)"
        )
        ?.focus();
  }
  useEffect(() => {
    if (!mode) {
      autoClosed.current = null;
      return;
    }
    if (!target || confirmed ||
      (balanceStatus !== "failed" && availableBaseUnits !== null) ||
      (autoClosed.current?.mode === mode && autoClosed.current.target === target)
    ) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      autoClosed.current = { mode, target };
      if (entry === "management") {
        setClosingManagement(management);
        setManagementSelection(null);
      }
      if (routing) routing.clearFlow({ mode: "replace" });
      else setLocalMode(null);
    });
    return () => { active = false; };
  }, [mode, target, balanceStatus, availableBaseUnits, confirmed, routing, entry, management]);
  const closedJourney = () => { if (latestJourneyGeneration.current === journeyGeneration) restoreFocus(); };
  const sheetOpen = view === "savings" && session !== null && (management !== null ||
    (mode !== null && target !== null && ((availableBaseUnits !== null && balanceStatus !== "failed") || confirmed)));
  const centsLabel =
    availableBaseUnits !== null
      ? `${formatUsdStablecoinAmount(
          (
            BigInt(availableBaseUnits) /
            BigInt(10) ** BigInt(BASE_USDC_DECIMALS - 2)
          ).toString(),
          2
        )} available`
      : undefined;
  return (
    <>
      {view === "cash" ? (
        <CashOverview
          snapshot={liveSnapshot}
          balanceStatus={balanceStatus}
          metadata={metadata}
          vaultStatus={vaultStatus}
          nowMs={rateNowMs}
          now={now}
          rateLabel={rateLabel}
          growthAuthority={growthAuthority}
          onOpenSavings={onOpenSavings}
          onAddMoney={onAddMoney}
          onAddMoneyIntent={onAddMoneyIntent}
          onRetryBalances={onRetryBalances}
        />
      ) : (
        <SavingsDetail
          snapshot={liveSnapshot}
          balanceStatus={balanceStatus}
          metadata={metadata}
          vaultStatus={vaultStatus}
          nowMs={rateNowMs}
          now={now}
          growthAuthority={growthAuthority}
          actionsAvailable={Boolean(session?.smartAccount)}
          onDepositVault={(candidate) => open("deposit", candidate)}
          onManageVault={openManagement}
          onRetryVaults={() => void query.refetch()}
          onRetryBalances={onRetryBalances}
        />
      )}
      {session && (activeManagement !== null || target !== null) ? (
        <SavingsJourney
          titleId={SAVINGS_JOURNEY_TITLE_ID}
          key={`${session.user.subject}:${session.smartAccount?.address ?? ""}:${activeManagement?.address ?? target?.vaultAddress ?? ""}:${entry}`}
          open={sheetOpen}
          entry={entry}
          management={activeManagement}
          mode={mode}
          session={session}
          candidate={target}
          availableLabel={centsLabel}
          availableBaseUnits={availableBaseUnits}
          availableStale={
            balanceStale || (confirmed && availableBaseUnits === null)
          }
          fetchAccountResource={fetchAccountResource}
          prepareMoneyAction={prepareMoneyAction}
          executeMoneyAction={async (action) => {
            setConfirmed(true);
            return executeMoneyAction(action);
          }}
          onSelectMode={open}
          onBackToManagement={backToManagement}
          onClose={close}
          onClosed={closedJourney}
        />
      ) : null}
    </>
  );
}

export function AuthenticatedCashExperience(props: {
  view: "cash" | "savings";
  onOpenSavings: () => void;
  regionReady?: boolean;
}): JSX.Element {
  const { view, onOpenSavings, regionReady = true } = props;
  const account = useAccountWallet();
  const region = usePresentationRegionId();
  const routing = useOptionalHomeShellRouting();
  const queryClient = useHomeQueryClient(browserHomeQueryClient());
  const session = isServerVerified(account) ? account.session : null;
  const balancesSession = session?.smartAccount
    ? {
        subject: session.user.subject,
        smartAccountAddress: session.smartAccount.address,
        chainId: session.smartAccount.chainId,
        accountProvider: session.accountProvider,
      }
    : null;
  const balances = useBalances(balancesSession, region, account.fetchBalances, {
    held: !regionReady,
  });
  const snapshot = balances.snapshot;
  return (
    <CashExperience
      view={view}
      onOpenSavings={onOpenSavings}
      session={session}
      snapshot={snapshot}
      balanceStatus={
        snapshot
          ? "ready"
          : balances.status === "error" || (session !== null && balancesSession === null)
            ? "failed"
            : "loading"
      }
      balanceStale={snapshot?.stale === true || balances.refreshError === true}
      onRetryBalances={balancesSession ? () => void balances.retry() : undefined}
      onAddMoneyIntent={moneySheetIntent(preloadAddMoneySheet, () => prefetchAddMoneyMethods(account, region, regionReady, queryClient)).onFocus}
      onAddMoney={() => {
        void preloadAddMoneySheet();
        routing?.setFlow("add-money", { mode: "push" });
      }}
      prepareMoneyAction={account.prepareMoneyAction}
      executeMoneyAction={account.executeMoneyAction}
      fetchAccountResource={account.fetchAccountResource}
    />
  );
}
