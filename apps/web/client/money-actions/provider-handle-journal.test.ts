import { describe, expect, test } from "bun:test";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import {
  PROVIDER_HANDLE_JOURNAL_KEY_PREFIX,
  ProviderHandleJournal,
  parseProviderHandleJournalEntry,
  type ProviderHandleJournalLock,
  type ProviderHandleJournalStorage,
} from "./provider-handle-journal";

class MemoryStorage implements ProviderHandleJournalStorage {
  protected readonly values = new Map<string, string>();
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
  accountProvider: "base-account",
} as const;
const ACTION_ID = "123e4567-e89b-42d3-a456-426614174001";
const ENTRY_ID = "123e4567-e89b-42d3-a456-426614174099";

function action(overrides: Partial<PreparedMoneyAction> = {}): PreparedMoneyAction {
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
    ...overrides,
  };
}

function journal(
  storage: ProviderHandleJournalStorage | null,
  entryId = ENTRY_ID,
  lock: ProviderHandleJournalLock | null = new TestJournalLock(),
) {
  return new ProviderHandleJournal({
    storage,
    lock,
    randomUUID: () => entryId,
    now: () => new Date("2026-09-10T10:01:00.000Z"),
  });
}

async function captureAndPersist(
  instance: ProviderHandleJournal,
  prepared: PreparedMoneyAction,
  handle: Parameters<ProviderHandleJournal["retain"]>[1],
) {
  const captured = instance.retain(prepared, handle);
  if (!captured.entry) return captured;
  return instance.persist(captured.entry);
}

