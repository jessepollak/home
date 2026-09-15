import "server-only";

import type { PortfolioAddress } from "@/config/portfolio-assets";
import type { RegionId } from "@/config/regions";
import {
  BALANCES_CHAIN_ID,
  type BalancesSnapshot,
  type Holding,
} from "@/shared/balances/types";
import { enumerateBalances as defaultEnumerateBalances } from "./enumerate";
import { priceBalances as defaultPriceBalances } from "./price";
import { readBalances as defaultReadBalances } from "./read";
import { resolveBalances as defaultResolveBalances } from "./resolve";
import { assembleBalancesSnapshot } from "./snapshot";
import { emitServerEvent, writeObservabilityEvent } from "@/server/observability/log";
import type {
  BalancesReadDurations,
  BalancesReadOutcome,
  ObservabilityEvent,
} from "@/server/observability/schema";
import {
  getBalanceSnapshotStore,
  type BalanceSnapshotRow,
  type BalanceSnapshotStore,
} from "./snapshot-store";
import type {
  BalancesEnumeration,
  BalancesRead,
  BalancesUniverse,
} from "./types";
import { getBalancesUniverse } from "./universe";

export const BALANCES_BACKSTOP_MS = 120_000;

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
  resolveBalances?: (
    read: BalancesRead,
    enumeration: BalancesEnumeration,
  ) => Promise<BalancesRead>;
  priceBalances?: (read: BalancesRead, region: RegionId) => Promise<Holding[]>;
  now?: () => Date;
  nowMs?: () => number;
  backstopMs?: number;
  log?: (event: ObservabilityEvent) => unknown;
  /** Starts detached work immediately; the composition root may retain it with `after()`. */
  schedule?: (task: Promise<unknown> | (() => Promise<unknown>)) => void;
};

type ObservedResult = {
  read: BalancesRead;
  stale: boolean;
  outcome: Exclude<BalancesReadOutcome, "error">;
  durationMs: Omit<BalancesReadDurations, "price" | "total">;
};

type ObservationDurations = ObservedResult["durationMs"];

