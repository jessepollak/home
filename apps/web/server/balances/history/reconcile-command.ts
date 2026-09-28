import "server-only";

import { createCoinbaseDailyFxReader } from "@/server/activity/valuation/coinbase-daily-fx";
import { createCodexHistoricalCloseReader } from "@/server/activity/valuation/codex-closes";
import { getBalanceSnapshotStore } from "@/server/balances/snapshot-store";
import { createCdpSqlAuthFromEnv, createCdpSqlHttpTransport } from "@/server/chain-data/cdp-sql-client";
import { createCodexRecognizedTokenCatalogReader } from "@/server/market-data/codex/recognized-catalog";
import { createHistoryChainReader } from "./chain";
import { createHistoryIngest } from "./ingest";
import { createHistoryReader } from "./read";
import { compareReconciliationPoint, historyInventoryFromSnapshot, parseReconcileArgs, reconciliationPassed, selectCommittedBuckets } from "./reconcile";
import { createHistorySeries } from "./series";
import { createHistoryTransferSource } from "./sql-transfers";
import { getHistoryStore } from "./store";
import { HISTORY_BUCKET_SECONDS, HISTORY_CHAIN_ID, HISTORY_DAY_SECONDS, type ChainBucket, type HistoryAsset } from "./types";

const HOUR = HISTORY_BUCKET_SECONDS * 1_000;
const DAY = HISTORY_DAY_SECONDS * 1_000;

type Point = Awaited<ReturnType<ReturnType<typeof createHistoryReader>["readPoints"]>>["points"][number];

function buckets(count: number, interval: number, finalized: number): Date[] {
  const latest = Math.floor(finalized / interval) * interval;
  return Array.from({ length: count }, (_, index) => new Date(latest - index * interval));
}

function safeFailure(error: unknown) {
  const code = "code" in Object(error) ? String((error as { code: unknown }).code) : "unknown";
  const name = error instanceof Error && /^[A-Za-z]{1,30}Error$/.test(error.name) ? error.name : "unknown";
  const status = "status" in Object(error) ? Number((error as { status: unknown }).status) : null;
  return { name, code: /^[a-z-]{1,30}$|^[A-Z0-9]{5}$/.test(code) ? code : "unknown",
    status: Number.isInteger(status) && status! >= 400 && status! < 600 ? status : null };
}

