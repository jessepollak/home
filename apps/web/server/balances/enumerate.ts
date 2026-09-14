import "server-only";

import type { PortfolioAddress } from "@/config/portfolio-assets";
import { writeObservabilityEvent } from "@/server/observability/log";
import type { ObservabilityEvent } from "@/server/observability/schema";
import {
  CdpTokenBalancesError,
  CDP_TOKEN_BALANCES_SOFT_PAGE_START_MS,
  CDP_TOKEN_BALANCES_TIMEOUT_MS,
  createCdpTokenBalancesClient,
  type CdpTokenBalancesClient,
} from "./enumerate-cdp";
import type { BalancesEnumeration } from "./types";

export const BALANCES_ENUMERATION_SOFT_PAGE_START_MS =
  CDP_TOKEN_BALANCES_SOFT_PAGE_START_MS;
export const BALANCES_ENUMERATION_HARD_PAGE_MS = CDP_TOKEN_BALANCES_TIMEOUT_MS;

type Dependencies = {
  listBalances?: CdpTokenBalancesClient["listBalances"];
  log?: (event: ObservabilityEvent) => unknown;
};

/** Per-owner in-flight CDP enumeration dedupe, detached from every route caller signal. */
export function createBalancesEnumerator(dependencies: Dependencies = {}) {
  const listBalances = dependencies.listBalances ??
    createCdpTokenBalancesClient().listBalances;
  const log = dependencies.log ?? writeObservabilityEvent;
  const inFlight = new Map<string, Promise<BalancesEnumeration>>();

  return async function enumerateBalances(
    owner: PortfolioAddress,
    callerSignal?: AbortSignal,
    cursor?: string | null,
  ): Promise<BalancesEnumeration> {
    void callerSignal;
    const key = `${owner.toLowerCase()}:${cursor ?? "start"}`;
    const existing = inFlight.get(key);
    if (existing) return existing;
    const pending = runEnumeration(
      listBalances,
      owner.toLowerCase() as PortfolioAddress,
      log,
      cursor,
    ).finally(() => {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    });
    inFlight.set(key, pending);
    return pending;
  };
}

export const enumerateBalances = createBalancesEnumerator();

async function runEnumeration(
  listBalances: CdpTokenBalancesClient["listBalances"],
  owner: PortfolioAddress,
  log: (event: ObservabilityEvent) => unknown,
  cursor?: string | null,
): Promise<BalancesEnumeration> {
  const startedAt = Date.now();
  try {
    const listed = await listBalances({
      address: owner,
      ...(cursor ? { pageToken: cursor } : {}),
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
      nextCursor: listed.complete ? null : listed.nextPageToken,
      pagesRead: listed.pagesRead,
      durationMs: listed.durationMs,
    };
    if (result.status === "incomplete") {
      emitEnumerationEvent(
        log,
        "incomplete",
        "partial",
        result.pagesRead,
        result.durationMs,
      );
    }
    return result;
  } catch (error) {
    const reason = error instanceof CdpTokenBalancesError
      ? error.code
      : "upstream-error";
    const durationMs = Date.now() - startedAt;
    emitEnumerationEvent(log, "unavailable", reason, 0, durationMs);
    return {
      status: "unavailable",
      rows: [],
      nextCursor: cursor ?? null,
      pagesRead: 0,
      durationMs,
    };
  }
}

function emitEnumerationEvent(
  log: (event: ObservabilityEvent) => unknown,
  outcome: "incomplete" | "unavailable",
  reason: Extract<ObservabilityEvent, {
    kind: "portfolio-balance-source";
  }>["reason"],
  pageCount: number,
  durationMs: number,
): void {
  try {
    log({
      kind: "portfolio-balance-source",
      route: "/api/balances",
      source: "cdp-token-balances",
      stage: "inventory",
      outcome,
      reason,
      pageCount,
      durationMs,
    });
  } catch {
    // Observability never changes enumeration.
  }
}
