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
): "postgres" | "sqlite" | "hosted-unconfigured" {
  if (env.DATABASE_URL?.trim()) return "postgres";
  if (env.VERCEL) return "hosted-unconfigured";
  return "sqlite";
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
  if (backend === "hosted-unconfigured") {
    throw new Error(
      "DATABASE_URL is required for money-action persistence on Vercel. Local bun dev keeps SQLite when DATABASE_URL is unset.",
    );
  }
  const { SqliteMoneyActionStore } = await import("./sqlite-store.node");
  return new SqliteMoneyActionStore();
}
