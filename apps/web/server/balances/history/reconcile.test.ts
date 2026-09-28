import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { PostgresBalanceSnapshotStore } from "@/server/balances/snapshot-store";
import type { ReadHolding } from "@/server/balances/types";
import { createPostgresSqlExecutor } from "@/server/db/sql";
import { erc20AssetKey, nativeAssetKey } from "@/shared/balances/types";
import { PORTFOLIO_USDC_ADDRESS, portfolioVaults } from "@/config/portfolio-assets";
import { createHistoryIngest } from "./ingest";
import { createHistoryReader } from "./read";
import { compareReconciliationPoint, historyInventoryFromSnapshot, parseReconcileArgs, reconciliationPassed, selectCommittedBuckets } from "./reconcile";
import type { createHistorySeries } from "./series";
import { PostgresHistoryStore } from "./store";
import type { HistoryChainReader } from "./types";

const wallet = "0x1111111111111111111111111111111111111111";
const heldToken = "0x0000000000000000000000000000000000000088";

describe("committed reconciliation bucket selection", () => {
  test("keeps blocks at or behind the cursor and counts the omitted tail", () => {
    const start = new Date("2026-09-25T00:00:00Z");
    const times = [start, new Date(start.getTime() + 3_600_000), new Date(start.getTime() + 7_200_000)];
    const buckets = [BigInt(99), BigInt(100), BigInt(101)].map((blockNumber, index) => ({
      bucketAt: times[index]!, blockNumber, blockHash: `0x${"a".repeat(64)}` as const, blockTime: times[index]!,
    }));
    expect(selectCommittedBuckets(buckets, BigInt(100))).toEqual({
      times: [new Date("2026-09-25T00:00:00Z"), new Date("2026-09-25T01:00:00Z")], omittedTail: 1,
    });
    expect(selectCommittedBuckets(buckets, BigInt(98))).toEqual({ times: [], omittedTail: 3 });
  });
});

describe("history inventory from balance snapshot", () => {
  const holding = (kind: "native" | "erc20", contractAddress: `0x${string}` | null, baseUnits: string): ReadHolding => {
    const key = kind === "native" ? nativeAssetKey() : erc20AssetKey(contractAddress!);
    return { key, id: key, kind, source: "catalog", name: "Token", symbol: "TOK", decimals: 6,
      contractAddress, cashCurrency: null, balance: { status: "ready", baseUnits } };
  };

  test("no snapshot leaves inventory incomplete", () => {
    expect(historyInventoryFromSnapshot(null)).toEqual({ heldAssets: [], inventory: "incomplete" });
  });

  test("complete snapshot includes only positive ERC-20 and native holdings, even without transfers", () => {
    expect(historyInventoryFromSnapshot({ coverage: { registry: "complete", catalog: "complete" }, holdings: [
      holding("erc20", heldToken, "1000000"), holding("native", null, "1"), holding("erc20", heldToken, "1000000"),
      holding("erc20", "0x0000000000000000000000000000000000000099", "0"),
    ] })).toEqual({
      inventory: "complete", heldAssets: [
        { key: `eip155:8453/erc20:${heldToken}`, kind: "erc20", contractAddress: heldToken, marketId: null, decimals: 6, cashCurrency: null },
        { key: "eip155:8453/native", kind: "native", contractAddress: null, marketId: null },
      ],
    });
  });

  test("incomplete catalog or registry keeps inventory incomplete but still anchors known holdings", () => {
    const holdings = [holding("erc20", heldToken, "1000000")];
    for (const coverage of [{ registry: "complete", catalog: "incomplete" },
      { registry: "partial", catalog: "complete" }, { registry: "complete", catalog: "unavailable" }] as const) {
      const result = historyInventoryFromSnapshot({ coverage, holdings });
      expect(result.inventory).toBe("incomplete");
      expect(result.heldAssets).toEqual([{ key: `eip155:8453/erc20:${heldToken}`, kind: "erc20", contractAddress: heldToken, marketId: null, decimals: 6, cashCurrency: null }]);
    }
  });

  test("a positive vault-share holding stays in the held set even when its vault is no longer configured", () => {
    const vault = (contractAddress: `0x${string}`, baseUnits: string): ReadHolding => ({
      key: erc20AssetKey(contractAddress), id: erc20AssetKey(contractAddress), kind: "vault-share", source: "registry",
      name: "Vault", symbol: "vUSDC", decimals: 18, contractAddress, cashCurrency: null,
      underlying: { key: erc20AssetKey(PORTFOLIO_USDC_ADDRESS), symbol: "USDC", decimals: 6 },
      balance: { status: "ready", baseUnits } });
    const stale = historyInventoryFromSnapshot({ coverage: { registry: "complete", catalog: "complete" }, holdings: [vault(heldToken, "1000000")] });
    expect(stale.inventory).toBe("complete");
    expect(stale.heldAssets).toEqual([{ key: `eip155:8453/erc20:${heldToken}`, kind: "vault-share", contractAddress: heldToken, marketId: null, decimals: 18, cashCurrency: null }]);
    const configured = portfolioVaults[0]!.address.toLowerCase() as `0x${string}`;
    expect(historyInventoryFromSnapshot({ coverage: { registry: "complete", catalog: "complete" }, holdings: [vault(configured, "1000000")] }).heldAssets)
      .toEqual([{ key: erc20AssetKey(configured), kind: "vault-share", contractAddress: configured, marketId: null, decimals: 18, cashCurrency: null }]);
  });
  test("a removed cash asset retains its snapshot currency and verified decimals", () => {
    const removed = { ...holding("erc20", heldToken, "2000000"), decimals: 8, cashCurrency: "EUR" as const };
    expect(historyInventoryFromSnapshot({ coverage: { registry: "complete", catalog: "complete" }, holdings: [removed] }).heldAssets)
      .toEqual([{ key: `eip155:8453/erc20:${heldToken}`, kind: "erc20", contractAddress: heldToken, marketId: null, decimals: 8, cashCurrency: "EUR" }]);
  });
});

