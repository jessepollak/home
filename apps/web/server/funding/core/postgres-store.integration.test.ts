import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readMigrationSql, readAllMigrationSql } from "@/tests/helpers/migrations";
import { fundingAbandonStoreContract } from "@/tests/helpers/funding-store-contract";
import { PostgresFundingOrderStore } from "./postgres-store";
import type { FundingReservation } from "./store";

const connectionString = process.env.FUNDING_PG_TEST_URL?.trim();
const describePostgres = connectionString ? describe : describe.skip;
const TEST_SCHEMA = "funding_contract_test";
type BunSqlClient = { unsafe(text: string, values?: unknown[]): Promise<ArrayLike<unknown>>; begin<T>(run: (transaction: BunSqlClient) => Promise<T>): Promise<T>; close(): Promise<void> };
let admin: BunSqlClient;
let sql: SqlExecutor;
let store: PostgresFundingOrderStore;
let hostedRetirementMigration: string;

function reservation(intentDigest = randomUUID()): FundingReservation {
  return {
    id: randomUUID(), owner: { subject: "pg-fixture", accountProvider: "base-account" },
    destination: "0x1111111111111111111111111111111111111111", providerId: "idrx",
    region: "ID", assetId: "base:idrx", paymentMethod: "qris", fiatAmount: "20000",
    intentDigest, quote: { fiatAmount: "20000", tokenAmountAtomic: "2000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" },
    quoteToken: `signed-${intentDigest}`, customerRef: null, sandbox: false, creationBlock: "100",
    createdAt: "2026-09-12T00:00:00.000Z",
  };
}
const dispatch = { providerOrderId: "provider-order", expectedTokenAmountAtomic: "2000000", fees: [], expiresAt: null, instructions: { kind: "qr" as const, scheme: "qris" as const, payload: "fixture", amount: "20000", currency: "IDR" }, expectedVersion: 0, updatedAt: "2026-09-12T00:00:01.000Z" };

async function inTestSchema(text: string): Promise<void> {
  await admin.begin(async (transaction) => {
    await transaction.unsafe(`SET LOCAL search_path TO ${TEST_SCHEMA}`);
    await transaction.unsafe(text);
  });
}

