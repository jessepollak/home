import "server-only";

import { serverEnvironment } from "@/server/config/env";

import type { CountryCode, RegionId, RegionOffer } from "@/config/regions";
import { getSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { REGION_SETTINGS_DEFAULTS, REGIONS_SETTINGS_DOMAIN, type RegionSettings } from "@/shared/operator-settings/regions";
import type { SettingsEntry } from "@/shared/operator-settings/contract";
import { OperatorSettingsStore } from "./store";

export type RegionPolicy =
  | { status: "ready"; offered: readonly CountryCode[]; defaultRegion: RegionId; source: "default" | "stored" }
  | { status: "unavailable" };

export class RegionPolicyUnavailableError extends Error {}

export const REGION_POLICY_TTL_MS = 5_000;
const FAILURE_TTL_MS = 1_000;
const REGION_POLICY_READ_DEADLINE_MS = 750;
export const OPERATOR_SETTINGS_PAGE_READ_TIMEOUT_MS = 5_000;

type ReaderEntry = { value: RegionSettings; source: "default" | "stored" } | null;
type Reader = (options: { timeoutMs: number; signal?: AbortSignal }) => Promise<ReaderEntry>;

function runtimeReader(env: Readonly<Record<string, string | undefined>> = serverEnvironment()): Reader {
  return async ({ timeoutMs, signal }) => {
    if (!env.DATABASE_URL?.trim()) return null;
    const entry = await new OperatorSettingsStore(getSqlExecutor(env)).read(REGIONS_SETTINGS_DOMAIN, { timeoutMs, signal });
    return { value: entry.settings.value as RegionSettings, source: entry.settings.source };
  };
}

function withDeadline<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const deadline = AbortSignal.timeout(Number.isFinite(ms) && ms >= 1 && ms <= 2_147_483_647 ? Math.trunc(ms) : 1);
  let onAbort = () => {};
  return Promise.race([
    work(controller.signal),
    new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        controller.abort(new RegionPolicyUnavailableError("Region settings read timed out"));
        reject(new RegionPolicyUnavailableError("Region settings read timed out"));
      };
      deadline.addEventListener("abort", onAbort, { once: true });
    }),
  ]).finally(() => deadline.removeEventListener("abort", onAbort));
}

export function createRegionPolicyReader({ read = runtimeReader(), now = Date.now, deadlineMs = REGION_POLICY_READ_DEADLINE_MS }: { read?: Reader; now?: () => number; deadlineMs?: number } = {}) {
  let cached: { policy: RegionPolicy; expiresAt: number; seq: number } | null = null;
  let inflight: Promise<RegionPolicy> | null = null;
  let generation = 0;
  let sequence = 0;
  let running: Promise<ReaderEntry> | null = null;
  const startRead = (fresh: boolean, signal: AbortSignal): Promise<ReaderEntry> => {
    if (!fresh) {
      if (running) return running;
      const started = read({ timeoutMs: deadlineMs });
      running = started;
      const settle = () => { if (running === started) running = null; };
      started.then(settle, settle);
      return started;
    }
    return read({ timeoutMs: deadlineMs, signal });
  };
  const load = async (fresh: boolean): Promise<RegionPolicy> => {
    const cachedPolicy = cached && cached.expiresAt > now() && (!fresh || cached.policy.status === "unavailable") ? cached.policy : null;
    if (cachedPolicy) return cachedPolicy;
    if (!fresh && inflight) return inflight;
    const started = generation;
    const seq = ++sequence;
    const pending = (async (): Promise<RegionPolicy> => {
      let policy: RegionPolicy;
      try {
        const entry = await withDeadline((signal) => startRead(fresh, signal), deadlineMs);
        policy = entry
          ? { status: "ready", offered: entry.value.offered, defaultRegion: entry.value.defaultRegion, source: entry.source }
          : { status: "ready", offered: REGION_SETTINGS_DEFAULTS.offered, defaultRegion: REGION_SETTINGS_DEFAULTS.defaultRegion, source: "default" };
      } catch {
        policy = { status: "unavailable" };
      }
      if (started === generation && seq > (cached?.seq ?? 0)) cached = { policy, expiresAt: now() + (policy.status === "ready" ? REGION_POLICY_TTL_MS : FAILURE_TTL_MS), seq };
      return policy;
    })();
    inflight = pending;
    try { return await pending; } finally { if (inflight === pending) inflight = null; }
  };
  return {
    read: () => load(false),
    async isOffered(region: string): Promise<boolean> {
      const policy = await load(true);
      if (policy.status === "unavailable") throw new RegionPolicyUnavailableError("Region settings are unavailable");
      return (policy.offered as readonly string[]).includes(region);
    },
    invalidate() {
      generation++;
      cached = null;
      inflight = null;
      running = null;
    },
  };
}

const runtime = createRegionPolicyReader();

export const readRegionPolicy = runtime.read;
export const isRegionOffered = runtime.isOffered;
export const invalidateRegionPolicy = runtime.invalidate;
export async function readRegionSettingsForPage(executor: SqlExecutor, timeoutMs = OPERATOR_SETTINGS_PAGE_READ_TIMEOUT_MS): Promise<SettingsEntry> {
  return withDeadline((signal) => new OperatorSettingsStore(executor).read(REGIONS_SETTINGS_DOMAIN, { timeoutMs, signal }), timeoutMs);
}

export async function readRegionOfferForRender(read: () => Promise<RegionPolicy> = readRegionPolicy): Promise<RegionOffer> {
  const policy = await read();
  return policy.status === "ready"
    ? { offered: policy.offered, defaultRegion: policy.defaultRegion }
    : { offered: [], defaultRegion: "GLOBAL" };
}
