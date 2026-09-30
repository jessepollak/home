"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { readClientHistoryFlag } from "@/config/shell-location";
import {
  isServerVerified,
  useAccountWallet,
  type AccountWalletClient,
} from "@/client/account/cdp-client";
import { useBalances } from "@/client/balances";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { useMoneyActionOutcome } from "@/client/actions/money-action-outcome";
import { fetchRecentActions, recentActionsQueryOptions, refetchFailedRecentActions, useRecentActionsStatus } from "@/client/actions/recent-actions-query";
import { isRecentActionsResponse, parseRecentMoneyActions } from "@/shared/actions/contracts/list";
import { readSavingsPreparedReview } from "@/shared/savings/review";
import { ownerQueryKey, ownerQueryMeta, useHomeQuery } from "@/client/query/query-client";
import { preloadAddMoneySheet } from "@/client/funding/funding-experience";
import { prefetchAddMoneyMethods } from "@/client/funding/funding-prefetch";
import { browserHomeQueryClient, getHomeQueryClient, useHomeQueryClient } from "@/client/query/query-client";
import { queryViewState } from "@/client/query/query-view-state";
import { useOptionalHomeShellRouting } from "@/client/home/panel-routing";
import { usePresentationRegionId } from "@/client/invest/presentation-quote";
import { SavingsJourney, type SavingsActionMode, type SavingsJourneyEntry } from "@/client/savings/savings-actions";
import { deferSheet, useIdlePreload } from "@/client/money-modal/deferred-sheet";
import { moneySheetIntent, moneySheetLoading } from "@/client/money-modal";
import { invalidateAfterAction } from "@/client/query/after-action";
import { cashConversionCurrencies } from "@/shared/trading/cash-conversion";
import {
  nextSavingsRateExpiryAt,
  summarizeSavingsPortfolio,
  getSavingsRateState,
} from "@/client/savings/portfolio-summary";
import { savingsTeaserApyLabel } from "@/client/savings/savings-teaser-apy";
import { useSavingsVaults } from "@/client/savings/use-savings-vaults";
import { useNow } from "@/client/time/use-now";
import type { SavingsGrowthAuthority } from "@/client/savings/use-estimated-growth";
import { selectVaultPositions } from "@/shared/balances/select";
import type { BalancesSnapshot } from "@/shared/balances/types";
import type { PendingCashoutEstimate } from "@/shared/balances/pending-cashout";
import type { CashConversionCurrencyCode } from "@/shared/trading/cash-conversion";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type {
  DerivedActionStatus,
  OperationResult,
  PreparedMoneyAction,
} from "@/shared/money-actions/types";
import { formatPresentationPercentage, formatUsdStablecoinAmount } from "@/shared/formatting";
import { isRecord } from "@/shared/guards";
import {
  BASE_USDC_ADDRESS,
  BASE_USDC_DECIMALS,
  MORPHO_V1_CANDIDATE_ADDRESSES,
} from "@/shared/savings/config";
import type { MorphoVaultCandidate } from "@/shared/savings/types";
import { TransferExecutionError } from "@/shared/transfers/types";
import { CashOverview, SavingsDetail } from "./cash-overview";
import { savingsWithdrawTargets } from "./savings-withdraw-targets";
import { savingsManagement, type SavingsManagement } from "./savings-management";

const SAVINGS_JOURNEY_TITLE_ID = "savings-journey-title";
const noDeadline = () => null;

const CashCurrencySheet = deferSheet(() => import("./cash-currency-sheet").then((module) => module.CashCurrencySheet),
  (props) => moneySheetLoading({
    title: props.entry.kind === "convert" ? "Convert to" : cashConversionCurrencies.find((currency) => currency.code === props.entry.source)?.name ?? "Cash",
    titleId: "cash-conversion-title",
    closeLabel: props.entry.kind === "convert" ? "Close conversion" : "Close currency details",
    onCancel: props.onCancel,
    onClosed: () => props.onClosed(false),
  }));
type View = "cash" | "savings";
type Mode = SavingsActionMode;
type PendingFirstDeposit = { account: string; action: PreparedMoneyAction; submission: "submitted" | "ambiguous" };

type ScopedSavingsDeposit = {
  action: PreparedMoneyAction;
  status: DerivedActionStatus;
  settledAt?: string;
};

function isUsdcAmount(amount: unknown): amount is { symbol: string; amountBaseUnits: string } {
  if (!isRecord(amount)) return false;
  return typeof amount.symbol === "string" && amount.symbol.toUpperCase() === "USDC" &&
    amount.decimals === 6 && amount.direction === "spend" &&
    typeof amount.amountBaseUnits === "string";
}

function scopedSavingsDeposits(value: unknown, session: VerifiedAccountSession | null): ScopedSavingsDeposit[] {
  if (!session?.smartAccount || !isRecentActionsResponse(value)) return [];
  const scoped = value.actions.filter((item) => {
    if (!item || typeof item !== "object" || !("owner" in item)) return false;
    const owner = item.owner;
    return owner && typeof owner === "object" && "chainId" in owner && owner.chainId === session.smartAccount?.chainId;
  });
  const deposits: ScopedSavingsDeposit[] = [];
  for (const row of parseRecentMoneyActions({ actions: scoped }, session)) {
    if (row.action.kind !== "savings-deposit") continue;
    deposits.push({
      action: { ...row.action, calls: [], owner: {
        subject: session.user.subject, accountProvider: session.accountProvider,
        address: session.smartAccount.address, chainId: session.smartAccount.chainId,
      } },
      status: row.status,
      ...(row.settledAt ? { settledAt: row.settledAt } : {}),
    });
  }
  return deposits;
}

