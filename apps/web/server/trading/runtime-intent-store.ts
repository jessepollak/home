import "server-only";

import type { TradeIntentStore } from "@/shared/trading/server-types";

let injectedStore: TradeIntentStore | null = null;
let runtimeStore: Promise<TradeIntentStore> | null = null;

type StoreSelectionEnv = { [key: string]: string | undefined };

export type TradeIntentStoreBackend = "sqlite" | "hosted-unavailable";

export class TradeRuntimeCapabilityError extends Error {
  readonly code = "HOSTED_SWAP_UNAVAILABLE" as const;
  readonly capability = "durable-trade-intent-payload-handoff" as const;

  constructor() {
    super(
      "Hosted swap execution is unavailable until trade intents and executable payload handoff are durable.",
    );
    this.name = "TradeRuntimeCapabilityError";
  }
}

export function setTradeIntentStoreForTests(store: TradeIntentStore | null): void {
  injectedStore = store;
  runtimeStore = null;
}

export function resolveTradeIntentStoreBackend(
  env: StoreSelectionEnv = process.env as StoreSelectionEnv,
): TradeIntentStoreBackend {
  if (env.VERCEL || env.DATABASE_URL?.trim()) return "hosted-unavailable";
  return "sqlite";
}

export async function getTradeIntentStore(): Promise<TradeIntentStore> {
  if (injectedStore) return injectedStore;
  runtimeStore ??= loadRuntimeStore();
  return runtimeStore;
}

async function loadRuntimeStore(): Promise<TradeIntentStore> {
  if (resolveTradeIntentStoreBackend() === "hosted-unavailable") {
    throw new TradeRuntimeCapabilityError();
  }
  const { SqliteTradeIntentStore } = await import("./sqlite-intent-store.node");
  return new SqliteTradeIntentStore();
}
