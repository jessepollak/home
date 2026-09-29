import { readJson } from "@/tests/helpers/read-json";
import { isRecord } from "@/shared/guards";
import { afterEach, describe, expect, test } from "bun:test";
import type { ActionRow } from "./store";
import { createConfirmActionHandler, createDeclineActionHandler, createGetActionHandler, createHandleActionHandler, createListActionsHandler, createRetryActionHandler } from "./handler";
import { DECLINE_ACTION_CONTRACT_VERSION } from "@/shared/actions/contracts/decline";
import { parseConfirmActionErrorResponse, parseConfirmActionResponse } from "@/shared/actions/contracts/confirm";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { ACTION_KINDS, type MoneyActionCall, type MoneyActionOwner } from "@/shared/money-actions/types";
import { parseRecentMoneyActions } from "@/shared/actions/contracts/list";

function parseLog(line: string): unknown {
  const parsed: unknown = JSON.parse(line);
  return parsed;
}

async function readStatus(response: Response): Promise<unknown> {
  const body = await readJson(response);
  if (!isRecord(body)) throw new Error("Invalid action response");
  return body.status;
}

async function readActions(response: Response): Promise<Record<string, unknown>[]> {
  const body = await readJson(response);
  if (!isRecord(body) || !Array.isArray(body.actions) || !body.actions.every(isRecord)) throw new Error("Invalid action list");
  return body.actions;
}

const ID = "11111111-1111-4111-8111-111111111111";
const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const CALL = { to: ADDRESS, data: "0x1234" as const, value: "0" };
const HANDLE = "bundle:base-account:fixture";
const HASH = `0x${"ab".repeat(32)}` as const;
const recorded = async (_owner: MoneyActionOwner, _id: string, input: { outcome: "succeeded" | "reverted" | "not_submitted" }) => ({
  row: { ...row, outcome: input.outcome }, written: true, conflict: false,
});
const operation = (success: boolean) => ({ userOpHash: HASH, sender: ADDRESS, success });
const blockTimestamp = "2026-09-12T12:06:00.000Z";
const row: ActionRow = {
  id: ID,
  owner_key: JSON.stringify(["owner-a", ADDRESS, 8453, "cdp-embedded"]),
  account_address: ADDRESS,
  provider: "cdp-embedded",
  kind: "send",
  summary: { title: "Send USDC", amounts: [], warnings: [], expiresAt: "2026-09-12T12:30:00.000Z" },
  pending: { calls: [CALL] },
  created_at: "2026-09-12T12:00:00.000Z",
  confirmed_at: null,
  provider_handle: null,
  transaction_hash: null,
  handle_recorded_at: null,
  declined_reported_at: null,
  dispatch_attempt: 0,
  outcome: null,
  outcome_source: null,
  settled_at: null,
  outcome_recorded_at: null,
};

function authorize(subject = "owner-a", accountProvider: "cdp-embedded" | "base-account" = "cdp-embedded") {
  return async () => Response.json({
    user: { subject },
    smartAccount: { address: ADDRESS, chainId: 8453 },
    accountProvider,
  });
}

