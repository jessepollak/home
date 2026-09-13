import { afterEach, describe, expect, test } from "bun:test";
import type { ActionRow } from "./store";
import { createConfirmActionHandler, createGetActionHandler, createListActionsHandler } from "./handler";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";

const ID = "11111111-1111-4111-8111-111111111111";
const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const CALL = { to: ADDRESS, data: "0x1234" as const, value: "0" };
const HANDLE = "bundle:base-account:fixture";
const HASH = `0x${"ab".repeat(32)}` as const;
const row: ActionRow = {
  id: ID,
  owner_key: "fixture",
  provider: "cdp-embedded",
  kind: "send",
  summary: { title: "Send USDC", amounts: [], warnings: [], expiresAt: "2026-09-12T12:30:00.000Z" },
  pending: { calls: [CALL] },
  created_at: "2026-09-12T12:00:00.000Z",
  confirmed_at: null,
  provider_handle: null,
  transaction_hash: null,
  handle_recorded_at: null,
};

function authorize(subject = "owner-a", accountProvider: "cdp-embedded" | "base-account" = "cdp-embedded") {
  return async () => Response.json({
    user: { subject },
    smartAccount: { address: ADDRESS, chainId: 8453 },
    accountProvider,
  });
}

function confirmedBaseRow(overrides: Partial<ActionRow> = {}): ActionRow {
  return {
    ...row,
    provider: "base-account",
    pending: null,
    confirmed_at: "2026-09-12T12:05:00.000Z",
    provider_handle: HANDLE,
    ...overrides,
  };
}

function context() {
  return { params: Promise.resolve({ id: ID }) };
}

afterEach(() => setObservabilityLogWriterForTests());

function request(path: string, init?: RequestInit) {
  return new Request(`https://home.test${path}`, {
    ...init,
    headers: { "X-Home-Account-Provider": "cdp-embedded", ...init?.headers },
  });
}

function baseRequest(path: string, init?: RequestInit) {
  return request(path, {
    ...init,
    headers: { "X-Home-Account-Provider": "base-account", ...init?.headers },
  });
}

