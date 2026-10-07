import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { snapshotProvesFreshness } from "@/client/query/after-action";
import { presentAction } from "@/server/actions/handler";
import { settleRow } from "@/server/actions/settle";
import { followAction, followActionUntilSettled, type FollowActionDeps } from "@/server/actions/follow-through";
import type { TransferReceiptStatus } from "@/server/actions/receipt";
import { actionOwnerKey, type ActionRow, type ActionsStore } from "@/server/actions/store";
import { parseRecentActionsPayload } from "@/shared/actions/contracts/list";
import { createBalancesService } from "@/server/balances/coalesce";
import { MemoryBalanceSnapshotStore } from "@/server/balances/memory-snapshot-store";
import { BORROW_MARKETS } from "@/shared/borrowing/config";
import { balancesSnapshotFixture, FIXTURE_OWNER_ADDRESS } from "@/shared/balances/fixtures";
import { parseHash32 } from "@/shared/chain/hex";
import type { MoneyActionOwner } from "@/shared/money-actions/types";

const owner: MoneyActionOwner = {
  subject: "subject-a", address: FIXTURE_OWNER_ADDRESS, chainId: 8453, accountProvider: "cdp-embedded",
};
const transactionHash = `0x${"a".repeat(64)}` as const;
const row: ActionRow = {
  id: "11111111-1111-4111-8111-111111111111",
  owner_key: actionOwnerKey(owner),
  account_address: FIXTURE_OWNER_ADDRESS,
  provider: "cdp-embedded",
  kind: "send",
  summary: {
    title: "Send USDC",
    amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1", direction: "spend" }],
    warnings: [], expiresAt: "2026-09-13T12:10:00.000Z",
  },
  pending: null,
  created_at: "2026-09-13T12:00:00.000Z",
  confirmed_at: "2026-09-13T12:00:01.000Z",
  provider_handle: transactionHash,
  transaction_hash: transactionHash,
  handle_recorded_at: "2026-09-13T12:00:02.000Z",
  declined_reported_at: null,
  dispatch_attempt: 0,
  outcome: null,
  outcome_source: null,
  settled_at: null,
  outcome_recorded_at: null,
  observed_receipt_transaction_hash: `0x${"A".repeat(64)}`,
  observed_receipt_block_number: "105",
  observed_receipt_block_hash: `0x${"b".repeat(64)}`,
  observed_receipt_outcome: "succeeded",
  observed_at: "2026-09-13T12:00:03.000Z",
};

test("an observed succeeded receipt proves the settlement boundary before the outcome is finalized", async () => {
  const response = await presentAction(row, owner, "confirmed", new Date("2026-09-13T12:00:04.000Z"));
  expect(response.status).toBe("confirmed");
  expect(response.settledBlockNumber).toBe("105");
  expect(response).not.toHaveProperty("settledAt");
  const parsed = parseRecentActionsPayload({ actions: [response] }, {
    user: { subject: owner.subject },
    smartAccount: { address: owner.address, chainId: owner.chainId },
    accountProvider: owner.accountProvider,
  });
  expect(parsed.operations).toHaveLength(1);
  const operation = parsed.operations[0];
  if (!operation) throw new Error("Expected a parsed action operation");
  expect(operation.status).toBe("confirmed");
  expect(operation.settledBlockNumber).toBe("105");
  const retained = { ...balancesSnapshotFixture, block: { ...balancesSnapshotFixture.block, number: "100" } };
  expect(snapshotProvesFreshness(retained, { at: 0, fresh: {}, settledBlock: operation.settledBlockNumber })).toBe(false);
});