function isOwnedSavingsDeposit(item: unknown, session: VerifiedAccountSession): boolean {
  if (!isRecord(item) || item.kind !== "savings-deposit") return false;
  const owner = item.owner;
  if (!isRecord(owner)) return false;
  return owner.subject === session.user.subject &&
    owner.accountProvider === session.accountProvider &&
    typeof owner.address === "string" &&
    owner.address.toLowerCase() === session.smartAccount?.address.toLowerCase() &&
    owner.chainId === session.smartAccount?.chainId;
}

function unparsedSavingsDepositBlocker(
  value: unknown,
  session: VerifiedAccountSession | null,
  snapshot: BalancesSnapshot | null,
): boolean {
  if (!session?.smartAccount || !isRecentActionsResponse(value)) return false;
  const parsedIds = new Set(
    parseRecentMoneyActions(value, session)
      .filter((row) => row.action.kind === "savings-deposit")
      .map((row) => row.action.id),
  );
  return value.actions.some((item) => {
    if (!isOwnedSavingsDeposit(item, session) || !isRecord(item)) return false;
    if (typeof item.id === "string" && parsedIds.has(item.id)) return false;
    if (item.status === "failed") return false;
    const summary = item.summary;
    return !(item.status === "confirmed" &&
      balancePostdatesReceipt(
        typeof item.settledAt === "string" ? item.settledAt : undefined,
        savingsVaultAddressFromMetadata(isRecord(summary) ? summary.metadata : undefined),
        snapshot,
      ));
  });
}

function savingsVaultAddressFromMetadata(metadata: unknown): string | null {
  if (!isRecord(metadata)) return null;
  return metadata.product === "savings" && metadata.operation === "deposit" && typeof metadata.vaultAddress === "string"
    ? metadata.vaultAddress
    : null;
}

function savingsDepositVaultAddress(deposit: ScopedSavingsDeposit): string | null {
  const review = readSavingsPreparedReview(deposit.action);
  if (review) return review.vaultAddress;
  return savingsVaultAddressFromMetadata(deposit.action.metadata);
}

function balancePostdatesReceipt(settledAt: string | undefined, vaultAddress: string | null, snapshot: BalancesSnapshot | null): boolean {
  if (!snapshot || snapshot.coverage.registry !== "complete") return false;
  const blockTimestampMs = Number(snapshot.block.timestamp) * 1000;
  const settledAtMs = typeof settledAt === "string" ? Date.parse(settledAt) : NaN;
  if (!Number.isFinite(blockTimestampMs) || !Number.isFinite(settledAtMs) || blockTimestampMs <= settledAtMs) return false;
  const address = vaultAddress?.toLowerCase();
  if (!address || !MORPHO_V1_CANDIDATE_ADDRESSES.some((candidate) => candidate.toLowerCase() === address)) return false;
  const holding = snapshot.holdings.find((entry) =>
    entry.kind === "vault-share" && entry.contractAddress?.toLowerCase() === address);
  return !holding || holding.underlyingBalance?.status === "ready";
}

function savingsDepositBalancePostdatesReceipt(deposit: ScopedSavingsDeposit, snapshot: BalancesSnapshot | null): boolean {
  return balancePostdatesReceipt(deposit.settledAt, savingsDepositVaultAddress(deposit), snapshot);
}

function inFlightSavingsDepositActions(deposits: ScopedSavingsDeposit[], snapshot: BalancesSnapshot | null): PreparedMoneyAction[] {
  return deposits
    .filter((deposit) => deposit.status === "pending" || deposit.status === "unknown" ||
      (deposit.status === "confirmed" && !savingsDepositBalancePostdatesReceipt(deposit, snapshot)))
    .map((deposit) => deposit.action);
}

function savingsDepositRetired(
  deposits: ScopedSavingsDeposit[],
  snapshot: BalancesSnapshot | null,
  actionId: string,
): boolean {
  const match = deposits.find((deposit) => deposit.action.id === actionId);
  return Boolean(match && match.status === "confirmed" &&
    savingsDepositBalancePostdatesReceipt(match, snapshot));
}

function pendingDepositDisplay(action: PreparedMoneyAction) {
  const review = readSavingsPreparedReview(action);
  if (review) return review.operation === "deposit"
    ? { vaultAddress: review.vaultAddress, vaultName: review.vaultName, amountBaseUnits: review.exactUsdcBaseUnits }
    : null;
  const metadata = action.metadata;
  if (!metadata || metadata.product !== "savings" || metadata.operation !== "deposit") return null;
  const spent = action.amounts.find(isUsdcAmount);
  if (!spent || !/^\d+$/.test(spent.amountBaseUnits) || spent.amountBaseUnits === "0") return null;
  return { vaultAddress: metadata.vaultAddress, vaultName: metadata.vaultName, amountBaseUnits: spent.amountBaseUnits };
}

