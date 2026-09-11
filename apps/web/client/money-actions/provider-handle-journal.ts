import type { ProviderHandle } from "@/server/money-actions/attempt-commands";
import type { MoneyActionKind, MoneyActionOwner, PreparedMoneyAction } from "./types";

export const PROVIDER_HANDLE_JOURNAL_VERSION = 1 as const;
export const PROVIDER_HANDLE_JOURNAL_KEY_PREFIX = "home:money-action-provider-handle:v1:";
const PROVIDER_HANDLE_JOURNAL_LOCK_NAME = "home:money-action-provider-handle:v1:persist";

const DEFAULT_MAX_ENTRIES = 32;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024;
const MAX_ENTRY_BYTES = 4 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reviewHashPattern = /^[0-9a-f]{64}$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const hashPattern = /^0x[0-9a-f]{64}$/;
const submissionIdPattern = /^[\x21-\x7e]{1,512}$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const actionKinds = new Set<MoneyActionKind>([
  "send",
  "save-deposit",
  "save-withdraw",
  "swap",
  "supply-collateral",
  "borrow",
  "repay",
  "withdraw-collateral",
]);

export type ProviderHandleJournalStorage = {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type ProviderHandleJournalLock = {
  withLock<T>(task: () => T | Promise<T>): Promise<T>;
};

export type ProviderHandleJournalEntry = {
  version: typeof PROVIDER_HANDLE_JOURNAL_VERSION;
  entryId: string;
  actionId: string;
  reviewHash: string;
  actionKind: MoneyActionKind;
  owner: MoneyActionOwner;
  provider: MoneyActionOwner["accountProvider"];
  handle: ProviderHandle;
  capturedAt: string;
};

export type ProviderHandleJournalIssue =
  | "storage-unavailable"
  | "storage-corrupt"
  | "storage-write-failed"
  | "storage-delete-failed"
  | "capacity-exceeded"
  | "lock-unavailable"
  | "lock-failed"
  | "binding-conflict"
  | "invalid-entry";

export type ProviderHandleJournalSnapshot = {
  entries: ProviderHandleJournalEntry[];
  issues: ProviderHandleJournalIssue[];
  totalBytes: number;
  persistentEntries: number;
  persistentBytes: number;
};

export type ProviderHandleJournalRetainResult = {
  retained: boolean;
  persisted: boolean;
  entry?: ProviderHandleJournalEntry;
  issues: ProviderHandleJournalIssue[];
};

export type ProviderHandleJournalAcknowledgeResult = {
  acknowledged: boolean;
  issues: ProviderHandleJournalIssue[];
};

export class ProviderHandleJournal {
  private readonly memory = new Map<string, { entry: ProviderHandleJournalEntry; raw: string }>();
  private readonly storage: ProviderHandleJournalStorage | null;
  private readonly lock: ProviderHandleJournalLock | null;
  private readonly now: () => Date;
  private readonly randomUUID: () => string;
  private readonly maxEntries: number;
  private readonly maxTotalBytes: number;

  constructor(options: {
    storage?: ProviderHandleJournalStorage | null;
    lock?: ProviderHandleJournalLock | null;
    now?: () => Date;
    randomUUID?: () => string;
    maxEntries?: number;
    maxTotalBytes?: number;
  } = {}) {
    this.storage = options.storage === undefined ? browserStorage() : options.storage;
    this.lock = options.lock === undefined ? browserLock() : options.lock;
    this.now = options.now ?? (() => new Date());
    this.randomUUID = options.randomUUID ?? (() => crypto.randomUUID());
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  }

  inspect(): ProviderHandleJournalSnapshot {
    const issues: ProviderHandleJournalIssue[] = [];
    const entries = new Map<string, ProviderHandleJournalEntry>();
    let totalBytes = 0;
    let persistentEntries = 0;
    let persistentBytes = 0;

    for (const [key, value] of this.memory) {
      entries.set(key, structuredClone(value.entry));
      totalBytes += byteLength(key) + byteLength(value.raw);
    }

    if (this.storage) {
      try {
        for (let index = 0; index < this.storage.length; index += 1) {
          const key = this.storage.key(index);
          if (!key?.startsWith(PROVIDER_HANDLE_JOURNAL_KEY_PREFIX)) continue;
          const raw = this.storage.getItem(key);
          if (raw === null) continue;
          persistentEntries += 1;
          persistentBytes += byteLength(key) + byteLength(raw);
          const memoryEntry = this.memory.get(key);
          if (memoryEntry) {
            if (memoryEntry.raw !== raw) addIssue(issues, "storage-corrupt");
            continue;
          }
          totalBytes += byteLength(key) + byteLength(raw);
          const parsed = parseProviderHandleJournalEntry(raw, key);
          if (!parsed) {
            addIssue(issues, "storage-corrupt");
            continue;
          }
          entries.set(key, parsed);
        }
      } catch {
        addIssue(issues, "storage-unavailable");
      }
    }

    return {
      entries: [...entries.values()].sort((left, right) => left.capturedAt.localeCompare(right.capturedAt)),
      issues,
      totalBytes,
      persistentEntries,
      persistentBytes,
    };
  }

  canRetain(): boolean {
    const snapshot = this.inspect();
    return snapshot.entries.length < this.maxEntries &&
      snapshot.persistentEntries < this.maxEntries &&
      snapshot.totalBytes + MAX_ENTRY_BYTES <= this.maxTotalBytes;
  }

  entriesForAction(action: PreparedMoneyAction): ProviderHandleJournalEntry[] {
    return this.inspect().entries.filter((entry) => providerHandleJournalEntryMatchesAction(entry, action));
  }

  retain(action: PreparedMoneyAction, handle: ProviderHandle): ProviderHandleJournalRetainResult {
    if (!validBinding(action, handle)) {
      return { retained: false, persisted: false, issues: ["invalid-entry"] };
    }

    const snapshot = this.inspect();
    const duplicate = snapshot.entries.find((entry) =>
      providerHandleJournalEntryMatchesAction(entry, action) && sameProviderHandle(entry.handle, handle)
    );
    if (duplicate) {
      const key = storageKey(duplicate.entryId);
      const raw = JSON.stringify(duplicate);
      this.memory.set(key, { entry: structuredClone(duplicate), raw });
      return {
        retained: true,
        persisted: this.isPersisted(key),
        entry: duplicate,
        issues: snapshot.issues,
      };
    }

    let entry: ProviderHandleJournalEntry = {
      version: PROVIDER_HANDLE_JOURNAL_VERSION,
      entryId: this.randomUUID(),
      actionId: action.id,
      reviewHash: action.reviewHash,
      actionKind: action.kind,
      owner: structuredClone(action.owner),
      provider: action.owner.accountProvider,
      handle: structuredClone(handle),
      capturedAt: this.now().toISOString(),
    };
    let key = storageKey(entry.entryId);
    if (this.memory.has(key) || snapshot.entries.some((candidate) => candidate.entryId === entry.entryId)) {
      entry = { ...entry, entryId: crypto.randomUUID() };
      key = storageKey(entry.entryId);
    }
    const raw = JSON.stringify(entry);
    if (
      !parseProviderHandleJournalEntry(raw, key) ||
      byteLength(raw) > MAX_ENTRY_BYTES
    ) {
      return { retained: false, persisted: false, issues: [...snapshot.issues, "invalid-entry"] };
    }

    // Synchronous memory capture is unconditional once a valid provider handle returns.
    // Persistence is a separate locked step so cross-tab capacity remains bounded.
    this.memory.set(key, { entry: structuredClone(entry), raw });
    return { retained: true, persisted: false, entry, issues: snapshot.issues };
  }

  async persist(entry: ProviderHandleJournalEntry): Promise<ProviderHandleJournalRetainResult> {
    const key = storageKey(entry.entryId);
    const held = this.memory.get(key);
    if (!held || !sameJournalEntry(held.entry, entry)) {
      return { retained: false, persisted: false, issues: ["invalid-entry"] };
    }
    if (!this.storage) {
      return { retained: true, persisted: false, entry, issues: [] };
    }
    if (!this.lock) {
      return { retained: true, persisted: false, entry, issues: ["lock-unavailable"] };
    }

    try {
      return await this.lock.withLock(() => {
        const snapshot = this.inspect();
        try {
          const existing = this.storage!.getItem(key);
          if (existing === held.raw) {
            return { retained: true, persisted: true, entry, issues: snapshot.issues };
          }
          if (existing !== null) {
            return {
              retained: true,
              persisted: false,
              entry,
              issues: [...snapshot.issues, "storage-write-failed"],
            };
          }
          if (
            snapshot.persistentEntries >= this.maxEntries ||
            snapshot.persistentBytes + byteLength(key) + byteLength(held.raw) > this.maxTotalBytes
          ) {
            return {
              retained: true,
              persisted: false,
              entry,
              issues: [...snapshot.issues, "capacity-exceeded"],
            };
          }
          this.storage!.setItem(key, held.raw);
          if (this.storage!.getItem(key) !== held.raw) {
            return {
              retained: true,
              persisted: false,
              entry,
              issues: [...snapshot.issues, "storage-write-failed"],
            };
          }
          return { retained: true, persisted: true, entry, issues: snapshot.issues };
        } catch {
          return {
            retained: true,
            persisted: false,
            entry,
            issues: [...snapshot.issues, "storage-write-failed"],
          };
        }
      });
    } catch {
      return { retained: true, persisted: false, entry, issues: ["lock-failed"] };
    }
  }

  acknowledge(entry: ProviderHandleJournalEntry): ProviderHandleJournalAcknowledgeResult {
    const key = storageKey(entry.entryId);
    const held = this.inspect().entries.find((candidate) => candidate.entryId === entry.entryId);
    if (!held || !sameJournalEntry(held, entry)) {
      return { acknowledged: false, issues: ["invalid-entry"] };
    }
    if (this.storage) {
      try {
        const stored = this.storage.getItem(key);
        if (stored !== null && stored !== JSON.stringify(entry)) {
          return { acknowledged: false, issues: ["storage-corrupt"] };
        }
        this.storage.removeItem(key);
        if (this.storage.getItem(key) !== null) {
          return { acknowledged: false, issues: ["storage-delete-failed"] };
        }
      } catch {
        return { acknowledged: false, issues: ["storage-delete-failed"] };
      }
    }
    this.memory.delete(key);
    return { acknowledged: true, issues: [] };
  }

  private isPersisted(key: string): boolean {
    if (!this.storage) return false;
    try {
      return this.storage.getItem(key) !== null;
    } catch {
      return false;
    }
  }
}

export function parseProviderHandleJournalEntry(
  raw: string,
  key?: string,
): ProviderHandleJournalEntry | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || !hasExactKeys(value, [
    "version",
    "entryId",
    "actionId",
    "reviewHash",
    "actionKind",
    "owner",
    "provider",
    "handle",
    "capturedAt",
  ])) return null;
  if (
    value.version !== PROVIDER_HANDLE_JOURNAL_VERSION ||
    typeof value.entryId !== "string" || !uuidPattern.test(value.entryId) ||
    (key !== undefined && key !== storageKey(value.entryId)) ||
    typeof value.actionId !== "string" || !uuidPattern.test(value.actionId) ||
    typeof value.reviewHash !== "string" || !reviewHashPattern.test(value.reviewHash) ||
    typeof value.actionKind !== "string" || !actionKinds.has(value.actionKind as MoneyActionKind) ||
    (value.provider !== "cdp-embedded" && value.provider !== "base-account") ||
    typeof value.capturedAt !== "string" || !isoDatePattern.test(value.capturedAt) || Number.isNaN(Date.parse(value.capturedAt)) ||
    !validOwner(value.owner) || value.owner.accountProvider !== value.provider ||
    !validProviderHandle(value.handle) || value.handle.provider !== value.provider
  ) return null;
  return value as ProviderHandleJournalEntry;
}