test.each(["throws", "returns null"] as const)("a finalized receipt keeps its block proof when the observation write %s", async (failure) => {
  const unobserved: ActionRow = { ...row, observed_receipt_transaction_hash: null, observed_receipt_block_number: null,
    observed_receipt_block_hash: null, observed_receipt_outcome: null, observed_at: null };
  const store: Pick<ActionsStore, "recordReceiptObservation" | "recordOutcome"> = {
    recordReceiptObservation: async () => {
      if (failure === "throws") throw new Error("Observation unavailable");
      return null;
    },
    recordOutcome: async (_owner, _id, input) => ({
      row: { ...unobserved, outcome: input.outcome, outcome_source: input.source, settled_at: input.settledAt },
      written: true, conflict: false,
    }),
  };
  const result = await settleRow(unobserved, owner, store, async (hash) => ({
    status: "confirmed", transactionHash: hash, blockNumber: "105", blockHash: `0x${"b".repeat(64)}`,
    blockTimestamp: "2026-09-13T12:00:03.000Z", finalized: true,
    userOperations: [{ userOpHash: transactionHash, sender: owner.address, success: true }],
  }), new AbortController().signal, "/api/actions");
  expect(result.receipt).toBe("confirmed");
  expect(result.row).toMatchObject({
    outcome: "succeeded", observed_receipt_transaction_hash: transactionHash, observed_receipt_block_number: "105",
    observed_receipt_block_hash: `0x${"b".repeat(64)}`, observed_receipt_outcome: "succeeded",
  });
  expect(result.row.observed_at).toBeInstanceOf(Date);
  expect(unobserved.observed_receipt_block_number).toBeNull();
  const response = await presentAction(result.row, owner, result.receipt, new Date("2026-09-13T12:00:04.000Z"));
  expect(response.status).toBe("confirmed");
  expect(response.settledBlockNumber).toBe("105");
  const parsed = parseRecentActionsPayload({ actions: [response] }, {
    user: { subject: owner.subject },
    smartAccount: { address: owner.address, chainId: owner.chainId },
    accountProvider: owner.accountProvider,
  });
  expect(parsed.operations).toHaveLength(1);
  const operation = parsed.operations[0];
  if (!operation) throw new Error("Expected a parsed action operation");
  expect(operation.settledBlockNumber).toBe("105");
});

test("a finalized receipt is persisted with the outcome when the observation write throws", async () => {
  const unobserved: ActionRow = { ...row, observed_receipt_transaction_hash: null, observed_receipt_block_number: null,
    observed_receipt_block_hash: null, observed_receipt_outcome: null, observed_at: null };
  const outcomeWrites: Parameters<ActionsStore["recordOutcome"]>[2][] = [];
  let persisted = unobserved;
  const store: Pick<ActionsStore, "recordReceiptObservation" | "recordOutcome"> = {
    recordReceiptObservation: async () => { throw new Error("Observation unavailable"); },
    recordOutcome: async (_owner, _id, input) => {
      outcomeWrites.push(input);
      const observation = input.observedReceipt;
      persisted = {
        ...unobserved, outcome: input.outcome, outcome_source: input.source, settled_at: input.settledAt,
        observed_receipt_transaction_hash: observation?.transactionHash ?? null,
        observed_receipt_block_number: observation?.blockNumber ?? null,
        observed_receipt_block_hash: observation?.blockHash ?? null,
        observed_receipt_outcome: observation?.outcome ?? null,
        observed_at: observation ? new Date("2026-09-13T12:00:04.000Z") : null,
      };
      return { row: persisted, written: true, conflict: false };
    },
  };
  const result = await settleRow(unobserved, owner, store, async (hash) => ({
    status: "confirmed", transactionHash: hash, blockNumber: "105", blockHash: `0x${"b".repeat(64)}`,
    blockTimestamp: "2026-09-13T12:00:03.000Z", finalized: true,
    userOperations: [{ userOpHash: transactionHash, sender: owner.address, success: true }],
  }), new AbortController().signal, "/api/actions");
  expect(outcomeWrites).toEqual([{
    outcome: "succeeded", source: "chain", settledAt: new Date("2026-09-13T12:00:03.000Z"),
    observedReceipt: { transactionHash, blockNumber: "105", blockHash: `0x${"b".repeat(64)}`, outcome: "succeeded" },
  }]);
  expect(result.row).toBe(persisted);
  expect(result.row.observed_receipt_block_number).toBe("105");
  expect(result.receipt).toBe("confirmed");
  const response = await presentAction(result.row, owner, result.receipt, new Date("2026-09-13T12:00:04.000Z"));
  expect(response.settledBlockNumber).toBe("105");
  const laterResponse = await presentAction(persisted, owner, null, new Date("2026-09-13T12:00:05.000Z"));
  expect(laterResponse.settledBlockNumber).toBe("105");
  const parsed = parseRecentActionsPayload({ actions: [laterResponse] }, {
    user: { subject: owner.subject },
    smartAccount: { address: owner.address, chainId: owner.chainId },
    accountProvider: owner.accountProvider,
  });
  expect(parsed.operations).toHaveLength(1);
  const operation = parsed.operations[0];
  if (!operation) throw new Error("Expected a parsed action operation");
  expect(operation.settledBlockNumber).toBe("105");
});

