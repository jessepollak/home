import "server-only";

import { serverEnvironment } from "@/server/config/env";

import { getSqlExecutor, type SqlQueryOptions } from "@/server/db/sql";
import type { SettingsEntry } from "@/shared/operator-settings/contract";
import { INVEST_HIDE_ALL, INVEST_SETTINGS_DEFAULTS, INVEST_SETTINGS_DOMAIN, parseInvestSettings, type InvestSettings } from "@/shared/operator-settings/invest";
import { OperatorSettingsStore } from "./store";

export type InvestVisibilityPolicy =
  | { status: "ready"; settings: InvestSettings; source: "default" | "stored" }
  | { status: "unavailable" };

export const INVEST_VISIBILITY_TTL_MS = 5_000;
const FAILURE_TTL_MS = 1_000;
const READ_DEADLINE_MS = 750;

type Reader = (signal: AbortSignal) => Promise<{ value: InvestSettings; source: "default" | "stored" } | null>;

function runtimeReader(env: Readonly<Record<string, string | undefined>> = serverEnvironment()): Reader {
  return async (signal) => {
    if (!env.DATABASE_URL?.trim()) return null;
    const entry = await new OperatorSettingsStore(getSqlExecutor(env)).read(INVEST_SETTINGS_DOMAIN, { timeoutMs: READ_DEADLINE_MS, signal });
    const value = parseInvestSettings(entry.settings.value);
    if (!value) throw new Error("Invalid invest settings");
    return { value, source: entry.settings.source };
  };
}

function withDeadline<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const deadline = AbortSignal.timeout(Number.isFinite(ms) && ms >= 1 && ms <= 2_147_483_647 ? Math.trunc(ms) : 1);
  let onAbort = () => {};
  const outcome = run(controller.signal).then(
    (value) => ({ settled: true as const, value }),
    () => ({ settled: false as const }),
  );
  const work = outcome.then((result) => {
    if (!result.settled) throw new Error("Invest settings read failed");
    return result.value;
  });
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        controller.abort(new Error("Invest settings read timed out"));
        reject(new Error("Invest settings read timed out"));
      };
      deadline.addEventListener("abort", onAbort, { once: true });
    }),
  ]).finally(() => deadline.removeEventListener("abort", onAbort));
}

export async function readInvestSettingsEntry(
  { read = (options: SqlQueryOptions) => new OperatorSettingsStore(getSqlExecutor()).read(INVEST_SETTINGS_DOMAIN, options), deadlineMs = READ_DEADLINE_MS }:
    { read?: (options: SqlQueryOptions) => Promise<SettingsEntry<unknown>>; deadlineMs?: number } = {},
): Promise<SettingsEntry<InvestSettings> | null> {
  const entry = await withDeadline((signal) => read({ timeoutMs: READ_DEADLINE_MS, signal }), deadlineMs);
  const value = parseInvestSettings(entry.settings.value);
  return value === null ? null : { ...entry, settings: { ...entry.settings, value } };
}

export function createInvestVisibilityReader({ read = runtimeReader(), now = Date.now, deadlineMs = READ_DEADLINE_MS }: { read?: Reader; now?: () => number; deadlineMs?: number } = {}) {
  let cached: { policy: InvestVisibilityPolicy; expiresAt: number } | null = null;
  let lastReady: Extract<InvestVisibilityPolicy, { status: "ready" }> | null = null;
  let inflight: Promise<InvestVisibilityPolicy> | null = null;
  let generation = 0;
  const load = async (): Promise<InvestVisibilityPolicy> => {
    if (cached && cached.expiresAt > now()) return cached.policy;
    if (inflight) return inflight;
    const started = generation;
    const pending = (async (): Promise<InvestVisibilityPolicy> => {
      let policy: InvestVisibilityPolicy;
      try {
        const entry = await withDeadline(read, deadlineMs);
        policy = entry
          ? { status: "ready", settings: entry.value, source: entry.source }
          : { status: "ready", settings: INVEST_SETTINGS_DEFAULTS, source: "default" };
      } catch {
        policy = { status: "unavailable" };
      }
      if (started === generation) {
        if (policy.status === "ready") lastReady = policy;
        cached = { policy, expiresAt: now() + (policy.status === "ready" ? INVEST_VISIBILITY_TTL_MS : FAILURE_TTL_MS) };
      }
      return policy;
    })();
    inflight = pending;
    try { return await pending; } finally { if (inflight === pending) inflight = null; }
  };
  const readVisibility = async (): Promise<{ settings: InvestSettings; available: boolean }> => {
    const policy = await load();
    if (policy.status === "ready") return { settings: policy.settings, available: true };
    return { settings: lastReady?.settings ?? INVEST_HIDE_ALL, available: lastReady !== null };
  };
  return {
    read: load,
    readVisibility,
    async readSettings(): Promise<InvestSettings> {
      return (await readVisibility()).settings;
    },
    invalidate() {
      generation++;
      cached = null;
      lastReady = null;
      inflight = null;
    },
  };
}

const runtime = createInvestVisibilityReader();

export const readInvestSettingsForRender = runtime.readSettings;
export const readInvestSearchVisibility = runtime.readVisibility;
export const invalidateInvestVisibility = runtime.invalidate;
