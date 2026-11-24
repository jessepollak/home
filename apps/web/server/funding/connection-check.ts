import "server-only";

import { serverEnvironment } from "@/server/config/env";
import { composeSignals } from "@/server/http/deadline";
import { fundingProviders } from "@/server/funding/providers";
import { createProviderContext, environmentAvailable, resolveFundingMode } from "@/server/funding/core/provider-context";
import type { FundingDirection, FundingProvider, ProviderContext } from "@/shared/funding/provider-contract";
import type { FundingConnectionResult, FundingConnectionStatus } from "@/shared/operator-settings/contract-funding-connections";

type Options = {
  providerId: string;
  providers?: readonly FundingProvider[];
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => Date;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
};
type Candidate = { region: ProviderContext["binding"]["region"]; direction: FundingDirection; env: readonly string[]; paymentMethodId: string };
const inFlight = new Map<string, Promise<FundingConnectionResult>>();

export function checkFundingConnection(options: Options): Promise<FundingConnectionResult> {
  const pending = inFlight.get(options.providerId);
  if (pending) return pending;
  const promise = runCheck(options).finally(() => { if (inFlight.get(options.providerId) === promise) inFlight.delete(options.providerId); });
  inFlight.set(options.providerId, promise);
  return promise;
}

function aggregate(scopes: FundingConnectionResult["scopes"]): FundingConnectionStatus {
  for (const status of ["rejected", "unreachable", "inconclusive"] as const) {
    if (scopes.some((scope) => scope.status === status)) return status;
  }
  if (scopes.every((scope) => scope.status === "not-configured")) return "not-configured";
  return scopes.some((scope) => scope.status === "connected") ? "connected" : "unsupported";
}

async function runCheck(options: Options): Promise<FundingConnectionResult> {
  const provider = (options.providers ?? fundingProviders).find((entry) => entry.manifest.id === options.providerId);
  if (!provider) throw new Error("Unknown funding provider");
  const env = options.env ?? serverEnvironment();
  let scopes: FundingConnectionResult["scopes"];
  if (!provider.checkConnection) {
    scopes = [{ regions: [...new Set(provider.manifest.bindings.map((binding) => binding.region))], status: "unsupported" }];
  } else {
    const candidates: Candidate[] = provider.manifest.bindings.flatMap((binding) =>
      (["onramp", "offramp"] as const).flatMap((direction) => {
        const directional = binding.directions[direction];
        return directional ? [{ region: binding.region, direction, env: directional.env, paymentMethodId: directional.paymentMethods[0]?.id ?? "" }] : [];
      }));
    const regionSpecific = new Set(candidates.map((candidate) => JSON.stringify([...candidate.env].sort()))).size > 1;
    const groups = new Map<string, Candidate[]>();
    for (const candidate of candidates) {
      const key = JSON.stringify([[...candidate.env].sort(), regionSpecific ? candidate.region : null]);
      groups.set(key, [...(groups.get(key) ?? []), candidate]);
    }
    const timeoutMs = options.timeoutMs ?? 5_000;
    scopes = (await Promise.all([...groups.values()].map(async (group) => {
      const regions = [...new Set(group.map((candidate) => candidate.region))];
      const [candidate] = group;
      if (!candidate) return null;
      if (!environmentAvailable(candidate.env, env)) return { regions, status: "not-configured" as const };
      let context: ProviderContext | undefined;
      try {
        for (const binding of group) {
          const sandbox = resolveFundingMode(provider.manifest, binding.direction, env) === "sandbox";
          const available = binding.direction === "onramp"
            ? provider.manifest.onramp && (!sandbox || provider.manifest.onramp.sandbox === true)
            : sandbox ? provider.manifest.offramp?.sandbox : provider.manifest.offramp?.production;
          if (!available) continue;
          context = createProviderContext({ manifest: provider.manifest, ...binding, env, sandbox, timeoutMs, fetchImplementation: options.fetchImplementation });
          break;
        }
      } catch {
        return { regions, status: "inconclusive" as const };
      }
      if (!context) return null;
      const signal = AbortSignal.timeout(timeoutMs);
      const original = context.request;
      const request: ProviderContext["request"] = (input, requestOptions) => original(input, {
        ...requestOptions, signal: requestOptions.signal ? composeSignals([signal, requestOptions.signal]) : signal,
      });
      const ctx = { ...context, signal, request };
      let onAbort: () => void = () => {};
      try {
        const deadline = new Promise<"unreachable">((resolve) => {
          onAbort = () => { resolve("unreachable"); };
          signal.addEventListener("abort", onAbort, { once: true });
        });
        const status = await Promise.race([Promise.resolve().then(() => provider.checkConnection?.(ctx) ?? "inconclusive"), deadline]);
        return { regions, status };
      } catch {
        return { regions, status: "unreachable" as const };
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    }))).filter((scope) => scope !== null);
    if (scopes.length === 0) scopes = [{ regions: [], status: "inconclusive" }];
  }
  return { providerId: options.providerId, checkedAt: (options.now ?? (() => new Date()))().toISOString(), status: aggregate(scopes), scopes };
}