test("a succeeded observation without a block hash cannot supply settlement proof", async () => {
  const response = await presentAction({ ...row, observed_receipt_block_hash: null }, owner, "confirmed");
  expect(response.status).toBe("confirmed");
  expect(response).not.toHaveProperty("settledBlockNumber");
});

test("a retained non-stale snapshot served after a settlement observation does not clear the qualifier", async () => {
  let nowMs = Date.parse("2026-09-13T12:00:00.000Z");
  let blockNumber = "100";
  let observations = 0;
  const scheduled: (() => Promise<unknown>)[] = [];
  const service = createBalancesService({
    store: new MemoryBalanceSnapshotStore(),
    readUniverse: async () => ({ entries: [] }),
    enumerateBalances: async () => ({ status: "complete", rows: [], nextCursor: null, pagesRead: 1, durationMs: 0 }),
    readBalances: async () => {
      observations += 1;
      return {
        block: {
          number: blockNumber,
          hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
          timestamp: String(Math.floor(nowMs / 1_000)),
        },
        observedAt: new Date(nowMs).toISOString(),
        holdings: [],
        coverage: { registry: "complete", catalog: "complete" },
      };
    },
    readBorrow: async (_owner, block) => ({
      markets: BORROW_MARKETS.map((market) => {
        const marketId = parseHash32(market.marketId);
        if (!marketId) throw new Error("Expected a valid borrow market id");
        return {
          marketId,
          status: "ready",
          blockNumber: block.number,
          collateralRaw: "0",
          debtAssetsRaw: "0",
          borrowAprWad: "0",
        };
      }),
    }),
    resolveBalances: async (read) => read,
    priceBalances: async () => ({
      holdings: [],
      borrow: { coverage: "complete", positions: [] },
      revalidating: false,
      durationMs: { store: 0, codex: 0, coinbase: 0 },
    }),
    registryHoldingsMatch: () => true,
    now: () => new Date(nowMs),
    nowMs: () => nowMs,
    schedule: (task) => { scheduled.push(typeof task === "function" ? task : () => task); },
    log: () => undefined,
  });

  const first = await service(FIXTURE_OWNER_ADDRESS, "US");
  expect(observations).toBe(1);
  expect(first.block.number).toBe("100");
  expect(first.fetchedAt).toBe("2026-09-13T12:00:00.000Z");
  const retained = await service(FIXTURE_OWNER_ADDRESS, "US");
  expect(observations).toBe(1);
  expect(retained.stale).toBeUndefined();
  expect(retained.block.number).toBe("100");
  expect(retained.fetchedAt).toBe(first.fetchedAt);
  expect(scheduled).toHaveLength(0);
  const marker = { at: Date.parse(retained.fetchedAt) + 1, fresh: {}, settledBlock: "105" };
  expect(snapshotProvesFreshness(retained, marker)).toBe(false);

  nowMs += 120_001;
  blockNumber = "110";
  const revalidating = await service(FIXTURE_OWNER_ADDRESS, "US");
  expect(revalidating.stale).toBe(true);
  expect(snapshotProvesFreshness(revalidating, marker)).toBe(false);
  expect(scheduled).toHaveLength(1);
  for (const task of scheduled.splice(0)) await task();
  const fresh = await service(FIXTURE_OWNER_ADDRESS, "US");
  expect(observations).toBe(2);
  expect(fresh.stale).toBeUndefined();
  expect(fresh.block.number).toBe("110");
  expect(fresh.fetchedAt).toBe("2026-09-13T12:02:00.001Z");
  expect(snapshotProvesFreshness(fresh, marker)).toBe(true);
});

