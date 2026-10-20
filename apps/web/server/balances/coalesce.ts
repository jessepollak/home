import "server-only";

import type { PortfolioAddress } from "@/config/portfolio-assets";
import { registryHoldingsMatchExpectations } from "@/shared/balances/registry-expectations";
import type { RegionId } from "@/config/regions";
import {
  BALANCES_CHAIN_ID,
  type BalancesSnapshot,
  type HoldingValue,
} from "@/shared/balances/types";
import { enumerateBalances as defaultEnumerateBalances } from "./enumerate";
import {
  priceBalances as defaultPriceBalances,
  type PriceBalancesResult,
  type ValuationMode,
} from "./price";
import { borrowReadComplete, borrowReadCurrent, carryForwardBorrow, readBorrowPositions as defaultReadBorrow } from "./borrow";
import { readBalances as defaultReadBalances } from "./read";
import { resolveBalances as defaultResolveBalances } from "./resolve";
import { assembleBalancesSnapshot } from "./snapshot";
import { emitServerEvent, observeSafely, writeObservabilityEvent } from "@/server/observability/log";
import type {
  BalancesReadDurations,
  BalancesReadIncomplete,
  BalancesReadOutcome,
  ObservabilityEvent,
} from "@/server/observability/schema";
import {
  getBalanceSnapshotStore,
  type BalanceSnapshotRevision,
  type BalanceSnapshotRow,
  type BalanceSnapshotStore,
} from "./snapshot-store";
import type {
  BalancesEnumeration,
  BalancesRead,
  BalancesUniverse,
  BorrowRead,
  ReadHolding,
} from "./types";
import { getBalancesUniverse } from "./universe";

export const BALANCES_BACKSTOP_MS = 120_000;
export const BALANCES_BORROW_RETRY_MS = 30_000;

type Dependencies = {
  store?: BalanceSnapshotStore;
  readUniverse?: () => Promise<BalancesUniverse>;
  enumerateBalances?: (
    owner: PortfolioAddress,
    signal?: AbortSignal,
    cursor?: string | null,
  ) => Promise<BalancesEnumeration>;
  readBalances?: (
    universe: BalancesUniverse,
    owner: PortfolioAddress,
    signal?: AbortSignal,
  ) => Promise<BalancesRead>;
  readBorrow?: (owner: PortfolioAddress, at: BalancesRead["block"]) => Promise<BorrowRead>;
  resolveBalances?: (
    read: BalancesRead,
    enumeration: BalancesEnumeration,
  ) => Promise<BalancesRead>;
  priceBalances?: (
    read: BalancesRead,
    region: RegionId,
    mode: ValuationMode,
    signal?: AbortSignal,
    requestStartedAtMs?: number,
  ) => Promise<PriceBalancesResult>;
  now?: () => Date;
  nowMs?: () => number;
  backstopMs?: number;
  borrowRetryMs?: number;
  log?: (event: ObservabilityEvent) => unknown;
  schedule?: (task: Promise<unknown> | (() => Promise<unknown>)) => void;
  registryHoldingsMatch?: typeof registryHoldingsMatchExpectations;
};

type ObservedResult = {
  read: BalancesRead;
  stale: boolean;
  outcome: Exclude<BalancesReadOutcome, "error">;
  durationMs: Omit<
    BalancesReadDurations,
    "price" | "pricing-index" | "pricing-compute" | "snapshot-assemble" | "valuation-store" | "codex" | "coinbase" | "total"
  >;
};

type ObservationDurations = ObservedResult["durationMs"];