async function main() {
  let stage = "arguments";
  try {
    const options = parseReconcileArgs(process.argv.slice(2));
    const store = getHistoryStore();
    if (!store) throw new Error("DATABASE_URL is required for history reconciliation.");
    const start = Date.now();
    const chain = createHistoryChainReader();
    const transport = createCdpSqlHttpTransport({ auth: createCdpSqlAuthFromEnv(), timeoutMs: 29_000 });
    let sqlAttempts = 0;
    const source = createHistoryTransferSource({ transport: { run(request) {
      sqlAttempts++;
      return transport.run(request);
    } } });
    let sourceFailure: ReturnType<typeof safeFailure> | null = null;
    const ingest = createHistoryIngest({ store, source: { async listChanges(input) {
      try {
        const result = await source.listChanges(input);
        sourceFailure = null;
        return result;
      } catch (error) {
        sourceFailure = safeFailure(error);
        throw error;
      }
    } }, chain });
    const series = createHistorySeries({ store, chain,
      readCloses: createCodexHistoricalCloseReader({ apiKey: process.env.CODEX_API_KEY }),
      readFx: createCoinbaseDailyFxReader({}),
    });
    const catalogReader = createCodexRecognizedTokenCatalogReader({ apiKey: process.env.CODEX_API_KEY });
    const reader = createHistoryReader({ ingest, series, chain, catalog: async () => {
      const result = await catalogReader();
      return new Map(result.entries.map((entry) => [entry.address.toLowerCase(), entry]));
    } });
    const enrolled = await ingest.enroll(options.address);
    if (!enrolled) throw new Error("no customer wallet row");
    const { heldAssets, inventory } = historyInventoryFromSnapshot(await getBalanceSnapshotStore().get(HISTORY_CHAIN_ID, options.address));
    const totals = { queries: 0, reads: 0, windows: 0, runs: 0, elapsedMs: 0 };
    stage = "ingest";
    let status: "building" | "ready" = "building";
    for (let run = 0; run < options.maxRuns && status !== "ready"; run++) {
      const report = await ingest.run(options.address, { heldAssets, deadline: Date.now() + options.budgetMs });
      totals.runs++;
      totals.queries += report.queries;
      totals.reads += report.reads;
      totals.windows += report.windows;
      if (report.status === "ready") status = "ready";
    }
    stage = "history-points";
    const head = await chain.finalizedHead();
    const requestedSamples = [
      { granularity: "1d" as const, times: buckets(options.days, DAY, head.timestamp * 1_000) },
      { granularity: "1h" as const, times: buckets(options.hours, HOUR, head.timestamp * 1_000) },
    ];
    const committed = await store.getAddress(HISTORY_CHAIN_ID, options.address);
    if (!committed) throw new Error("no customer wallet row");
    const samples: typeof requestedSamples = [];
    let omittedTailBuckets = 0;
    for (const sample of requestedSamples) {
      const selected = selectCommittedBuckets(await series.ensureBuckets(sample.times, head), committed.forwardBlock);
      samples.push({ ...sample, times: selected.times });
      omittedTailBuckets += selected.omittedTail;
    }
    const history = [] as Point[];
    for (const sample of samples) {
      const result = await reader.readPoints(options.address, { bucketTimes: sample.times,
        granularity: sample.granularity, quoteCurrency: "USD", inventory, heldAssets, maxArchiveReads: sample.times.length + 10 });
      history.push(...result.points);
    }
    stage = "archive-reference";
    const tracked = await store.listTrackedAssets(enrolled.id);
    const uniqueBuckets = new Map<bigint, ChainBucket>();
    for (const point of history) uniqueBuckets.set(point.blockNumber, {
      bucketAt: point.bucketAt, blockNumber: point.blockNumber, blockHash: head.hash, blockTime: point.bucketAt,
    });
    const referenceQuantities = new Map<bigint, Map<string, { status: "ready"; baseUnits: bigint } | { status: "unavailable"; reason: "pending-read" }>>();
    for (const bucket of uniqueBuckets.values()) {
      const reads = await chain.readQuantities({ address: options.address, assets: tracked, block: bucket.blockNumber });
      referenceQuantities.set(bucket.blockNumber, new Map(tracked.map((asset: HistoryAsset) => {
        const quantity = reads.get(asset.key);
        return [asset.key, quantity?.status === "ready" ? quantity : { status: "unavailable" as const, reason: "pending-read" as const }];
      })));
    }
    stage = "reference-values";
    const references = [] as Point[];
    for (const sample of samples) {
      const result = await reader.readPoints(options.address, { bucketTimes: sample.times,
        granularity: sample.granularity, quoteCurrency: "USD", inventory, heldAssets, maxArchiveReads: 0, referenceQuantities });
      references.push(...result.points);
    }
    stage = "compare";
    const resolved = await ingest.readQuantities(options.address, { buckets: [...uniqueBuckets.values()], maxArchiveReads: 0, heldAssets });
    const quantityByKey = new Map(resolved.map((row) => [row.asset.key, new Map(row.buckets.map(({ bucket, quantity }) => [bucket.blockNumber, quantity]))]));
    const trackedByKey = new Map<string, HistoryAsset>(tracked.map((asset) => [asset.key, asset]));
    let exact = 0;
    let total = 0;
    let mismatches = 0;
    let pending = 0;
    let incorrectComplete = 0;
    let classificationMismatches = 0;
    let uncomparable = 0;
    let comparedPartial = 0;
    const missingByKindAndReason: Record<string, number> = {};
    const mismatchesByKind: Record<string, number> = {};
    const pendingByKind: Record<string, number> = {};
    let toleranceFailures = 0;
    let comparedNet = 0;
    let maxRatio = 0;
    let unboundedNetDiff = false;
    const coverage = { complete: 0, partial: 0, unavailable: 0 };
    for (const [index, point] of history.entries()) {
      const reference = references[index];
      coverage[point.value.coverage]++;
      for (const entry of point.value.missing) {
        const kind = trackedByKey.get(entry.assetKey)?.kind ?? "unknown";
        const label = `${kind}/${entry.reason}`;
        missingByKindAndReason[label] = (missingByKindAndReason[label] ?? 0) + 1;
      }
      if (!reference || reference.blockNumber !== point.blockNumber) {
        classificationMismatches++;
        if (point.value.coverage === "complete") incorrectComplete++;
        continue;
      }
      let differing = false;
      for (const row of resolved) {
        total++;
        const quantity = quantityByKey.get(row.asset.key)?.get(point.blockNumber);
        const archive = referenceQuantities.get(point.blockNumber)?.get(row.asset.key);
        if (quantity?.status !== "ready" || archive?.status !== "ready") {
          pending++;
          pendingByKind[row.asset.kind] = (pendingByKind[row.asset.kind] ?? 0) + 1;
        } else if (quantity.baseUnits !== archive.baseUnits) {
          mismatches++;
          mismatchesByKind[row.asset.kind] = (mismatchesByKind[row.asset.kind] ?? 0) + 1;
          differing = true;
        } else exact++;
      }
      const diff = compareReconciliationPoint(point, reference);
      if (diff.status === "classification-mismatch") classificationMismatches++;
      if (point.value.coverage === "complete" && (differing || diff.status !== "compared")) incorrectComplete++;
      if (diff.status === "unavailable") uncomparable++;
      if (diff.status === "compared") {
        comparedNet++;
        if (point.value.coverage === "partial") comparedPartial++;
        if (!diff.pass) toleranceFailures++;
        if (diff.ratio === null) unboundedNetDiff = true;
        else maxRatio = Math.max(maxRatio, diff.ratio);
      }
    }
    totals.elapsedMs = Date.now() - start;
    const pass = reconciliationPassed({ buckets: history.length, complete: coverage.complete, compared: comparedNet,
      ready: status === "ready", mismatches, pending, classificationMismatches, toleranceFailures });
    console.log(JSON.stringify({ pass, assets: tracked.length, buckets: history.length, omittedTailBuckets, quantities: {
      exact, total, mismatches, pending, mismatchesByKind, pendingByKind }, coverage, missingByKindAndReason, net: { compared: comparedNet,
      comparedPartial, uncomparable, classificationMismatches,
      maxDiffRelativeToEthWeightedValue: comparedNet && !unboundedNetDiff ? maxRatio : null,
      unboundedNetDiff, tolerancePass: comparedNet ? toleranceFailures === 0 : null,
      toleranceFailures, incorrectComplete }, ingest: { ...totals, status,
      sqlAttempts, sourceFailure,
      splitWindows: totals.queries > totals.windows }, archiveReads: uniqueBuckets.size }));
    process.exitCode = pass ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error && ["no customer wallet row", "DATABASE_URL is required for history reconciliation.",
      "Invalid history reconciliation address.", "Invalid history reconciliation arguments.",
      "Invalid history reconciliation limit.", "History reconciliation requires --address."].includes(error.message)
      ? error.message : "History reconciliation unavailable.";
    console.error(JSON.stringify({ error: message, stage, ...safeFailure(error) }));
    process.exitCode = 1;
    return 1;
  }
}

if (import.meta.main) await main();