function groupPendingSavingsDeposits(actions: PreparedMoneyAction[]) {
  const byVault = new Map<string, { vaultAddress: string; vaultName: string; amountBaseUnits: string }>();
  for (const action of actions) {
    const display = pendingDepositDisplay(action);
    if (!display) continue;
    const key = display.vaultAddress.toLowerCase();
    const previous = byVault.get(key);
    byVault.set(key, { vaultAddress: display.vaultAddress, vaultName: display.vaultName,
      amountBaseUnits: (BigInt(previous?.amountBaseUnits ?? "0") + BigInt(display.amountBaseUnits)).toString() });
  }
  return [...byVault.values()];
}

function pendingSavingsDeposits(value: unknown, session: VerifiedAccountSession | null, local: PreparedMoneyAction | null, snapshot: BalancesSnapshot | null) {
  const byId = new Map<string, PreparedMoneyAction>();
  const server = scopedSavingsDeposits(value, session);
  for (const action of inFlightSavingsDepositActions(server, snapshot)) byId.set(action.id, action);
  if (local && !server.some((deposit) => deposit.action.id === local.id)) byId.set(local.id, local);
  return groupPendingSavingsDeposits([...byId.values()]);
}

function PendingFirstDepositWatcher({ pending, fetchAccountResource, onFailed }: {
  pending: PendingFirstDeposit;
  fetchAccountResource?: AccountWalletClient["fetchAccountResource"];
  onFailed: (actionId: string) => void;
}) {
  const { outcome } = useMoneyActionOutcome({
    action: pending.action,
    submission: pending.submission,
    fetchOperations: (signal) => fetchAccountResource
      ? fetchAccountResource("/api/actions", { signal })
      : Promise.reject(new Error("Actions unavailable")),
  });
  useEffect(() => {
    if (outcome === "failed") onFailed(pending.action.id);
  }, [outcome, onFailed, pending.action.id]);
  return null;
}

const UNCONFIRMED_SAVINGS_ENTRY_REFRESH_MS = 15_000;
const IN_FLIGHT_SAVINGS_DEPOSIT_REFRESH_MS = 5_000;

export function savingsEntryRefreshInterval({ funded, inFlightDeposits }: {
  funded: boolean | undefined;
  inFlightDeposits: number;
}): number | false {
  if (inFlightDeposits > 0 && funded !== true) return IN_FLIGHT_SAVINGS_DEPOSIT_REFRESH_MS;
  if (funded === false) return UNCONFIRMED_SAVINGS_ENTRY_REFRESH_MS;
  return false;
}

function RehydratedDepositFailureWatcher({ deposits, inFlight, funded, onFailed }: {
  deposits: ScopedSavingsDeposit[];
  inFlight: PreparedMoneyAction[];
  funded: boolean;
  onFailed: () => void;
}) {
  const tracked = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (funded) {
      tracked.current.clear();
      return;
    }
    const statuses = new Map(deposits.map(({ action, status }) => [action.id, status]));
    let failed = false;
    for (const id of tracked.current) {
      if (statuses.get(id) !== "failed") continue;
      failed = true;
      tracked.current.delete(id);
    }
    for (const action of inFlight) tracked.current.add(action.id);
    if (failed) onFailed();
  }, [deposits, inFlight, funded, onFailed]);
  return null;
}