export function providerHandleJournalEntryMatchesAction(
  entry: ProviderHandleJournalEntry,
  action: PreparedMoneyAction,
): boolean {
  return entry.actionId === action.id &&
    entry.reviewHash === action.reviewHash &&
    entry.actionKind === action.kind &&
    entry.provider === action.owner.accountProvider &&
    exactOwner(entry.owner, action.owner);
}

export function sameProviderHandle(left: ProviderHandle, right: ProviderHandle): boolean {
  return left.kind === right.kind && left.provider === right.provider && left.value === right.value;
}

function validBinding(action: PreparedMoneyAction, handle: ProviderHandle): boolean {
  return uuidPattern.test(action.id) &&
    reviewHashPattern.test(action.reviewHash) &&
    actionKinds.has(action.kind) &&
    validOwner(action.owner) &&
    validProviderHandle(handle) &&
    action.owner.accountProvider === handle.provider;
}

function validOwner(value: unknown): value is MoneyActionOwner {
  return isRecord(value) && hasExactKeys(value, ["subject", "address", "chainId", "accountProvider"]) &&
    typeof value.subject === "string" && value.subject.length > 0 && value.subject.length <= 512 &&
    typeof value.address === "string" && addressPattern.test(value.address) &&
    value.chainId === 8453 &&
    (value.accountProvider === "cdp-embedded" || value.accountProvider === "base-account");
}

