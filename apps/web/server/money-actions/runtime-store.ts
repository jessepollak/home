import "server-only";

import type { AttemptStoreResource } from "./attempt-store";
import type { MoneyActionStore } from "./store";

type RuntimeResourceFactory = (connectionString: string) => Promise<AttemptStoreResource>;

const defaultRuntimeResourceFactory: RuntimeResourceFactory = async (connectionString) => {
  const { createNeonSqlExecutor, createPostgresAttemptStoreResourceWithExecutor } = await import("./postgres-store");
  return createPostgresAttemptStoreResourceWithExecutor(createNeonSqlExecutor(connectionString));
};

let injectedStore: MoneyActionStore | null = null;
let runtimeStore: Promise<MoneyActionStore> | null = null;
let runtimeResourceFactory = defaultRuntimeResourceFactory;

export function setMoneyActionStoreForTests(store: MoneyActionStore | null): void {
  injectedStore = store;
  runtimeStore = null;
}

export function setMoneyActionRuntimeResourceFactoryForTests(
  factory: RuntimeResourceFactory | null,
): void {
  runtimeResourceFactory = factory ?? defaultRuntimeResourceFactory;
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
    const resource = await runtimeResourceFactory(process.env.DATABASE_URL!);
    try {
      await resource.init();
      return resource.store;
    } catch (error) {
      try { await resource.dispose(); } catch { /* preserve the readiness failure */ }
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