export type CashExperienceProps = {
  view: View;
  onOpenSavings: () => void;
  session: VerifiedAccountSession | null;
  snapshot: BalancesSnapshot | null;
  balanceStatus: "ready" | "loading" | "failed";
  balanceStale?: boolean;
  pendingCashout?: PendingCashoutEstimate;
  onRetryBalances?: () => void;
  onAddMoney: (options?: { replaceFlow?: boolean }) => void;
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
  pendingCashout = null,
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
  const region = usePresentationRegionId();
  const ownerIdentity = session ? `${session.user.subject}:${session.smartAccount?.address.toLowerCase() ?? ""}:${session.accountProvider}` : "signed-out";
  const query = useSavingsVaults({ fetchVaults });
  const metadata = query.data ?? null;
  const nextDeadline = useCallback(
    (nowMs: number) => metadata
      ? nextSavingsRateExpiryAt(metadata.candidates, metadata.source.fetchedAt, nowMs)
      : null,
    [metadata],
  );
  const rateNowMs = useNow(metadata, nextDeadline, now);
  const vaultView = queryViewState(query, { hasCachedData: metadata !== null });
  const vaultStatus = vaultView === "failed" ? "failed" : vaultView === "loading" ? "loading" : "ready";
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
        regionId: region,
        summary,
        candidates: metadata.candidates,
        metadata,
        nowMs: rateNowMs,
      })
    : null;
  const growthOwner = session?.user.subject ?? null;
  const growthAuthority = useMemo<SavingsGrowthAuthority | null>(() =>
    liveSnapshot && growthOwner !== null
      ? {
          accountIdentity: `${
            growthOwner
          }:${liveSnapshot.owner.address.toLowerCase()}`,
          assetIdentity: `${BASE_USDC_ADDRESS.toLowerCase()}:8453:${BASE_USDC_DECIMALS}`,
          blockNumber: liveSnapshot.block.number,
          blockHash: liveSnapshot.block.hash,
          blockTimestamp: liveSnapshot.block.timestamp,
          snapshotStale: liveSnapshot.stale === true || balanceStale,
          registryCoverageComplete:
            liveSnapshot.coverage.registry === "complete",
        }
      : null, [liveSnapshot, growthOwner, balanceStale]);

  const [localMode, setLocalMode] = useState<Mode | null>(null);
  const [targetSelection, setTargetSelection] = useState<{ owner: string; candidate: MorphoVaultCandidate } | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [firstUseHistoryFloor, setFirstUseHistoryFloor] = useState(0);
  const hasHistorySource = fetchAccountResource !== undefined;
  const [confirmed, setConfirmed] = useState(false);
  const [managementSelection, setManagementSelection] = useState<{ owner: string; address: string } | null>(null);
  const [entry, setEntry] = useState<SavingsJourneyEntry>("amount");
  const [closingManagement, setClosingManagement] = useState<SavingsManagement | null>(null);
  const [journeyGeneration, setJourneyGeneration] = useState(0);
  const latestJourneyGeneration = useRef(0);
  const previousOwner = useRef(ownerIdentity);
  const opener = useRef<HTMLElement | null>(null);
  const currencyOpener = useRef<HTMLElement | null>(null);
  const [currencyEntry, setCurrencyEntry] = useState<{ kind: "convert" | "currency"; source: CashConversionCurrencyCode } | null>(null);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [currencyUnresolved, setCurrencyUnresolved] = useState(false);
  const [currencyReset, setCurrencyReset] = useState(0);
  const [currencyOwner, setCurrencyOwner] = useState<string | null>(null);
  const [currencySnapshot, setCurrencySnapshot] = useState<BalancesSnapshot | null>(null);
  const currencyBalanceSnapshot = liveSnapshot ?? currencySnapshot;
  const sessionOwner = session?.smartAccount ? dataOwnerKey(session) : null;
  const currencyReady =
    view === "cash" &&
    currencyOwner !== null &&
    sessionOwner === currencyOwner &&
    Boolean(session?.smartAccount) &&
    Boolean(currencyBalanceSnapshot) &&
    Boolean(fetchAccountResource);
  if (currencyOwner !== null && !currencyReady) {
    setCurrencyOpen(false);
    setCurrencyUnresolved(false);
    setCurrencyEntry(null);
    setCurrencySnapshot(null);
    setCurrencyOwner(null);
    setConfirmed(false);
  }
  useIdlePreload(CashCurrencySheet.preload, view === "cash" && Boolean(session?.smartAccount));
  function openCurrency(kind: "convert" | "currency", source: CashConversionCurrencyCode, opener: HTMLElement) {
    if (!session?.smartAccount || !liveSnapshot || balanceStatus !== "ready") return;
    currencyOpener.current = opener;
    const owner = dataOwnerKey(session);
    if (!currencyUnresolved || currencyOwner !== owner || currencyEntry?.kind !== kind || currencyEntry.source !== source) {
      setCurrencyReset((key) => key + 1);
      setCurrencyEntry({ kind, source });
      setCurrencyUnresolved(false);
    }
    setCurrencyOwner(owner);
    setCurrencySnapshot(liveSnapshot);
    void CashCurrencySheet.preload();
    setCurrencyOpen(true);
  }
  function currencyClosed(unresolved: boolean) {
    setCurrencyUnresolved(unresolved);
    setConfirmed(false);
    if (!unresolved) setCurrencyEntry(null);
    const element = currencyOpener.current;
    currencyOpener.current = null;
    if (element?.isConnected && !element.matches(":disabled")) element.focus();
    else document.querySelector<HTMLButtonElement>("[data-shell-back] button:not(:disabled)")?.focus();
  }
  const autoClosed = useRef<{ mode: Mode; target: MorphoVaultCandidate } | null>(null);
  const [autoClosedSelection, setAutoClosedSelection] = useState<{ mode: Mode; target: MorphoVaultCandidate } | null>(null);
  const [routedJourney, setRoutedJourney] = useState<Mode | null>(null);
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
  const leavingForAddMoney = useRef(false);
  const target = targetSelection?.owner === ownerIdentity ? targetSelection.candidate : null;
  const managementAddress = managementSelection?.owner === ownerIdentity ? managementSelection.address : null;
  const routeMode =
    routing?.state.flow === "save-deposit"
      ? "deposit"
      : routing?.state.flow === "save-withdraw"
      ? "withdraw"
      : null;
  const mode = routing ? routeMode : localMode;
  const accountIdentity = session?.smartAccount ? dataOwnerKey(session) : null;
  const actionsQueryKey = useMemo(
    () => accountIdentity ? ownerQueryKey(accountIdentity, "actions") : ["unauthenticated", "savings-actions-disabled"],
    [accountIdentity]
  );
  const [pendingFirstDeposit, setPendingFirstDeposit] = useState<PendingFirstDeposit | null>(null);
  const [depositFailed, setDepositFailed] = useState(false);
  const markDepositFailed = useCallback(() => setDepositFailed(true), [setDepositFailed]);
  const savingsPortfolioEmpty = summary?.funded === false;
  const actions = useHomeQuery({
    queryKey: actionsQueryKey,
    enabled: (view === "savings" || currencyOpen) && accountIdentity !== null && fetchAccountResource !== undefined,
    ...recentActionsQueryOptions,
    refetchOnWindowFocus: (query) => refetchFailedRecentActions(query) || (savingsPortfolioEmpty ? "always" : false),
    refetchOnReconnect: (query) => refetchFailedRecentActions(query) || (savingsPortfolioEmpty ? "always" : false),
    refetchInterval: (query) => savingsEntryRefreshInterval({
      funded: summary?.funded,
      inFlightDeposits: inFlightSavingsDepositActions(scopedSavingsDeposits(query.state.data, session), liveSnapshot).length,
    }),
    meta: accountIdentity ? ownerQueryMeta(accountIdentity, "owner") : undefined,
    queryFn: ({ signal }) => fetchRecentActions((requestSignal) => fetchAccountResource
      ? fetchAccountResource("/api/actions", { signal: requestSignal })
      : Promise.reject(new Error("Actions unavailable")), signal),
  });
  const actionsStatus = useRecentActionsStatus({
    hasData: actions.data !== undefined,
    isPending: actions.isPending && actions.fetchStatus !== "idle",
    isError: actions.isError,
    dataUpdatedAt: actions.dataUpdatedAt,
    errorUpdatedAt: actions.errorUpdatedAt,
  }, { tolerateStaleError: false });
  const scopedServerDeposits = useMemo(
    () => scopedSavingsDeposits(actions.data, session),
    [actions.data, session]
  );
  const serverInFlightDeposits = useMemo(
    () => inFlightSavingsDepositActions(scopedServerDeposits, liveSnapshot),
    [scopedServerDeposits, liveSnapshot]
  );
  const usdc = liveSnapshot?.holdings.find((holding) => holding.id === "usdc")?.balance;
  const management = useMemo(() => managementAddress ? savingsManagement({
    address: managementAddress,
    snapshot: liveSnapshot,
    metadata,
    nowMs: rateNowMs,
    regionId: region,
    actionsAvailable: Boolean(session?.smartAccount),
    usdcBaseUnits: usdc?.status === "ready" ? usdc.baseUnits : null,
    usdcUnavailable: usdc?.status !== "ready" || balanceStatus === "failed",
  }) : null, [managementAddress, liveSnapshot, metadata, rateNowMs, region, session?.smartAccount, usdc, balanceStatus]);
  const activeManagement = management ?? closingManagement;
  const [previousAccountIdentity, setPreviousAccountIdentity] = useState(accountIdentity);
  const fundedNow = Boolean(summary?.funded || liveSnapshot?.holdings.some((holding) =>
    holding.kind === "vault-share" && holding.underlyingBalance?.status === "ready" &&
    BigInt(holding.underlyingBalance.baseUnits) > BigInt(0)
  ));
  const localPendingUnresolved = !fundedNow && pendingFirstDeposit !== null &&
    pendingFirstDeposit.account === accountIdentity &&
    !savingsDepositRetired(scopedServerDeposits, liveSnapshot, pendingFirstDeposit.action.id);
  const undisplayableLocalDeposit = pendingFirstDeposit !== null &&
    pendingFirstDeposit.account === accountIdentity &&
    pendingDepositDisplay(pendingFirstDeposit.action) === null;
  const undisplayableInFlightDeposit = !fundedNow &&
    (serverInFlightDeposits.some((action) => pendingDepositDisplay(action) === null) ||
      undisplayableLocalDeposit);
  const unparsedSavingsDeposit = useMemo(
    () => unparsedSavingsDepositBlocker(actions.data, session, liveSnapshot),
    [actions.data, session, liveSnapshot],
  );
  const actionHistoryUnresolved = actionsStatus === "error" && !fundedNow && fetchAccountResource !== undefined;
  const savingsEntryUnresolved = actionHistoryUnresolved || undisplayableInFlightDeposit || unparsedSavingsDeposit;
  const depositEntryBlocked = !fundedNow &&
    (localPendingUnresolved || serverInFlightDeposits.length > 0 || savingsEntryUnresolved || actionsStatus === "loading");
  const currencyDepositBlocked = !fundedNow && (depositEntryBlocked || actions.data === undefined);
  const firstUseHistoryPending = hasHistorySource && firstUseHistoryFloor > 0 &&
    Math.max(actions.dataUpdatedAt, actions.errorUpdatedAt) < firstUseHistoryFloor;
  const firstUseHistoryBlocked = !fundedNow && !confirmed &&
    (firstUseHistoryPending || savingsEntryUnresolved || actions.isFetching);
  const localPendingAction = pendingFirstDeposit?.account === accountIdentity ? pendingFirstDeposit.action : null;
  const pendingDeposits = useMemo(
    () => fundedNow ? [] : pendingSavingsDeposits(actions.data, session, localPendingAction, liveSnapshot),
    [fundedNow, actions.data, session, localPendingAction, liveSnapshot]
  );
  if (previousAccountIdentity !== accountIdentity) {
    setPreviousAccountIdentity(accountIdentity);
    setPendingFirstDeposit(null);
    setDepositFailed(false);
    setTargetSelection(null);
    setChoosing(false);
    setConfirmed(false);
    setLocalMode(null);
  } else if (pendingFirstDeposit !== null &&
    (fundedNow || savingsDepositRetired(scopedServerDeposits, liveSnapshot, pendingFirstDeposit.action.id))) {
    setPendingFirstDeposit(null);
  }
  const chooseFlowSuperseded = choosing && fundedNow && !confirmed && mode !== null && target === null;
  if (!routing && chooseFlowSuperseded) setLocalMode(null);
  const chooseFlowCleared = useRef(false);
  useEffect(() => {
    if (!routing || !chooseFlowSuperseded) {
      chooseFlowCleared.current = false;
      return;
    }
    if (chooseFlowCleared.current) return;
    chooseFlowCleared.current = true;
    routing.clearFlow({ mode: "replace" });
  }, [routing, chooseFlowSuperseded]);
  const firstDepositSuperseded = !confirmed && !fundedNow &&
    (serverInFlightDeposits.length > 0 || savingsEntryUnresolved || localPendingUnresolved);
  const depositFlowSuperseded = mode === "deposit" && firstDepositSuperseded;
  if (!routing && depositFlowSuperseded) setLocalMode(null);

  useEffect(() => {
    if (!routing || !initialRoute.current || normalized.current) return;
    normalized.current = true;
    if (readClientHistoryFlag("cashSavingsFlowPushed")) return;
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
    setChoosing(false);
    setManagementSelection(null);
    setClosingManagement(null);
    setConfirmed(false);
    setLocalMode(null);
    autoClosed.current = null;
    opener.current = null;
    currencyOpener.current = null;
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
  if (!mode && autoClosedSelection !== null) setAutoClosedSelection(null);
  if (!mode && routedJourney !== null) setRoutedJourney(null);
  const routedDepositCandidate = best && usdc?.status === "ready" &&
    !(summary?.funded === false && BigInt(usdc.baseUnits) === BigInt(0)) ? best : null;
  const routedCandidate = routeMode === "deposit" ? routedDepositCandidate
    : routeMode === "withdraw" && withdrawable.length === 1 ? withdrawable[0]!.candidate
    : null;
  const routedOpenBlocked = routeMode === "deposit" &&
    (choosing || query.isError || (!fundedNow &&
      (savingsEntryUnresolved || serverInFlightDeposits.length > 0 || actionsStatus === "loading" ||
        pendingFirstDeposit?.account === accountIdentity)));
  const routedSelection = routing && view === "savings" && routedCandidate && !target &&
    autoClosedSelection?.mode !== routeMode && balanceStatus !== "failed" && !routedOpenBlocked &&
    liveSnapshot && session?.smartAccount && (metadata || query.isError) ? routedCandidate : null;
  const routedEntryNowMs = useNow(routedSelection, noDeadline);
  if (routedSelection) {
    setRoutedJourney(routeMode);
    setTargetSelection({ owner: ownerIdentity, candidate: routedSelection });
    setEntry("amount");
    if (routeMode === "deposit" && !fundedNow && hasHistorySource) setFirstUseHistoryFloor(routedEntryNowMs);
  }
  const routedDepositNeedsFreshHistory = routedJourney === "deposit" && !fundedNow && hasHistorySource;
  useEffect(() => {
    if (!routedDepositNeedsFreshHistory) return;
    void browserHomeQueryClient()?.refetchQueries({ queryKey: actionsQueryKey });
  }, [routedDepositNeedsFreshHistory, actionsQueryKey]);

  useEffect(() => {
    if (!routing) return;
    if (depositFlowSuperseded && autoClosed.current?.mode !== mode) {
      routing.clearFlow({ mode: "replace" });
      return;
    }
    if (view !== "savings" || !routeMode || target || (routeMode === "deposit" && choosing) || autoClosed.current?.mode === routeMode) return;
    if (balanceStatus === "failed" || (routeMode === "deposit" && (query.isError || (pendingFirstDeposit?.account === accountIdentity && !fundedNow)))) {
      routing.clearFlow({ mode: "replace" });
      return;
    }
    if (!liveSnapshot || !session?.smartAccount || (!metadata && !query.isError)) return;
    if (routeMode === "deposit") {
      if (!fundedNow && actionsStatus === "loading") return;
      if (!routedDepositCandidate) routing.clearFlow({ mode: "replace" });
      return;
    }
    if (withdrawable.length !== 1) routing.clearFlow({ mode: "replace" });
  }, [
    routing,
    view,
    routeMode,
    mode,
    target,
    choosing,
    confirmed,
    balanceStatus,
    query.isError,
    liveSnapshot,
    metadata,
    session,
    best,
    usdc,
    withdrawable,
    summary?.funded,
    pendingFirstDeposit,
    accountIdentity,
    fundedNow,
    actionsStatus,
    savingsEntryUnresolved,
    depositFlowSuperseded,
    serverInFlightDeposits,
    routedDepositCandidate,
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
  function armFirstDepositHistory() {
    setConfirmed(false);
    setFirstUseHistoryFloor(Date.now());
    if (fetchAccountResource) void actions.refetch();
  }
  async function executeSavingsAction(action: PreparedMoneyAction): Promise<OperationResult> {
    const holdsConfirmation = action.kind === "savings-deposit" || action.kind === "savings-withdraw";
    if (holdsConfirmation) setConfirmed(true);
    const markPending = (submission: PendingFirstDeposit["submission"]) => {
      if (action.kind === "savings-deposit" && accountIdentity) setPendingFirstDeposit({ account: accountIdentity, action, submission });
    };
    try {
      const result = await executeMoneyAction(action);
      if (result.status !== "rejected" && result.status !== "failed") markPending("submitted");
      else if (holdsConfirmation) setConfirmed(false);
      return result;
    } catch (error) {
      if (error instanceof TransferExecutionError && (error.reason === "submission-unknown" || error.reason === "dispatch-unknown")) markPending("ambiguous");
      else if (holdsConfirmation) setConfirmed(false);
      throw error;
    }
  }
  function startSaving() {
    setDepositFailed(false);
    autoClosed.current = null;
    leavingForAddMoney.current = false;
    latestJourneyGeneration.current += 1;
    setJourneyGeneration(latestJourneyGeneration.current);
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    armFirstDepositHistory();
    setEntry("amount");
    setTargetSelection(null);
    setConfirmed(false);
    setChoosing(true);
    if (routing) routing.setFlow("save-deposit");
    else setLocalMode("deposit");
  }
  function open(nextMode: Mode, candidate: MorphoVaultCandidate) {
    autoClosed.current = null;
    setAutoClosedSelection(null);
    leavingForAddMoney.current = false;
    if (nextMode === "deposit" && !fundedNow) armFirstDepositHistory();
    if (managementAddress === null) {
      latestJourneyGeneration.current += 1;
      setJourneyGeneration(latestJourneyGeneration.current);
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setEntry("amount");
    }
    setTargetSelection({ owner: ownerIdentity, candidate });
    setChoosing(false);
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
    setChoosing(false);
    setConfirmed(false);
    if (leavingForAddMoney.current) {
      leavingForAddMoney.current = false;
      return;
    }
    if (element?.isConnected && !element.matches(":disabled")) element.focus();
    else
      document
        .querySelector<HTMLButtonElement>(
          "[data-shell-back] button:not(:disabled)"
        )
        ?.focus();
  }
  const shouldAutoClose = mode && target && !confirmed &&
    (balanceStatus === "failed" || availableBaseUnits === null) &&
    (autoClosedSelection?.mode !== mode || autoClosedSelection.target !== target);
  if (shouldAutoClose) {
    setAutoClosedSelection({ mode, target });
    if (entry === "management") {
      setClosingManagement(management);
      setManagementSelection(null);
    }
    if (!routing) setLocalMode(null);
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
    autoClosed.current = { mode, target };
    if (routing) routing.clearFlow({ mode: "replace" });
  }, [mode, target, balanceStatus, availableBaseUnits, confirmed, routing]);
  const closedJourney = () => { if (latestJourneyGeneration.current === journeyGeneration) restoreFocus(); };
  const sheetOpen = view === "savings" && session !== null && (management !== null ||
    (choosing && mode === "deposit") ||
    (mode !== null && target !== null && ((availableBaseUnits !== null && balanceStatus !== "failed") || confirmed)));
  const currentTarget = target && metadata?.candidates.find((candidate) =>
    candidate.vaultAddress.toLowerCase() === target.vaultAddress.toLowerCase()
  );
  const destinationRate = currentTarget && metadata ? getSavingsRateState(currentTarget, {
    metadataFetchedAt: metadata.source.fetchedAt,
    metadataStale: metadata.stale,
    nowMs: rateNowMs,
  }) : null;
  const depositCashState: "ready" | "empty" | "unavailable" =
    availableBaseUnits === null ? "unavailable" : BigInt(availableBaseUnits) > BigInt(0) ? "ready" : "empty";
  const pickerOptions = choosing && metadata ? metadata.candidates.map((candidate) => {
    const rate = getSavingsRateState(candidate, {
      metadataFetchedAt: metadata.source.fetchedAt, metadataStale: metadata.stale, nowMs: rateNowMs,
    });
    return {
      candidate,
      name: candidate.name,
      rateLabel: rate.status === "unavailable" ? "Rate unavailable"
        : `${formatPresentationPercentage(rate.value, region)} APY${rate.status === "stale" ? " at last update" : ""}`,
      rate: rate.status === "unavailable" ? -1 : rate.value,
      disabled: rate.status === "unavailable" || depositCashState !== "ready" || firstUseHistoryPending,
    };
  }).sort((left, right) => right.rate - left.rate) : [];
  const destinationLabel = target
    ? `${target.name}${destinationRate && destinationRate.status !== "unavailable"
      ? ` · ${formatPresentationPercentage(destinationRate.value, region)} APY${destinationRate.status === "stale" ? " at last update" : ""}` : ""}`
    : undefined;
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
          regionId={region}
          snapshot={liveSnapshot}
          pendingCashout={pendingCashout}
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
          actionsAvailable={Boolean(session?.smartAccount)}
          onConvert={(element) => openCurrency("convert", "USD", element)}
          onConvertIntent={() => void CashCurrencySheet.preload()}
          onCurrencyIntent={() => void CashCurrencySheet.preload()}
          onOpenCurrency={session?.smartAccount ? (code, element) => openCurrency("currency", code, element) : undefined}
          onRetryBalances={onRetryBalances}
        />
      ) : (
        <SavingsDetail
          regionId={region}
          key={accountIdentity ?? "signed-out"}
          snapshot={liveSnapshot}
          balanceStatus={balanceStatus}
          metadata={metadata}
          vaultStatus={vaultStatus}
          nowMs={rateNowMs}
          now={now}
          growthAuthority={growthAuthority}
          summary={summary}
          balanceStale={balanceStale}
          pendingDeposits={pendingDeposits}
          depositFailed={depositFailed}
          pendingActionsLoading={actionsStatus === "loading" && !fundedNow}
          pendingActionsError={savingsEntryUnresolved}
          depositEntryBlocked={depositEntryBlocked}
          onRetryActions={() => void actions.refetch()}
          onAddMoney={onAddMoney}
          actionsAvailable={Boolean(session?.smartAccount)}
          onStartSaving={startSaving}
          onDepositVault={(candidate) => open("deposit", candidate)}
          onManageVault={openManagement}
          onRetryVaults={() => void query.refetch()}
          onRetryBalances={onRetryBalances}
        />
      )}
      {pendingFirstDeposit && pendingFirstDeposit.account === accountIdentity && !fundedNow ? (
        <PendingFirstDepositWatcher
          pending={pendingFirstDeposit}
          fetchAccountResource={fetchAccountResource}
          onFailed={(actionId) => {
            setPendingFirstDeposit((current) => current?.action.id === actionId ? null : current);
            setConfirmed(false);
            setDepositFailed(true);
          }}
        />
      ) : null}
      <RehydratedDepositFailureWatcher
        key={`rehydrated-deposit-${accountIdentity ?? "signed-out"}`}
        deposits={scopedServerDeposits}
        inFlight={serverInFlightDeposits}
        funded={fundedNow}
        onFailed={markDepositFailed}
      />
      {currencyReady && currencyEntry && session?.smartAccount && currencyBalanceSnapshot && fetchAccountResource ? <CashCurrencySheet key={`${currencyReset}:${currencyOwner}`} open={currencyOpen} entry={currencyEntry}
        session={session} snapshot={currencyBalanceSnapshot} best={best} balanceStale={balanceStale || !liveSnapshot} depositEntryBlocked={currencyDepositBlocked}
        historyBlocked={firstUseHistoryBlocked || firstDepositSuperseded} onSaveEntry={armFirstDepositHistory}
        fetchAccountResource={fetchAccountResource} prepareMoneyAction={prepareMoneyAction} executeMoneyAction={executeSavingsAction}
        onCancel={() => setCurrencyOpen(false)} onClosed={currencyClosed} onAddMoney={onAddMoney}
        onConfirmed={() => invalidateAfterAction(getHomeQueryClient(), dataOwnerKey(session))} /> : null}
      {session && (activeManagement !== null || target !== null || choosing) ? (
        <SavingsJourney
          titleId={SAVINGS_JOURNEY_TITLE_ID}
          key={`${session.user.subject}:${session.smartAccount?.address ?? ""}:${activeManagement?.address ?? target?.vaultAddress ?? ""}:${entry}`}
          open={sheetOpen}
          entry={entry}
          management={activeManagement}
          mode={mode}
          session={session}
          candidate={target}
          picker={choosing ? {
            options: pickerOptions,
            cash: depositCashState,
            onRetryBalances,
            onRetryVaults: () => void query.refetch(),
            onPick: (candidate) => setTargetSelection({ owner: ownerIdentity, candidate }),
            onBack: () => setTargetSelection(null),
            onAddMoney: () => {
              if (routing) {
                leavingForAddMoney.current = true;
                setTargetSelection(null);
                setChoosing(false);
                onAddMoney({ replaceFlow: true });
              } else {
                close();
                onAddMoney();
              }
            },
          } : undefined}
          availableLabel={centsLabel}
          destinationLabel={mode === "deposit" ? destinationLabel : undefined}
          historyBlocked={mode === "deposit" && firstUseHistoryBlocked}
          availableBaseUnits={availableBaseUnits}
          availableStale={
            balanceStale || (confirmed && availableBaseUnits === null)
          }
          fetchAccountResource={fetchAccountResource}
          prepareMoneyAction={prepareMoneyAction}
          executeMoneyAction={executeSavingsAction}
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
  pendingCashout: PendingCashoutEstimate;
}): JSX.Element {
  const { view, onOpenSavings, regionReady = true, pendingCashout } = props;
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
      pendingCashout={pendingCashout}
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
      onAddMoney={(options) => {
        void preloadAddMoneySheet();
        routing?.setFlow("add-money", { mode: options?.replaceFlow ? "replace" : "push" });
      }}
      prepareMoneyAction={account.prepareMoneyAction}
      executeMoneyAction={account.executeMoneyAction}
      fetchAccountResource={account.fetchAccountResource}
    />
  );
}
