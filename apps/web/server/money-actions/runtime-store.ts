import "server-only";

import type { MoneyActionStore } from "./store";

type RuntimeMoneyActionStore = MoneyActionStore & {
  ensureSchema(): Promise<void>;
  dispose?(): Promise<void>;
};
type RuntimeStoreFactory = (connectionString: string) => Promise<RuntimeMoneyActionStore>;

const RUNTIME_STORE_CLEANUP_TIMEOUT_MS = 5_000;

const defaultRuntimeStoreFactory: RuntimeStoreFactory = async (connectionString) => {
  const { PostgresMoneyActionStore } = await import("./postgres-store");
  return new PostgresMoneyActionStore(connectionString);
};

let injectedStore: MoneyActionStore | null = null;
let runtimeStore: Promise<MoneyActionStore> | null = null;
let runtimeStoreFactory = defaultRuntimeStoreFactory;

export function setMoneyActionStoreForTests(store: MoneyActionStore | null): void {
  injectedStore = store;
  runtimeStore = null;
}

export function setMoneyActionRuntimeStoreFactoryForTests(
  factory: RuntimeStoreFactory | null,
): void {
  runtimeStoreFactory = factory ?? defaultRuntimeStoreFactory;
  runtimeStore = null;
}

type StoreSelectionEnv = { [key: string]: string | undefined };

export function resolveMoneyActionStoreBackend(
  env: StoreSelectionEnv = process.env as StoreSelectionEnv,
): "postgres" | "cutover-unverified" | "unconfigured" {
  if (!env.DATABASE_URL?.trim()) return "unconfigured";
  return env.MONEY_ACTION_POSTGRES_CUTOVER === "verified-empty"
    ? "postgres"
    : "cutover-unverified";
}

export async function getMoneyActionStore(): Promise<MoneyActionStore> {
  if (injectedStore) return injectedStore;
  if (runtimeStore) return runtimeStore;
  const loading = loadRuntimeStore();
  runtimeStore = loading;
  try {
    return await loading;
  } catch (error) {
    if (runtimeStore === loading) runtimeStore = null;
    throw error;
  }
}

async function loadRuntimeStore(): Promise<MoneyActionStore> {
  const backend = resolveMoneyActionStoreBackend();
  if (backend === "postgres") {
    const store = await runtimeStoreFactory(process.env.DATABASE_URL!);
    try {
      await store.ensureSchema();
      return store;
    } catch (error) {
      try {
        const disposal = store.dispose?.();
        if (disposal) await withCleanupTimeout(disposal, RUNTIME_STORE_CLEANUP_TIMEOUT_MS);
      } catch { /* preserve the readiness failure */ }
      throw error;
    }
  }
  if (backend === "cutover-unverified") {
    throw new Error(
      "MONEY_ACTION_POSTGRES_CUTOVER=verified-empty is required after verifying no unresolved legacy SQLite money actions remain.",
    );
  }
  throw new Error(
    "DATABASE_URL is required for PostgreSQL money-action persistence in every runtime.",
  );
}

async function withCleanupTimeout(disposal: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      disposal,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`PostgreSQL money-action cleanup timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
        (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