export function createBalancesService(dependencies: Dependencies = {}) {
  const store = dependencies.store ?? getBalanceSnapshotStore();
  const readUniverse = dependencies.readUniverse ?? getBalancesUniverse;
  const enumerateBalances = dependencies.enumerateBalances ?? defaultEnumerateBalances;
  const readBalances = dependencies.readBalances ?? defaultReadBalances;
  const resolveBalances = dependencies.resolveBalances ?? defaultResolveBalances;
  const priceBalances = dependencies.priceBalances ?? defaultPriceBalances;
  const readBorrow = dependencies.readBorrow ?? defaultReadBorrow;
  const now = dependencies.now ?? (() => new Date());
  const nowMs = dependencies.nowMs ?? (() => Date.now());
  const backstopMs = dependencies.backstopMs ?? BALANCES_BACKSTOP_MS;
  const borrowRetryMs = dependencies.borrowRetryMs ?? BALANCES_BORROW_RETRY_MS;
  const log = dependencies.log ?? writeObservabilityEvent;
  const registryHoldingsMatch = dependencies.registryHoldingsMatch ?? registryHoldingsMatchExpectations;
  const schedule = dependencies.schedule ?? ((task) => {
    void (typeof task === "function" ? task() : task);
  });
  const inFlight = new Map<string, Promise<ObservedResult>>();
  const revalidating = new Set<string>();

  async function getObserved(owner: PortfolioAddress): Promise<ObservedResult> {
    const address = owner.toLowerCase() as PortfolioAddress;
    const existing = inFlight.get(address);
    if (existing) return existing;
    const pending = selectObservation(address).finally(() => {
      if (inFlight.get(address) === pending) inFlight.delete(address);
    });
    inFlight.set(address, pending);
    return pending;
  }

  async function selectObservation(owner: PortfolioAddress): Promise<ObservedResult> {
    const durationMs = emptyObservationDurations();
    let row: BalanceSnapshotRow | null = null;
    try {
      row = await timeStage(nowMs, durationMs, "store-read", () =>
        store.get(BALANCES_CHAIN_ID, owner));
    } catch {
      observeStoreFailure("BALANCE_STORE_READ_FAILED");
    }
    const current = now();
    const hot = row !== null && Boolean(row.hotUntil) &&
      Date.parse(row.hotUntil!) > current.getTime();
    const signaled = row !== null && Boolean(row.staleAt) &&
      Date.parse(row.staleAt!) > Date.parse(row.observedAt);
    const expired = row !== null &&
      current.getTime() - Date.parse(row.observedAt) > backstopMs;
    const degraded = row !== null && needsFullObservation(readFromRow(row), current, borrowRetryMs);
    const required = signaled || expired || degraded;
    const registryChanged = row !== null && (hasUnavailableRegistry(row.holdings) || (!hot && !registryHoldingsMatch(row.holdings)));

    if (row && !hot && !registryChanged) {
      if (required) scheduleRevalidation(owner, row, "background-full");
      else if (row.enumerationCursor) scheduleRevalidation(owner, row, "background-resume");
      return {
        read: readFromRow(row),
        stale: required || !borrowReadCurrent(readFromRow(row)),
        outcome: required ? "revalidating" : "served-row",
        durationMs,
      };
    }

    try {
      const registryOnly = Boolean(hot && row && !registryChanged);
      const observed = registryOnly
        ? await observeRegistryOnly(owner, row!, durationMs)
        : await observeFull(owner, row, durationMs);
      const winner = await persistObserved(owner, observed.read, observed.basis, durationMs);
      const currentWinner = winner && registryHoldingsMatch(winner.holdings) && !hasUnavailableRegistry(winner.holdings) ? winner : null;
      const refresh = registryOnly &&
        (signaled || expired || needsFullObservation(observed.read, current, borrowRetryMs));
      if (refresh) scheduleRevalidation(owner, row!, "background-full");
      return {
        read: currentWinner ?? observed.read,
        stale: refresh || observed.read.coverage.registry === "partial" || !borrowReadCurrent(observed.read),
        outcome: registryOnly ? "registry-only" : "full",
        durationMs,
      };
    } catch (error) {
      if (!row || registryChanged || !registryHoldingsMatch(row.holdings)) throw error;
      if (required) scheduleRevalidation(owner, row, "background-full");
      return {
        read: readFromRow(row),
        stale: true,
        outcome: "stale-fallback",
        durationMs,
      };
    }
  }

  async function latestRow(owner: PortfolioAddress, fallback: BalanceSnapshotRow | null): Promise<BalanceSnapshotRow | null> {
    try {
      return (await store.get(BALANCES_CHAIN_ID, owner)) ?? fallback;
    } catch {
      observeStoreFailure("BALANCE_STORE_READ_FAILED");
      return fallback;
    }
  }

  async function persistObserved(
    owner: PortfolioAddress,
    observed: BalancesRead,
    basis: BalanceSnapshotRevision | null,
    durationMs: ObservationDurations,
  ): Promise<BalancesRead | null> {
    try {
      const wrote = await timeStage(nowMs, durationMs, "store-write", () =>
        store.putObservation(observationFromRead(owner, observed), basis));
      if (!wrote) {
        const winner = await timeStage(nowMs, durationMs, "store-read", () =>
          store.get(BALANCES_CHAIN_ID, owner));
        return winner ? readFromRow(winner) : null;
      }
    } catch {
      observeStoreFailure("BALANCE_STORE_WRITE_FAILED");
    }
    return null;
  }

  function scheduleRevalidation(
    owner: PortfolioAddress,
    row: BalanceSnapshotRow,
    outcome: "background-full" | "background-resume",
  ): void {
    const address = owner.toLowerCase() as PortfolioAddress;
    if (revalidating.has(address)) return;
    revalidating.add(address);
    const task = async () => {
      const startedAt = nowMs();
      const durationMs = emptyObservationDurations();
      try {
        const observed = await observeFull(address, row, durationMs);
        await persistObserved(address, observed.read, observed.basis, durationMs);
        emitBalancesRead(log, outcome, {
          ...durationMs,
          price: 0,
          "valuation-store": 0,
          codex: 0,
          coinbase: 0,
          total: Math.max(0, nowMs() - startedAt),
        }, observed.read.coverage);
      } catch {
        emitBalancesRead(log, "background-error", {
          ...durationMs,
          price: 0,
          "valuation-store": 0,
          codex: 0,
          coinbase: 0,
          total: Math.max(0, nowMs() - startedAt),
        }, row.coverage);
      } finally {
        revalidating.delete(address);
      }
    };
    try {
      schedule(task);
    } catch {
      revalidating.delete(address);
    }
  }

  async function observeFull(
    owner: PortfolioAddress,
    row: BalanceSnapshotRow | null,
    durationMs: ObservationDurations,
  ): Promise<{ read: BalancesRead; basis: BalanceSnapshotRevision | null }> {
    const consumedCursor = row?.enumerationCursor ?? null;
    const universeRequest = readUniverse();
    const registryRequest = timeStage(nowMs, durationMs, "registry-read", async () =>
      readBalances(await universeRequest, owner));
    const enumerationRequest = timeStage(nowMs, durationMs, "enumerate", () =>
      enumerateBalances(owner, undefined, consumedCursor));
    const borrowRequest = registryRequest.then((registryRead) => readBorrow(owner, registryRead.block));
    const [registryRead, enumeration, borrow] = await Promise.all([
      registryRequest,
      enumerationRequest,
      borrowRequest,
    ]);
    const resolved = await timeStage(nowMs, durationMs, "resolve", () =>
      resolveBalances(registryRead, enumeration));
    const latest = await latestRow(owner, row);
    const resumed = latest && (consumedCursor !== null || enumeration.status !== "complete" || resolved.coverage.catalog !== "complete" || losesEnrichment(resolved, latest))
      ? mergeResumedHoldings(resolved, latest, enumeration, consumedCursor)
      : resolved;
    return {
      read: {
        ...carryForwardRegistry(resumed, latest),
        borrow: carryForwardBorrow(borrow, latest?.borrow),
        observedAt: latest && enumeration.status === "unavailable"
          ? latest.observedAt
          : resumed.observedAt,
        enumerationCursor: enumeration.status === "unavailable"
          ? latest?.enumerationCursor ?? null
          : enumeration.status === "complete"
            ? null
            : enumeration.nextCursor,
      },
      basis: latest ? { blockNumber: latest.blockNumber, observedAt: latest.observedAt } : null,
    };
  }

  async function observeRegistryOnly(
    owner: PortfolioAddress,
    row: BalanceSnapshotRow,
    durationMs: ObservationDurations,
  ): Promise<{ read: BalancesRead; basis: BalanceSnapshotRevision | null }> {
    const registryRead = await timeStage(nowMs, durationMs, "registry-read", async () => {
      const universe = await readUniverse();
      return readBalances(universe, owner);
    });
    const borrow = await readBorrow(owner, registryRead.block);
    const resolvedRegistry = await timeStage(nowMs, durationMs, "resolve", () =>
      resolveBalances(registryRead, unavailableEnumeration()));
    const latest = (await latestRow(owner, row)) ?? row;
    const withEnrichment = carryForwardRegistry(resolvedRegistry, latest);
    const registryKeys = new Set(withEnrichment.holdings.filter((holding) => holding.source === "registry").map((holding) => holding.key));
    return {
      read: {
        ...withEnrichment,
        borrow: carryForwardBorrow(borrow, latest.borrow),
        observedAt: latest.observedAt,
        holdings: [
          ...withEnrichment.holdings.filter((holding) => holding.source === "registry"),
          ...latest.holdings.filter((holding) => holding.source !== "registry" && !registryKeys.has(holding.key)),
        ],
        coverage: {
          registry: withEnrichment.coverage.registry,
          catalog: latest.coverage.catalog,
        },
        enumerationCursor: latest.enumerationCursor,
      },
      basis: { blockNumber: latest.blockNumber, observedAt: latest.observedAt },
    };
  }

  return async function getBalancesSnapshot(
    owner: PortfolioAddress,
    region: RegionId,
    signal?: AbortSignal,
    requestStartedAtMs?: number,
  ): Promise<BalancesSnapshot> {
    const startedAt = nowMs();
    let coverage: Extract<ObservabilityEvent, { kind: "balances-read" }>["coverage"] = {
      registry: "unknown",
      catalog: "unknown",
    };
    try {
      const observed = await getObserved(owner);
      coverage = observed.read.coverage;
      const priceStartedAt = nowMs();
      const priced = await priceBalances(
        observed.read,
        region,
        observed.outcome === "full" ? "bootstrap" : "cached",
        signal,
        requestStartedAtMs ?? startedAt,
      );
      const priceDuration = Math.max(0, nowMs() - priceStartedAt);
      const assembleStartedAt = nowMs();
      const snapshot = assembleBalancesSnapshot({
        owner,
        region,
        read: observed.read,
        holdings: priced.holdings,
        borrow: priced.borrow,
        stale: observed.stale || priced.revalidating,
      });
      const assembleDuration = Math.max(0, nowMs() - assembleStartedAt);
      emitBalancesRead(log, observed.outcome, {
        ...observed.durationMs,
        price: priceDuration,
        "valuation-store": priced.durationMs.store,
        "pricing-index": priced.durationMs.index,
        "pricing-compute": priced.durationMs.compute,
        "snapshot-assemble": assembleDuration,
        codex: priced.durationMs.codex,
        coinbase: priced.durationMs.coinbase,
        total: Math.max(0, nowMs() - startedAt),
      }, coverage, snapshot, observed.read);
      return snapshot;
    } catch (error) {
      emitBalancesRead(log, "error", {
        ...emptyObservationDurations(),
        price: 0,
        "valuation-store": 0,
        codex: 0,
        coinbase: 0,
        total: Math.max(0, nowMs() - startedAt),
      }, coverage);
      throw error;
    }
  };
}