describe("action confirm operator capture", () => {
  const confirmed = { ...row, owner_key: JSON.stringify(["owner-a", ADDRESS, 8453, "cdp-embedded"]),
    confirmed_at: "2026-09-12T12:05:00.000Z" };
  for (const reject of [false, true]) {
    test(reject ? "a rejecting recorder preserves the confirm response" : "records the confirmed row once", async () => {
      const captured: ActionRow[] = [];
      const handler = createConfirmActionHandler({
        authorize: authorize(), now: () => new Date("2026-09-12T12:05:00.000Z"),
        store: { get: async () => row, confirm: async () => confirmed },
        markHot: async () => {},
        recordConfirmed: async (value) => {
          captured.push(value);
          if (reject) throw new Error("operator capture failed");
        },
      });
      const response = await handler(request(`/api/actions/${ID}/confirm`, { method: "POST", body: "{}" }), context());
      expect(response.status).toBe(200);
      expect(parseConfirmActionResponse(await readJson(response))?.calls).toEqual([CALL]);
      expect(captured).toEqual([confirmed]);
    });
  }
});

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
  test("list returns a typed unavailable error and records a store-read event", async () => {
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => lines.push(line));
    const handler = createListActionsHandler({
      authorize: authorize(),
      store: { list: async () => { throw new Error("store offline"); }, recordHandle: async () => null, recordOutcome: recorded },
    });
    const response = await handler(request("/api/actions"));
    expect(response.status).toBe(503);
    expect(await readJson(response)).toEqual({ error: { code: "ACTIONS_UNAVAILABLE", message: "Recorded actions are temporarily unavailable." } });
    expect(lines.map(parseLog)).toMatchObject([{
      kind: "action-read", route: "/api/actions", code: "ACTIONS_STORE_UNAVAILABLE", outcome: "unavailable", provider: "cdp-embedded",
    }]);
  });

  test("get returns a typed unavailable error and records a store-read event", async () => {
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => lines.push(line));
    const handler = createGetActionHandler({
      authorize: authorize(),
      store: { get: async () => { throw new Error("store offline"); }, recordHandle: async () => null, recordOutcome: recorded },
    });
    const response = await handler(request(`/api/actions/${ID}`), context());
    expect(response.status).toBe(503);
    expect(await readJson(response)).toEqual({ error: { code: "ACTIONS_UNAVAILABLE", message: "Recorded actions are temporarily unavailable." } });
    expect(lines.map(parseLog)).toMatchObject([{
      kind: "action-read", route: "/api/actions/:redacted", code: "ACTIONS_STORE_UNAVAILABLE", outcome: "unavailable", provider: "cdp-embedded",
    }]);
  });

  test("GET resumes an owner-scoped unconfirmed review without exposing pending metadata", async () => {
    const handler = createGetActionHandler({
      authorize: authorize(),
      store: { get: async () => row, recordHandle: async () => null, recordOutcome: recorded },
    });
    const response = await handler(request(`/api/actions/${ID}`), context());
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({
      id: ID,
      kind: "send",
      summary: row.summary,
      calls: [CALL],
      expiresAt: row.summary.expiresAt,
    });
  });

  test("a savings confirmation remains owner-scoped and derives confirmed action status", async () => {
    const savingsRow: ActionRow = {
      ...row,
      kind: "savings-withdraw",
      summary: {
        ...row.summary,
        title: "Withdraw USDC",
        metadata: {
          product: "savings",
          operation: "withdraw",
          vaultAddress: ADDRESS,
          vaultName: "Configured USDC vault",
          network: { name: "Base", chainId: 8453 },
          feeWad: "0",
          limitBaseUnits: "1000000",
          previewSharesBaseUnits: "1000000000000000000",
          shareDecimals: 18,
          exchangeConstraint: "withdraw-exact-assets-or-revert",
          discoveryRate: { status: "unavailable", netApy: null, fetchedAt: null, stateAsOf: null },
          source: { blockNumber: "51026404", blockHash: HASH, blockTimestamp: "1789214400" },
        },
      },
    };
    let stored = savingsRow;
    const store = {
      get: async () => stored,
      confirm: async () => {
        stored = {
          ...stored,
          pending: null,
          confirmed_at: "2026-09-12T12:05:00.000Z",
          transaction_hash: HASH,
          provider_handle: HASH,
        };
        return { ...stored, pending: savingsRow.pending };
      },
      recordHandle: async () => null,
      recordOutcome: async (_owner: MoneyActionOwner, _id: string, input: { outcome: "succeeded" | "reverted" | "not_submitted" }) => ({
        row: { ...stored, outcome: input.outcome }, written: true, conflict: false,
      }),
    };
    const confirm = createConfirmActionHandler({
      authorize: authorize(),
      now: () => new Date("2026-09-12T12:05:00.000Z"),
      store,
    });
    const confirmed = await confirm(
      request(`/api/actions/${ID}/confirm`, { method: "POST", body: "{}" }),
      context(),
    );
    expect(confirmed.status).toBe(200);
    expect(await readJson(confirmed)).toMatchObject({
      summary: { metadata: { product: "savings", operation: "withdraw" } },
    });

    const get = createGetActionHandler({
      authorize: authorize(),
      store,
      now: () => new Date("2026-09-12T12:10:00.000Z"),
      readReceipt: async () => ({
        status: "confirmed",
        transactionHash: HASH,
        blockNumber: "51026405", blockHash: HASH,
        blockTimestamp, finalized: true, userOperations: [operation(true)],
      }),
    });
    const response = await get(request(`/api/actions/${ID}`), context());
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({
      kind: "savings-withdraw",
      status: "confirmed",
      summary: { metadata: { product: "savings", operation: "withdraw" } },
    });
  });

  test("a fresh attributable receipt stays confirmed when its outcome write fails or returns no row", async () => {
    const confirmed = { ...row, pending: null, confirmed_at: "2026-09-12T12:05:00.000Z", provider_handle: HASH, transaction_hash: HASH };
    for (const recordOutcome of [
      async () => { throw new Error("database unavailable"); },
      async () => ({ row: null, written: false, conflict: false }),
    ]) {
      const handler = createGetActionHandler({
        authorize: authorize(),
        store: { get: async () => confirmed, recordHandle: async () => null, recordOutcome },
        now: () => new Date("2026-09-12T12:10:00.000Z"),
        readReceipt: async () => ({ status: "confirmed", transactionHash: HASH, blockNumber: "1", blockHash: HASH, blockTimestamp, finalized: true, userOperations: [operation(true)] }),
      });
      expect(await readStatus(await handler(request(`/api/actions/${ID}`), context()))).toBe("confirmed");
    }
  });

  test("CDP receipts require a matching hash handle before recording an outcome", async () => {
    for (const [providerHandle, expectedStatus, expectedOutcome] of [
      [null, "unknown", null],
      ["not-a-hash", "unknown", null],
      [`0x${"AB".repeat(32)}`, "confirmed", "succeeded"],
    ] as const) {
      let stored: ActionRow = {
        ...row, pending: null, confirmed_at: "2026-09-12T12:05:00.000Z",
        provider_handle: providerHandle, transaction_hash: HASH,
      };
      let writes = 0;
      const handler = createGetActionHandler({
        authorize: authorize(),
        store: {
          get: async () => stored,
          recordHandle: async () => null,
          recordOutcome: async (_owner, _id, input) => {
            writes += 1;
            stored = { ...stored, outcome: input.outcome };
            return { row: stored, written: true, conflict: false };
          },
        },
        readReceipt: async () => ({ status: "confirmed", transactionHash: HASH, blockNumber: "1", blockHash: HASH, blockTimestamp, finalized: true, userOperations: [operation(true)] }),
      });
      const response = await handler(request(`/api/actions/${ID}`), context());
      expect(response.status).toBe(200);
      expect(await readStatus(response)).toBe(expectedStatus);
      expect(stored.outcome).toBe(expectedOutcome);
      expect(writes).toBe(expectedOutcome ? 1 : 0);
    }
  });

  test("decline rejects an unversioned body before writing and returns a versioned response", async () => {
    let writes = 0;
    const handler = createDeclineActionHandler({
      authorize: authorize(),
      store: { recordDecline: async () => { writes += 1; return { row, changed: true }; } },
    });
    for (const body of ["{}", "not json"]) {
      const response = await handler(request(`/api/actions/${ID}/decline`, { method: "POST", body }), context());
      expect(response.status).toBe(400);
      expect(await readJson(response)).toMatchObject({ error: { code: "INVALID_ACTION_DECLINE" } });
    }
    expect(writes).toBe(0);
    const response = await handler(request(`/api/actions/${ID}/decline`, {
      method: "POST", body: JSON.stringify({ version: DECLINE_ACTION_CONTRACT_VERSION, attempt: 0 }),
    }), context());
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({ version: DECLINE_ACTION_CONTRACT_VERSION, action: { id: ID } });
    expect(writes).toBe(1);
  });

  test("retry validates an exact request and maps missing or dispatched rows to errors", async () => {
    const attempts: number[] = [];
    const retry = createRetryActionHandler({ authorize: authorize(), store: {
      get: async () => row,
      beginRetry: async (_owner, _id, attempt) => {
        attempts.push(attempt);
        return { row: { ...row, confirmed_at: "2026-09-12T12:05:00.000Z" }, conflict: false, dispatched: false };
      },
    } });
    for (const body of ["{}", '{"version":1,"attempt":0}', '{"version":1,"attempt":1,"extra":true}']) {
      expect((await retry(request(`/api/actions/${ID}/retry`, { method: "POST", body }), context())).status).toBe(400);
    }
    expect(attempts).toEqual([]);
    const response = await retry(request(`/api/actions/${ID}/retry`, { method: "POST", body: '{"version":1,"attempt":1}' }), context());
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({ version: 1, action: { id: ID } });
    expect(attempts).toEqual([1]);
    const conflict = createRetryActionHandler({ authorize: authorize(), store: {
      get: async () => row,
      beginRetry: async () => ({ row, conflict: true, dispatched: true }),
    } });
    const blocked = await conflict(request(`/api/actions/${ID}/retry`, { method: "POST", body: '{"version":1,"attempt":1}' }), context());
    expect(blocked.status).toBe(409);
    expect(await readJson(blocked)).toMatchObject({ error: { code: "ACTION_ALREADY_DISPATCHED" } });
  });

  test("a non-finalized attributable receipt reports its state without recording a final outcome", async () => {
    const confirmed = { ...row, pending: null, confirmed_at: "2026-09-12T12:05:00.000Z", provider_handle: HASH, transaction_hash: HASH };
    let writes = 0;
    const handler = createGetActionHandler({ authorize: authorize(), store: {
      get: async () => confirmed, recordHandle: async () => null,
      recordOutcome: async () => { writes += 1; throw new Error("unexpected write"); },
    }, readReceipt: async () => ({ status: "confirmed", transactionHash: HASH, blockNumber: "1", blockHash: HASH, blockTimestamp, finalized: false, userOperations: [operation(false)] }) });
    expect(await readStatus(await handler(request(`/api/actions/${ID}`), context()))).toBe("failed");
    expect(writes).toBe(0);
  });

  test("GET and list retain included receipt observations until a finalized null receipt proves a drop", async () => {
    for (const route of ["get", "list"] as const) {
      let stored: ActionRow = { ...row, pending: null, confirmed_at: "2026-09-12T12:05:00.000Z", provider_handle: HASH, transaction_hash: HASH };
      let reads = 0;
      let clears = 0;
      let current: "included" | "error" | "lagging" | "dropped" = "included";
      const store = {
        get: async (owner: MoneyActionOwner) => owner.subject === "owner-a" ? stored : null,
        list: async (owner: MoneyActionOwner) => owner.subject === "owner-a" ? [stored] : [],
        recordHandle: async () => null,
        recordOutcome: recorded,
        recordReceiptObservation: async (owner: MoneyActionOwner, _id: string, input: { transactionHash: string; blockNumber: string; blockHash: string; outcome: "succeeded" | "reverted" }) => {
          if (owner.subject !== "owner-a" || stored.outcome || input.transactionHash.toLowerCase() !== stored.transaction_hash?.toLowerCase()) return null;
          stored = { ...stored, observed_receipt_transaction_hash: input.transactionHash, observed_receipt_block_number: input.blockNumber,
            observed_receipt_block_hash: input.blockHash, observed_receipt_outcome: input.outcome, observed_at: blockTimestamp };
          return stored;
        },
        clearReceiptObservation: async (owner: MoneyActionOwner, _id: string, blockHash: string) => {
          if (owner.subject !== "owner-a" || stored.observed_receipt_block_hash !== blockHash) return null;
          clears++;
          stored = { ...stored, observed_receipt_transaction_hash: null, observed_receipt_block_number: null,
            observed_receipt_block_hash: null, observed_receipt_outcome: null, observed_at: null };
          return stored;
        },
      };
      const dependencies = {
        authorize: authorize(), store, now: () => new Date("2026-09-12T12:10:00.000Z"),
        readReceipt: async (): Promise<import("./receipt").TransferReceiptStatus> => {
          reads++;
          if (current === "error") throw new Error("RPC unavailable");
          if (current === "lagging" || current === "dropped") return { status: "pending", transactionHash: HASH, finalizedBlockNumber: current === "lagging" ? "9" : "10" };
          return { status: "confirmed", transactionHash: HASH, blockNumber: "10", blockHash: HASH,
            blockTimestamp, finalized: false, userOperations: [operation(true)] };
        },
      };
      const handler = route === "get" ? createGetActionHandler(dependencies) : createListActionsHandler({ ...dependencies, refreshCashouts: async () => [] });
      const read = async () => {
        const response = route === "get"
          ? await (handler as ReturnType<typeof createGetActionHandler>)(request(`/api/actions/${ID}`), context())
          : await (handler as ReturnType<typeof createListActionsHandler>)(request("/api/actions"));
        expect(response.status).toBe(200);
        const body = await readJson(response);
        if (route === "get") return isRecord(body) ? body.status : undefined;
        return isRecord(body) && Array.isArray(body.actions) && isRecord(body.actions[0]) ? body.actions[0].status : undefined;
      };
      for (const [state, expected] of [["included", "confirmed"], ["error", "confirmed"],
        ["lagging", "confirmed"], ["dropped", "pending"], ["error", "pending"]] as const) {
        current = state;
        expect(await read(), `${route}: ${state}`).toBe(expected);
      }
      expect(reads).toBe(5);
      expect(clears).toBe(1);
      expect(stored.observed_receipt_outcome).toBeNull();
      const foreign = createGetActionHandler({ ...dependencies, authorize: authorize("owner-b") });
      expect((await foreign(request(`/api/actions/${ID}`), context())).status).toBe(404);
      expect(clears).toBe(1);
    }
  });

  for (const observedOutcome of ["succeeded", "reverted"] as const) {
    for (const clearResult of ["null", "throws", "absent"] as const) {
      test(`a finalized null receipt overrides a ${observedOutcome} observation when clearing ${clearResult}`, async () => {
        const observed: ActionRow = {
          ...row, pending: null, confirmed_at: "2026-09-12T12:05:00.000Z", provider_handle: HASH, transaction_hash: HASH,
          observed_receipt_transaction_hash: HASH, observed_receipt_block_number: "10",
          observed_receipt_block_hash: HASH, observed_receipt_outcome: observedOutcome, observed_at: blockTimestamp,
        };
        const lines: string[] = [];
        setObservabilityLogWriterForTests((line) => lines.push(line));
        const handler = createGetActionHandler({
          authorize: authorize(), now: () => new Date("2026-09-12T12:10:00.000Z"),
          store: {
            get: async () => observed, recordHandle: async () => null, recordOutcome: recorded,
            ...(clearResult === "absent" ? {} : {
              clearReceiptObservation: async () => {
                if (clearResult === "throws") throw new Error("store unavailable");
                return null;
              },
            }),
          },
          readReceipt: async () => ({ status: "pending", transactionHash: HASH, finalizedBlockNumber: "10" }),
        });
        const response = await handler(request(`/api/actions/${ID}`), context());
        expect(response.status).toBe(200);
        expect(await readJson(response)).toMatchObject({ id: ID, status: "pending" });
        expect(lines.map((line) => { const parsed = parseLog(line); return isRecord(parsed) ? parsed.code : undefined; })).toEqual(clearResult === "throws" ? ["OBSERVATION_UNAVAILABLE"] : []);
      });
    }
  }

  test("concurrent reads both report a verified drop when only the first clears the observation", async () => {
    let stored: ActionRow = {
      ...row, pending: null, confirmed_at: "2026-09-12T12:05:00.000Z", provider_handle: HASH, transaction_hash: HASH,
      observed_receipt_transaction_hash: HASH, observed_receipt_block_number: "10",
      observed_receipt_block_hash: HASH, observed_receipt_outcome: "succeeded", observed_at: blockTimestamp,
    };
    let loaded = 0;
    let clears = 0;
    let release!: () => void;
    const bothLoaded = new Promise<void>((resolve) => { release = resolve; });
    const handler = createGetActionHandler({
      authorize: authorize(), now: () => new Date("2026-09-12T12:10:00.000Z"),
      store: {
        get: async () => {
          const snapshot = stored;
          if (++loaded === 2) release();
          await bothLoaded;
          return snapshot;
        },
        recordHandle: async () => null, recordOutcome: recorded,
        clearReceiptObservation: async () => {
          if (++clears === 2) return null;
          stored = { ...stored, observed_receipt_transaction_hash: null, observed_receipt_block_number: null,
            observed_receipt_block_hash: null, observed_receipt_outcome: null, observed_at: null };
          return stored;
        },
      },
      readReceipt: async () => ({ status: "pending", transactionHash: HASH, finalizedBlockNumber: "10" }),
    });
    const responses = await Promise.all([
      handler(request(`/api/actions/${ID}`), context()), handler(request(`/api/actions/${ID}`), context()),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(await Promise.all(responses.map(readStatus))).toEqual(["pending", "pending"]);
    expect(loaded).toBe(2);
    expect(clears).toBe(2);
    expect(stored.observed_receipt_outcome).toBeNull();
  });

  test("an observation write failure does not fail a fresh receipt or manufacture future confirmation", async () => {
    const confirmed = { ...row, pending: null, confirmed_at: "2026-09-12T12:05:00.000Z", provider_handle: HASH, transaction_hash: HASH };
    let unavailable = false;
    const handler = createGetActionHandler({ authorize: authorize(), now: () => new Date("2026-09-12T12:10:00.000Z"), store: {
      get: async () => confirmed, recordHandle: async () => null, recordOutcome: recorded,
      recordReceiptObservation: async () => { throw new Error("write failed"); },
    }, readReceipt: async () => {
      if (unavailable) throw new Error("RPC unavailable");
      return { status: "confirmed", transactionHash: HASH, blockNumber: "10", blockHash: HASH,
        blockTimestamp, finalized: false, userOperations: [operation(true)] };
    } });
    const read = async () => readStatus(await handler(request(`/api/actions/${ID}`), context()));
    expect(await read()).toBe("confirmed");
    unavailable = true;
    expect(await read()).toBe("pending");
  });

  test("reverted observations survive failed reads, fresh receipts replace them, and persisted outcomes win", async () => {
    let stored: ActionRow = { ...row, pending: null, confirmed_at: "2026-09-12T12:05:00.000Z", provider_handle: HASH, transaction_hash: HASH };
    let mode: "reverted" | "succeeded" | "error" | "finalized" = "reverted";
    let writes = 0;
    const handler = createGetActionHandler({ authorize: authorize(), now: () => new Date("2026-09-12T12:10:00.000Z"), store: {
      get: async () => stored, recordHandle: async () => null,
      recordReceiptObservation: async (_owner, _id, input) => {
        stored = { ...stored, observed_receipt_transaction_hash: input.transactionHash, observed_receipt_block_number: input.blockNumber,
          observed_receipt_block_hash: input.blockHash, observed_receipt_outcome: input.outcome, observed_at: blockTimestamp };
        writes++;
        return stored;
      },
      clearReceiptObservation: async () => null,
      recordOutcome: async (_owner, _id, input) => {
        stored = { ...stored, outcome: input.outcome };
        return { row: stored, written: true, conflict: false };
      },
    }, readReceipt: async () => {
      if (mode === "error") throw new Error("RPC unavailable");
      return { status: "confirmed", transactionHash: HASH, blockNumber: "10", blockHash: mode === "reverted" ? HASH : `0x${"ef".repeat(32)}`,
        blockTimestamp, finalized: mode === "finalized", userOperations: [operation(mode !== "reverted")] };
    } });
    const read = async () => readStatus(await handler(request(`/api/actions/${ID}`), context()));
    for (const [state, expected] of [["reverted", "failed"], ["error", "failed"], ["succeeded", "confirmed"],
      ["error", "confirmed"], ["finalized", "confirmed"], ["error", "confirmed"]] as const) {
      mode = state;
      expect(await read(), state).toBe(expected);
    }
    expect(writes).toBe(2);
    expect(stored.outcome).toBe("succeeded");
  });

  test("GET distinguishes pending, unreadable, attributable, and unattributable repay receipts", async () => {
    const repay = confirmedBaseRow({
      kind: "repay",
      transaction_hash: HASH,
      summary: {
        ...row.summary,
        title: "Repay all",
        metadata: {
          product: "borrow", operation: "repay-all", marketId: HASH,
          loanAsset: { id: "usdc", symbol: "USDC" },
          collateralAsset: { id: "eth", symbol: "ETH" },
          projectedHealthFactorWad: null, projectedLiquidationPriceRaw: null,
          borrowAprWad: "0",
          source: { blockNumber: "1", blockHash: HASH, blockTimestamp: "1789214400" },
        },
      },
    });
    for (const [receiptState, expectedStatus, expectedCode] of [
      ["pending", "pending", null],
      ["throws", "pending", null],
      ["confirmed", "confirmed", null],
      ["unattributed", "unknown", "OUTCOME_UNATTRIBUTED"],
    ] as const) {
      const lines: string[] = [];
      setObservabilityLogWriterForTests((line) => lines.push(line));
      const handler = createGetActionHandler({
        authorize: authorize("owner-a", "base-account"),
        now: () => new Date("2026-09-12T12:10:00.000Z"),
        store: {
          get: async () => repay,
          recordHandle: async () => null,
          recordOutcome: async () => { throw new Error("unexpected outcome write"); },
        },
        readReceipt: async (hash) => {
          expect(hash).toBe(HASH);
          if (receiptState === "throws") throw new Error("Base receipt read failed");
          if (receiptState === "pending") return { status: "pending", transactionHash: hash, finalizedBlockNumber: "0" };
          return {
            status: "confirmed", transactionHash: hash, blockNumber: "1", blockHash: HASH, blockTimestamp,
            finalized: false, userOperations: receiptState === "confirmed" ? [operation(true)] : [],
          };
        },
      });
      const response = await handler(baseRequest(`/api/actions/${ID}`), context());
      expect(response.status).toBe(200);
      expect(await readJson(response)).toMatchObject({ id: ID, kind: "repay", transactionHash: HASH, status: expectedStatus });
      expect(lines).toHaveLength(expectedCode ? 1 : 0);
      expect(lines.map(parseLog)).toMatchObject(expectedCode ? [{
        kind: "action-outcome", route: "/api/actions/:redacted", code: expectedCode,
        outcome: "conflict", provider: "base-account",
      }] : []);
    }
  });

  test("GET returns a confirmed row with derived status", async () => {
    const confirmed = { ...row, pending: null, confirmed_at: "2026-09-12T12:05:00.000Z" };
    const handler = createGetActionHandler({
      authorize: authorize(),
      store: { get: async () => confirmed, recordHandle: async () => null, recordOutcome: recorded },
      now: () => new Date("2026-09-12T12:10:00.000Z"),
    });
    const response = await handler(request(`/api/actions/${ID}`), context());
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({ id: ID, kind: "send", status: "pending", summary: row.summary });
  });

  test("GET exposes the recorded handle time as submission time and omits it before a handle exists", async () => {
    const base = { ...row, pending: null, confirmed_at: "2026-09-12T12:05:00.000Z" };
    for (const [stored, expected] of [[{ ...base, provider_handle: HASH, handle_recorded_at: "2026-09-12T12:08:00.000Z" }, "2026-09-12T12:08:00.000Z"], [base, undefined]] as const) {
      const handler = createGetActionHandler({
        authorize: authorize(),
        store: { get: async () => stored, recordHandle: async () => null, recordOutcome: recorded },
        now: () => new Date("2026-09-12T12:10:00.000Z"),
      });
      const body = await readJson((await handler(request(`/api/actions/${ID}`), context())));
      expect(body).toMatchObject({ confirmedAt: "2026-09-12T12:05:00.000Z" });
      if (!isRecord(body)) throw new Error("Invalid action response");
      expect(body.submittedAt).toBe(expected);
    }
  });

  test("GET returns the same 404 for another owner", async () => {
    const handler = createGetActionHandler({
      authorize: authorize("owner-b"),
      store: { get: async () => null, recordHandle: async () => null, recordOutcome: recorded },
    });
    const response = await handler(request(`/api/actions/${ID}`), context());
    expect(response.status).toBe(404);
    expect(await readJson(response)).toEqual({ error: { code: "ACTION_NOT_FOUND", message: "The action was not found." } });
  });

  test("first confirmation subscribes its owner once without awaiting a rejected subscription", async () => {
    const subscribed: string[] = [];
    let draft: ActionRow = row;
    const handler = createConfirmActionHandler({ authorize: authorize(),
      now: () => new Date("2026-09-12T12:05:00.000Z"),
      store: { get: async () => draft, confirm: async () => {
        draft = { ...row, confirmed_at: "2026-09-12T12:05:00.000Z" };
        return draft;
      } },
      recordConfirmed: async () => {},
      ensureAddressSubscribed: async (address) => { subscribed.push(address); throw new Error("subscription rejected"); },
    });
    const post = () => handler(request(`/api/actions/${ID}/confirm`, { method: "POST", body: "{}" }), context());
    expect((await post()).status).toBe(200);
    expect(subscribed).toEqual([ADDRESS]);
    expect((await post()).status).toBe(404);
    expect(subscribed).toEqual([ADDRESS]);
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
    expect(parseConfirmActionResponse(await readJson(response))?.calls).toEqual([CALL]);
  });

  function cashoutConfirmRow(kind: "cash-out" | "cash-out-withdraw"): ActionRow {
    const common = { providerId: "peer", providerName: "Peer", environment: "production" as const, region: "US", platform: "cash-app", platformLabel: "Cash App", currency: "USD", minConversionRate: "1", intentAmountRange: { min: "1", max: "100000000" }, estimateAsOf: "2026-09-12T12:00:00.000Z", escrow: ADDRESS };
    return {
      ...row,
      kind,
      summary: {
        ...row.summary,
        metadata: kind === "cash-out"
          ? { product: "cashout", operation: "deposit", canonicalHandle: "user@example.com", approximateFiatAmount: "10", ...common }
          : { product: "cashout", operation: "withdraw", depositId: "deposit_1", approximateFiatAmount: "0", ...common },
      },
    };
  }

  test.each(ACTION_KINDS.filter((kind) => kind !== "trade"))("confirm %s returns calls accepted by the shared parser", async (kind) => {
    const transfer: MoneyActionCall = { to: ADDRESS, data: "0x", value: "123" };
    const approval: MoneyActionCall = {
      to: ADDRESS,
      data: `0x095ea7b3${"0".repeat(24)}${ADDRESS.slice(2)}${"0".repeat(63)}1`,
      value: "0",
      approval: { assetId: "usdc", spender: ADDRESS },
    };
    const calls = kind === "send" ? [transfer] : [CALL, approval];
    const draft: ActionRow = {
      ...(kind === "cash-out" || kind === "cash-out-withdraw" ? cashoutConfirmRow(kind) : row),
      kind,
      pending: { calls },
    };
    const handler = createConfirmActionHandler({
      authorize: authorize(),
      now: () => new Date("2026-09-12T12:05:00.000Z"),
      regionOffered: async () => true,
      store: {
        get: async () => draft,
        confirm: async (_owner, _id, confirmedCalls) => {
          expect(confirmedCalls).toEqual(calls);
          return { ...draft, confirmed_at: "2026-09-12T12:05:00.000Z", pending: { calls: confirmedCalls ?? [] } };
        },
      },
    });
    const response = await handler(request(`/api/actions/${ID}/confirm`, { method: "POST", body: "{}" }), context());
    expect(response.status).toBe(200);
    expect(parseConfirmActionResponse(await readJson(response))?.calls).toEqual(calls);
  });

  test("confirm rechecks the persisted cash-out region and refuses a removed region", async () => {
    let confirms = 0;
    const draft = cashoutConfirmRow("cash-out");
    const handler = createConfirmActionHandler({
      authorize: authorize(),
      now: () => new Date("2026-09-12T12:05:00.000Z"),
      regionOffered: async () => false,
      store: { get: async () => draft, confirm: async () => { confirms += 1; return draft; } },
    });
    const response = await handler(request(`/api/actions/${ID}/confirm`, { method: "POST", body: "{}" }), context());
    expect(response.status).toBe(502);
    expect(parseConfirmActionErrorResponse(await readJson(response))).toEqual({ error: { code: "CASHOUT_UNAVAILABLE", message: "Cash out isn't available in your region." } });
    expect(confirms).toBe(0);
  });

  test("confirm fails closed when the cash-out region settings are unavailable", async () => {
    let confirms = 0;
    const draft = cashoutConfirmRow("cash-out");
    const handler = createConfirmActionHandler({
      authorize: authorize(),
      now: () => new Date("2026-09-12T12:05:00.000Z"),
      regionOffered: async () => { throw new Error("settings unavailable"); },
      store: { get: async () => draft, confirm: async () => { confirms += 1; return draft; } },
    });
    const response = await handler(request(`/api/actions/${ID}/confirm`, { method: "POST", body: "{}" }), context());
    expect(response.status).toBe(503);
    expect(parseConfirmActionErrorResponse(await readJson(response))).toEqual({ error: { code: "CASHOUT_SETTINGS_UNAVAILABLE", message: "Cash out is unavailable right now. Try again shortly." } });
    expect(confirms).toBe(0);
  });

  test("confirm allows an offered cash-out region", async () => {
    const draft = cashoutConfirmRow("cash-out");
    const handler = createConfirmActionHandler({
      authorize: authorize(),
      now: () => new Date("2026-09-12T12:05:00.000Z"),
      regionOffered: async () => true,
      store: { get: async () => draft, confirm: async (_owner, _id, calls) => ({ ...draft, confirmed_at: "2026-09-12T12:05:00.000Z", pending: { calls: calls ?? [] } }) },
    });
    const response = await handler(request(`/api/actions/${ID}/confirm`, { method: "POST", body: "{}" }), context());
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(parseConfirmActionResponse(body)).not.toBeNull();
    expect(parseConfirmActionErrorResponse(body)).toBeNull();
  });

  test("confirm never rechecks the region for withdrawals or already-confirmed cash-outs", async () => {
    let regionChecks = 0;
    const regionOffered = async () => { regionChecks += 1; return true; };
    const withdraw = cashoutConfirmRow("cash-out-withdraw");
    const withdrawHandler = createConfirmActionHandler({
      authorize: authorize(),
      now: () => new Date("2026-09-12T12:05:00.000Z"),
      regionOffered,
      store: { get: async () => withdraw, confirm: async (_owner, _id, calls) => ({ ...withdraw, confirmed_at: "2026-09-12T12:05:00.000Z", pending: { calls: calls ?? [] } }) },
    });
    expect((await withdrawHandler(request(`/api/actions/${ID}/confirm`, { method: "POST", body: "{}" }), context())).status).toBe(200);

    const confirmed = { ...cashoutConfirmRow("cash-out"), confirmed_at: "2026-09-12T12:05:00.000Z" };
    const confirmedHandler = createConfirmActionHandler({
      authorize: authorize(),
      now: () => new Date("2026-09-12T12:05:00.000Z"),
      regionOffered,
      store: { get: async () => confirmed, confirm: async () => null },
    });
    expect((await confirmedHandler(request(`/api/actions/${ID}/confirm`, { method: "POST", body: "{}" }), context())).status).toBe(404);
    expect(regionChecks).toBe(0);
  });

  test("confirm fails closed for a cash-out without persisted region metadata", async () => {
    let confirms = 0;
    const draft: ActionRow = { ...row, kind: "cash-out" };
    const handler = createConfirmActionHandler({
      authorize: authorize(),
      now: () => new Date("2026-09-12T12:05:00.000Z"),
      regionOffered: async () => true,
      store: { get: async () => draft, confirm: async () => { confirms += 1; return draft; } },
    });
    const response = await handler(request(`/api/actions/${ID}/confirm`, { method: "POST", body: "{}" }), context());
    expect(response.status).toBe(503);
    expect(parseConfirmActionErrorResponse(await readJson(response))?.error.code).toBe("CASHOUT_SETTINGS_UNAVAILABLE");
    expect(confirms).toBe(0);
  });


  test("Base confirm returns a padded batch gas hint and estimator failure remains non-blocking", async () => {
    const estimatedCalls: unknown[] = [];
    const writes: string[] = [];
    setObservabilityLogWriterForTests((line) => writes.push(line));
    const store = {
      get: async () => ({ ...row, provider: "base-account" as const }),
      confirm: async (_owner: MoneyActionOwner, _id: string, calls?: MoneyActionCall[]) => ({
        ...row,
        provider: "base-account" as const,
        confirmed_at: "2026-09-12T12:05:00.000Z",
        pending: { calls: calls as typeof CALL[] },
      }),
    };
    const success = createConfirmActionHandler({
      authorize: authorize("owner-a", "base-account"),
      now: () => new Date("2026-09-12T12:05:00.000Z"),
      store,
      estimateBaseBatch: async (calls, account) => {
        estimatedCalls.push({ calls, account });
        return BigInt(100_000);
      },
    });
    const response = await success(baseRequest(`/api/actions/${ID}/confirm`, { method: "POST", body: "{}" }), context());
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({ calls: [CALL], batchGasLimit: "150000" });
    expect(estimatedCalls).toEqual([{ calls: [CALL], account: ADDRESS }]);
    expect(JSON.parse(writes[0] ?? "{}")).toMatchObject({
      kind: "action-confirm",
      code: "BASE_BATCH_GAS_HINT_APPLIED",
      outcome: "ok",
    });

    const unavailable = createConfirmActionHandler({
      authorize: authorize("owner-a", "base-account"),
      now: () => new Date("2026-09-12T12:05:00.000Z"),
      store,
      estimateBaseBatch: async () => { throw new Error("rpc unavailable"); },
    });
    const fallback = await unavailable(baseRequest(`/api/actions/${ID}/confirm`, { method: "POST", body: "{}" }), context());
    expect(fallback.status).toBe(200);
    expect(await readJson(fallback)).not.toHaveProperty("batchGasLimit");
    expect(JSON.parse(writes[1] ?? "{}")).toMatchObject({
      code: "BASE_BATCH_GAS_HINT_UNAVAILABLE",
      outcome: "unavailable",
    });
  });

  test("Base confirm still estimates a two-call batch", async () => {
    const calls = [CALL, { ...CALL, data: "0x5678" as const }];
    const estimatedCalls: MoneyActionCall[][] = [];
    const handler = createConfirmActionHandler({
      authorize: authorize("owner-a", "base-account"),
      now: () => new Date("2026-09-12T12:05:00.000Z"),
      estimateBaseBatch: async (batch) => { estimatedCalls.push([...batch]); return BigInt(100_000); },
      store: {
        get: async () => ({ ...row, provider: "base-account", pending: { calls } }),
        confirm: async (_owner, _id, confirmedCalls) => ({
          ...row, provider: "base-account", confirmed_at: "2026-09-12T12:05:00.000Z",
          pending: { calls: confirmedCalls ?? [] },
        }),
      },
    });
    const response = await handler(baseRequest(`/api/actions/${ID}/confirm`, { method: "POST", body: "{}" }), context());
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({ calls, batchGasLimit: "150000" });
    expect(estimatedCalls).toEqual([calls]);
  });

  test("Base confirm skips the gas hint for a finalized three-call batch without altering its calls", async () => {
    const calls: MoneyActionCall[] = [
      { to: "0x2222222222222222222222222222222222222222", data: "0x095ea7b3", value: "0" },
      { to: "0x3333333333333333333333333333333333333333", data: "0x238d6579", value: "0" },
      { to: "0x3333333333333333333333333333333333333333", data: "0x50d8cd4b", value: "0" },
    ];
    const writes: string[] = [];
    setObservabilityLogWriterForTests((line) => writes.push(line));
    let estimates = 0;
    const handler = createConfirmActionHandler({
      authorize: authorize("owner-a", "base-account"),
      now: () => new Date("2026-09-12T12:05:00.000Z"),
      estimateBaseBatch: async () => { estimates += 1; return BigInt(100_000); },
      store: {
        get: async () => ({ ...row, provider: "base-account", pending: { calls } }),
        confirm: async (_owner, _id, confirmedCalls) => ({
          ...row, provider: "base-account", confirmed_at: "2026-09-12T12:05:00.000Z",
          pending: { calls: confirmedCalls ?? [] },
        }),
      },
    });
    const response = await handler(baseRequest(`/api/actions/${ID}/confirm`, { method: "POST", body: "{}" }), context());
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(parseConfirmActionResponse(body)?.calls).toEqual(calls);
    expect(body).not.toHaveProperty("batchGasLimit");
    expect(estimates).toBe(0);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0] ?? "{}")).toMatchObject({
      level: "info", kind: "action-confirm", code: "BASE_BATCH_GAS_HINT_SKIPPED", outcome: "skipped", provider: "base-account",
    });
  });

  test("CDP confirm never invokes the Base estimator", async () => {
    let estimates = 0;
    const handler = createConfirmActionHandler({
      authorize: authorize(),
      now: () => new Date("2026-09-12T12:05:00.000Z"),
      estimateBaseBatch: async () => { estimates += 1; return BigInt(100_000); },
      store: {
        get: async () => row,
        confirm: async (_owner, _id, calls) => ({ ...row, confirmed_at: "2026-09-12T12:05:00.000Z", pending: { calls: calls ?? [] } }),
      },
    });
    expect((await handler(request(`/api/actions/${ID}/confirm`, { method: "POST", body: "{}" }), context())).status).toBe(200);
    expect(estimates).toBe(0);
  });

  test("confirm awaits the owner balance hot signal exactly once only after success", async () => {
    const signals: Array<{ address: string; until: string }> = [];
    let release!: () => void;
    let signalStarted!: () => void;
    const pendingSignal = new Promise<void>((resolve) => { release = resolve; });
    const startedSignal = new Promise<void>((resolve) => { signalStarted = resolve; });
    const handler = createConfirmActionHandler({
      authorize: authorize(),
      now: () => new Date("2026-09-12T12:05:00.000Z"),
      markHot: async (address, until) => {
        signals.push({ address, until: until.toISOString() });
        signalStarted();
        await pendingSignal;
      },
      store: {
        get: async () => row,
        confirm: async (_owner, _id, calls) => ({ ...row, confirmed_at: "2026-09-12T12:05:00.000Z", pending: { calls: calls ?? [] } }),
      },
    });
    let responded = false;
    const responsePending = handler(
      request(`/api/actions/${ID}/confirm`, { method: "POST", body: "{}" }),
      context(),
    ).then((response) => {
      responded = true;
      return response;
    });
    await startedSignal;
    expect(signals).toEqual([{ address: ADDRESS, until: "2026-09-12T12:06:00.000Z" }]);
    expect(responded).toBeFalse();
    release();
    expect((await responsePending).status).toBe(200);

    const failedSignals: string[] = [];
    const failed = createConfirmActionHandler({
      authorize: authorize(),
      markHot: async (address) => { failedSignals.push(address); },
      store: { get: async () => null, confirm: async () => null },
    });
    expect((await failed(request(`/api/actions/${ID}/confirm`, { method: "POST", body: "{}" }), context())).status).toBe(404);
    expect(failedSignals).toEqual([]);
  });

  test("a new handle schedules follow-through, a duplicate waits for the throttle, and an unresolved row retries after it", async () => {
    const tasks: Array<() => Promise<unknown>> = [];
    let clock = new Date("2026-09-12T12:05:00.000Z");
    const confirmed = { ...row, pending: null, confirmed_at: "2026-09-12T12:05:00.000Z", provider_handle: HANDLE };
    const handler = createHandleActionHandler({
      authorize: authorize(),
      now: () => clock,
      markHot: async () => {},
      schedule: (task) => { tasks.push(task); },
      store: { recordHandle: async () => confirmed },
    });
    const post = () => handler(request(`/api/actions/${ID}/handle`, { method: "POST", body: JSON.stringify({ providerHandle: HANDLE }) }), context());

    expect((await post()).status).toBe(200);
    expect(tasks).toHaveLength(1);
    expect((await post()).status).toBe(200);
    expect(tasks).toHaveLength(1);

    clock = new Date("2026-09-12T12:05:16.000Z");
    expect((await post()).status).toBe(200);
    expect(tasks).toHaveLength(2);
  });

  test("a settled action never schedules follow-through, including a late duplicate post", async () => {
    const tasks: Array<() => Promise<unknown>> = [];
    const settled = { ...row, confirmed_at: "2026-09-12T12:05:00.000Z", provider_handle: HANDLE, outcome: "succeeded" as const, outcome_source: "chain" as const,
      settled_at: "2026-09-12T12:05:00.000Z", outcome_recorded_at: "2026-09-12T12:05:00.000Z" };
    const handler = createHandleActionHandler({
      authorize: authorize(),
      now: () => new Date("2026-09-12T12:05:00.000Z"),
      markHot: async () => {},
      schedule: (task) => { tasks.push(task); },
      store: { recordHandle: async () => settled },
    });
    expect((await handler(request(`/api/actions/${ID}/handle`, { method: "POST", body: JSON.stringify({ providerHandle: HANDLE }) }), context())).status).toBe(200);
    expect(tasks).toHaveLength(0);
  });

  test("an unavailable scheduler is reported and a later duplicate post can try again", async () => {
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => { lines.push(line); });
    let clock = new Date("2026-09-12T12:05:00.000Z");
    const confirmed = { ...row, pending: null, confirmed_at: "2026-09-12T12:05:00.000Z", provider_handle: HANDLE };
    const attempts: string[] = [];
    const handler = createHandleActionHandler({
      authorize: authorize(),
      now: () => clock,
      markHot: async () => {},
      schedule: () => { attempts.push("schedule"); throw new Error("scheduler unavailable"); },
      store: { recordHandle: async () => confirmed },
    });
    const post = () => handler(request(`/api/actions/${ID}/handle`, { method: "POST", body: JSON.stringify({ providerHandle: HANDLE }) }), context());

    expect((await post()).status).toBe(200);
    expect(attempts).toHaveLength(1);
    expect(lines.map(parseLog)).toContainEqual(expect.objectContaining({
      kind: "action-reconcile", code: "FOLLOW_SCHEDULE_UNAVAILABLE", outcome: "unavailable",
    }));

    clock = new Date("2026-09-12T12:05:01.000Z");
    expect((await post()).status).toBe(200);
    expect(attempts).toHaveLength(2);
  });

  test("handle awaits the owner balance hot signal exactly once only after success", async () => {
    const signals: string[] = [];
    const confirmed = { ...row, pending: null, confirmed_at: "2026-09-12T12:05:00.000Z", provider_handle: HANDLE };
    const handler = createHandleActionHandler({
      authorize: authorize(),
      now: () => new Date("2026-09-12T12:05:00.000Z"),
      markHot: async (address) => { signals.push(address); },
      store: { recordHandle: async () => confirmed },
    });
    const response = await handler(request(`/api/actions/${ID}/handle`, {
      method: "POST",
      body: JSON.stringify({ providerHandle: HANDLE }),
    }), context());
    expect(response.status).toBe(200);
    expect(signals).toEqual([ADDRESS]);

    const failedSignals: string[] = [];
    const failed = createHandleActionHandler({
      authorize: authorize(),
      markHot: async (address) => { failedSignals.push(address); },
      store: { recordHandle: async () => null },
    });
    expect((await failed(request(`/api/actions/${ID}/handle`, {
      method: "POST",
      body: JSON.stringify({ providerHandle: HANDLE }),
    }), context())).status).toBe(404);
    expect(failedSignals).toEqual([]);
  });

  test("a rejected balance signal still returns the normal confirm response and emits one event", async () => {
    const writes: string[] = [];
    setObservabilityLogWriterForTests((line) => writes.push(line));
    const handler = createConfirmActionHandler({
      authorize: authorize(),
      now: () => new Date("2026-09-12T12:05:00.000Z"),
      markHot: async () => { throw new Error("database unavailable"); },
      store: {
        get: async () => row,
        confirm: async (_owner, _id, calls) => ({ ...row, confirmed_at: "2026-09-12T12:05:00.000Z", pending: { calls: calls ?? [] } }),
      },
    });

    const response = await handler(
      request(`/api/actions/${ID}/confirm`, { method: "POST", body: "{}" }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0] ?? "{}")).toMatchObject({
      kind: "balances-signal",
      code: "BALANCE_SIGNAL_FAILED",
      outcome: "unavailable",
    });
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
    let estimatedCalls: unknown;
    const handler = createConfirmActionHandler({
      authorize: authorize("owner-a", "base-account"), now: () => new Date("2026-09-12T12:05:00.000Z"),
      estimateBaseBatch: async (calls) => { estimatedCalls = calls; return BigInt(100_000); },
      store: { get: async () => trade, confirm: async (_owner, _id, calls) => {
        confirmedCalls = calls;
        return { ...trade, confirmed_at: "2026-09-12T12:05:00.000Z", pending: { calls: calls ?? [] } };
      } },
    });
    const response = await handler(request(`/api/actions/${ID}/confirm`, { method: "POST", headers: { "X-Home-Account-Provider": "base-account" }, body: JSON.stringify({ signature }) }), context());
    expect(response.status).toBe(200);
    expect(confirmedCalls).toEqual([{ ...CALL, data: `0x1234${"41".padStart(64, "0")}${signature.slice(2)}` }]);
    expect(estimatedCalls).toEqual(confirmedCalls);
  });

  test("a late-approved submission gets the pending grace window from its recorded handle", async () => {
    const late = confirmedBaseRow({
      confirmed_at: "2026-09-12T11:30:00.000Z",
      handle_recorded_at: "2026-09-12T11:59:00.000Z",
      transaction_hash: HASH,
    });
    const handler = createListActionsHandler({
      authorize: authorize("owner-a", "base-account"),
      now: () => new Date("2026-09-12T12:00:00.000Z"),
      store: { list: async () => [late], recordHandle: async () => null, recordOutcome: recorded },
      readReceipt: async () => { throw new Error("Base receipt read failed"); },
    });
    const response = await handler(baseRequest("/api/actions"));
    expect(response.status).toBe(200);
    expect((await readActions(response))[0]).toMatchObject({ id: ID, status: "pending" });
  });

  test("list keeps a hashless ambiguous dispatch unknown after the grace window", async () => {
    const ambiguous = confirmedBaseRow({
      confirmed_at: "2026-09-12T11:44:59.000Z",
      provider_handle: null,
      transaction_hash: null,
    });
    const handler = createListActionsHandler({
      authorize: authorize("owner-a", "base-account"),
      now: () => new Date("2026-09-12T12:00:00.000Z"),
      store: { list: async () => [ambiguous], recordHandle: async () => null, recordOutcome: recorded },
    });
    const response = await handler(baseRequest("/api/actions"));
    expect(response.status).toBe(200);
    expect((await readActions(response))[0]).toMatchObject({ id: ID, status: "unknown" });
  });

  test("list does not reconcile a candidate inside the client grace period", async () => {
    let resolverCalls = 0;
    const candidate = confirmedBaseRow({ confirmed_at: "2026-09-12T12:09:50.000Z" });
    const handler = createListActionsHandler({
      authorize: authorize("owner-a", "base-account"),
      now: () => new Date("2026-09-12T12:10:00.000Z"),
      store: { list: async () => [candidate], recordHandle: async () => null, recordOutcome: recorded },
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
        recordOutcome: recorded,
      },
      resolveHandle: async () => ({ status: "complete", transactionHash: HASH }),
      readReceipt: async (hash) => {
        receiptHash = hash;
        return { status: "confirmed", transactionHash: hash, blockNumber: "1", blockHash: HASH, blockTimestamp, finalized: true, userOperations: [operation(true)] };
      },
    });

    const response = await handler(baseRequest("/api/actions"));
    const body = await readActions(response);

    expect(response.status).toBe(200);
    expect(recordedInputs).toEqual([{ transactionHash: HASH }]);
    expect(receiptHash).toBe(HASH);
    expect(body[0]?.status).toBe("confirmed");
    expect(JSON.parse(writes[0] ?? "{}")).toMatchObject({
      kind: "action-reconcile",
      route: "/api/actions",
      code: "COMPLETE",
      outcome: "ok",
      provider: "base-account",
      level: "info",
    });
  });

  test("list exposes a settled action's receipt block time", async () => {
    const candidate = confirmedBaseRow({ outcome: "succeeded", settled_at: blockTimestamp });
    const handler = createListActionsHandler({
      authorize: authorize("owner-a", "base-account"),
      now: () => new Date("2026-09-12T12:10:00.000Z"),
      store: { list: async () => [candidate], recordHandle: async () => null, recordOutcome: recorded },
    });

    const body = await (await handler(baseRequest("/api/actions"))).json() as { actions: Array<{ settledAt?: string }> };
    expect(body.actions[0]?.settledAt).toBe(blockTimestamp);
    const [parsed] = parseRecentMoneyActions(body, {
      user: { subject: "owner-a" },
      smartAccount: { address: ADDRESS, chainId: 8453 },
      accountProvider: "base-account",
    });
    expect(parsed?.action.id).toBe(candidate.id);
    expect(parsed?.settledAt).toBe(blockTimestamp);
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
        recordOutcome: recorded,
      },
      resolveHandle: async () => ({ status: "pending" }),
    });

    expect((await handler(baseRequest("/api/actions"))).status).toBe(200);
    expect(recordCalls).toBe(0);
  });

  test("list does not report wallet non-submission when its outcome write fails", async () => {
    const candidate = confirmedBaseRow();
    const handler = createListActionsHandler({
      authorize: authorize("owner-a", "base-account"),
      now: () => new Date("2026-09-12T12:10:00.000Z"),
      store: {
        list: async () => [candidate],
        recordHandle: async () => null,
        recordOutcome: async () => { throw new Error("database unavailable"); },
      },
      resolveHandle: async () => ({ status: "not_submitted" }),
    });
    const response = await handler(baseRequest("/api/actions"));
    expect(response.status).toBe(200);
    expect((await readActions(response))[0]).toMatchObject({ id: candidate.id, status: "pending" });
  });

  test("list records reverted wallet outcome when no hash is returned", async () => {
    setObservabilityLogWriterForTests(() => undefined);
    const candidate = confirmedBaseRow();
    let recordCalls = 0;
    const handler = createListActionsHandler({
      authorize: authorize("owner-a", "base-account"),
      now: () => new Date("2026-09-12T12:10:00.000Z"),
      store: {
        list: async () => [candidate],
        recordHandle: async () => { recordCalls += 1; return null; },
        recordOutcome: recorded,
      },
      resolveHandle: async () => ({ status: "reverted" }),
    });

    const response = await handler(baseRequest("/api/actions"));
    const body = await readActions(response);

    expect(response.status).toBe(200);
    expect(recordCalls).toBe(0);
    expect(body[0]).toMatchObject({ id: candidate.id, status: "failed" });
    expect(body[0]?.transactionHash).toBeUndefined();
  });

  test("list tolerates a recordHandle conflict and presents the stored row", async () => {
    setObservabilityLogWriterForTests(() => undefined);
    const candidate = confirmedBaseRow();
    const handler = createListActionsHandler({
      authorize: authorize("owner-a", "base-account"),
      now: () => new Date("2026-09-12T12:10:00.000Z"),
      store: { list: async () => [candidate], recordHandle: async () => null, recordOutcome: recorded },
      resolveHandle: async () => ({ status: "complete", transactionHash: HASH }),
    });

    const response = await handler(baseRequest("/api/actions"));
    const body = await readActions(response);

    expect(response.status).toBe(200);
    expect(body[0]).toMatchObject({ status: "pending" });
    expect(body[0]?.transactionHash).toBeUndefined();
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
        recordOutcome: recorded,
      },
      resolveHandle: async () => ({ status: "complete", transactionHash: HASH }),
    });

    const response = await handler(baseRequest("/api/actions"));
    const body = await readActions(response);

    expect(response.status).toBe(200);
    expect(body[0]).toMatchObject({ id: candidate.id, status: "pending" });
    expect(body[0]?.transactionHash).toBeUndefined();
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
      store: { list: async () => [legacy, ...candidates], recordHandle: async () => null, recordOutcome: recorded },
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

  test("list reconciles eligible rows for both providers while reading existing receipts", async () => {
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
        recordOutcome: recorded,
      },
      resolveHandle: async (resolved) => {
        resolvedIds.push(resolved.id);
        return { status: "pending" };
      },
      readReceipt: async (hash) => {
        receiptHashes.push(hash);
        return { status: "pending", transactionHash: hash, finalizedBlockNumber: "0" };
      },
    });

    const response = await handler(baseRequest("/api/actions"));

    expect(response.status).toBe(200);
    expect(resolvedIds).toEqual([cdpRow.id, candidate.id]);
    expect(receiptHashes).toEqual([HASH]);
  });

  test("list survives a throwing resolver", async () => {
    const writes: string[] = [];
    setObservabilityLogWriterForTests((line) => writes.push(line));
    const candidate = confirmedBaseRow();
    const handler = createListActionsHandler({
      authorize: authorize("owner-a", "base-account"),
      now: () => new Date("2026-09-12T12:10:00.000Z"),
      store: { list: async () => [candidate], recordHandle: async () => null, recordOutcome: recorded },
      resolveHandle: async () => { throw new Error("provider failed"); },
    });

    const response = await handler(baseRequest("/api/actions"));

    expect(response.status).toBe(200);
    expect((await readActions(response))[0]).toMatchObject({ id: candidate.id, status: "pending" });
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
        recordOutcome: async (_owner, _id, input) => ({
          row: { ...candidate, transaction_hash: HASH, outcome: input.outcome }, written: true, conflict: false,
        }),
      },
      resolveHandle: async () => {
        resolverCalls += 1;
        return { status: "complete", transactionHash: HASH };
      },
      readReceipt: async (hash) => ({
        status: "confirmed",
        transactionHash: hash,
        blockNumber: "1", blockHash: HASH,
        blockTimestamp, finalized: true, userOperations: [operation(false)],
      }),
    });

    const response = await handler(baseRequest(`/api/actions/${ID}`), context());

    expect(response.status).toBe(200);
    expect(resolverCalls).toBe(1);
    expect(await readJson(response)).toMatchObject({ id: ID, transactionHash: HASH, status: "failed" });
  });
});
