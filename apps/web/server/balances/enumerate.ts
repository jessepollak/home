import "server-only";

import type { PortfolioAddress } from "@/config/portfolio-assets";
import { writeObservabilityEvent } from "@/server/observability/log";
import type { ObservabilityEvent } from "@/server/observability/schema";
import {
  CdpTokenBalancesError,
  createCdpTokenBalancesClient,
  type CdpTokenBalancesClient,
} from "./enumerate-cdp";
import type { BalancesEnumeration } from "./types";

export const BALANCES_ENUMERATION_TTL_MS = 60_000;
export const BALANCES_ENUMERATION_DEADLINE_MS = 8_000;
export const BALANCES_ENUMERATION_CACHE_MAX_OWNERS = 256;

type Dependencies = {
  listBalances?: CdpTokenBalancesClient["listBalances"];
  log?: (event: ObservabilityEvent) => unknown;
  now?: () => number;
  ttlMs?: number;
  deadlineMs?: number;
  maxOwners?: number;
};

type Entry = {
  inFlight: Promise<BalancesEnumeration> | null;
  value: BalancesEnumeration | null;
  storedAt: number;
};

/** Per-owner CDP enumeration cache, detached from every route caller signal. */
export function createBalancesEnumerator(dependencies: Dependencies = {}) {
  const listBalances = dependencies.listBalances ??
    createCdpTokenBalancesClient().listBalances;
  const log = dependencies.log ?? writeObservabilityEvent;
  const now = dependencies.now ?? Date.now;
  const ttlMs = dependencies.ttlMs ?? BALANCES_ENUMERATION_TTL_MS;
  const deadlineMs = dependencies.deadlineMs ?? BALANCES_ENUMERATION_DEADLINE_MS;
  const maxOwners = dependencies.maxOwners ??
    BALANCES_ENUMERATION_CACHE_MAX_OWNERS;
  const entries = new Map<string, Entry>();

  return async function enumerateBalances(
    owner: PortfolioAddress,
    callerSignal?: AbortSignal,
  ): Promise<BalancesEnumeration> {
    void callerSignal;
    const key = owner.toLowerCase();
    const currentTime = now();
    let entry = entries.get(key);

    if (entry) {
      entries.delete(key);
      entries.set(key, entry);
      if (entry.value && currentTime - entry.storedAt <= ttlMs) {
        return entry.value;
      }
      if (entry.inFlight) return entry.inFlight;
    } else {
      entry = { inFlight: null, value: null, storedAt: 0 };
      entries.set(key, entry);
      evict(entries, maxOwners);
    }

    const target = entry;
    target.inFlight = runEnumeration(
      listBalances,
      owner.toLowerCase() as PortfolioAddress,
      deadlineMs,
      log,
    );
    try {
      const value = await target.inFlight;
      target.value = value;
      target.storedAt = now();
      return value;
    } finally {
      target.inFlight = null;
    }
  };
}

export const enumerateBalances = createBalancesEnumerator();

async function runEnumeration(
  listBalances: CdpTokenBalancesClient["listBalances"],
  owner: PortfolioAddress,
  deadlineMs: number,
  log: (event: ObservabilityEvent) => unknown,
): Promise<BalancesEnumeration> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort("balances-enumeration-deadline"),
    deadlineMs,
  );
  try {
    const listed = await listBalances({
      address: owner,
      signal: controller.signal,
    });
    const result: BalancesEnumeration = {
      status: listed.complete ? "complete" : "incomplete",
      rows: listed.balances.map((row) => ({
        contractAddress: row.contractAddress,
        amountBaseUnits: row.amountBaseUnits,
        ...(row.name ? { name: row.name } : {}),
        ...(row.symbol ? { symbol: row.symbol } : {}),
        ...(row.decimals !== undefined ? { decimals: row.decimals } : {}),
      })),
    };
    if (result.status === "incomplete") {
      emitEnumerationEvent(log, "incomplete", "partial");
    }
    return result;
  } catch (error) {
    const reason = error instanceof CdpTokenBalancesError
      ? error.code
      : "upstream-error";
    emitEnumerationEvent(log, "unavailable", reason);
    return { status: "unavailable", rows: [] };
  } finally {
    clearTimeout(timer);
  }
}

function emitEnumerationEvent(
  log: (event: ObservabilityEvent) => unknown,
  outcome: "incomplete" | "unavailable",
  reason: Extract<ObservabilityEvent, {
    kind: "portfolio-balance-source";
  }>["reason"],
): void {
  try {
    log({
      kind: "portfolio-balance-source",
      route: "/api/balances",
      source: "cdp-token-balances",
      stage: "inventory",
      outcome,
      reason,
    });
  } catch {
    // Observability never changes enumeration.
  }
}

function evict(entries: Map<string, Entry>, maximum: number): void {
  while (entries.size > maximum) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) return;
    entries.delete(oldest);
  }
}