function hasUnavailableRegistry(holdings: readonly ReadHolding[]): boolean {
  return holdings.some((holding) => holding.source === "registry" &&
    [holding.balance, holding.underlyingBalance, holding.withdrawableBalance].some((balance) => balance?.status === "unavailable"));
}

function carryForwardRegistry(read: BalancesRead, row: BalanceSnapshotRow | null): BalancesRead {
  const prior = new Map(row?.holdings.filter((holding) => holding.source === "registry").map((holding) => [holding.key, holding]));
  let carried = false;
  const holdings = read.holdings.map((holding): ReadHolding => {
    if (holding.source !== "registry") return holding;
    const previous = prior.get(holding.key);
    const next = { ...holding };
    for (const field of ["balance", "underlyingBalance", "withdrawableBalance"] as const) {
      if (holding[field]?.status !== "unavailable") continue;
      const balance = previous?.[field];
      if (balance?.status !== "ready") throw new Error("balances-registry-unavailable");
      next[field] = balance;
      carried = true;
    }
    if (next.withdrawableBalance?.status === "ready" && next.underlyingBalance?.status === "ready" &&
      BigInt(next.withdrawableBalance.baseUnits) > BigInt(next.underlyingBalance.baseUnits)) {
      next.withdrawableBalance = next.underlyingBalance;
    }
    return next;
  });
  return { ...read, holdings, coverage: { ...read.coverage, registry: carried ? "partial" : read.coverage.registry } };
}

