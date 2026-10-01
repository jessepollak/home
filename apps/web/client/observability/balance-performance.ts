import { isRecord } from "@/shared/guards";
import type { BalancesSnapshot } from "@/shared/balances/types";
import type { HomeStartupReport } from "@/shared/observability/client-performance.contract";
import { recordHomeStartupBalances } from "./perf-marks";

type Timing = Pick<HomeStartupReport, "balanceFetchMs" | "balanceResponseMs" | "balanceParsedMs">;
const timings = new WeakMap<object, Timing>();
const restored = new WeakSet<object>();

export function createBalanceReadTiming() {
  const timing: Timing = {};
  return {
    mark(stage: "fetch" | "response") {
      if (stage === "fetch") timing.balanceFetchMs = performance.now();
      else timing.balanceResponseMs = performance.now();
    },
    parsed(snapshot: BalancesSnapshot) {
      timing.balanceParsedMs = performance.now();
      timings.set(snapshot, timing);
    },
  };
}

export function recordRestoredBalance(snapshot: unknown): void {
  if (isRecord(snapshot)) restored.add(snapshot);
}

export function balanceStartupDetails(snapshot: BalancesSnapshot) {
  const timing = timings.get(snapshot);
  return {
    balanceCache: restored.has(snapshot) ? "restored" : timing ? "cold" : "unknown",
    ...timing,
  } as const;
}

export function recordPresentedBalance(snapshot: BalancesSnapshot): void {
  recordHomeStartupBalances(balanceStartupDetails(snapshot));
}
