import "server-only";

import { serverEnvironment } from "@/server/config/env";

import { presentationRegions } from "@/config/regions";
import { getSqlExecutor, type SqlQueryOptions } from "@/server/db/sql";
import { OperatorSettingsStore } from "@/server/operator-settings/store";
import { fundingCorridorKey, type FundingOfferingView } from "@/shared/funding/offering";
import type { FundingDirection, FundingProvider } from "@/shared/funding/provider-contract";
import { parseFundingSettings, type FundingSettings, type SettingsEntry } from "@/shared/operator-settings/contract";
import { fundingProviders } from "./providers";
import { environmentAvailable } from "./core/provider-context";

const FUNDING_SETTINGS_READ_DEADLINE_MS = 3_000;

/** @public for the operator funding settings console */
export class FundingOfferingUnavailableError extends Error {}

async function withDeadline<T>(run: (signal: AbortSignal) => Promise<T>, ms: number, parent?: AbortSignal): Promise<T> {
  parent?.throwIfAborted();
  const controller = new AbortController();
  const cancellation = Promise.withResolvers<never>();
  const abortFromParent = () => {
    controller.abort(parent?.reason);
    cancellation.reject(controller.signal.reason);
  };
  parent?.addEventListener("abort", abortFromParent, { once: true });
  const deadline = setTimeout(() => {
    const error = new Error("Funding settings read timed out");
    controller.abort(error);
    cancellation.reject(error);
  }, ms);
  try {
    return await Promise.race([run(controller.signal), cancellation.promise]);
  } finally {
    clearTimeout(deadline);
    parent?.removeEventListener("abort", abortFromParent);
  }
}


type Environment = Readonly<Record<string, string | undefined>>;
type OfferingEntry = SettingsEntry<FundingSettings>;
type OfferingInput = { providers: ReadonlyArray<FundingProvider>; env: Environment; entry: OfferingEntry };
function combinedEvidence(notes: ReadonlyArray<string | null>): string | null {
  const unique = [...new Set(notes.map((note) => note?.trim() ?? "").filter((note) => note.length > 0))];
  return unique.length > 0 ? unique.join("; ") : null;
}


export function resolveFundingOffering({ providers, env, entry }: OfferingInput) {
  const saved = entry.settings.source === "stored";
  const selected = new Map(entry.settings.value.corridors.map((corridor) => [
    fundingCorridorKey(corridor.providerId, corridor.region, corridor.direction), corridor.offered,
  ]));
  const known = new Set<string>();
  const offered = new Set<string>();
  const selectedCorridors = new Set<string>();
  const corridors: FundingOfferingView["corridors"] = [];
  const corridorByKey = new Map<string, FundingOfferingView["corridors"][number]>();
  const evidenceByKey = new Map<string, string[]>();
  const currenciesByKey = new Map<string, Set<string>>();
  const credentialsByKey = new Map<string, Set<string>>();
  const credentials: FundingOfferingView["providers"] = [];
  const legacyNames = new Set<string>();
  for (const provider of providers) {
    const envNames = new Set<string>();
    for (const binding of provider.manifest.bindings) {
      for (const direction of ["onramp", "offramp"] as const) {
        const directional = binding.directions[direction];
        if (!directional) continue;
        const key = fundingCorridorKey(provider.manifest.id, binding.region, direction);
        known.add(key);
        const switchName = directional.legacyOfferedEnv;
        if (switchName) legacyNames.add(switchName);
        for (const name of directional.env) envNames.add(name);
        credentialsByKey.set(key, new Set([...(credentialsByKey.get(key) ?? []), ...directional.env]));
        const missingEnv = directional.env.filter((name) => !environmentAvailable([name], env));
        const confirmedBy = "confirmedBy" in directional ? directional.confirmedBy : "";
        evidenceByKey.set(key, [...(evidenceByKey.get(key) ?? []), confirmedBy]);
        const isSelected = saved ? (selected.get(key) ?? false) : switchName ? env[switchName]?.trim() === "1" : true;
        const existing = corridorByKey.get(key);
        if (existing) {
          const currencies = currenciesByKey.get(key) ?? new Set<string>();
          currenciesByKey.set(key, currencies);
          currencies.add(binding.currency);
          existing.currency = [...currencies].join(" / ");
          existing.paymentMethods = [...new Set([...existing.paymentMethods, ...directional.paymentMethods.map((method) => method.label)])];
          existing.missingEnv = [...new Set([...existing.missingEnv, ...missingEnv])].sort();
          existing.connection = existing.missingEnv.length ? "not-connected" : "connected";
          existing.selected = existing.selected && isSelected;
          existing.offered = existing.selected && existing.connection === "connected";
        } else {
          const corridor: FundingOfferingView["corridors"][number] = {
            key, providerId: provider.manifest.id, providerName: provider.manifest.displayName,
            region: binding.region, regionName: presentationRegions[binding.region].countryName,
            direction, currency: binding.currency, paymentMethods: [...new Set(directional.paymentMethods.map((method) => method.label))],
            connection: missingEnv.length ? "not-connected" : "connected", missingEnv: [...new Set(missingEnv)].sort(), credentials: [], selected: isSelected,
            offered: isSelected && missingEnv.length === 0, confirmedBy: null,
            newSinceSave: saved && !selected.has(key),
          };
          corridors.push(corridor);
          corridorByKey.set(key, corridor);
          currenciesByKey.set(key, new Set([binding.currency]));
        }
      }
    }
    credentials.push({ providerId: provider.manifest.id, displayName: provider.manifest.displayName,
      credentials: [...envNames].sort().map((name) => ({ name, state: environmentAvailable([name], env) ? "set" as const : "unset" as const })) });
  }
  for (const corridor of corridors) {
    corridor.confirmedBy = combinedEvidence(evidenceByKey.get(corridor.key) ?? []);
    corridor.credentials = [...(credentialsByKey.get(corridor.key) ?? [])].sort().map((name) => ({ name, state: environmentAvailable([name], env) ? "set" as const : "unset" as const }));
    if (corridor.selected) selectedCorridors.add(corridor.key);
    if (corridor.offered) offered.add(corridor.key);
  }
  const view: FundingOfferingView = {
    source: saved ? "saved" : "deployment", revision: entry.settings.revision,
    updatedAt: entry.settings.updatedAt, updatedBy: entry.settings.updatedBy,
    corridors, providers: credentials,
    legacy: [...legacyNames].sort().map((name) => ({ name, state: !env[name]?.trim() ? "unset" as const : saved ? "ignored" as const : "in-effect" as const })),
    unknownSaved: saved ? entry.settings.value.corridors.filter((row) => !known.has(fundingCorridorKey(row.providerId, row.region, row.direction)))
      .map(({ providerId, region, direction }) => ({ providerId, region, direction })) : [],
  };
  return {
    view,
    source: view.source,
    isSelected: (providerId: string, region: string, direction: FundingDirection) =>
      selectedCorridors.has(fundingCorridorKey(providerId, region, direction)),
    isOffered: (providerId: string, region: string, direction: FundingDirection) =>
      offered.has(fundingCorridorKey(providerId, region, direction)),
  };
}