function needsFullObservation(
  read: Pick<BalancesRead, "coverage" | "borrow" | "block" | "observedAt">,
  current: Date,
  borrowRetryMs: number,
): boolean {
  if (read.coverage.catalog === "unavailable" || read.coverage.registry === "partial") return true;
  return !borrowReadCurrent(read) &&
    current.getTime() - Date.parse(read.observedAt) >= borrowRetryMs;
}

function observationFromRead(
  owner: PortfolioAddress,
  read: BalancesRead,
) {
  return {
    chainId: BALANCES_CHAIN_ID,
    address: owner.toLowerCase() as `0x${string}`,
    blockNumber: read.block.number,
    blockHash: read.block.hash,
    blockTimestamp: read.block.timestamp,
    observedAt: read.observedAt,
    enumerationCursor: read.enumerationCursor ?? null,
    borrow: read.borrow ?? null,
    holdings: read.holdings,
    coverage: read.coverage,
  };
}

function isEnriched(holding: ReadHolding): boolean {
  return holding.source === "catalog" || holding.marketDataResolved === true;
}

function losesEnrichment(resolved: BalancesRead, row: BalanceSnapshotRow): boolean {
  const prior = new Map(row.holdings.filter((holding) => holding.source !== "registry").map((holding) => [holding.key, holding]));
  return resolved.holdings.some((holding) => {
    const previous = prior.get(holding.key);
    return holding.source === "wallet" && !holding.marketDataResolved && previous !== undefined && isEnriched(previous);
  });
}

