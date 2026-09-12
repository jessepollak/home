import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PostgresFundingOrderStore, type FundingSqlExecutor } from "./postgres-store";
import type { FundingReservation } from "./store";

const connectionString = process.env.FUNDING_PG_TEST_URL?.trim();
const describePostgres = connectionString ? describe : describe.skip;
type BunSqlClient = { unsafe(text: string, values?: unknown[]): Promise<ArrayLike<unknown>>; begin<T>(run: (transaction: BunSqlClient) => Promise<T>): Promise<T>; close(): Promise<void> };
let client: BunSqlClient;
let store: PostgresFundingOrderStore;

function reservation(intentDigest = randomUUID()): FundingReservation {
  return {
    id: randomUUID(), owner: { subject: "pg-fixture", accountProvider: "base-account" },
    destination: "0x1111111111111111111111111111111111111111", providerId: "idrx",
    region: "ID", assetId: "base:idrx", paymentMethod: "qris", fiatAmount: "20000",
    intentDigest, quote: { fiatAmount: "20000", tokenAmountAtomic: "2000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" },
    quoteToken: `signed-${intentDigest}`, customerRef: null, creationBlock: "100",
    createdAt: "2026-09-12T00:00:00.000Z",
  };
}
const dispatch = { providerOrderId: "provider-order", expectedTokenAmountAtomic: "2000000", fees: [], expiresAt: null, instructions: { kind: "qr" as const, scheme: "qris" as const, payload: "fixture", amount: "20000", currency: "IDR" }, expectedVersion: 0, updatedAt: "2026-09-12T00:00:01.000Z" };