describe("actions HTTP handlers", () => {
  test("GET resumes an owner-scoped unconfirmed review without exposing pending metadata", async () => {
    const handler = createGetActionHandler({
      authorize: authorize(),
      store: { get: async () => row, recordHandle: async () => null },
    });
    const response = await handler(request(`/api/actions/${ID}`), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: ID,
      kind: "send",
      summary: row.summary,
      calls: [CALL],
      expiresAt: row.summary.expiresAt,
    });
  });

  test("GET returns a confirmed row with derived status", async () => {
    const confirmed = { ...row, pending: null, confirmed_at: "2026-09-12T12:05:00.000Z" };
    const handler = createGetActionHandler({
      authorize: authorize(),
      store: { get: async () => confirmed, recordHandle: async () => null },
      now: () => new Date("2026-09-12T12:10:00.000Z"),
    });
    const response = await handler(request(`/api/actions/${ID}`), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: ID, kind: "send", status: "pending", summary: row.summary });
  });

  test("GET returns the same 404 for another owner", async () => {
    const handler = createGetActionHandler({
      authorize: authorize("owner-b"),
      store: { get: async () => null, recordHandle: async () => null },
    });
    const response = await handler(request(`/api/actions/${ID}`), context());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "ACTION_NOT_FOUND", message: "The action was not found." } });
  });

  test("confirm returns only the reviewed calls after the store clears pending", async () => {
    let confirmedCalls: unknown;
    const handler = createConfirmActionHandler({
      authorize: authorize(),
      now: () => new Date("2026-09-12T12:05:00.000Z"),
      store: {
        get: async () => row,
        confirm: async (_owner, _id, calls) => {
          confirmedCalls = calls;
          return { ...row, confirmed_at: "2026-09-12T12:05:00.000Z", pending: { calls: calls ?? [] } };
        },
      },
    });
    const response = await handler(request(`/api/actions/${ID}/confirm`, { method: "POST", body: "{}" }), context());
    expect(response.status).toBe(200);
    expect(confirmedCalls).toEqual([CALL]);
    expect((await response.json()).calls).toEqual([CALL]);
  });

  test("a failed confirm emits exactly one bounded event without money or call fields", async () => {
    const writes: string[] = [];
    setObservabilityLogWriterForTests((line) => writes.push(line));
    const trade = { ...row, kind: "trade" } satisfies ActionRow;
    const handler = createConfirmActionHandler({
      authorize: authorize(),
      now: () => new Date("2026-09-12T12:05:00.000Z"),
      store: {
        get: async () => trade,
        confirm: async () => null,
      },
    });

    const response = await handler(
      request(`/api/actions/${ID}/confirm`, { method: "POST", body: "{}" }),
      context(),
    );

    expect(response.status).toBe(400);
    expect(writes).toHaveLength(1);
    const event = JSON.parse(writes[0] ?? "{}") as Record<string, unknown>;
    expect(event).toMatchObject({
      kind: "action-confirm",
      code: "INVALID_TRADE_SIGNATURE",
      outcome: "failed",
      provider: "cdp-embedded",
      route: "/api/actions/:redacted/confirm",
    });
    expect(Object.keys(event).sort()).toEqual([
      "code",
      "durationMs",
      "kind",
      "level",
      "outcome",
      "ownerHash",
      "provider",
      "route",
      "schema",
    ]);
  });

  test("confirms a trade using the moved Permit2 finalizer", async () => {
    const signature = `0x${"ab".repeat(65)}` as const;
    const permitHash = `0x${"cd".repeat(32)}` as const;
    const trade = {
      ...row,
      provider: "base-account" as const,
      kind: "trade",
      pending: {
        calls: [CALL], permitHash,
        signingTypedData: {
          domain: { name: "Coinbase Smart Wallet", version: "1", chainId: 8453, verifyingContract: ADDRESS },
          types: {
            EIP712Domain: [
              { name: "name", type: "string" },
              { name: "version", type: "string" },
              { name: "chainId", type: "uint256" },
              { name: "verifyingContract", type: "address" },
            ],
            CoinbaseSmartWalletMessage: [{ name: "hash", type: "bytes32" }],
          },
          primaryType: "CoinbaseSmartWalletMessage" as const,
          message: { hash: permitHash },
        },
        signerAddress: ADDRESS, signerOwnerIndex: 0 as const, signerDeployed: false, swapCallIndex: 0,
      },
    } satisfies ActionRow;
    let confirmedCalls: unknown;
    const handler = createConfirmActionHandler({
      authorize: authorize("owner-a", "base-account"), now: () => new Date("2026-09-12T12:05:00.000Z"),
      store: { get: async () => trade, confirm: async (_owner, _id, calls) => {
        confirmedCalls = calls;
        return { ...trade, confirmed_at: "2026-09-12T12:05:00.000Z", pending: { calls: calls ?? [] } };
      } },
    });
    const response = await handler(request(`/api/actions/${ID}/confirm`, { method: "POST", headers: { "X-Home-Account-Provider": "base-account" }, body: JSON.stringify({ signature }) }), context());
    expect(response.status).toBe(200);
    expect(confirmedCalls).toEqual([{ ...CALL, data: `0x1234${"41".padStart(64, "0")}${signature.slice(2)}` }]);
  });

  test("list does not reconcile a candidate inside the client grace period", async () => {
    let resolverCalls = 0;
    const candidate = confirmedBaseRow({ confirmed_at: "2026-09-12T12:09:50.000Z" });
    const handler = createListActionsHandler({
      authorize: authorize("owner-a", "base-account"),
      now: () => new Date("2026-09-12T12:10:00.000Z"),
      store: { list: async () => [candidate], recordHandle: async () => null },
      resolveHandle: async () => { resolverCalls += 1; return { status: "pending" }; },
    });

    const response = await handler(baseRequest("/api/actions"));

    expect(response.status).toBe(200);
    expect(resolverCalls).toBe(0);
  });

  test("list records a completed handle and derives status from its receipt", async () => {
    const writes: string[] = [];
    setObservabilityLogWriterForTests((line) => writes.push(line));
    const candidate = confirmedBaseRow();
    const recordedInputs: unknown[] = [];
    let receiptHash: string | undefined;
    const handler = createListActionsHandler({
      authorize: authorize("owner-a", "base-account"),
      now: () => new Date("2026-09-12T12:10:00.000Z"),
      store: {
        list: async () => [candidate],
        recordHandle: async (_owner, _id, input) => {
          recordedInputs.push(input);
          return { ...candidate, transaction_hash: input.transactionHash ?? null };
        },
      },
      resolveHandle: async () => ({ status: "complete", transactionHash: HASH }),
      readReceipt: async (hash) => {
        receiptHash = hash;
        return { status: "confirmed", transactionHash: hash, blockNumber: "1", success: true };
      },
    });

    const response = await handler(baseRequest("/api/actions"));
    const body = await response.json() as { actions: Array<{ status: string }> };

    expect(response.status).toBe(200);
    expect(recordedInputs).toEqual([{ transactionHash: HASH }]);
    expect(receiptHash).toBe(HASH);
    expect(body.actions[0]?.status).toBe("confirmed");
    expect(JSON.parse(writes[0] ?? "{}")).toMatchObject({
      kind: "action-reconcile",
      route: "/api/actions",
      code: "COMPLETE",
      outcome: "ok",
      provider: "base-account",
      level: "info",
    });
  });

  test("list leaves pending handle resolutions unrecorded", async () => {
    const candidate = confirmedBaseRow();
    let recordCalls = 0;
    const handler = createListActionsHandler({
      authorize: authorize("owner-a", "base-account"),
      now: () => new Date("2026-09-12T12:10:00.000Z"),
      store: {
        list: async () => [candidate],
        recordHandle: async () => { recordCalls += 1; return null; },
      },
      resolveHandle: async () => ({ status: "pending" }),
    });

    expect((await handler(baseRequest("/api/actions"))).status).toBe(200);
    expect(recordCalls).toBe(0);
  });

  test("list leaves failed handle resolutions unrecorded and unchanged", async () => {
    setObservabilityLogWriterForTests(() => undefined);
    const candidate = confirmedBaseRow();
    let recordCalls = 0;
    const handler = createListActionsHandler({
      authorize: authorize("owner-a", "base-account"),
      now: () => new Date("2026-09-12T12:10:00.000Z"),
      store: {
        list: async () => [candidate],
        recordHandle: async () => { recordCalls += 1; return null; },
      },
      resolveHandle: async () => ({ status: "failed" }),
    });

    const response = await handler(baseRequest("/api/actions"));
    const body = await response.json() as { actions: Array<{ status: string; transactionHash?: string }> };

    expect(response.status).toBe(200);
    expect(recordCalls).toBe(0);
    expect(body.actions[0]).toMatchObject({ id: candidate.id, status: "pending" });
    expect(body.actions[0]?.transactionHash).toBeUndefined();
  });

  test("list tolerates a recordHandle conflict and presents the stored row", async () => {
    setObservabilityLogWriterForTests(() => undefined);
    const candidate = confirmedBaseRow();
    const handler = createListActionsHandler({
      authorize: authorize("owner-a", "base-account"),
      now: () => new Date("2026-09-12T12:10:00.000Z"),
      store: { list: async () => [candidate], recordHandle: async () => null },
      resolveHandle: async () => ({ status: "complete", transactionHash: HASH }),
    });

    const response = await handler(baseRequest("/api/actions"));
    const body = await response.json() as { actions: Array<{ status: string; transactionHash?: string }> };

    expect(response.status).toBe(200);
    expect(body.actions[0]).toMatchObject({ status: "pending" });
    expect(body.actions[0]?.transactionHash).toBeUndefined();
  });

  test("list tolerates a throwing recordHandle and presents the stored row", async () => {
    const writes: string[] = [];
    setObservabilityLogWriterForTests((line) => writes.push(line));
    const candidate = confirmedBaseRow();
    const handler = createListActionsHandler({
      authorize: authorize("owner-a", "base-account"),
      now: () => new Date("2026-09-12T12:10:00.000Z"),
      store: {
        list: async () => [candidate],
        recordHandle: async () => { throw new Error("database unavailable"); },
      },
      resolveHandle: async () => ({ status: "complete", transactionHash: HASH }),
    });

    const response = await handler(baseRequest("/api/actions"));
    const body = await response.json() as { actions: Array<{ status: string; transactionHash?: string }> };

    expect(response.status).toBe(200);
    expect(body.actions[0]).toMatchObject({ id: candidate.id, status: "pending" });
    expect(body.actions[0]?.transactionHash).toBeUndefined();
    expect(JSON.parse(writes[0] ?? "{}")).toMatchObject({
      kind: "action-reconcile",
      outcome: "unavailable",
      level: "info",
    });
  });

  test("list reconciles at most five candidates per request and rotates the window across polls", async () => {
    const candidates = Array.from({ length: 7 }, (_, index) => confirmedBaseRow({
      id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
      confirmed_at: new Date(Date.parse("2026-09-12T12:00:00.000Z") + index * 1_000).toISOString(),
      provider_handle: `${HANDLE}:${index}`,
    }));
    const legacy = confirmedBaseRow({
      id: "99999999-9999-4999-8999-999999999999",
      confirmed_at: "2026-09-12T12:09:00.000Z",
      provider_handle: "99999999-9999-4999-8999-999999999999",
    });
    let resolvedIds: string[] = [];
    let nowIso = "2026-09-12T12:10:00.000Z";
    const handler = createListActionsHandler({
      authorize: authorize("owner-a", "base-account"),
      now: () => new Date(nowIso),
      store: { list: async () => [legacy, ...candidates], recordHandle: async () => null },
      resolveHandle: async (candidate) => { resolvedIds.push(candidate.id); return { status: "pending" }; },
    });

    const covered = new Set<string>();
    for (const step of [0, 1, 2]) {
      nowIso = new Date(Date.parse("2026-09-12T12:10:00.000Z") + step * 10_000).toISOString();
      resolvedIds = [];
      expect((await handler(baseRequest("/api/actions"))).status).toBe(200);
      expect(resolvedIds).toHaveLength(5);
      expect(resolvedIds).not.toContain(legacy.id);
      for (const id of resolvedIds) covered.add(id);
    }
    expect([...covered].sort()).toEqual(candidates.map(({ id }) => id).sort());
  });

  test("list reconciles only eligible Base rows while reading existing receipts", async () => {
    const cdpRow = confirmedBaseRow({
      id: "22222222-2222-4222-8222-222222222222",
      provider: "cdp-embedded",
    });
    const hashedRow = confirmedBaseRow({
      id: "33333333-3333-4333-8333-333333333333",
      provider_handle: "hashed-handle",
      transaction_hash: HASH,
    });
    const candidate = confirmedBaseRow({
      id: "44444444-4444-4444-8444-444444444444",
      provider_handle: "candidate-handle",
    });
    const resolvedIds: string[] = [];
    const receiptHashes: string[] = [];
    const handler = createListActionsHandler({
      authorize: authorize("owner-a", "base-account"),
      now: () => new Date("2026-09-12T12:10:00.000Z"),
      store: {
        list: async () => [cdpRow, hashedRow, candidate],
        recordHandle: async () => null,
      },
      resolveHandle: async (resolved) => {
        resolvedIds.push(resolved.id);
        return { status: "pending" };
      },
      readReceipt: async (hash) => {
        receiptHashes.push(hash);
        return { status: "pending", transactionHash: hash };
      },
    });

    const response = await handler(baseRequest("/api/actions"));

    expect(response.status).toBe(200);
    expect(resolvedIds).toEqual([candidate.id]);
    expect(receiptHashes).toEqual([HASH]);
  });

  test("list survives a throwing resolver", async () => {
    const writes: string[] = [];
    setObservabilityLogWriterForTests((line) => writes.push(line));
    const candidate = confirmedBaseRow();
    const handler = createListActionsHandler({
      authorize: authorize("owner-a", "base-account"),
      now: () => new Date("2026-09-12T12:10:00.000Z"),
      store: { list: async () => [candidate], recordHandle: async () => null },
      resolveHandle: async () => { throw new Error("provider failed"); },
    });

    const response = await handler(baseRequest("/api/actions"));

    expect(response.status).toBe(200);
    expect((await response.json()).actions[0]).toMatchObject({ id: candidate.id, status: "pending" });
    expect(JSON.parse(writes[0] ?? "{}")).toMatchObject({
      kind: "action-reconcile",
      outcome: "unavailable",
      level: "info",
    });
  });

  test("GET reconciles one eligible candidate", async () => {
    setObservabilityLogWriterForTests(() => undefined);
    const candidate = confirmedBaseRow();
    let resolverCalls = 0;
    const handler = createGetActionHandler({
      authorize: authorize("owner-a", "base-account"),
      now: () => new Date("2026-09-12T12:10:00.000Z"),
      store: {
        get: async () => candidate,
        recordHandle: async (_owner, _id, input) => ({
          ...candidate,
          transaction_hash: input.transactionHash ?? null,
        }),
      },
      resolveHandle: async () => {
        resolverCalls += 1;
        return { status: "complete", transactionHash: HASH };
      },
      readReceipt: async (hash) => ({
        status: "confirmed",
        transactionHash: hash,
        blockNumber: "1",
        success: false,
      }),
    });

    const response = await handler(baseRequest(`/api/actions/${ID}`), context());

    expect(response.status).toBe(200);
    expect(resolverCalls).toBe(1);
    expect(await response.json()).toMatchObject({ id: ID, transactionHash: HASH, status: "failed" });
  });
});