function mergeResumedHoldings(
  resolved: BalancesRead,
  row: BalanceSnapshotRow,
  enumeration: BalancesEnumeration,
  consumedCursor: string | null,
): BalancesRead {
  const positiveContracts = consumedCursor === null && enumeration.status === "complete"
    ? new Set(enumeration.rows.filter((holding) => BigInt(holding.amountBaseUnits) > BigInt(0)).map((holding) => holding.contractAddress.toLowerCase()))
    : null;
  const holdings = new Map(
    row.holdings
      .filter((holding) => holding.source !== "registry" &&
        (positiveContracts === null || (holding.contractAddress !== null && positiveContracts.has(holding.contractAddress.toLowerCase()))))
      .map((holding) => [holding.key, holding]),
  );
  let preserved = false;
  for (const holding of resolved.holdings) {
    if (holding.source === "registry") holdings.delete(holding.key);
    else {
      const previous = holdings.get(holding.key);
      if (holding.source === "wallet" && !holding.marketDataResolved && previous && isEnriched(previous)) {
        holdings.set(holding.key, { ...previous, balance: holding.balance });
        preserved = true;
      } else holdings.set(holding.key, holding);
    }
  }
  return {
    ...resolved,
    holdings: [
      ...resolved.holdings.filter((holding) => holding.source === "registry"),
      ...holdings.values(),
    ],
    coverage: {
      registry: resolved.coverage.registry,
      catalog: enumeration.status === "unavailable" ||
          (consumedCursor !== null && row.coverage.catalog === "incomplete")
        ? row.coverage.catalog
        : preserved && resolved.coverage.catalog === "complete"
          ? "incomplete"
          : resolved.coverage.catalog,
    },
  };
}