export async function readFundingOffering(deps: {
  providers?: ReadonlyArray<FundingProvider>;
  env?: Environment;
  store?: Pick<OperatorSettingsStore, "read">;
  signal?: AbortSignal;
  timeoutMs?: number;
} = {}) {
  const timeoutMs = deps.timeoutMs ?? FUNDING_SETTINGS_READ_DEADLINE_MS;
  const stored = await withDeadline((signal) =>
    (deps.store ?? new OperatorSettingsStore(getSqlExecutor())).read("funding", { signal, timeoutMs }), timeoutMs, deps.signal);
  const value = parseFundingSettings(stored.settings.value);
  if (!value) throw new FundingOfferingUnavailableError("Stored funding settings are unreadable.");
  const entry: OfferingEntry = { ...stored, settings: { ...stored.settings, value } };
  return resolveFundingOffering({ providers: deps.providers ?? fundingProviders, env: deps.env ?? serverEnvironment(), entry });
}

/** @public read by the cash-out confirm gate, which bounds the settings read so a stalled read cannot hold a confirmation open */
export function createCashoutCorridorOfferingReader({
  read = (options: SqlQueryOptions = {}) => readFundingOffering({ signal: options.signal, timeoutMs: options.timeoutMs }),
  deadlineMs = FUNDING_SETTINGS_READ_DEADLINE_MS,
}: {
  read?: (options?: SqlQueryOptions) => Promise<Pick<ReturnType<typeof resolveFundingOffering>, "isOffered">>;
  deadlineMs?: number;
} = {}) {
  return async (providerId: string, region: string, direction: FundingDirection, signal?: AbortSignal): Promise<boolean> => {
    const offering = await withDeadline((deadlineSignal) => read({ signal: deadlineSignal, timeoutMs: deadlineMs }), deadlineMs, signal);
    return offering.isOffered(providerId, region, direction);
  };
}

export const isCashoutCorridorOffered = createCashoutCorridorOfferingReader();


/** @public read by the operator funding settings console */
export async function readFundingOfferingView(): Promise<FundingOfferingView> {
  try {
    return (await readFundingOffering()).view;
  } catch {
    throw new FundingOfferingUnavailableError("Funding offering is unavailable.");
  }
}
