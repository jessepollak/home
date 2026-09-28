import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { createHmac, randomUUID } from "node:crypto";
import { createCdpWebhookHandler } from "@/server/balances/webhook";
import { settleOpenActionsForAccounts } from "./follow-through";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readMigrationSql } from "@/tests/helpers/migrations";
import { createDeclineActionHandler, createGetActionHandler, createHandleActionHandler, createListActionsHandler, createRetryActionHandler } from "./handler";
import { ActionsStore } from "./store";
import type { MoneyActionOwner } from "@/shared/money-actions/types";
import type { TransferReceiptStatus } from "./receipt";
import { createActionHandleResolver, type HandleResolution } from "./reconcile";
import { createUserOperationLogLookup } from "./user-operation-log";
import { USER_OPERATION_ENTRY_POINTS, USER_OPERATION_EVENT_TOPIC } from "./receipt";
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
  status: "confirmed", transactionHash: hash, blockNumber: "1", blockHash: `0x${"ef".repeat(32)}`, blockTimestamp, finalized: true,
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
      await transaction.unsafe(await readMigrationSql("016_action_receipt_observations.sql"));
      for (const file of ["002_funding_provider_seam.sql", "007_funding_provider_customers.sql", "008_funding_provider_user_tokens.sql", "011_operator_registry.sql", "017_record_customer_ids.sql"]) {
        await transaction.unsafe(await readMigrationSql(file));
      }
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

  for (const provider of ["cdp-embedded", "base-account"] as const) {
    test(`${provider} follows a handle to a finalized receipt without another client call`, async () => {
      const id = await prepared(provider);
      const tasks: Array<() => Promise<unknown>> = [];
      const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
        const call = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] };
        const result = call.method === "wallet_getCallsStatus"
          ? { id: userOpHash, version: "2.0.0", chainId: "0x2105", atomic: true, status: 200, receipts: [{ transactionHash: hash }] }
          : call.method === "eth_chainId" ? "0x2105"
          : call.method === "eth_blockNumber" ? "0x100"
          : [{ address: USER_OPERATION_ENTRY_POINTS.V06, transactionHash: hash,
            topics: [USER_OPERATION_EVENT_TOPIC, userOpHash, `0x${"0".repeat(24)}${address.slice(2)}`] }];
        return Response.json({ jsonrpc: "2.0", id: call.id, result });
      };
      const resolver = createActionHandleResolver({ fetchImpl, now: () => Date.now(),
        logLookup: createUserOperationLogLookup({ fetchImpl, now: () => Date.now() }) });
      const handle = createHandleActionHandler({ authorize: provider === "base-account" ? baseAuthorize : authorize,
        store, schedule: (task) => tasks.push(task), markHot: async () => {},
        followDeps: { store, resolveHandle: resolver, readReceipt: async () => receipt(true) } });
      expect((await handle(request(id, "/handle", provider, { providerHandle: userOpHash }), context(id))).status).toBe(200);
      expect((await store.get(owner(provider), id))?.transaction_hash).toBeNull();
      expect(tasks).toHaveLength(1);
      await tasks[0]!();
      expect(await store.get(owner(provider), id)).toMatchObject({ transaction_hash: hash,
        observed_receipt_transaction_hash: hash, observed_receipt_outcome: "succeeded", outcome: "succeeded", outcome_source: "chain" });
      expect((await handle(request(id, "/handle", provider, { providerHandle: userOpHash }), context(id))).status).toBe(200);
      expect(tasks).toHaveLength(1);
    });
  }

  test("a signed account webhook settles a confirmed handle-only action", async () => {
    const id = await prepared();
    await store.recordHandle(owner(), id, { providerHandle: userOpHash });
    const tasks: Array<() => Promise<void>> = [];
    const logLines: string[] = [];
    setObservabilityLogWriterForTests((line) => { logLines.push(line); });
    const secret = "fixture-webhook-secret";
    const timestamp = Math.floor(Date.now() / 1000);
    const raw = new TextEncoder().encode(JSON.stringify({ eventType: "wallet.activity.detected", data: { matchedAddress: address } }));
    const signature = createHmac("sha256", secret).update(Buffer.concat([Buffer.from(`${timestamp}.`), Buffer.from(raw)])).digest("hex");
    const webhook = createCdpWebhookHandler({ store: { markStaleMany: async () => {} }, keyring: null,
      subscriptions: { list: async () => [{ subscriptionId: "fixture", credential: { kind: "legacy-plaintext" as const, secret }, target: "https://home.test/api/webhooks/cdp",
        eventType: "wallet_activity", createdAt: new Date().toISOString() }] },
      schedule: (task) => { tasks.push(task); },
      settleActions: (addresses, signal) => settleOpenActionsForAccounts(addresses, {
        signal, route: "/api/webhooks/cdp", deps: { store,
          resolveHandle: async () => ({ status: "complete", transactionHash: hash }),
          readReceipt: async () => receipt(true),
        },
      }),
    });
    expect((await webhook(raw, `t=${timestamp},v0=${signature}`)).status).toBe(200);
    expect((await store.get(owner(), id))?.outcome).toBeNull();
    expect(tasks).toHaveLength(1);
    await tasks[0]!();
    expect(await store.get(owner(), id)).toMatchObject({ transaction_hash: hash, outcome: "succeeded", outcome_source: "chain" });
    expect(logLines.map((line) => JSON.parse(line))).toContainEqual(expect.objectContaining({ kind: "action-reconcile",
      code: "WEBHOOK_ACTION_SETTLED", outcome: "ok" }));
    expect(logLines.join(" ")).not.toContain(address);
    expect(logLines.join(" ")).not.toContain(userOpHash);
  });

  test("a webhook delivery for one address never settles another account's open action", async () => {
    const otherAddress = "0x2222222222222222222222222222222222222222" as const;
    const otherOwner: MoneyActionOwner = { subject: "other-owner", address: otherAddress, chainId: 8453, accountProvider: "cdp-embedded" };
    const otherId = randomUUID();
    await store.insert({ id: otherId, owner: otherOwner, kind: "send",
      summary: { title: "Send", amounts: [], warnings: [], expiresAt: "2099-01-01T00:00:00.000Z" },
      pending: { calls: [{ to: otherAddress, data: "0x", value: "0" }] }, createdAt: new Date().toISOString() });
    await store.confirm(otherOwner, otherId);
    await store.recordHandle(otherOwner, otherId, { providerHandle: userOpHash });

    const tasks: Array<() => Promise<void>> = [];
    const secret = "fixture-webhook-secret";
    const timestamp = Math.floor(Date.now() / 1000);
    const raw = new TextEncoder().encode(JSON.stringify({ eventType: "wallet.activity.detected", data: { matchedAddress: address, from: otherAddress } }));
    const signature = createHmac("sha256", secret).update(Buffer.concat([Buffer.from(`${timestamp}.`), Buffer.from(raw)])).digest("hex");
    const webhook = createCdpWebhookHandler({ store: { markStaleMany: async () => {} }, keyring: null,
      subscriptions: { list: async () => [{ subscriptionId: "fixture", credential: { kind: "legacy-plaintext" as const, secret }, target: "https://home.test/api/webhooks/cdp",
        eventType: "wallet_activity", createdAt: new Date().toISOString() }] },
      schedule: (task) => { tasks.push(task); },
      settleActions: (addresses, signal) => settleOpenActionsForAccounts(addresses, {
        signal, route: "/api/webhooks/cdp", deps: { store,
          resolveHandle: async () => ({ status: "complete", transactionHash: hash }),
          readReceipt: async () => receipt(true),
        },
      }),
    });

    expect((await webhook(raw, `t=${timestamp},v0=${signature}`)).status).toBe(200);
    await tasks[0]!();
    expect(await store.get(otherOwner, otherId)).toMatchObject({ transaction_hash: null, outcome: null });
  });

  test("a multi-wallet delivery checks each matched wallet past its own open-action limit", async () => {
    const secondAddress = "0x2222222222222222222222222222222222222222" as const;
    const secondOwner: MoneyActionOwner = { subject: "second-owner", address: secondAddress, chainId: 8453, accountProvider: "cdp-embedded" };
    const triggered = randomUUID();
    await store.insert({ id: triggered, owner: secondOwner, kind: "send",
      summary: { title: "Send", amounts: [], warnings: [], expiresAt: "2099-01-01T00:00:00.000Z" },
      pending: { calls: [{ to: secondAddress, data: "0x", value: "0" }] }, createdAt: new Date().toISOString() });
    await store.confirm(secondOwner, triggered);
    await store.recordHandle(secondOwner, triggered, { providerHandle: userOpHash });
    await sql.query("UPDATE actions SET confirmed_at = now() - interval '5 minutes' WHERE id = $1", [triggered]);
    for (let index = 0; index < 24; index += 1) {
      const id = await prepared();
      await store.recordHandle(owner(), id, { providerHandle: userOpHash });
    }

    const tasks: Array<() => Promise<void>> = [];
    const secret = "fixture-webhook-secret";
    const timestamp = Math.floor(Date.now() / 1000);
    const raw = new TextEncoder().encode(JSON.stringify({ eventType: "wallet.activity.multi",
      data: { matchedAddress: address, address: secondAddress } }));
    const signature = createHmac("sha256", secret).update(Buffer.concat([Buffer.from(`${timestamp}.`), Buffer.from(raw)])).digest("hex");
    const multiReceipt: TransferReceiptStatus = { status: "confirmed", transactionHash: hash, blockNumber: "1",
      blockHash: `0x${"ef".repeat(32)}`, blockTimestamp, finalized: true,
      userOperations: [{ userOpHash, sender: address, success: true }, { userOpHash, sender: secondAddress, success: true }] };
    const followed: string[] = [];
    const webhook = createCdpWebhookHandler({ store: { markStaleMany: async () => {} }, keyring: null,
      subscriptions: { list: async () => [{ subscriptionId: "fixture", credential: { kind: "legacy-plaintext" as const, secret }, target: "https://home.test/api/webhooks/cdp",
        eventType: "wallet_activity", createdAt: new Date().toISOString() }] },
      schedule: (task) => { tasks.push(task); },
      settleActions: (addresses, signal) => settleOpenActionsForAccounts(addresses, {
        signal, route: "/api/webhooks/cdp", deps: { store,
          resolveHandle: async (row) => { followed.push(row.id); return { status: "complete", transactionHash: hash }; },
          readReceipt: async () => multiReceipt,
        },
      }),
    });

    expect((await webhook(raw, `t=${timestamp},v0=${signature}`)).status).toBe(200);
    await tasks[0]!();

    expect(followed).toContain(triggered);
    expect(await store.get(secondOwner, triggered)).toMatchObject({ transaction_hash: hash, outcome: "succeeded" });
  });

  test("system follow-up queries select only recent identifiable open rows", async () => {
    const recent = await prepared();
    const settled = await prepared();
    const old = await prepared();
    const unidentified = await prepared();
    const unconfirmed = randomUUID();
    await store.insert({ id: unconfirmed, owner: owner(), kind: "send",
      summary: { title: "Send", amounts: [], warnings: [], expiresAt: "2099-01-01T00:00:00.000Z" },
      pending: { calls: [{ to: address, data: "0x", value: "0" }] }, createdAt: new Date().toISOString() });
    await sql.query("UPDATE actions SET provider_handle = $2 WHERE id = $1", [unconfirmed, userOpHash]);
    await store.recordHandle(owner(), recent, { providerHandle: userOpHash });
    await store.recordHandle(owner(), settled, { providerHandle: userOpHash });
    await store.recordOutcome(owner(), settled, { outcome: "not_submitted", source: "wallet", settledAt: null });
    await store.recordHandle(owner(), old, { providerHandle: userOpHash });
    await sql.query("UPDATE actions SET confirmed_at = now() - interval '40 days' WHERE id = $1", [old]);
    const since = new Date(Date.now() - 7 * 86_400_000);
    expect((await store.listOpenByAccounts([address.toUpperCase()], since, 1)).map((row) => row.id)).toEqual([recent]);
    expect((await store.listOpenForFollowUp(since, 10)).map((row) => row.id)).toEqual([recent]);
    expect((await store.listOpenForFollowUp(since, 1)).map((row) => row.id)).toEqual([recent]);
    expect(unidentified).toBeDefined();
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
    expect((await store.get(owner(), id))?.observed_receipt_outcome).toBe("succeeded");
    const unavailable = handlers("cdp-embedded", { readReceipt: async () => { throw new Error("RPC unavailable"); } });
    expect((await (await unavailable.get(request(id, ""), context(id))).json()).status).toBe("confirmed");
    const lagging = handlers("cdp-embedded", { readReceipt: async () => ({ status: "pending", transactionHash: hash, finalizedBlockNumber: "0" }) });
    expect((await (await lagging.get(request(id, ""), context(id))).json()).status).toBe("confirmed");
    const final = handlers("cdp-embedded", { readReceipt: async () => receipt(true) });
    expect((await (await final.get(request(id, ""), context(id))).json()).status).toBe("confirmed");
    expect((await store.get(owner(), id))?.outcome).toBe("succeeded");
  });

  test("a finalized null receipt clears a persisted observation before deriving status", async () => {
    const id = await prepared();
    await store.recordHandle(owner(), id, { providerHandle: userOpHash, transactionHash: hash });
    const included = handlers("cdp-embedded", { readReceipt: async () => ({ ...receipt(false), finalized: false }) });
    expect((await (await included.get(request(id, ""), context(id))).json()).status).toBe("failed");
    const dropped = handlers("cdp-embedded", { readReceipt: async () => ({ status: "pending", transactionHash: hash, finalizedBlockNumber: "1" }) });
    expect((await (await dropped.get(request(id, ""), context(id))).json()).status).toBe("pending");
    expect(await store.get(owner(), id)).toMatchObject({ observed_receipt_outcome: null, observed_receipt_block_hash: null });
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