function unavailableEnumeration(): BalancesEnumeration {
  return {
    status: "unavailable",
    rows: [],
    nextCursor: null,
    pagesRead: 0,
    durationMs: 0,
  };
}

function emptyObservationDurations(): ObservationDurations {
  return {
    "store-read": 0,
    enumerate: 0,
    "registry-read": 0,
    resolve: 0,
    "store-write": 0,
  };
}

async function timeStage<T, K extends keyof ObservationDurations>(
  nowMs: () => number,
  durations: ObservationDurations,
  stage: K,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = nowMs();
  try {
    return await run();
  } finally {
    durations[stage] += Math.max(0, nowMs() - startedAt);
  }
}

function emitBalancesRead(
  log: (event: ObservabilityEvent) => unknown,
  outcome: BalancesReadOutcome,
  durationMs: BalancesReadDurations,
  coverage: Extract<ObservabilityEvent, { kind: "balances-read" }>["coverage"],
  snapshot?: BalancesSnapshot,
  read?: BalancesRead,
): void {
  observeSafely(() => log({
    kind: "balances-read",
    route: "/api/balances",
    outcome,
    durationMs,
    coverage,
    incomplete: snapshot && read ? countIncomplete(snapshot, read) : emptyIncomplete(),
  }));
}

function emptyIncomplete(): BalancesReadIncomplete {
  return {
    registry: 0,
    catalog: 0,
    borrow: 0,
    balanceUnavailable: 0,
    valueUnavailable: 0,
    priceUnavailable: 0,
    priceStale: 0,
    fxUnavailable: 0,
    belowMarketGate: 0,
    noQuoteCurrency: 0,
  };
}

function countIncomplete(snapshot: BalancesSnapshot, read: BalancesRead): BalancesReadIncomplete {
  const incomplete = emptyIncomplete();
  incomplete.registry = Number(read.coverage.registry !== "complete");
  incomplete.catalog = Number(read.coverage.catalog !== "complete");
  incomplete.borrow = Number(!borrowReadComplete(read.borrow));
  const lines = [
    ...snapshot.holdings,
    ...snapshot.borrow.positions.flatMap((position) => [position.collateral, position.debt]),
  ];
  for (const line of lines) {
    if (BigInt(line.balance.baseUnits) <= BigInt(0)) continue;
    const key = incompleteValueKey(line.value);
    if (key) incomplete[key] = Math.min(10_000, incomplete[key] + 1);
  }
  return incomplete;
}

function incompleteValueKey(value: HoldingValue): keyof Omit<BalancesReadIncomplete, "registry" | "catalog" | "borrow" | "balanceUnavailable"> | null {
  if (value.status === "priced") return null;
  switch (value.reason) {
    case "price-unavailable":
    case "price-paused":
    case "asset-removed": return "priceUnavailable";
    case "fx-unavailable": return "fxUnavailable";
    case "below-market-gate": return "belowMarketGate";
    case "no-quote-currency": return "noQuoteCurrency";
  }
}

function observeStoreFailure(code: "BALANCE_STORE_READ_FAILED" | "BALANCE_STORE_WRITE_FAILED"): void {
  emitServerEvent("balances-store", {
    route: "/api/balances",
    code,
    outcome: "unavailable",
    durationMs: 0,
  });
}

function readFromRow(row: BalanceSnapshotRow): BalancesRead {
  return {
    block: {
      number: row.blockNumber,
      hash: row.blockHash,
      timestamp: row.blockTimestamp,
    },
    observedAt: row.observedAt,
    holdings: row.holdings,
    coverage: row.coverage,
    enumerationCursor: row.enumerationCursor,
    borrow: row.borrow,
  };
}