type WriteResult = "ok" | "throws" | "null";
function followFixture(options: {
  observed?: boolean;
  finalized?: boolean;
  success?: boolean;
  observation?: WriteResult | "missing";
  outcome?: WriteResult;
} = {}) {
  let persisted: ActionRow = options.observed ? { ...row } : { ...row,
    observed_receipt_transaction_hash: null, observed_receipt_block_number: null,
    observed_receipt_block_hash: null, observed_receipt_outcome: null, observed_at: null };
  const initial = { ...persisted };
  let observationResult = options.observation ?? "ok";
  let outcomeResult = options.outcome ?? "ok";
  let nowMs = 0;
  const calls = { get: 0, receipt: 0, observation: 0, outcome: 0, clear: 0 };
  const sleeps: number[] = [];
  const proof = { transactionHash, blockNumber: "105", blockHash: `0x${"b".repeat(64)}`,
    outcome: options.success === false ? "reverted" as const : "succeeded" as const };
  const observe = (input: typeof proof): ActionRow => ({ ...persisted,
    observed_receipt_transaction_hash: input.transactionHash, observed_receipt_block_number: input.blockNumber,
    observed_receipt_block_hash: input.blockHash, observed_receipt_outcome: input.outcome,
    observed_at: new Date("2026-09-13T12:00:04.000Z") });
  const store: NonNullable<FollowActionDeps["store"]> = {
    get: async (requestedOwner, id) => {
      expect(requestedOwner).toEqual(owner);
      expect(id).toBe(row.id);
      calls.get += 1;
      return { ...persisted };
    },
    recordHandle: async () => { throw new Error("Unexpected handle resolution"); },
    ...(options.observation === "missing" ? {} : { recordReceiptObservation: async (_owner: MoneyActionOwner, _id: string, input: typeof proof) => {
      calls.observation += 1;
      if (observationResult === "throws") throw new Error("Observation unavailable");
      if (observationResult === "null") return null;
      persisted = observe(input);
      return { ...persisted };
    } }),
    recordOutcome: async (_owner, _id, input) => {
      calls.outcome += 1;
      if (outcomeResult === "throws") throw new Error("Outcome unavailable");
      if (outcomeResult === "null") return { row: null, written: false, conflict: false };
      expect(input.observedReceipt).toEqual(proof);
      persisted = { ...observe(proof), outcome: input.outcome, outcome_source: input.source,
        settled_at: input.settledAt, outcome_recorded_at: "2026-09-13T12:00:04.000Z" };
      return { row: { ...persisted }, written: true, conflict: false };
    },
    clearReceiptObservation: async () => {
      calls.clear += 1;
      persisted = { ...persisted, observed_receipt_transaction_hash: null, observed_receipt_block_number: null,
        observed_receipt_block_hash: null, observed_receipt_outcome: null, observed_at: null };
      return { ...persisted };
    },
  };
  const controller = new AbortController();
  const deps: FollowActionDeps = {
    store, now: () => nowMs,
    readReceipt: async (hash, signal) => {
      expect(hash).toBe(transactionHash);
      expect(signal?.aborted).toBe(false);
      calls.receipt += 1;
      return { status: "confirmed", ...proof, blockTimestamp: "2026-09-13T12:00:03.000Z",
        finalized: options.finalized ?? false,
        userOperations: [{ sender: owner.address, userOpHash: transactionHash, success: options.success ?? true }] };
    },
  };
  const loopOptions = { deps, deadlineMs: 10_000, signal: controller.signal, route: "/api/actions/:id/handle",
    sleep: async (ms: number, signal: AbortSignal) => {
      expect(signal.aborted).toBe(false);
      sleeps.push(ms);
      nowMs += ms;
    } };
  return { initial, deps, store, calls, sleeps, controller, loopOptions,
    persisted: () => persisted,
    replacePersisted: (next: ActionRow) => { persisted = next; },
    recover: () => { observationResult = "ok"; outcomeResult = "ok"; },
    advance: (ms: number) => { nowMs += ms; } };
}