describePostgres("PostgresFundingOrderStore production contract", () => {
  fundingAbandonStoreContract(() => store, reservation);
  beforeAll(async () => {
    admin = new Bun.SQL(connectionString!) as unknown as BunSqlClient;
    hostedRetirementMigration = await readMigrationSql("003_coinbase_hosted_retired.sql");
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await admin.unsafe(`CREATE SCHEMA ${TEST_SCHEMA}`);
    for (const migration of await readAllMigrationSql()) await inTestSchema(migration);
    sql = createPostgresSqlExecutor(connectionString!, { schema: TEST_SCHEMA });
    store = new PostgresFundingOrderStore(sql);
  });
  beforeEach(async () => { await sql.query("TRUNCATE funding_orders"); });
  afterAll(async () => {
    await sql?.dispose?.();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await admin?.close();
  });

  test("concurrent reservations produce one stable order and retain the original quote token", async () => {
    const digest = randomUUID();
    const left = reservation(digest);
    const right = { ...reservation(digest), quoteToken: left.quoteToken };
    const results = await Promise.all([store.reserve(left), store.reserve(right)]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results[0].order.id).toBe(results[1].order.id);
    expect(results[0].order.quoteToken).toBe(left.quoteToken);
  });

  test("rejects a second dispatch that reuses another order's provider order id", async () => {
    const first = reservation();
    const second = reservation();
    await store.reserve(first);
    await store.reserve(second);
    await store.completeDispatch(first.id, dispatch);
    await expect(store.completeDispatch(second.id, dispatch)).rejects.toBeDefined();
  });

  test("sandbox flag round-trips through reservations", async () => {
    const input = { ...reservation(), sandbox: true };
    const reserved = await store.reserve(input);
    expect(reserved.order.sandbox).toBe(true);
    expect((await store.getOwned(input.id, input.owner))?.sandbox).toBe(true);
  });

  test("sandbox migration leaves the column non-null and false by default", async () => {
    const { rows } = await sql.query<{ is_nullable: string; column_default: string | null }>(
      "SELECT is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'funding_orders' AND column_name = 'sandbox'",
      [TEST_SCHEMA],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].is_nullable).toBe("NO");
    expect(rows[0].column_default ?? "").toMatch(/false/);
  });

  test("lists open orders and reads a specific provider only for their owner", async () => {
    const first = { ...reservation(), owner: { subject: "pg-provider-scope", accountProvider: "base-account" as const } };
    const second = { ...reservation(), owner: first.owner, providerId: "coinbase", createdAt: "2026-09-13T00:00:00.000Z" };
    const otherMethod = { ...reservation(), owner: first.owner, paymentMethod: "bank", createdAt: "2026-09-12T01:00:00.000Z" };
    await store.reserve(first);
    await store.reserve(otherMethod);
    await store.reserve(second);
    expect((await store.listOpen(first.owner, "ID")).map((order) => order.id)).toEqual([second.id, otherMethod.id, first.id]);
    expect((await store.getOpenForProvider(first.owner, "ID", "idrx"))?.id).toBe(otherMethod.id);
    expect((await store.getOpenForProvider(first.owner, "ID", "idrx", "qris"))?.id).toBe(first.id);
    expect((await store.getOpenForProvider(first.owner, "ID", "idrx", "bank"))?.id).toBe(otherMethod.id);
    expect(await store.getOpenForProvider(first.owner, "ID", "idrx", "card")).toBeNull();
    expect((await store.getOpenForProvider(first.owner, "ID", "coinbase"))?.id).toBe(second.id);
    expect(await store.listOpen({ subject: "pg-other", accountProvider: "base-account" }, "ID")).toEqual([]);
    expect(await store.getOpenForProvider({ subject: "pg-other", accountProvider: "base-account" }, "ID", "idrx", "qris")).toBeNull();
    expect(await store.getOpenForProvider(first.owner, "US", "idrx")).toBeNull();
    const otherAsset = { ...reservation(), owner: first.owner, assetId: "base:usdc", createdAt: "2026-09-14T00:00:00.000Z" };
    await store.reserve(otherAsset);
    expect((await store.getOpenForProvider(first.owner, "ID", "idrx", "qris"))?.id).toBe(otherAsset.id);
    expect((await store.getOpenForProvider(first.owner, "ID", "idrx", "qris", first.assetId))?.id).toBe(first.id);
    expect((await store.getOpenForProvider(first.owner, "ID", "idrx", "qris", otherAsset.assetId))?.id).toBe(otherAsset.id);
    expect((await store.getOpenForProvider(first.owner, "ID", "idrx", undefined, otherAsset.assetId))?.id).toBe(otherAsset.id);
    expect(await store.getOpenForProvider(first.owner, "ID", "idrx", "bank", otherAsset.assetId)).toBeNull();
  });

  test("finds an owner-region ambiguous order after a newer open order is observed", async () => {
    const ambiguousInput = { ...reservation(), owner: { subject: "pg-ambiguous-lookup", accountProvider: "base-account" as const } };
    await store.reserve(ambiguousInput);
    await store.markDispatchAmbiguous(ambiguousInput.id, 0, "2026-09-12T00:00:01.000Z");
    const newer = { ...reservation(), owner: ambiguousInput.owner };
    await store.reserve(newer);
    const dispatched = await store.completeDispatch(newer.id, { ...dispatch, providerOrderId: "pg-ambiguous-lookup-newer" });
    await store.applyObservation(newer.id, { state: "awaiting-payment", providerStatus: "pending", expectedVersion: dispatched.version, updatedAt: "2026-09-12T00:00:05.000Z" });
    expect((await store.getOpen(ambiguousInput.owner, "ID"))?.id).toBe(newer.id);
    expect((await store.getDispatchAmbiguous(ambiguousInput.owner, "ID", "idrx"))?.id).toBe(ambiguousInput.id);
    expect(await store.getDispatchAmbiguous(ambiguousInput.owner, "ID", "other-provider")).toBeNull();
    expect(await store.getDispatchAmbiguous({ subject: "pg-other", accountProvider: "base-account" }, "ID", "idrx")).toBeNull();
  });

  test("owner-scoped ambiguous resolution is terminal and excluded from getOpen", async () => {
    const input = reservation();
    await store.reserve(input);
    const ambiguous = await store.markDispatchAmbiguous(
      input.id,
      0,
      "2026-09-12T00:00:01.000Z",
    );
    expect((await store.getOpen(input.owner, "ID"))?.id).toBe(input.id);
    expect(await store.resolveDispatchAmbiguous(
      input.id,
      { subject: "wrong-owner", accountProvider: input.owner.accountProvider },
      ambiguous.version,
      "2026-09-12T00:00:02.000Z",
    )).toBeNull();
    expect((await store.getOwned(input.id, input.owner))?.state).toBe("dispatch-ambiguous");

    const resolved = await store.resolveDispatchAmbiguous(
      input.id,
      input.owner,
      ambiguous.version,
      "2026-09-12T00:00:03.000Z",
    );
    expect(resolved).toMatchObject({ state: "cancelled", instructions: null });
    expect(await store.getOpen(input.owner, "ID")).toBeNull();
    const replay = await store.reserve({ ...input, id: randomUUID() });
    expect(replay).toMatchObject({ created: false, order: { id: input.id, state: "cancelled" } });
    expect(await store.resolveDispatchAmbiguous(
      input.id,
      input.owner,
      resolved!.version,
      "2026-09-12T00:00:04.000Z",
    )).toBeNull();
  });

  test("does not resume completed sandbox runs but keeps live sent-unverified orders open", async () => {
    const sandbox = { ...reservation(), owner: { subject: "pg-sandbox", accountProvider: "base-account" as const }, sandbox: true };
    await store.reserve(sandbox);
    const sandboxDispatched = await store.completeDispatch(sandbox.id, { ...dispatch, providerOrderId: "sandbox-sent" });
    await store.applyObservation(sandbox.id, { state: "sent-unverified", providerStatus: "complete", expectedVersion: sandboxDispatched.version, updatedAt: "2026-09-12T00:00:02.000Z" });
    expect(await store.getOpen(sandbox.owner, "ID")).toBeNull();
    const replacement = await store.reserve({
      ...reservation(),
      owner: sandbox.owner,
      sandbox: true,
    });
    expect(replacement.created).toBe(true);

    const live = { ...reservation(), owner: { subject: "pg-live", accountProvider: "base-account" as const } };
    await store.reserve(live);
    const liveDispatched = await store.completeDispatch(live.id, { ...dispatch, providerOrderId: "live-sent" });
    await store.applyObservation(live.id, { state: "sent-unverified", providerStatus: "unverified", expectedVersion: liveDispatched.version, updatedAt: "2026-09-12T00:00:02.000Z" });
    expect((await store.getOpen(live.owner, "ID"))?.id).toBe(live.id);
    const liveReplacement = await store.reserve({
      ...reservation(),
      owner: live.owner,
    });
    expect(liveReplacement.created).toBe(true);
  });

  test("persists settlement economics and preserves them across later observations", async () => {
    const input = reservation();
    await store.reserve(input);
    const dispatched = await store.completeDispatch(input.id, dispatch);
    const fees = [{ label: "QRIS Fee (0.7%)", amount: "140", currency: "IDR" }];
    const settled = await store.applyObservation(input.id, {
      state: "settling",
      providerStatus: "PROCESSING:PAID",
      expectedTokenAmountAtomic: "1986000",
      fees,
      expectedVersion: dispatched.version,
      updatedAt: "2026-09-12T00:00:02.000Z",
    });
    expect(settled).toMatchObject({
      expectedTokenAmountAtomic: "1986000",
      fees,
    });

    const sent = await store.applyObservation(input.id, {
      state: "sent-unverified",
      providerStatus: "MINTED:PAID",
      expectedVersion: settled!.version,
      updatedAt: "2026-09-12T00:00:03.000Z",
    });
    expect(sent).toMatchObject({
      expectedTokenAmountAtomic: "1986000",
      fees,
    });
    expect(await store.getOwned(input.id, input.owner)).toMatchObject({
      expectedTokenAmountAtomic: "1986000",
      fees,
    });
  });

  for (const state of ["cancelled", "expired"] as const) {
    test(`provider ${state} after abandonment clears the persisted reason`, async () => {
      const input = reservation();
      await store.reserve(input);
      const dispatched = await store.completeDispatch(input.id, dispatch);
      const abandoned = await store.abandon(input.id, input.owner, { expectedVersion: dispatched.version, reason: "owner", updatedAt: "2026-09-12T00:00:02.000Z" });
      expect(abandoned).toMatchObject({ state: "abandoned", abandonReason: "owner" });
      if (!abandoned) throw new Error("Expected abandoned order");
      expect(await store.applyObservation(input.id, { state, providerStatus: state, expectedVersion: abandoned.version, updatedAt: "2026-09-12T00:00:03.000Z" })).toMatchObject({ state, abandonReason: null });
      expect(await store.getOwned(input.id, input.owner)).toMatchObject({ state, abandonReason: null });
      const { rows } = await sql.query<{ abandon_reason: string | null }>("SELECT abandon_reason FROM funding_orders WHERE id=$1", [input.id]);
      expect(rows).toEqual([{ abandon_reason: null }]);
    });
  }

  test("a receipt after abandonment clears the persisted reason", async () => {
    const input = reservation();
    await store.reserve(input);
    const dispatched = await store.completeDispatch(input.id, dispatch);
    const abandoned = await store.abandon(input.id, input.owner, { expectedVersion: dispatched.version, reason: "timed-out", updatedAt: "2026-09-12T00:00:02.000Z" });
    if (!abandoned) throw new Error("Expected abandoned order");
    expect(await store.claimReceipt(input.id, { transactionHash: `0x${"6".repeat(64)}`, logIndex: 3, expectedVersion: abandoned.version, updatedAt: "2026-09-12T00:00:03.000Z" })).toMatchObject({ state: "received", abandonReason: null });
    const { rows } = await sql.query<{ abandon_reason: string | null }>("SELECT abandon_reason FROM funding_orders WHERE id=$1", [input.id]);
    expect(rows).toEqual([{ abandon_reason: null }]);
  });

  test("reads normalize an older non-abandoned row with a stale abandonment reason", async () => {
    const input = reservation();
    await store.reserve(input);
    await store.completeDispatch(input.id, dispatch);
    await sql.query("UPDATE funding_orders SET state='expired', abandon_reason='owner', instructions=NULL WHERE id=$1", [input.id]);
    expect(await store.getOwned(input.id, input.owner)).toMatchObject({ state: "expired", abandonReason: null });
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

  test("migration 003 idempotently terminalizes hosted Coinbase rows and removes them from getOpen", async () => {
    const awaiting = {
      ...reservation(),
      providerId: "coinbase",
      region: "US",
      assetId: "base:usdc",
      paymentMethod: "hosted",
      fiatAmount: "25",
      quote: {
        fiatAmount: "25",
        tokenAmountAtomic: "25000000",
        fees: [],
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    } satisfies FundingReservation;
    const reserving = { ...awaiting, id: randomUUID(), intentDigest: randomUUID(), quoteToken: `signed-${randomUUID()}` };
    const ambiguous = { ...awaiting, id: randomUUID(), intentDigest: randomUUID(), quoteToken: `signed-${randomUUID()}` };
    await store.reserve(awaiting);
    await store.completeDispatch(awaiting.id, {
      providerOrderId: "hosted-session-token",
      expectedTokenAmountAtomic: "25000000",
      fees: [],
      expiresAt: null,
      instructions: { kind: "redirect", url: "https://pay.coinbase.com/buy" },
      expectedVersion: 0,
      updatedAt: "2026-09-12T00:00:01.000Z",
    });
    await store.reserve(reserving);
    await store.reserve(ambiguous);
    await store.markDispatchAmbiguous(
      ambiguous.id,
      0,
      "2026-09-12T00:00:01.000Z",
    );

    await inTestSchema(hostedRetirementMigration);
    const expired = await store.getOwned(awaiting.id, awaiting.owner);
    const failed = await store.getOwned(reserving.id, reserving.owner);
    const ambiguousFailed = await store.getOwned(ambiguous.id, ambiguous.owner);
    expect(expired).toMatchObject({
      state: "expired",
      providerStatus: "HOSTED_SESSION_RETIRED",
      instructions: null,
      version: 2,
    });
    expect(failed).toMatchObject({
      state: "failed",
      providerStatus: "HOSTED_SESSION_RETIRED",
      instructions: null,
      version: 1,
    });
    expect(ambiguousFailed).toMatchObject({
      state: "failed",
      providerStatus: "HOSTED_SESSION_RETIRED",
      instructions: null,
      version: 2,
    });
    expect(await store.getOpen(awaiting.owner, "US")).toBeNull();

    await inTestSchema(hostedRetirementMigration);
    expect((await store.getOwned(awaiting.id, awaiting.owner))?.version).toBe(2);
    expect((await store.getOwned(reserving.id, reserving.owner))?.version).toBe(1);
    expect((await store.getOwned(ambiguous.id, ambiguous.owner))?.version).toBe(2);
  });
  test("keeps an older open order visible despite a newer terminal order at the limit", async () => {
    const older = reservation();
    const newer = { ...reservation(), createdAt: "2026-09-13T00:00:00.000Z" };
    await store.reserve(older);
    await store.reserve(newer);
    await store.markDispatchAmbiguous(newer.id, 0, newer.createdAt);
    await store.resolveDispatchAmbiguous(newer.id, newer.owner, 1, newer.createdAt);
    expect((await store.listOwned(older.owner, 1)).map((row) => row.id)).toEqual([older.id]);
    expect((await store.listOwned(older.owner, 2)).map((row) => row.id)).toEqual([newer.id, older.id]);
  });

  test("lists exact owner across regions newest first and rejects unbounded limits", async () => {
    const first = reservation();
    const second = { ...reservation(), region: "US", assetId: "base:usdc", createdAt: "2026-09-13T00:00:00.000Z" };
    const otherSubject = { ...reservation(), owner: { subject: "different", accountProvider: "base-account" as const }, createdAt: "2026-09-14T00:00:00.000Z" };
    const otherProvider = { ...reservation(), owner: { subject: first.owner.subject, accountProvider: "cdp-embedded" as const }, createdAt: "2026-09-15T00:00:00.000Z" };
    for (const input of [first, second, otherSubject, otherProvider]) await store.reserve(input);
    expect((await store.listOwned(first.owner, 50)).map((row) => row.id)).toEqual([second.id, first.id]);
    expect((await store.listOwned(first.owner, 1)).map((row) => row.id)).toEqual([second.id]);
    for (const limit of [0, -1, 101, 1.5, Number.NaN]) await expect(store.listOwned(first.owner, limit)).rejects.toThrow();
  });
});
