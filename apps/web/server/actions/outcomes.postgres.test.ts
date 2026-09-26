import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { randomUUID } from "node:crypto";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readMigrationSql } from "@/tests/helpers/migrations";
import { createDeclineActionHandler, createGetActionHandler, createHandleActionHandler, createListActionsHandler, createRetryActionHandler } from "./handler";
import { ActionsStore } from "./store";
import type { MoneyActionOwner } from "@/shared/money-actions/types";
import type { TransferReceiptStatus } from "./receipt";
import type { HandleResolution } from "./reconcile";
import { DECLINE_ACTION_CONTRACT_VERSION } from "@/shared/actions/contracts/decline";

const connectionString = process.env.ACTION_PG_TEST_URL?.trim();
const describePostgres = connectionString ? describe : describe.skip;
const schema = "actions_outcomes_contract_test";
type Client = { unsafe(text: string, values?: unknown[]): Promise<ArrayLike<unknown>>; begin<T>(run: (transaction: Client) => Promise<T>): Promise<T>; close(): Promise<void> };
let admin: Client;
let sql: SqlExecutor;
let store: ActionsStore;
const address = "0x1111111111111111111111111111111111111111" as const;
const hash = `0x${"ab".repeat(32)}` as const;
const userOpHash = `0x${"cd".repeat(32)}` as const;
const blockTimestamp = "2026-09-12T12:06:00.000Z";
const owner = (provider: "cdp-embedded" | "base-account" = "cdp-embedded"): MoneyActionOwner => ({ subject: "outcomes-owner", address, chainId: 8453, accountProvider: provider });
const authorize = async () => Response.json({ user: { subject: "outcomes-owner" }, smartAccount: { address, chainId: 8453 }, accountProvider: "cdp-embedded" });
const baseAuthorize = async () => Response.json({ user: { subject: "outcomes-owner" }, smartAccount: { address, chainId: 8453 }, accountProvider: "base-account" });
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (id: string, path: string, provider: "cdp-embedded" | "base-account" = "cdp-embedded", body?: object) => new Request(`https://home.test/api/actions/${id}${path}`, {
  method: body === undefined ? "GET" : "POST",
  headers: { "X-Home-Account-Provider": provider, "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const listRequest = (provider: "cdp-embedded" | "base-account" = "cdp-embedded") => new Request("https://home.test/api/actions", { headers: { "X-Home-Account-Provider": provider } });
const receipt = (success: boolean, sender: string = address, operationHash: string = userOpHash): TransferReceiptStatus => ({
  status: "confirmed", transactionHash: hash, blockNumber: "1", blockTimestamp, finalized: true,
  userOperations: [{ userOpHash: operationHash, sender, success }],
});
async function prepared(provider: "cdp-embedded" | "base-account" = "cdp-embedded") {
  const id = randomUUID();
  const actionOwner = owner(provider);
  await store.insert({ id, owner: actionOwner, kind: "send", summary: { title: "Send", amounts: [], warnings: [], expiresAt: "2099-01-01T00:00:00.000Z" },
    pending: { calls: [{ to: address, data: "0x", value: "0" }] }, createdAt: new Date().toISOString() });
  await store.confirm(actionOwner, id);
  return id;
}
function handlers(provider: "cdp-embedded" | "base-account" = "cdp-embedded", options: {
  readReceipt?: () => Promise<TransferReceiptStatus>;
  resolveHandle?: () => Promise<HandleResolution>;
} = {}) {
  const deps = { authorize: provider === "base-account" ? baseAuthorize : authorize, store,
    now: () => new Date(Date.now() + 60_000), ...options };
  return {
    handle: createHandleActionHandler(deps), decline: createDeclineActionHandler(deps), retry: createRetryActionHandler(deps),
    get: createGetActionHandler(deps), list: createListActionsHandler(deps),
  };
}

describePostgres("write-once action outcomes with real handlers", () => {
  beforeAll(async () => {
    admin = new Bun.SQL(connectionString!) as unknown as Client;
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (transaction) => {
      await transaction.unsafe(`SET LOCAL search_path TO ${schema}`);
      await transaction.unsafe(await readMigrationSql("001_actions.sql"));
      await transaction.unsafe(await readMigrationSql("012_action_outcomes.sql"));
      await transaction.unsafe(await readMigrationSql("012_action_outcomes.sql"));
      await transaction.unsafe(await readMigrationSql("013_action_call_commitment.sql"));
      await transaction.unsafe(await readMigrationSql("014_cashout_orders.sql"));
    });
    sql = createPostgresSqlExecutor(connectionString!, { schema });
    store = new ActionsStore(sql);
  });
  beforeEach(async () => { await sql.query("TRUNCATE actions CASCADE"); });
  afterAll(async () => {
    setObservabilityLogWriterForTests();
    await sql?.dispose?.();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.close();
  });

  test("duplicate handle, hash, decline and chain reports preserve every column", async () => {
    const id = await prepared();
    const { handle, decline, get } = handlers("cdp-embedded", { readReceipt: async () => receipt(true) });
    const post = (body: object) => handle(request(id, "/handle", "cdp-embedded", body), context(id));
    expect((await post({ providerHandle: userOpHash })).status).toBe(200);
    const firstHandle = await store.get(owner(), id);
    expect((await post({ providerHandle: userOpHash })).status).toBe(200);
    expect(await store.get(owner(), id)).toEqual(firstHandle);
    expect((await post({ transactionHash: hash })).status).toBe(200);
    const firstHash = await store.get(owner(), id);
    expect((await post({ transactionHash: hash })).status).toBe(200);
    expect(await store.get(owner(), id)).toEqual(firstHash);
    expect((await get(request(id, ""), context(id))).status).toBe(200);
    const firstOutcome = await store.get(owner(), id);
    expect(firstOutcome).toMatchObject({ outcome: "succeeded", outcome_source: "chain", settled_at: new Date(blockTimestamp) });
    expect((await get(request(id, ""), context(id))).status).toBe(200);
    expect(await store.get(owner(), id)).toEqual(firstOutcome);

    const declinedId = await prepared();
    const report = () => decline(request(declinedId, "/decline", "cdp-embedded", { version: DECLINE_ACTION_CONTRACT_VERSION, attempt: 0 }), context(declinedId));
    expect((await report()).status).toBe(200);
    const firstDecline = await store.get(owner(), declinedId);
    expect((await report()).status).toBe(200);
    expect(await store.get(owner(), declinedId)).toEqual(firstDecline);
  });

  test("browser hash remains a hint until an attributable UserOperationEvent is observed", async () => {
    const id = await prepared();
    const { handle } = handlers();
    expect((await handle(request(id, "/handle", "cdp-embedded", { providerHandle: userOpHash, transactionHash: hash }), context(id))).status).toBe(200);
    expect((await store.get(owner(), id))?.outcome).toBeNull();
    for (const chainReceipt of [receipt(true, "0x2222222222222222222222222222222222222222"), receipt(true, address, hash)]) {
      const { get } = handlers("cdp-embedded", { readReceipt: async () => chainReceipt });
      const response = await get(request(id, ""), context(id));
      expect((await response.json()).status).toBe("unknown");
      expect((await store.get(owner(), id))?.outcome).toBeNull();
    }
    const { get } = handlers("cdp-embedded", { readReceipt: async () => receipt(true) });
    expect((await (await get(request(id, ""), context(id))).json()).status).toBe("confirmed");
    expect(await store.get(owner(), id)).toMatchObject({ outcome: "succeeded", outcome_source: "chain", settled_at: new Date(blockTimestamp) });
  });

  test("CDP browser hashes stay unresolved without a valid matching user operation handle", async () => {
    for (const providerHandle of [undefined, "not-a-hash"]) {
      const id = await prepared();
      const { handle, get } = handlers("cdp-embedded", { readReceipt: async () => receipt(true) });
      const post = (body: object) => handle(request(id, "/handle", "cdp-embedded", body), context(id));
      expect((await post({ transactionHash: hash, ...(providerHandle ? { providerHandle } : {}) })).status).toBe(200);
      expect((await (await get(request(id, ""), context(id))).json()).status).toBe("unknown");
      expect(await store.get(owner(), id)).toMatchObject({ provider_handle: providerHandle ?? null, transaction_hash: hash, outcome: null });
      if (!providerHandle) {
        expect((await post({ providerHandle: `0x${"CD".repeat(32)}` })).status).toBe(200);
        expect((await (await get(request(id, ""), context(id))).json()).status).toBe("confirmed");
        expect(await store.get(owner(), id)).toMatchObject({ outcome: "succeeded", outcome_source: "chain", settled_at: new Date(blockTimestamp) });
      }
    }
  });

  test("Base 400 records wallet non-submission while Base 500 with a hash waits for chain reversal", async () => {
    const id = await prepared("base-account");
    const { handle } = handlers("base-account");
    expect((await handle(request(id, "/handle", "base-account", { providerHandle: "base-handle" }), context(id))).status).toBe(200);
    const failed = handlers("base-account", { resolveHandle: async () => ({ status: "not_submitted" }) });
    expect((await (await failed.get(request(id, "", "base-account"), context(id))).json()).status).toBe("failed");
    expect(await store.get(owner("base-account"), id)).toMatchObject({ outcome: "not_submitted", outcome_source: "wallet", transaction_hash: null });

    const reversedId = await prepared("base-account");
    expect((await handle(request(reversedId, "/handle", "base-account", { providerHandle: "base-handle" }), context(reversedId))).status).toBe(200);
    const reversed = handlers("base-account", { resolveHandle: async () => ({ status: "reverted", transactionHash: hash }), readReceipt: async () => receipt(false) });
    expect((await (await reversed.get(request(reversedId, "", "base-account"), context(reversedId))).json()).status).toBe("failed");
    expect(await store.get(owner("base-account"), reversedId)).toMatchObject({ transaction_hash: hash, outcome: "reverted", outcome_source: "chain", settled_at: new Date(blockTimestamp) });
  });

  test("decline hides an action until retry records a handle; later decline cannot alter a dispatched row", async () => {
    const id = await prepared();
    const { decline, handle, list } = handlers("cdp-embedded", { readReceipt: async () => receipt(true) });
    expect((await decline(request(id, "/decline", "cdp-embedded", { version: DECLINE_ACTION_CONTRACT_VERSION, attempt: 0 }), context(id))).status).toBe(200);
    expect((await (await list(listRequest())).json()).actions).toEqual([]);
    expect((await handle(request(id, "/handle", "cdp-embedded", { providerHandle: userOpHash, transactionHash: hash }), context(id))).status).toBe(200);
    expect((await (await list(listRequest())).json()).actions).toMatchObject([{ id, status: "confirmed" }]);
    expect((await store.get(owner(), id))?.outcome).toBe("succeeded");
    const laterId = await prepared();
    expect((await handle(request(laterId, "/handle", "cdp-embedded", { providerHandle: userOpHash }), context(laterId))).status).toBe(200);
    const blockedRetry = await handlers().retry(request(laterId, "/retry", "cdp-embedded", { version: 1, attempt: 1 }), context(laterId));
    expect(blockedRetry.status).toBe(409);
    expect(await blockedRetry.json()).toMatchObject({ error: { code: "ACTION_ALREADY_DISPATCHED" } });
    expect((await decline(request(laterId, "/decline", "cdp-embedded", { version: DECLINE_ACTION_CONTRACT_VERSION, attempt: 0 }), context(laterId))).status).toBe(200);
    expect((await store.get(owner(), laterId))?.declined_reported_at).toBeNull();
  });

  test("a declined retry is visible without a handle, and a late previous decline cannot hide it", async () => {
    const id = await prepared();
    const { decline, retry, list } = handlers();
    const report = (attempt: number) => decline(request(id, "/decline", "cdp-embedded", { version: 1, attempt }), context(id));
    const begin = () => retry(request(id, "/retry", "cdp-embedded", { version: 1, attempt: 1 }), context(id));
    expect((await report(0)).status).toBe(200);
    expect((await (await list(listRequest())).json()).actions).toEqual([]);
    expect((await begin()).status).toBe(200);
    const afterRetry = await store.get(owner(), id);
    expect(afterRetry).toMatchObject({ dispatch_attempt: 1, declined_reported_at: null, transaction_hash: null, provider_handle: null });
    expect((await begin()).status).toBe(200);
    expect(await store.get(owner(), id)).toEqual(afterRetry);
    expect((await (await list(listRequest())).json()).actions).toMatchObject([{ id, status: "pending" }]);
    expect((await report(0)).status).toBe(200);
    expect(await store.get(owner(), id)).toEqual(afterRetry);
    expect((await (await list(listRequest())).json()).actions).toHaveLength(1);
    expect((await report(1)).status).toBe(200);
    expect((await (await list(listRequest())).json()).actions).toEqual([]);
    expect((await retry(request(id, "/retry", "cdp-embedded", { version: 1, attempt: 3 }), context(id))).status).toBe(409);
  });

  test("wallet outcomes and hashes cannot coexist in either posting order", async () => {
    const { handle } = handlers("base-account");
    const walletFirst = await prepared("base-account");
    await store.recordOutcome(owner("base-account"), walletFirst, { outcome: "not_submitted", source: "wallet", settledAt: null });
    const initial = await store.get(owner("base-account"), walletFirst);
    expect((await handle(request(walletFirst, "/handle", "base-account", { transactionHash: hash }), context(walletFirst))).status).toBe(404);
    expect(await store.get(owner("base-account"), walletFirst)).toEqual(initial);

    const hashFirst = await prepared("base-account");
    await store.recordHandle(owner("base-account"), hashFirst, { transactionHash: hash });
    const before = await store.get(owner("base-account"), hashFirst);
    const outcome = await store.recordOutcome(owner("base-account"), hashFirst, { outcome: "not_submitted", source: "wallet", settledAt: null });
    expect(outcome).toMatchObject({ written: false, conflict: true });
    expect(await store.get(owner("base-account"), hashFirst)).toEqual(before);
  });

  test("a non-finalized receipt displays a result without recording it until a finalized read", async () => {
    const id = await prepared();
    await store.recordHandle(owner(), id, { providerHandle: userOpHash, transactionHash: hash });
    const nonfinal = handlers("cdp-embedded", { readReceipt: async () => ({ ...receipt(true), finalized: false }) });
    expect((await (await nonfinal.get(request(id, ""), context(id))).json()).status).toBe("confirmed");
    expect((await store.get(owner(), id))?.outcome).toBeNull();
    const final = handlers("cdp-embedded", { readReceipt: async () => receipt(true) });
    expect((await (await final.get(request(id, ""), context(id))).json()).status).toBe("confirmed");
    expect((await store.get(owner(), id))?.outcome).toBe("succeeded");
  });

  test("a racing chain result emits a conflict event and preserves the first outcome", async () => {
    const id = await prepared();
    await store.recordHandle(owner(), id, { providerHandle: userOpHash, transactionHash: hash });
    const events: Array<Record<string, unknown>> = [];
    setObservabilityLogWriterForTests((line) => { events.push(JSON.parse(line) as Record<string, unknown>); });
    const get = createGetActionHandler({ authorize, readReceipt: async () => receipt(false),
      store: {
        get: (actionOwner, actionId) => store.get(actionOwner, actionId),
        recordHandle: (actionOwner, actionId, input) => store.recordHandle(actionOwner, actionId, input),
        recordOutcome: async (actionOwner, actionId, input) => {
          await store.recordOutcome(actionOwner, actionId, { outcome: "succeeded", source: "chain", settledAt: new Date(blockTimestamp) });
          return store.recordOutcome(actionOwner, actionId, input);
        },
      },
    });
    expect((await (await get(request(id, ""), context(id))).json()).status).toBe("confirmed");
    expect((await store.get(owner(), id))?.outcome).toBe("succeeded");
    expect(events).toContainEqual(expect.objectContaining({ kind: "action-outcome", code: "OUTCOME_CONFLICT", outcome: "conflict" }));
    setObservabilityLogWriterForTests();
  });

  test("conflicting later evidence cannot overwrite a settled result", async () => {
    const id = await prepared();
    await store.recordOutcome(owner(), id, { outcome: "succeeded", source: "chain", settledAt: new Date(blockTimestamp) });
    const original = await store.get(owner(), id);
    const conflict = await store.recordOutcome(owner(), id, { outcome: "reverted", source: "chain", settledAt: new Date("2026-09-12T12:07:00.000Z") });
    expect(conflict).toMatchObject({ written: false, conflict: true });
    const { get } = handlers("cdp-embedded", { readReceipt: async () => { throw new Error("receipt should not be reread"); } });
    expect((await (await get(request(id, ""), context(id))).json()).status).toBe("confirmed");
    expect(await store.get(owner(), id)).toEqual(original);
  });
});
