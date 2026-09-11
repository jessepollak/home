import type { MoneyActionStore } from "./store";

let injectedStore: MoneyActionStore | null = null;
let runtimeStore: Promise<MoneyActionStore> | null = null;

export function setMoneyActionStoreForTests(store: MoneyActionStore | null): void {
  injectedStore = store;
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
  runtimeStore ??= loadRuntimeStore();
  return runtimeStore;
}

async function loadRuntimeStore(): Promise<MoneyActionStore> {
  const backend = resolveMoneyActionStoreBackend();
  if (backend === "postgres") {
    const { PostgresMoneyActionStore } = await import("./postgres-store");
    return new PostgresMoneyActionStore();
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