(process.env.BALANCES_PG_TEST_URL ? describe : describe.skip)("history held inventory through ingest and valuation", () => {
  test("a complete snapshot anchors a held token without transfers and yields a complete point", async () => {
    const sql = createPostgresSqlExecutor(process.env.BALANCES_PG_TEST_URL!);
    const customer = randomUUID();
    const address = `0x${randomUUID().replaceAll("-", "").padStart(40, "0")}` as const;
    const hash = `0x${"a".repeat(64)}` as const;
    const windowAt = new Date("2025-09-25T00:00:00.000Z");
    const headAt = new Date("2026-09-25T12:00:00.000Z");
    const tokenKey = `eip155:8453/erc20:${heldToken}`;
    try {
      const credential = randomUUID();
      await sql.query("INSERT INTO customers (id, first_seen_at, last_seen_at, first_seen_source) VALUES ($1,$2,$2,'sign_in')", [customer, headAt]);
      await sql.query("INSERT INTO customer_credentials (id, customer_id, account_provider, subject, first_seen_at, last_seen_at) VALUES ($1,$2,'base-account',$3,$4,$4)",
        [credential, customer, randomUUID(), headAt]);
      await sql.query("INSERT INTO customer_wallets (id, customer_id, credential_id, chain_id, address) VALUES ($1,$2,$3,8453,$4)",
        [randomUUID(), customer, credential, address]);
      const snapshotStore = new PostgresBalanceSnapshotStore(sql);
      await sql.query(`INSERT INTO balance_snapshots
        (chain_id, address, block_number, block_hash, block_timestamp, observed_at, holdings, coverage)
        VALUES (8453,$1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
      [address, "120", hash, String(headAt.getTime() / 1_000), headAt,
        JSON.stringify([{ key: erc20AssetKey(heldToken), id: tokenKey, kind: "erc20", source: "catalog", name: "Token",
          symbol: "TOK", decimals: 6, contractAddress: heldToken, cashCurrency: null, balance: { status: "ready", baseUnits: "1000000" } }]),
        JSON.stringify({ registry: "complete", catalog: "complete" })]);
      const { heldAssets, inventory } = historyInventoryFromSnapshot(await snapshotStore.get(8453, address));
      expect(inventory).toBe("complete");
      const store = new PostgresHistoryStore(sql);
      const bucket = { bucketAt: windowAt, blockNumber: BigInt(10), blockHash: hash, blockTime: windowAt };
      const chain: HistoryChainReader = {
        async finalizedHead() { return { number: BigInt(120), hash, timestamp: headAt.getTime() / 1_000 }; },
        async resolveBuckets() { return [bucket]; },
        async readQuantities({ assets }) { return new Map(assets.map((asset) => [asset.key,
          { status: "ready" as const, baseUnits: asset.key === tokenKey ? BigInt(1000000) : BigInt(0) }])); },
        async readVaultRates() { return []; },
        async readMorphoBorrowIndexes() { return []; },
      };
      const ingest = createHistoryIngest({ store, chain, now: () => headAt, lagBlocks: BigInt(0), source: { async listChanges() {
        return { changes: [], queries: 1, windows: 1 };
      } } });
      const enrolled = (await ingest.enroll(address))!;
      expect((await ingest.run(address, { heldAssets, deadline: headAt.getTime() + 100_000 })).status).toBe("ready");
      expect((await store.listCheckpoints(enrolled.id)).filter((point) => point.asset.key === tokenKey)
        .map((point) => [point.blockNumber, point.purpose, point.chainQuantity]))
        .toEqual([[BigInt(10), "window-start", BigInt(1000000)], [BigInt(120), "reconcile", BigInt(1000000)]]);
      const series = { ensureBuckets: async () => [bucket], fill: async () => new Map([[`close:${heldToken}`,
        new Map([[windowAt.getTime(), { status: "ready" as const, value: { atoms: BigInt(9), scale: 0 }, provisional: false }]])]])
      } as unknown as ReturnType<typeof createHistorySeries>;
      const reader = createHistoryReader({ ingest, chain, series, catalog: async () => new Map([[heldToken,
        { name: "Token", symbol: "TOK", decimals: 6 }]]) });
      const result = await reader.readPoints(address, { bucketTimes: [windowAt], granularity: "1d", quoteCurrency: "USD",
        inventory, heldAssets, maxArchiveReads: 0 });
      expect(result.points[0]?.value.coverage).toBe("complete");
      expect(result.points[0]?.value.net).toEqual({ status: "complete", value: { atoms: "9000000000000000000", scale: 18 },
        currency: "USD", negative: false });
    } finally {
      await sql.query("DELETE FROM customers WHERE id=$1", [customer]);
      await sql.dispose?.();
    }
  });
});

describe("history reconciliation operator arguments", () => {
  test("defaults and explicitly bounded sampling", () => {
    expect(parseReconcileArgs(["--", "--address", wallet])).toEqual({ address: wallet, days: 30, hours: 24, budgetMs: 25_000, maxRuns: 20 });
    expect(parseReconcileArgs(["--address", wallet, "--days", "3", "--hours", "2", "--budget-ms", "5000", "--max-runs", "4"]))
      .toEqual({ address: wallet, days: 3, hours: 2, budgetMs: 5000, maxRuns: 4 });
  });
  test("rejects invalid arguments", () => {
    for (const args of [["--address", "invalid"], ["--address", wallet, "--days", "0"],
      ["--address", wallet, "--hours", "2", "--hours", "4"], ["--address", wallet, "--budget-ms", "abc"],
      ["--address", wallet, "--unexpected", "1"]]) expect(() => parseReconcileArgs(args)).toThrow();
  });

});
describe("history reconciliation decision", () => {
  test("requires every bucket complete, valued, and quantity-exact", () => {
    const input = { buckets: 2, complete: 2, compared: 2, ready: true, mismatches: 0, pending: 0, classificationMismatches: 0, toleranceFailures: 0 };
    expect(reconciliationPassed(input)).toBe(true);
    expect(reconciliationPassed({ ...input, ready: false })).toBe(false);
    expect(reconciliationPassed({ ...input, buckets: 0 })).toBe(false);
    expect(reconciliationPassed({ ...input, complete: 1 })).toBe(false);
    expect(reconciliationPassed({ ...input, compared: 1 })).toBe(false);
    expect(reconciliationPassed({ ...input, mismatches: 1 })).toBe(false);
    expect(reconciliationPassed({ ...input, pending: 1 })).toBe(false);
    expect(reconciliationPassed({ ...input, classificationMismatches: 1 })).toBe(false);
    expect(reconciliationPassed({ ...input, toleranceFailures: 1 })).toBe(false);
  });
  test("compares matching partial missing sets at the ETH-weighted tolerance", () => {
    type Point = Parameters<typeof compareReconciliationPoint>[0];
    const point = (amount: string, reason: "no-recent-close" | "below-market-gate"): Point => ({
      value: { coverage: "partial", missing: [{ assetKey: "asset", reason }],
        net: { status: "partial", value: { atoms: amount, scale: 2 }, currency: "USD", negative: false } },
      ethWeightedValue: { atoms: "1000", scale: 0 },
    });
    expect(compareReconciliationPoint(point("100500", "below-market-gate"), point("100000", "below-market-gate")))
      .toEqual({ status: "compared", pass: true, ratio: 0.005 });
    expect(compareReconciliationPoint(point("100501", "below-market-gate"), point("100000", "below-market-gate")))
      .toMatchObject({ status: "compared", pass: false });
    expect(compareReconciliationPoint(point("100000", "no-recent-close"), point("100000", "below-market-gate")))
      .toEqual({ status: "classification-mismatch" });
    expect(compareReconciliationPoint({ ...point("100000", "below-market-gate"), value: { ...point("100000", "below-market-gate").value,
      coverage: "complete" } }, point("100000", "below-market-gate"))).toEqual({ status: "classification-mismatch" });
  });
  test("matching unavailable points remain uncomparable and opposing signed nets are compared", () => {
    type Point = Parameters<typeof compareReconciliationPoint>[0];
    const noValue: Point = { value: { coverage: "unavailable", missing: [{ assetKey: "asset", reason: "pending-read" }],
      net: { status: "unavailable", value: null, currency: "USD", negative: false } },
      ethWeightedValue: { atoms: "0", scale: 0 } };
    expect(compareReconciliationPoint(noValue, noValue)).toEqual({ status: "unavailable" });
    const positive: Point = { value: { coverage: "complete", missing: [], net: { status: "complete",
      value: { atoms: "1", scale: 0 }, currency: "USD", negative: false } }, ethWeightedValue: { atoms: "1000", scale: 0 } };
    const negative: Point = { ...positive, value: { ...positive.value, net: { ...positive.value.net, negative: true } } };
    expect(compareReconciliationPoint(negative, positive)).toMatchObject({ status: "compared", pass: true });
  });
});