describe("durable receipt follow-through", () => {
  beforeEach(() => setSystemTime(new Date("2026-09-13T12:00:04.000Z")));
  afterEach(() => setSystemTime());

  test.each([
    { observation: "throws", success: true }, { observation: "null", success: true }, { observation: "missing", success: true },
    { observation: "throws", success: false }, { observation: "null", success: false }, { observation: "missing", success: false },
  ] as const)("unfinalized receipt retries nondurable $observation writes (success=$success)", async (scenario) => {
    const fixture = followFixture(scenario);
    const result = await followActionUntilSettled(fixture.initial, fixture.loopOptions);
    expect(fixture.calls).toEqual({ get: 4, receipt: 4, observation: scenario.observation === "missing" ? 0 : 4, outcome: 0, clear: 0 });
    expect(fixture.sleeps).toEqual([2_000, 3_000, 4_000, 5_000]);
    expect(fixture.persisted().observed_receipt_block_number).toBeNull();
    expect(result.observed_receipt_block_number).toBe("105");
    expect(result.outcome).toBeNull();
    const response = await presentAction(result, owner, scenario.success ? "confirmed" : "failed", new Date("2026-09-13T12:00:04.000Z"));
    expect(response.status).toBe(scenario.success ? "confirmed" : "failed");
    if (scenario.success) expect(response.settledBlockNumber).toBe("105");
    else expect(response).not.toHaveProperty("settledBlockNumber");
  });

  test.each([
    { observation: "throws", outcome: "throws" }, { observation: "null", outcome: "throws" },
    { observation: "throws", outcome: "null" }, { observation: "null", outcome: "null" },
    { observation: "missing", outcome: "throws" }, { observation: "missing", outcome: "null" },
  ] as const)("finalized receipt retries observation=$observation/outcome=$outcome", async (scenario) => {
    const fixture = followFixture({ ...scenario, finalized: true });
    const result = await followActionUntilSettled(fixture.initial, fixture.loopOptions);
    expect(fixture.calls.get).toBe(4);
    expect(fixture.calls.receipt).toBe(4);
    expect(fixture.calls.outcome).toBe(4);
    expect(result.outcome).toBeNull();
    expect(result.observed_receipt_block_number).toBe("105");
    expect(fixture.persisted().observed_receipt_block_number).toBeNull();
  });

  test.each(["throws", "null"] as const)("persisted observation stops after an outcome write %s", async (outcome) => {
    const fixture = followFixture({ finalized: true, outcome });
    const result = await followActionUntilSettled(fixture.initial, fixture.loopOptions);
    expect(fixture.calls).toEqual({ get: 1, receipt: 1, observation: 1, outcome: 1, clear: 0 });
    expect(fixture.sleeps).toEqual([]);
    expect(result).toEqual(fixture.persisted());
    expect(result.outcome).toBeNull();
    expect(result.observed_receipt_block_number).toBe("105");
  });

  test.each(["throws", "null", "missing"] as const)("durable outcome stops when the observation writer %s", async (observation) => {
    const fixture = followFixture({ finalized: true, observation });
    const result = await followActionUntilSettled(fixture.initial, fixture.loopOptions);
    expect(fixture.calls.get).toBe(1);
    expect(fixture.calls.receipt).toBe(1);
    expect(fixture.calls.outcome).toBe(1);
    expect(fixture.sleeps).toEqual([]);
    expect(result).toEqual(fixture.persisted());
    expect(result.outcome).toBe("succeeded");
    expect(result.observed_receipt_block_number).toBe("105");
  });

  test("a later retry persists both facts after transient write rejection", async () => {
    const fixture = followFixture({ finalized: true, observation: "throws", outcome: "throws" });
    const result = await followActionUntilSettled(fixture.initial, { ...fixture.loopOptions,
      sleep: async (ms) => { fixture.advance(ms); fixture.recover(); } });
    expect(fixture.calls).toEqual({ get: 2, receipt: 2, observation: 2, outcome: 2, clear: 0 });
    expect(result).toEqual(fixture.persisted());
    expect(result.outcome).toBe("succeeded");
  });

  test.each([true, false])("older durable proof cannot stop recovery of a new nondurable receipt (success=%s)", async (success) => {
    const fixture = followFixture({ observed: true, finalized: true, observation: "null", outcome: "throws", success });
    const older = { ...fixture.initial, observed_receipt_block_number: "100", observed_receipt_block_hash: `0x${"c".repeat(64)}` };
    fixture.replacePersisted(older);
    const result = await followActionUntilSettled(older, { ...fixture.loopOptions, sleep: async (ms) => {
      expect(fixture.persisted().observed_receipt_block_number).toBe("100");
      fixture.advance(ms);
      fixture.recover();
    } });
    expect(fixture.calls).toEqual({ get: 2, receipt: 2, observation: 2, outcome: 2, clear: 0 });
    expect(result.observed_receipt_block_number).toBe("105");
    expect(result.outcome).toBe(success ? "succeeded" : "reverted");
  });

  test("matching durable receipt avoids another observation write and stops despite outcome rejection", async () => {
    const fixture = followFixture({ observed: true, finalized: true, outcome: "throws" });
    const result = await followActionUntilSettled(fixture.initial, fixture.loopOptions);
    expect(fixture.calls).toEqual({ get: 1, receipt: 1, observation: 0, outcome: 1, clear: 0 });
    expect(result).toEqual(fixture.initial);
    expect(fixture.sleeps).toEqual([]);
  });

  test.each([false, true])("unreadable receipt retries only without retained durable proof (observed=%s)", async (observed) => {
    const fixture = followFixture({ observed });
    fixture.deps.readReceipt = async () => { fixture.calls.receipt += 1; throw new Error("Receipt unavailable"); };
    const result = await followActionUntilSettled(fixture.initial, fixture.loopOptions);
    expect(fixture.calls.get).toBe(observed ? 1 : 4);
    expect(fixture.calls.receipt).toBe(observed ? 1 : 4);
    expect(fixture.calls.observation).toBe(0);
    expect(result).toEqual(fixture.initial);
  });

  test.each(["pending", "unattributed"] as const)("%s receipts without proof stay unresolved and bounded", async (status) => {
    const fixture = followFixture();
    fixture.deps.readReceipt = async (): Promise<TransferReceiptStatus> => {
      fixture.calls.receipt += 1;
      return status === "pending" ? { status: "pending", transactionHash, finalizedBlockNumber: "104" }
        : { status: "confirmed", transactionHash, blockNumber: "105", blockHash: `0x${"b".repeat(64)}`,
          blockTimestamp: "2026-09-13T12:00:03.000Z", finalized: true, userOperations: [] };
    };
    const result = await followActionUntilSettled(fixture.initial, fixture.loopOptions);
    expect(fixture.calls).toEqual({ get: 4, receipt: 4, observation: 0, outcome: 0, clear: 0 });
    expect(result).toEqual(fixture.initial);
  });

  test("a pending receipt before finality retains durable proof and stops", async () => {
    const fixture = followFixture({ observed: true });
    fixture.deps.readReceipt = async () => ({ status: "pending", transactionHash, finalizedBlockNumber: "104" });
    const result = await followActionUntilSettled(fixture.initial, fixture.loopOptions);
    expect(result).toEqual(fixture.initial);
    expect(fixture.calls.get).toBe(1);
    expect(fixture.calls.clear).toBe(0);
    expect(fixture.sleeps).toEqual([]);
  });

  test.each(["ok", "throws", "null"] as const)("a verified receipt drop does not stop retry when clear=%s", async (clear) => {
    const fixture = followFixture({ observed: true });
    fixture.deps.readReceipt = async () => ({ status: "pending", transactionHash, finalizedBlockNumber: "105" });
    if (clear !== "ok") fixture.store.clearReceiptObservation = async () => {
      fixture.calls.clear += 1;
      if (clear === "throws") throw new Error("Clear unavailable");
      return null;
    };
    const result = await followActionUntilSettled(fixture.initial, fixture.loopOptions);
    expect(fixture.calls.get).toBe(4);
    expect(fixture.calls.clear).toBe(clear === "ok" ? 1 : 4);
    expect(result.observed_receipt_block_number).toBeNull();
    expect(fixture.persisted().observed_receipt_block_number).toBe(clear === "ok" ? null : "105");
  });

  test("abort after a fresh receipt returns proof without another attempt", async () => {
    const fixture = followFixture({ observation: "throws" });
    const reader = fixture.deps.readReceipt;
    if (!reader) throw new Error("Expected the fixture receipt reader");
    fixture.deps.readReceipt = async (hash, signal) => {
      const receipt = await reader(hash, signal);
      fixture.controller.abort(new DOMException("Timed out", "TimeoutError"));
      return receipt;
    };
    const result = await followActionUntilSettled(fixture.initial, fixture.loopOptions);
    expect(fixture.calls.get).toBe(1);
    expect(result.observed_receipt_block_number).toBe("105");
    expect(fixture.persisted().observed_receipt_block_number).toBeNull();
    expect(fixture.sleeps).toEqual([]);
  });

  test("a receipt read cut short by abort retains no invented proof", async () => {
    const fixture = followFixture();
    fixture.deps.readReceipt = async () => {
      fixture.controller.abort();
      throw new DOMException("Aborted", "AbortError");
    };
    const result = await followActionUntilSettled(fixture.initial, fixture.loopOptions);
    expect(fixture.calls.get).toBe(1);
    expect(result).toEqual(fixture.initial);
    expect(fixture.calls.observation).toBe(0);
    expect(fixture.sleeps).toEqual([]);
  });

  test("a foreign owner returned by the owner-scoped read never reaches a receipt writer", async () => {
    const fixture = followFixture();
    const foreign = { ...fixture.initial, owner_key: actionOwnerKey({ ...owner, subject: "subject-b" }) };
    fixture.replacePersisted(foreign);
    const result = await followAction(fixture.initial, fixture.loopOptions);
    expect(result).toEqual(foreign);
    expect(fixture.calls).toEqual({ get: 1, receipt: 0, observation: 0, outcome: 0, clear: 0 });
  });

  test.each(["settled", "aborted", "unconfirmed"] as const)("%s rows do not call the store or chain", async (state) => {
    const fixture = followFixture();
    if (state === "aborted") fixture.controller.abort();
    const initial: ActionRow = { ...fixture.initial,
      ...(state === "settled" ? { outcome: "succeeded" as const } : {}),
      ...(state === "unconfirmed" ? { confirmed_at: null } : {}) };
    const result = await followAction(initial, fixture.loopOptions);
    expect(result).toEqual(initial);
    expect(fixture.calls).toEqual({ get: 0, receipt: 0, observation: 0, outcome: 0, clear: 0 });
  });

  test("the settled projection distinguishes fresh API proof from persisted proof", async () => {
    const fixture = followFixture({ finalized: true, observation: "throws", outcome: "null" });
    const result = await settleRow(fixture.initial, owner, fixture.store, fixture.deps.readReceipt,
      fixture.controller.signal, "/api/actions");
    expect(result.receipt).toBe("confirmed");
    expect(result.receiptPersisted).toBe(false);
    expect(result.row.observed_receipt_block_number).toBe("105");
    const response = await presentAction(result.row, owner, result.receipt, new Date("2026-09-13T12:00:04.000Z"));
    expect(response.settledBlockNumber).toBe("105");
    expect(response).not.toHaveProperty("receiptPersisted");
    expect(fixture.persisted().observed_receipt_block_number).toBeNull();
  });
});