/** Persistent observation selection with per-instance, per-owner in-flight dedupe. */
export function createBalancesService(dependencies: Dependencies = {}) {
  const store = dependencies.store ?? getBalanceSnapshotStore();
  const readUniverse = dependencies.readUniverse ?? getBalancesUniverse;
  const enumerateBalances = dependencies.enumerateBalances ?? defaultEnumerateBalances;
  const readBalances = dependencies.readBalances ?? defaultReadBalances;
  const resolveBalances = dependencies.resolveBalances ?? defaultResolveBalances;
  const priceBalances = dependencies.priceBalances ?? defaultPriceBalances;
  const now = dependencies.now ?? (() => new Date());
  const nowMs = dependencies.nowMs ?? (() => Date.now());
  const backstopMs = dependencies.backstopMs ?? BALANCES_BACKSTOP_MS;
  const log = dependencies.log ?? writeObservabilityEvent;
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
    const degraded = row !== null && (
      row.coverage.catalog === "unavailable" || row.coverage.registry === "partial"
    );
    const required = signaled || expired || degraded;

    if (row && !hot) {
      if (required) scheduleRevalidation(owner, row, "background-full");
      else if (row.enumerationCursor) scheduleRevalidation(owner, row, "background-resume");
      return {
        read: readFromRow(row),
        stale: required,
        outcome: required ? "revalidating" : "served-row",
        durationMs,
      };
    }

    try {
      const registryOnly = Boolean(hot && row);
      const observed = registryOnly
        ? await observeRegistryOnly(owner, row!, durationMs)
        : await observeFull(owner, row, durationMs);
      const winner = await persistObserved(owner, observed, durationMs);
      if (registryOnly && required) scheduleRevalidation(owner, row!, "background-full");
      return {
        read: winner ?? observed,
        stale: registryOnly && required,
        outcome: registryOnly ? "registry-only" : "full",
        durationMs,
      };
    } catch (error) {
      if (!row) throw error;
      if (required) scheduleRevalidation(owner, row, "background-full");
      return {
        read: readFromRow(row),
        stale: true,
        outcome: "stale-fallback",
        durationMs,
      };
    }
  }

  async function persistObserved(
    owner: PortfolioAddress,
    observed: BalancesRead,
    durationMs: ObservationDurations,
  ): Promise<BalancesRead | null> {
    try {
      const wrote = await timeStage(nowMs, durationMs, "store-write", () =>
        store.putObservation(observationFromRead(owner, observed)));
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
        await persistObserved(address, observed, durationMs);
        emitBalancesRead(log, outcome, {
          ...durationMs,
          price: 0,
          total: Math.max(0, nowMs() - startedAt),
        }, observed.coverage);
      } catch {
        emitBalancesRead(log, "background-error", {
          ...durationMs,
          price: 0,
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
      // Scheduling failure never changes the cached response.
    }
  }

  async function observeFull(
    owner: PortfolioAddress,
    row: BalanceSnapshotRow | null,
    durationMs: ObservationDurations,
  ): Promise<BalancesRead> {
    const universeRequest = readUniverse();
    const registryRequest = timeStage(nowMs, durationMs, "registry-read", async () =>
      readBalances(await universeRequest, owner));
    const enumerationRequest = timeStage(nowMs, durationMs, "enumerate", () =>
      enumerateBalances(owner, undefined, row?.enumerationCursor));
    const [registryRead, enumeration] = await Promise.all([
      registryRequest,
      enumerationRequest,
    ]);
    const resolved = await timeStage(nowMs, durationMs, "resolve", () =>
      resolveBalances(registryRead, enumeration));
    const resumed = row && (row.enumerationCursor || enumeration.status === "unavailable")
      ? mergeResumedHoldings(resolved, row, enumeration)
      : resolved;
    return {
      ...resumed,
      observedAt: row && enumeration.status === "unavailable"
        ? row.observedAt
        : resumed.observedAt,
      enumerationCursor: enumeration.status === "unavailable"
        ? row?.enumerationCursor ?? null
        : enumeration.status === "complete"
          ? null
          : enumeration.nextCursor,
    };
  }

  async function observeRegistryOnly(
    owner: PortfolioAddress,
    row: BalanceSnapshotRow,
    durationMs: ObservationDurations,
  ): Promise<BalancesRead> {
    const registryRead = await timeStage(nowMs, durationMs, "registry-read", async () => {
      const universe = await readUniverse();
      return readBalances(universe, owner);
    });
    const withEnrichment = await timeStage(nowMs, durationMs, "resolve", () =>
      resolveBalances(registryRead, unavailableEnumeration()));
    return {
      ...withEnrichment,
      observedAt: row.observedAt,
      holdings: [
        ...withEnrichment.holdings.filter((holding) => holding.source === "registry"),
        ...row.holdings.filter((holding) => holding.source !== "registry"),
      ],
      coverage: {
        registry: withEnrichment.coverage.registry,
        catalog: row.coverage.catalog,
      },
      enumerationCursor: row.enumerationCursor,
    };
  }

  return async function getBalancesSnapshot(
    owner: PortfolioAddress,
    region: RegionId,
    signal?: AbortSignal,
  ): Promise<BalancesSnapshot> {
    void signal;
    const startedAt = nowMs();
    let coverage: Extract<ObservabilityEvent, { kind: "balances-read" }>["coverage"] = {
      registry: "unknown",
      catalog: "unknown",
    };
    try {
      const observed = await getObserved(owner);
      coverage = observed.read.coverage;
      const priceStartedAt = nowMs();
      const holdings = await priceBalances(observed.read, region);
      const priceDuration = Math.max(0, nowMs() - priceStartedAt);
      const snapshot = assembleBalancesSnapshot({
        owner,
        region,
        read: observed.read,
        holdings,
        stale: observed.stale,
      });
      emitBalancesRead(log, observed.outcome, {
        ...observed.durationMs,
        price: priceDuration,
        total: Math.max(0, nowMs() - startedAt),
      }, coverage);
      return snapshot;
    } catch (error) {
      emitBalancesRead(log, "error", {
        ...emptyObservationDurations(),
        price: 0,
        total: Math.max(0, nowMs() - startedAt),
      }, coverage);
      throw error;
    }
  };
}

export const getBalancesSnapshot = createBalancesService();

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
    holdings: read.holdings,
    coverage: read.coverage,
  };
}

function mergeResumedHoldings(
  resolved: BalancesRead,
  row: BalanceSnapshotRow,
  enumeration: BalancesEnumeration,
): BalancesRead {
  const holdings = new Map(
    row.holdings
      .filter((holding) => holding.source !== "registry")
      .map((holding) => [holding.key, holding]),
  );
  for (const holding of resolved.holdings) {
    if (holding.source !== "registry") holdings.set(holding.key, holding);
  }
  return {
    ...resolved,
    holdings: [
      ...resolved.holdings.filter((holding) => holding.source === "registry"),
      ...holdings.values(),
    ],
    coverage: {
      registry: resolved.coverage.registry,
      catalog: enumeration.status === "unavailable"
        ? row.coverage.catalog
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
): void {
  try {
    log({
      kind: "balances-read",
      route: "/api/balances",
      outcome,
      durationMs,
      coverage,
    });
  } catch {
    // Observability never changes balance reads.
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
  };
}
