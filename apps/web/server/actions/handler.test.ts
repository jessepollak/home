import { afterEach, describe, expect, test } from "bun:test";
import type { ActionRow } from "./store";
import { createConfirmActionHandler, createGetActionHandler } from "./handler";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";

const ID = "11111111-1111-4111-8111-111111111111";
const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const CALL = { to: ADDRESS, data: "0x1234" as const, value: "0" };
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

describe("actions HTTP handlers", () => {
  test("GET resumes an owner-scoped unconfirmed review without exposing pending metadata", async () => {
    const handler = createGetActionHandler({ authorize: authorize(), store: { get: async () => row } });
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
      store: { get: async () => confirmed },
      now: () => new Date("2026-09-12T12:10:00.000Z"),
    });
    const response = await handler(request(`/api/actions/${ID}`), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: ID, kind: "send", status: "pending", summary: row.summary });
  });

  test("GET returns the same 404 for another owner", async () => {
    const handler = createGetActionHandler({ authorize: authorize("owner-b"), store: { get: async () => null } });
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
});
