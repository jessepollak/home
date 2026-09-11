import { describe, expect, test } from "bun:test";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import {
  ProviderHandleJournal,
  type ProviderHandleJournalLock,
  type ProviderHandleJournalStorage,
} from "@/client/money-actions/provider-handle-journal";
import { recoverJournaledProviderHandle } from "@/client/money-actions/provider-handle-recovery";
import type { MoneyActionApiFetch } from "@/client/money-actions/client";
import {
  createMoneyActionReadHandler,
  createMoneyActionSubmissionHandler,
} from "@/server/money-actions/handlers";
import { MemoryMoneyActionStore } from "@/server/money-actions/store";

class MemoryStorage implements ProviderHandleJournalStorage {
  readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

class TestJournalLock implements ProviderHandleJournalLock {
  private tail = Promise.resolve();

  async withLock<T>(task: () => T | Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}

const OWNER = {
  subject: "subject-a",
  address: "0x1111111111111111111111111111111111111111",
  chainId: 8453,
  accountProvider: "cdp-embedded",
} as const;
const ACTION_ID = "123e4567-e89b-42d3-a456-426614174001";
const USER_OPERATION_HASH = `0x${"b".repeat(64)}` as const;
const OTHER_USER_OPERATION_HASH = `0x${"c".repeat(64)}` as const;

function action(): PreparedMoneyAction {
  return {
    id: ACTION_ID,
    reviewHash: "a".repeat(64),
    owner: OWNER,
    kind: "send",
    title: "Send USDC",
    calls: [{ to: "0x2222222222222222222222222222222222222222", data: "0x1234", value: "0" }],
    amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" }],
    warnings: [],
    createdAt: "2026-09-10T10:00:00.000Z",
    expiresAt: "2026-09-10T10:10:00.000Z",
  };
}

function makeJournal(
  storage: ProviderHandleJournalStorage,
  entryId: string,
  lock: ProviderHandleJournalLock = new TestJournalLock(),
) {
  return new ProviderHandleJournal({
    storage,
    lock,
    randomUUID: () => entryId,
    now: () => new Date("2026-09-10T10:01:01.000Z"),
  });
}

async function captureAndPersist(
  journal: ProviderHandleJournal,
  prepared: PreparedMoneyAction,
  handle: Parameters<ProviderHandleJournal["retain"]>[1],
) {
  const captured = journal.retain(prepared, handle);
  if (!captured.entry) return captured;
  return journal.persist(captured.entry);
}

async function claimedStore() {
  const store = new MemoryMoneyActionStore();
  await store.issue(action());
  await store.claim(OWNER, ACTION_ID, action().reviewHash, "2026-09-10T10:01:00.000Z");
  return store;
}

function handlerFetch(
  store: MemoryMoneyActionStore,
  options: {
    beforePost?: () => void | Promise<void>;
    afterCommittedPost?: () => never;
    forceConflictAfterRecording?: boolean;
  } = {},
): { fetchApi: MoneyActionApiFetch; counts: { reads: number; posts: number } } {
  const authorize = async () => Response.json({
    user: { subject: OWNER.subject },
    smartAccount: { address: OWNER.address, chainId: 8453 },
    accountProvider: OWNER.accountProvider,
  });
  const read = createMoneyActionReadHandler({
    authorize,
    store,
    now: () => new Date("2026-09-10T10:02:00.000Z"),
    readReceipt: async (_hash) => ({ status: "pending", transactionHash: _hash }),
  });
  const submit = createMoneyActionSubmissionHandler({
    authorize,
    store,
    now: () => new Date("2026-09-10T10:02:00.000Z"),
    readReceipt: async (_hash) => ({ status: "pending", transactionHash: _hash }),
  });
  const counts = { reads: 0, posts: 0 };
  const context = { params: Promise.resolve({ id: ACTION_ID }) };
  const fetchApi: MoneyActionApiFetch = async (path, init = {}) => {
    let response: Response;
    if (init.method === "POST") {
      counts.posts += 1;
      await options.beforePost?.();
      response = await submit(new Request(`https://home.example${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Home-Account-Provider": OWNER.accountProvider },
        body: init.body,
      }), context);
      if (response.ok && options.afterCommittedPost) options.afterCommittedPost();
      if (response.ok && options.forceConflictAfterRecording) {
        throw Object.assign(new Error("bounded conflict"), { status: 409 });
      }
    } else {
      counts.reads += 1;
      response = await read(new Request(`https://home.example${path}`, {
        headers: { "X-Home-Account-Provider": OWNER.accountProvider },
      }), context);
    }
    if (!response.ok) throw Object.assign(new Error("request failed"), { status: response.status });
    return response.json();
  };
  return { fetchApi, counts };
}

describe("provider handle journal recovery", () => {
  test("acknowledges committed evidence after a lost POST response using one owner-fenced GET and no replay", async () => {
    const store = await claimedStore();
    const storage = new MemoryStorage();
    const first = makeJournal(storage, "123e4567-e89b-42d3-a456-426614174091");
    await captureAndPersist(first, action(), { kind: "user-operation-hash", provider: "cdp-embedded", value: USER_OPERATION_HASH });
    const lost = handlerFetch(store, {
      afterCommittedPost: () => { throw new Error("response lost"); },
    });
    const initial = (await store.get(OWNER, ACTION_ID))!;
    const firstResult = await recoverJournaledProviderHandle({
      fetchApi: lost.fetchApi,
      journal: first,
      action: action(),
      operation: initial,
      assertActive: () => {},
    });
    expect(firstResult.kind).toBe("retained");
    expect((await store.get(OWNER, ACTION_ID))?.userOperationHash).toBe(USER_OPERATION_HASH);
    expect(storage.length).toBe(1);

    const afterReload = makeJournal(storage, "123e4567-e89b-42d3-a456-426614174092");
    const recovered = handlerFetch(store);
    const secondResult = await recoverJournaledProviderHandle({
      fetchApi: recovered.fetchApi,
      journal: afterReload,
      action: action(),
      assertActive: () => {},
    });
    expect(secondResult).toMatchObject({ kind: "acknowledged", operation: { userOperationHash: USER_OPERATION_HASH } });
    expect(recovered.counts).toEqual({ reads: 1, posts: 0 });
    expect(storage.length).toBe(0);
  });

  test("handles terminalization between GET and POST by attaching evidence without reopening terminal state", async () => {
    const store = await claimedStore();
    const storage = new MemoryStorage();
    const journal = makeJournal(storage, "123e4567-e89b-42d3-a456-426614174093");
    await captureAndPersist(journal, action(), { kind: "user-operation-hash", provider: "cdp-embedded", value: USER_OPERATION_HASH });
    const transport = handlerFetch(store, {
      beforePost: async () => {
        await store.updateStatus(OWNER, ACTION_ID, "failed", "2026-09-10T10:01:30.000Z", {
          expectedSourceStatus: "submitting",
          requireNoSubmissionReference: true,
        });
      },
    });
    const result = await recoverJournaledProviderHandle({
      fetchApi: transport.fetchApi,
      journal,
      action: action(),
      operation: (await store.get(OWNER, ACTION_ID))!,
      assertActive: () => {},
    });
    expect(result).toMatchObject({
      kind: "acknowledged",
      operation: { status: "failed", userOperationHash: USER_OPERATION_HASH },
    });
    expect(transport.counts.posts).toBe(1);
    expect(storage.length).toBe(0);
  });

  test("on a bounded 409 re-reads once and acknowledges only the exact durable evidence", async () => {
    const store = await claimedStore();
    const storage = new MemoryStorage();
    const journal = makeJournal(storage, "123e4567-e89b-42d3-a456-426614174094");
    await captureAndPersist(journal, action(), { kind: "user-operation-hash", provider: "cdp-embedded", value: USER_OPERATION_HASH });
    const transport = handlerFetch(store, { forceConflictAfterRecording: true });
    const result = await recoverJournaledProviderHandle({
      fetchApi: transport.fetchApi,
      journal,
      action: action(),
      operation: (await store.get(OWNER, ACTION_ID))!,
      assertActive: () => {},
    });
    expect(result.kind).toBe("acknowledged");
    expect(transport.counts).toEqual({ reads: 1, posts: 1 });
    expect(storage.length).toBe(0);
  });

  test("treats prepared POST and 409 re-read acknowledgments as inconsistencies before exact evidence cleanup", async () => {
    const currentStore = await claimedStore();
    const initial = (await currentStore.get(OWNER, ACTION_ID))!;
    const preparedStore = new MemoryMoneyActionStore();
    await preparedStore.issue(action());
    const preparedExact = {
      ...(await preparedStore.get(OWNER, ACTION_ID))!,
      userOperationHash: USER_OPERATION_HASH,
    };

    for (const mode of ["direct", "conflict-reread"] as const) {
      const storage = new MemoryStorage();
      const journal = makeJournal(storage, crypto.randomUUID());
      await captureAndPersist(journal, action(), { kind: "user-operation-hash", provider: "cdp-embedded", value: USER_OPERATION_HASH });
      let posts = 0;
      let reads = 0;
      const result = await recoverJournaledProviderHandle({
        fetchApi: async (_path, init) => {
          if (init?.method === "POST") {
            posts += 1;
            if (mode === "conflict-reread") {
              throw Object.assign(new Error("bounded conflict"), { status: 409 });
            }
          } else {
            reads += 1;
          }
          return { operation: preparedExact };
        },
        journal,
        action: action(),
        operation: initial,
        assertActive: () => {},
      });
      expect(result).toMatchObject({ kind: "inconsistent", operation: { status: "prepared" } });
      expect(posts).toBe(1);
      expect(reads).toBe(mode === "conflict-reread" ? 1 : 0);
      expect(storage.length).toBe(1);
    }
  });

  test("detects same-owner/action binding mismatches before exact filtering and retains them across memory reset", async () => {
    const initial = (await (await claimedStore()).get(OWNER, ACTION_ID))!;
    const mismatches: PreparedMoneyAction[] = [
      { ...action(), reviewHash: "d".repeat(64) },
      { ...action(), kind: "save-deposit" },
      { ...action(), owner: { ...OWNER, accountProvider: "base-account" } },
    ];
    for (const mismatched of mismatches) {
      const storage = new MemoryStorage();
      const stale = makeJournal(storage, crypto.randomUUID());
      const retained = mismatched.owner.accountProvider === "base-account"
        ? stale.retain(mismatched, { kind: "submission-id", provider: "base-account", value: "stale-bundle" })
        : stale.retain(mismatched, { kind: "user-operation-hash", provider: "cdp-embedded", value: USER_OPERATION_HASH });
      expect(retained.retained).toBe(true);
      expect((await stale.persist(retained.entry!)).persisted).toBe(true);

      const afterReset = makeJournal(storage, crypto.randomUUID());
      let posts = 0;
      const result = await recoverJournaledProviderHandle({
        fetchApi: async (_path, init) => {
          if (init?.method === "POST") posts += 1;
          return { operation: initial };
        },
        journal: afterReset,
        action: action(),
        operation: initial,
        assertActive: () => {},
      });
      expect(result.kind).toBe("conflict");
      expect(result.issues).toContain("binding-conflict");
      expect(posts).toBe(0);
      expect(storage.length).toBe(1);
    }
  });

  test("prepared inconsistency and actual evidence conflict retain the exact entry and never POST", async () => {
    const preparedStore = new MemoryMoneyActionStore();
    await preparedStore.issue(action());
    const storage = new MemoryStorage();
    const journal = makeJournal(storage, "123e4567-e89b-42d3-a456-426614174095");
    await captureAndPersist(journal, action(), { kind: "user-operation-hash", provider: "cdp-embedded", value: USER_OPERATION_HASH });
    const preparedTransport = handlerFetch(preparedStore);
    const prepared = await recoverJournaledProviderHandle({
      fetchApi: preparedTransport.fetchApi,
      journal,
      action: action(),
      operation: (await preparedStore.get(OWNER, ACTION_ID))!,
      assertActive: () => {},
    });
    expect(prepared.kind).toBe("inconsistent");
    expect(preparedTransport.counts.posts).toBe(0);

    const conflictStore = await claimedStore();
    await conflictStore.recordSubmission(OWNER, ACTION_ID, { userOperationHash: OTHER_USER_OPERATION_HASH }, "2026-09-10T10:01:10.000Z");
    const conflictTransport = handlerFetch(conflictStore);
    const conflict = await recoverJournaledProviderHandle({
      fetchApi: conflictTransport.fetchApi,
      journal,
      action: action(),
      operation: (await conflictStore.get(OWNER, ACTION_ID))!,
      assertActive: () => {},
    });
    expect(conflict.kind).toBe("conflict");
    expect(conflictTransport.counts.posts).toBe(0);
    expect(storage.length).toBe(1);
  });

  test("malformed or mismatching acknowledgments retain evidence and stop before provider recovery", async () => {
    const currentStore = await claimedStore();
    const initial = (await currentStore.get(OWNER, ACTION_ID))!;
    for (const response of [
      { operation: { nope: true } },
      { operation: { ...initial, action: { ...action(), reviewHash: "d".repeat(64) } } },
    ]) {
      const storage = new MemoryStorage();
      const journal = makeJournal(storage, crypto.randomUUID());
      await captureAndPersist(journal, action(), { kind: "user-operation-hash", provider: "cdp-embedded", value: USER_OPERATION_HASH });
      let posts = 0;
      const result = await recoverJournaledProviderHandle({
        fetchApi: async (_path, init) => {
          if (init?.method === "POST") posts += 1;
          return response;
        },
        journal,
        action: action(),
        operation: initial,
        assertActive: () => {},
      });
      expect(result.kind).toBe("retained");
      expect(posts).toBe(1);
      expect(storage.length).toBe(1);
    }
  });
});