describe("provider handle journal", () => {
  test("strictly stores only versioned owner/action/provider/handle metadata under an immutable entry key", async () => {
    const storage = new MemoryStorage();
    const instance = journal(storage);
    const result = await captureAndPersist(instance, action(), {
      kind: "submission-id",
      provider: "base-account",
      value: "0xMiXeD-Base-Handle",
    });

    expect(result).toMatchObject({ retained: true, persisted: true });
    expect(storage.length).toBe(1);
    const key = storage.key(0)!;
    expect(key).toBe(`${PROVIDER_HANDLE_JOURNAL_KEY_PREFIX}${ENTRY_ID}`);
    const raw = storage.getItem(key)!;
    expect(raw).not.toContain("1000000");
    expect(raw).not.toContain("0x1234");
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual([
      "actionId", "actionKind", "capturedAt", "entryId", "handle", "owner", "provider", "reviewHash", "version",
    ]);
    expect(parseProviderHandleJournalEntry(raw, key)?.handle.value).toBe("0xMiXeD-Base-Handle");
  });

  test("stores a matching CDP user-operation handle with canonical hash binding", async () => {
    const storage = new MemoryStorage();
    const embeddedAction = action({
      owner: { ...OWNER, accountProvider: "cdp-embedded" },
    });
    const userOperationHash = `0x${"b".repeat(64)}` as const;
    const result = await captureAndPersist(journal(storage), embeddedAction, {
      kind: "user-operation-hash",
      provider: "cdp-embedded",
      value: userOperationHash,
    });
    expect(result).toMatchObject({
      retained: true,
      persisted: true,
      entry: {
        actionId: embeddedAction.id,
        provider: "cdp-embedded",
        handle: { kind: "user-operation-hash", value: userOperationHash },
      },
    });
  });

  test("survives a true memory reset and is shared by two journal instances", async () => {
    const storage = new MemoryStorage();
    const lock = new TestJournalLock();
    const first = journal(storage, ENTRY_ID, lock);
    const retained = await captureAndPersist(first, action(), {
      kind: "submission-id",
      provider: "base-account",
      value: "CaseSensitiveID",
    });
    expect(retained.retained).toBe(true);

    const second = journal(storage, "123e4567-e89b-42d3-a456-426614174098", lock);
    expect(second.entriesForAction(action())).toHaveLength(1);
    expect(second.entriesForAction(action())[0]?.handle.value).toBe("CaseSensitiveID");
    expect(second.retain(action(), {
      kind: "submission-id",
      provider: "base-account",
      value: "CaseSensitiveID",
    })).toMatchObject({ retained: true, persisted: true });
    expect(storage.length).toBe(1);
  });

  test("retains across owner switches but never rebinds an entry", () => {
    const instance = journal(new MemoryStorage());
    instance.retain(action(), { kind: "submission-id", provider: "base-account", value: "bundle-A" });
    const other = action({
      owner: {
        ...OWNER,
        subject: "subject-b",
        address: "0x2222222222222222222222222222222222222222",
      },
    });
    expect(instance.entriesForAction(other)).toEqual([]);
    expect(instance.entriesForAction(action())).toHaveLength(1);
  });

  test("keeps the synchronous memory copy when persistence is unavailable or over quota", async () => {
    class QuotaStorage extends MemoryStorage {
      override setItem() { throw new DOMException("quota", "QuotaExceededError"); }
    }
    const instance = journal(new QuotaStorage());
    const captured = instance.retain(action(), {
      kind: "submission-id",
      provider: "base-account",
      value: "bundle-A",
    });
    expect(captured).toMatchObject({ retained: true, persisted: false });
    expect(instance.entriesForAction(action())).toHaveLength(1);
    const result = await instance.persist(captured.entry!);
    expect(result).toMatchObject({ retained: true, persisted: false });
    expect(result.issues).toContain("storage-write-failed");
    expect(instance.entriesForAction(action())).toHaveLength(1);
  });

  test("failed exact deletion remains observable and retains the entry for a later cleanup retry", async () => {
    class DeleteFailureStorage extends MemoryStorage {
      fail = true;
      override removeItem(key: string) {
        if (this.fail) throw new Error("blocked");
        super.removeItem(key);
      }
    }
    const storage = new DeleteFailureStorage();
    const instance = journal(storage);
    const captured = instance.retain(action(), {
      kind: "submission-id",
      provider: "base-account",
      value: "bundle-A",
    });
    await instance.persist(captured.entry!);
    const entry = captured.entry!;
    expect(instance.acknowledge(entry)).toEqual({ acknowledged: false, issues: ["storage-delete-failed"] });
    expect(instance.entriesForAction(action())).toHaveLength(1);
    storage.fail = false;
    expect(instance.acknowledge(entry)).toEqual({ acknowledged: true, issues: [] });
    expect(instance.entriesForAction(action())).toEqual([]);
  });

  test("does not delete a storage record that no longer exactly matches the acknowledged entry", async () => {
    const storage = new MemoryStorage();
    const instance = journal(storage);
    const captured = instance.retain(action(), {
      kind: "submission-id",
      provider: "base-account",
      value: "bundle-A",
    });
    await instance.persist(captured.entry!);
    const entry = captured.entry!;
    const key = storage.key(0)!;
    storage.setItem(key, JSON.stringify({ ...entry, reviewHash: "b".repeat(64) }));
    expect(instance.inspect().issues).toContain("storage-corrupt");
    expect(instance.acknowledge(entry)).toEqual({ acknowledged: false, issues: ["storage-corrupt"] });
    expect(storage.getItem(key)).not.toBeNull();
  });

  test("reports corruption and capacity instead of silently evicting valid unacknowledged entries", async () => {
    const storage = new MemoryStorage();
    storage.setItem(`${PROVIDER_HANDLE_JOURNAL_KEY_PREFIX}123e4567-e89b-42d3-a456-426614174097`, "{not-json");
    const first = new ProviderHandleJournal({
      storage,
      lock: new TestJournalLock(),
      maxEntries: 1,
      randomUUID: () => ENTRY_ID,
      now: () => new Date("2026-09-10T10:01:00.000Z"),
    });
    const retained = first.retain(action(), {
      kind: "submission-id",
      provider: "base-account",
      value: "bundle-A",
    });
    expect(retained).toMatchObject({ retained: true, persisted: false });
    expect(retained.issues).toContain("storage-corrupt");
    const persisted = await first.persist(retained.entry!);
    expect(persisted.issues).toContain("storage-corrupt");
    expect(persisted.issues).toContain("capacity-exceeded");

    const nextAction = action({ id: "123e4567-e89b-42d3-a456-426614174002" });
    const next = first.retain(nextAction, {
      kind: "submission-id",
      provider: "base-account",
      value: "bundle-B",
    });
    const nextPersistence = await first.persist(next.entry!);
    expect(nextPersistence).toMatchObject({ retained: true, persisted: false });
    expect(nextPersistence.issues).toContain("capacity-exceeded");
    expect(first.entriesForAction(action())[0]?.handle.value).toBe("bundle-A");
    expect(first.entriesForAction(nextAction)[0]?.handle.value).toBe("bundle-B");
    expect(storage.length).toBe(1);

    const sizeStorage = new MemoryStorage();
    const sizeBounded = new ProviderHandleJournal({
      storage: sizeStorage,
      lock: new TestJournalLock(),
      maxTotalBytes: 128,
      randomUUID: () => "123e4567-e89b-42d3-a456-426614174096",
    });
    const sizeCapture = sizeBounded.retain(action(), {
      kind: "submission-id",
      provider: "base-account",
      value: "bundle-C",
    });
    expect(await sizeBounded.persist(sizeCapture.entry!)).toMatchObject({
      retained: true,
      persisted: false,
      issues: ["capacity-exceeded"],
    });
    expect(sizeBounded.entriesForAction(action())).toHaveLength(1);
    expect(sizeStorage.length).toBe(0);
  });

  test("atomically bounds overlapping two-instance persistence after the same 31-entry snapshot", async () => {
    const storage = new MemoryStorage();
    const lock = new TestJournalLock();
    const filler = new ProviderHandleJournal({ storage, lock });
    for (let index = 0; index < 31; index += 1) {
      const fillerAction = action({
        id: `223e4567-e89b-42d3-a456-${String(index).padStart(12, "0")}`,
      });
      const captured = filler.retain(fillerAction, {
        kind: "submission-id",
        provider: "base-account",
        value: `bundle-${index}`,
      });
      expect((await filler.persist(captured.entry!)).persisted).toBe(true);
    }

    const first = new ProviderHandleJournal({
      storage,
      lock,
      randomUUID: () => "123e4567-e89b-42d3-a456-426614174094",
    });
    const second = new ProviderHandleJournal({
      storage,
      lock,
      randomUUID: () => "123e4567-e89b-42d3-a456-426614174095",
    });
    expect(first.canRetain()).toBe(true);
    expect(second.canRetain()).toBe(true);
    const firstAction = action({ id: "323e4567-e89b-42d3-a456-426614174001" });
    const secondAction = action({ id: "423e4567-e89b-42d3-a456-426614174001" });
    const firstCapture = first.retain(firstAction, {
      kind: "submission-id",
      provider: "base-account",
      value: "bundle-A",
    });
    const secondCapture = second.retain(secondAction, {
      kind: "submission-id",
      provider: "base-account",
      value: "bundle-B",
    });

    const results = await Promise.all([
      first.persist(firstCapture.entry!),
      second.persist(secondCapture.entry!),
    ]);
    expect(results.filter((result) => result.persisted)).toHaveLength(1);
    expect(results.filter((result) => result.issues.includes("capacity-exceeded"))).toHaveLength(1);
    expect(first.entriesForAction(firstAction)).toHaveLength(1);
    expect(second.entriesForAction(secondAction)).toHaveLength(1);
    expect(storage.length).toBe(32);
  });

  test("keeps evidence memory-only when persistent storage has no safe cross-tab lock", async () => {
    const storage = new MemoryStorage();
    const instance = journal(storage, ENTRY_ID, null);
    const captured = instance.retain(action(), {
      kind: "submission-id",
      provider: "base-account",
      value: "bundle-A",
    });
    expect(await instance.persist(captured.entry!)).toMatchObject({
      retained: true,
      persisted: false,
      issues: ["lock-unavailable"],
    });
    expect(instance.entriesForAction(action())).toHaveLength(1);
    expect(storage.length).toBe(0);
  });

  test("rejects schema additions, provider mismatches, noncanonical hashes, and oversized opaque handles", () => {
    const instance = journal(new MemoryStorage());
    expect(instance.retain(action(), {
      kind: "user-operation-hash",
      provider: "cdp-embedded",
      value: `0x${"a".repeat(64)}`,
    })).toMatchObject({ retained: false, issues: ["invalid-entry"] });
    expect(instance.retain(action(), {
      kind: "submission-id",
      provider: "base-account",
      value: "x".repeat(513),
    })).toMatchObject({ retained: false, issues: ["invalid-entry"] });

    const valid = journal(new MemoryStorage()).retain(action(), {
      kind: "submission-id",
      provider: "base-account",
      value: "bundle-A",
    }).entry!;
    expect(parseProviderHandleJournalEntry(JSON.stringify({ ...valid, payload: "forbidden" }))).toBeNull();
  });
});
