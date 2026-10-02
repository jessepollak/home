import "server-only";

import { OPERATOR_SETTINGS_CONTRACT_VERSION, type SettingsEntry, type SettingsResponse } from "@/shared/operator-settings/contract";
import { getSqlExecutor, type SqlQueryOptions } from "@/server/db/sql";
import { parseProductSettings, type ProductSettings } from "@/shared/operator-settings/products";
import { OperatorSettingsStore } from "./store";

const PRODUCT_SETTINGS_PAGE_READ_DEADLINE_MS = 5_000;

export type ProductSettingsEntry = SettingsResponse & { settings: SettingsResponse["settings"] & { value: ProductSettings } };

function withDeadline<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const signal = AbortSignal.timeout(ms);
  let onAbort = () => {};
  const expired = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error("Product settings read timed out"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([work(signal), expired]).finally(() => signal.removeEventListener("abort", onAbort));
}

export async function readProductSettingsEntryForPage(
  { read = (options: SqlQueryOptions) => new OperatorSettingsStore(getSqlExecutor()).read("products", options), deadlineMs = PRODUCT_SETTINGS_PAGE_READ_DEADLINE_MS }:
    { read?: (options: SqlQueryOptions) => Promise<SettingsEntry<unknown>>; deadlineMs?: number } = {},
): Promise<ProductSettingsEntry | null> {
  const entry = await withDeadline((signal) => read({ timeoutMs: deadlineMs, signal }), deadlineMs);
  const value = parseProductSettings(entry.settings.value);
  return value === null ? null : { version: OPERATOR_SETTINGS_CONTRACT_VERSION, domain: entry.domain, settings: { ...entry.settings, value } };
}