describePostgres("PostgresFundingOrderStore production contract", () => {
  beforeAll(async () => {
    client = new Bun.SQL(connectionString!) as unknown as BunSqlClient;
    const migration = await readFile(resolve(import.meta.dir, "../migrations/002_funding_provider_seam.sql"), "utf8");
    await client.unsafe("DROP TABLE IF EXISTS funding_orders");
    await client.unsafe(migration);
    store = new PostgresFundingOrderStore(bunExecutor(client));
  });
  beforeEach(async () => { await client.unsafe("TRUNCATE funding_orders"); });
  afterAll(async () => { await client?.unsafe("DROP TABLE IF EXISTS funding_orders"); await client?.close(); });

  test("concurrent reservations produce one stable order and retain the original quote token", async () => {
    const digest = randomUUID();
    const left = reservation(digest);
    const right = { ...reservation(digest), quoteToken: left.quoteToken };
    const results = await Promise.all([store.reserve(left), store.reserve(right)]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results[0].order.id).toBe(results[1].order.id);
    expect(results[0].order.quoteToken).toBe(left.quoteToken);
  });

  test("CAS rejects stale observations and terminal states cannot reopen", async () => {
    const input = reservation();
    await store.reserve(input);
    const dispatched = await store.completeDispatch(input.id, dispatch);
    const settling = await store.applyObservation(input.id, { state: "settling", providerStatus: "processing", providerTransactionHash: `0x${"1".repeat(64)}`, expectedVersion: dispatched.version, updatedAt: "2026-09-12T00:00:02.000Z" });
    expect(settling?.state).toBe("settling");
    expect(await store.applyObservation(input.id, { state: "awaiting-payment", providerStatus: "stale", expectedVersion: dispatched.version, updatedAt: "2026-09-12T00:00:03.000Z" })).toBeNull();
    const refunded = await store.applyObservation(input.id, { state: "refunded", providerStatus: "refund-completed", expectedVersion: settling!.version, updatedAt: "2026-09-12T00:00:04.000Z" });
    expect(refunded?.instructions).toBeNull();
    expect(await store.applyObservation(input.id, { state: "sent-unverified", providerStatus: "late-complete", expectedVersion: refunded!.version, updatedAt: "2026-09-12T00:00:05.000Z" })).toBeNull();
    expect((await store.getOwned(input.id, input.owner))?.state).toBe("refunded");
  });

  test("simultaneous observation, refund and receipt contenders keep one monotonic terminal winner", async () => {
    const input = reservation();
    await store.reserve(input);
    const dispatched = await store.completeDispatch(input.id, dispatch);
    const contenders = await Promise.all([
      store.applyObservation(input.id, { state: "settling", providerStatus: "processing", expectedVersion: dispatched.version, updatedAt: "2026-09-12T00:00:02.000Z" }),
      store.applyObservation(input.id, { state: "refunded", providerStatus: "refund-completed", expectedVersion: dispatched.version, updatedAt: "2026-09-12T00:00:02.000Z" }),
      store.claimReceipt(input.id, { transactionHash: `0x${"4".repeat(64)}`, logIndex: 9, expectedVersion: dispatched.version, updatedAt: "2026-09-12T00:00:02.000Z" }),
    ]);
    expect(contenders.filter(Boolean)).toHaveLength(1);
    let current = (await store.getOwned(input.id, input.owner))!;
    if (current.state === "settling") {
      const terminals = await Promise.all([
        store.applyObservation(input.id, { state: "refunded", providerStatus: "refund-completed", expectedVersion: current.version, updatedAt: "2026-09-12T00:00:03.000Z" }),
        store.claimReceipt(input.id, { transactionHash: `0x${"4".repeat(64)}`, logIndex: 9, expectedVersion: current.version, updatedAt: "2026-09-12T00:00:03.000Z" }),
      ]);
      expect(terminals.filter(Boolean)).toHaveLength(1);
      current = (await store.getOwned(input.id, input.owner))!;
    }
    expect(["refunded", "received"]).toContain(current.state);
    expect(current.instructions).toBeNull();
    expect(await store.applyObservation(input.id, { state: "sent-unverified", providerStatus: "late", expectedVersion: current.version, updatedAt: "2026-09-12T00:00:04.000Z" })).toBeNull();
    expect((await store.getOwned(input.id, input.owner))?.state).toBe(current.state);
  });

  test("receipt claims are unique, immutable and atomic with received", async () => {
    const first = reservation();
    const second = reservation();
    await store.reserve(first); await store.reserve(second);
    const a = await store.completeDispatch(first.id, dispatch);
    const b = await store.completeDispatch(second.id, { ...dispatch, providerOrderId: "provider-order-2" });
    const evidence = { transactionHash: `0x${"2".repeat(64)}` as `0x${string}`, logIndex: 7 };
    const received = await store.claimReceipt(first.id, { ...evidence, expectedVersion: a.version, updatedAt: "2026-09-12T00:00:02.000Z" });
    expect(received?.state).toBe("received");
    expect(received?.transactionHash).toBe(evidence.transactionHash);
    expect(await store.claimReceipt(second.id, { ...evidence, expectedVersion: b.version, updatedAt: "2026-09-12T00:00:03.000Z" })).toBeNull();
    expect(await store.claimReceipt(first.id, { transactionHash: `0x${"3".repeat(64)}`, logIndex: 8, expectedVersion: received!.version, updatedAt: "2026-09-12T00:00:04.000Z" })).toBeNull();
    const persisted = await store.getOwned(first.id, first.owner);
    expect([persisted?.transactionHash, persisted?.logIndex]).toEqual([evidence.transactionHash, 7]);
  });
});

function bunExecutor(sqlClient: BunSqlClient, inTransaction = false): FundingSqlExecutor {
  return {
    async query<T>(text: string, values: unknown[] = []) {
      return { rows: Array.from(await sqlClient.unsafe(text, values)) as T[] };
    },
    async transaction<T>(run: (transaction: FundingSqlExecutor) => Promise<T>) {
      if (inTransaction) throw new Error("nested transaction unsupported");
      return sqlClient.begin((transaction) => run(bunExecutor(transaction, true)));
    },
  };
}
