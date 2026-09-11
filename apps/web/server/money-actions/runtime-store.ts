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
): "postgres" | "unconfigured" {
  return env.DATABASE_URL?.trim() ? "postgres" : "unconfigured";
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
  throw new Error(
    "DATABASE_URL is required for PostgreSQL money-action persistence in every runtime.",
  );
}
