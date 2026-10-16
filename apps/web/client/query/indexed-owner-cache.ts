import { createStore, get, update, type UseStore } from "idb-keyval";
import { isRecord } from "@/shared/guards";

type OwnerRecord = { epoch: string; owner: string | null; value: string | null; savedAt: number };
const key = "owner-client";
let browserStore: UseStore | undefined;
let boundaryWork: Promise<boolean> = Promise.resolve(true);
function store(): UseStore { return browserStore ??= createStore("home-query-cache", "owner-clients"); }
function record(value: unknown): OwnerRecord {
  return isRecord(value) && typeof value.epoch === "string" &&
    (value.owner === null || typeof value.owner === "string") &&
    (value.value === null || typeof value.value === "string") &&
    typeof value.savedAt === "number" && Number.isFinite(value.savedAt)
    ? { epoch: value.epoch, owner: value.owner, value: value.value, savedAt: value.savedAt }
    : { epoch: "empty", owner: null, value: null, savedAt: 0 };
}

export async function openIndexedOwnerCache(owner: string, customStore?: UseStore) {
  if (!customStore) await boundaryWork;
  const database = customStore ?? store();
  const initial = record(await get(key, database));
  return {
    value: initial.owner === owner ? initial.value : null,
    async isCurrent(value: string | null): Promise<boolean> {
      const current = record(await get(key, database));
      return current.epoch === initial.epoch && (current.owner === null || current.owner === owner) && current.value === value;
    },
    async write(value: string, savedAt: number, isCurrent: () => boolean): Promise<boolean> {
      let committed = false;
      await update(key, (raw: unknown) => {
        const current = record(raw);
        if (!isCurrent() || current.epoch !== initial.epoch ||
          current.owner !== null && current.owner !== owner || current.savedAt > savedAt) return current;
        committed = true;
        return { epoch: current.epoch, owner, value, savedAt };
      }, database);
      return committed;
    },
    async remove(value: string): Promise<void> {
      await update(key, (raw: unknown) => {
        const current = record(raw);
        return current.epoch === initial.epoch && current.owner === owner && current.value === value
          ? { ...current, value: null } : current;
      }, database);
    },
  };
}

export async function clearIndexedOwnerCache(preserveOwner?: string, customStore?: UseStore, isCurrent: () => boolean = () => true): Promise<boolean> {
  try {
    await update(key, (raw: unknown) => {
      const current = record(raw);
      if (!isCurrent()) return current;
      return preserveOwner && current.owner === preserveOwner ? current
        : { epoch: crypto.randomUUID(), owner: null, value: null, savedAt: 0 };
    }, customStore ?? store());
    return true;
  } catch { return false; }
}

export function clearBrowserIndexedOwnerCache(preserveOwner?: string): void {
  if (typeof indexedDB === "undefined") return;
  boundaryWork = boundaryWork.then(() => clearIndexedOwnerCache(preserveOwner));
}
