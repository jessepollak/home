import "server-only";

import { serverEnvironment } from "@/server/config/env";

import { getSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import type { SettingsEntry } from "@/shared/operator-settings/contract";
import { parseProductSettings, resolveProductOffering, type ProductOffering } from "@/shared/operator-settings/products";
import { OperatorSettingsStore } from "./store";

export const PRODUCT_OFFERING_TTL_MS = 3_000;
export const PRODUCT_OFFERING_READ_TIMEOUT_MS = 2_000;

type OfferingReader = {
  env?: Readonly<Record<string, string | undefined>>;
  store?: () => Pick<OperatorSettingsStore, "read">;
  sql?: () => SqlExecutor;
  now?: () => number;
  timeoutMs?: number;
};

let cached: { expiresAt: number; offering: Promise<ProductOffering> } | null = null;
let pendingRead: Promise<SettingsEntry> | null = null;

export function invalidateProductOffering(): void {
  cached = null;
  pendingRead = null;
}

export async function readProductOffering(reader: OfferingReader = {}): Promise<ProductOffering> {
  const custom = reader.store !== undefined || reader.env !== undefined;
  const now = (reader.now ?? Date.now)();
  if (!custom && cached && cached.expiresAt > now) return cached.offering;
  const offering = loadProductOffering(reader);
  if (!custom) cached = { expiresAt: now + PRODUCT_OFFERING_TTL_MS, offering };
  return offering;
}

async function loadProductOffering(reader: OfferingReader): Promise<ProductOffering> {
  const env = reader.env ?? serverEnvironment();
  if (!reader.store && !env.DATABASE_URL?.trim()) return resolveProductOffering({ kind: "deployment" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutMs = reader.timeoutMs ?? PRODUCT_OFFERING_READ_TIMEOUT_MS;
    const store = reader.store ? reader.store() : new OperatorSettingsStore(reader.sql ? reader.sql() : getSqlExecutor(env));
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
    const read = reader.store
      ? store.read("products", { timeoutMs, signal: AbortSignal.timeout(timeoutMs) })
      : readProductsOnce(store, timeoutMs);
    const entry = await Promise.race([read, timeout]);
    if (!entry) return resolveProductOffering({ kind: "unavailable" });
    if (entry.settings.source === "default") return resolveProductOffering({ kind: "deployment" });
    const value = parseProductSettings(entry.settings.value);
    return value ? resolveProductOffering({ kind: "saved", value }) : resolveProductOffering({ kind: "unavailable" });
  } catch {
    return resolveProductOffering({ kind: "unavailable" });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function readProductsOnce(store: Pick<OperatorSettingsStore, "read">, timeoutMs: number): Promise<SettingsEntry> {
  if (!pendingRead) {
    const read = store.read("products", { timeoutMs, signal: AbortSignal.timeout(timeoutMs) });
    pendingRead = read;
    const settle = () => { if (pendingRead === read) pendingRead = null; };
    void read.then(settle, settle);
  }
  return pendingRead;
}