function validProviderHandle(value: unknown): value is ProviderHandle {
  if (!isRecord(value) || !hasExactKeys(value, ["kind", "provider", "value"])) return false;
  if (value.kind === "user-operation-hash") {
    return value.provider === "cdp-embedded" && typeof value.value === "string" && hashPattern.test(value.value);
  }
  return value.kind === "submission-id" && value.provider === "base-account" &&
    typeof value.value === "string" && submissionIdPattern.test(value.value);
}

function exactOwner(left: MoneyActionOwner, right: MoneyActionOwner): boolean {
  return left.subject === right.subject && left.address === right.address && left.chainId === right.chainId &&
    left.accountProvider === right.accountProvider;
}

function sameJournalEntry(left: ProviderHandleJournalEntry, right: ProviderHandleJournalEntry): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function storageKey(entryId: string): string {
  return `${PROVIDER_HANDLE_JOURNAL_KEY_PREFIX}${entryId}`;
}

function browserLock(): ProviderHandleJournalLock | null {
  try {
    if (typeof navigator === "undefined" || !navigator.locks) return null;
    const locks = navigator.locks as unknown as {
      request<T>(name: string, callback: () => T | Promise<T>): Promise<T>;
    };
    return {
      withLock<T>(task: () => T | Promise<T>): Promise<T> {
        return locks.request<T>(PROVIDER_HANDLE_JOURNAL_LOCK_NAME, task);
      },
    };
  } catch {
    return null;
  }
}

function browserStorage(): ProviderHandleJournalStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function addIssue(issues: ProviderHandleJournalIssue[], issue: ProviderHandleJournalIssue): void {
  if (!issues.includes(issue)) issues.push(issue);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
