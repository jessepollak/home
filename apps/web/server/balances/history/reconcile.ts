import "server-only";

import type { BalanceSnapshotRow } from "@/server/balances/snapshot-store";
import { withinEthWeightedTolerance, type valueHistoryPoint } from "@/shared/balances/history-valuation";
import { exactDecimalToFraction } from "@/shared/balances/math";
import { contractHistoryAsset, nativeHistoryAsset } from "./assets";
import type { ChainBucket, HexAddress, HistoryAsset } from "./types";

export function historyInventoryFromSnapshot(row: Pick<BalanceSnapshotRow, "holdings" | "coverage"> | null): { heldAssets: HistoryAsset[]; inventory: "complete" | "incomplete" } {
  const heldAssets = row?.holdings.flatMap((holding): HistoryAsset[] => {
    if (holding.balance.status !== "ready" || BigInt(holding.balance.baseUnits) <= BigInt(0)) return [];
    if (holding.kind === "native") return [nativeHistoryAsset()];
    if (holding.kind === "erc20" || holding.kind === "vault-share") return holding.contractAddress ? [contractHistoryAsset(holding.contractAddress, holding)] : [];
    return [];
  }) ?? [];
  return { heldAssets: [...new Map(heldAssets.map((asset) => [asset.key, asset])).values()],
    inventory: row?.coverage.catalog === "complete" && row.coverage.registry === "complete" ? "complete" : "incomplete" };
}

export type ReconcileArgs = { address: HexAddress; days: number; hours: number; budgetMs: number; maxRuns: number };

export function parseReconcileArgs(args: readonly string[]): ReconcileArgs {
  const flags = new Map<string, number>();
  let address: HexAddress | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") continue;
    if (arg === "--address") {
      if (address || !/^0x[0-9a-fA-F]{40}$/.test(args[i + 1] ?? "")) throw new Error("Invalid history reconciliation address.");
      address = args[++i]!.toLowerCase() as HexAddress;
      continue;
    }
    if (!["--days", "--hours", "--budget-ms", "--max-runs"].includes(arg) || flags.has(arg) || !/^[1-9][0-9]*$/.test(args[i + 1] ?? "")) {
      throw new Error("Invalid history reconciliation arguments.");
    }
    const value = Number(args[++i]);
    if (!Number.isSafeInteger(value) || value > 10_000 && arg !== "--budget-ms" || value > 600_000 && arg === "--budget-ms") {
      throw new Error("Invalid history reconciliation limit.");
    }
    flags.set(arg, value);
  }
  if (!address) throw new Error("History reconciliation requires --address.");
  return { address, days: flags.get("--days") ?? 30, hours: flags.get("--hours") ?? 24,
    budgetMs: flags.get("--budget-ms") ?? 25_000, maxRuns: flags.get("--max-runs") ?? 20 };
}

export function selectCommittedBuckets(buckets: readonly ChainBucket[], forwardBlock: bigint): { times: Date[]; omittedTail: number } {
  const committed = buckets.filter((bucket) => bucket.blockNumber <= forwardBlock);
  return { times: committed.map((bucket) => bucket.bucketAt), omittedTail: buckets.length - committed.length };
}

type Point = { value: Pick<ReturnType<typeof valueHistoryPoint>, "coverage" | "missing" | "net">;
  ethWeightedValue: ReturnType<typeof valueHistoryPoint>["net"]["value"] };

export function compareReconciliationPoint(history: Point, reference: Point) {
  const missing = (point: Point) => point.value.missing.map(({ assetKey, reason }) => `${assetKey}:${reason}`).sort();
  const hMissing = missing(history);
  const rMissing = missing(reference);
  if (history.value.coverage !== reference.value.coverage || hMissing.length !== rMissing.length ||
    hMissing.some((entry, index) => entry !== rMissing[index])) return { status: "classification-mismatch" as const };
  const h = history.value.net.value;
  const r = reference.value.net.value;
  const weight = reference.ethWeightedValue;
  if (!h || !r || !weight) return { status: "unavailable" as const };
  const hf = exactDecimalToFraction(h);
  const rf = exactDecimalToFraction(r);
  const wf = exactDecimalToFraction(weight);
  const signedH = history.value.net.negative ? -hf.numerator : hf.numerator;
  const signedR = reference.value.net.negative ? -rf.numerator : rf.numerator;
  const diff = signedH * rf.denominator - signedR * hf.denominator;
  const absolute = diff < BigInt(0) ? -diff : diff;
  const ratio = wf.numerator === BigInt(0) ? absolute === BigInt(0) ? 0 : null
    : Number(absolute * wf.denominator * BigInt(1_000_000) / (hf.denominator * rf.denominator * wf.numerator)) / 1_000_000;
  const pass = history.value.net.negative === reference.value.net.negative
    ? withinEthWeightedTolerance({ history: h, reference: r, ethWeightedValue: weight })
    : absolute * BigInt(200) * wf.denominator <= wf.numerator * hf.denominator * rf.denominator;
  return { status: "compared" as const, pass, ratio };
}

export function reconciliationPassed(input: {
  buckets: number;
  complete: number;
  compared: number;
  ready: boolean;
  mismatches: number;
  pending: number;
  classificationMismatches: number;
  toleranceFailures: number;
}): boolean {
  return input.ready && input.buckets > 0 && input.complete === input.buckets && input.compared === input.buckets &&
    input.mismatches === 0 && input.pending === 0 && input.classificationMismatches === 0 && input.toleranceFailures === 0;
}
