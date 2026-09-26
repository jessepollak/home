"use client";

import {
  browserHomeQueryClient,
  publicQueryKey,
  useHomeQuery,
  useHomeQueryClient,
} from "@/client/query/query-client";
import { deploymentHeaders } from "@/client/query/deployment-headers";
import { parseVaultsResult } from "@/shared/savings/contracts/vaults";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import { hasUsableSavingsRateObservation } from "./portfolio-summary";

const savingsVaultsKey = publicQueryKey("savings-vaults");

export function retainLastKnownSavingsRates(
  previous: MorphoVaultsResult | null | undefined,
  next: MorphoVaultsResult,
  nowMs = Date.now(),
): MorphoVaultsResult {
  if (!previous) return next;
  return {
    ...next,
    candidates: next.candidates.map((candidate) => {
      if (hasUsableSavingsRateObservation(candidate, nowMs)) return candidate;
      const retained = previous.candidates.find((prior) =>
        prior.vaultAddress.toLowerCase() === candidate.vaultAddress.toLowerCase() &&
        sameAsset(prior.asset, candidate.asset) &&
        hasUsableSavingsRateObservation(prior, nowMs)
      );
      return retained ? {
        ...candidate,
        netApy: retained.netApy,
        grossApy: retained.grossApy,
        stateAsOf: retained.stateAsOf,
        source: retained.source,
      } : candidate;
    }),
  };
}

function sameAsset(left: MorphoVaultCandidate["asset"], right: MorphoVaultCandidate["asset"]): boolean {
  return left.address.toLowerCase() === right.address.toLowerCase() &&
    left.symbol.toUpperCase() === right.symbol.toUpperCase() && left.decimals === right.decimals;
}

async function fetchSavingsVaults(signal?: AbortSignal): Promise<unknown> {
  const response = await fetch("/api/savings/vaults", {
    headers: { ...deploymentHeaders(), accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("Vault request failed");
  return response.json();
}

export function useSavingsVaults({
  initialData,
  fetchVaults = fetchSavingsVaults,
}: {
  initialData?: MorphoVaultsResult | null;
  fetchVaults?: (signal?: AbortSignal) => Promise<unknown>;
} = {}) {
  const queryClient = useHomeQueryClient(browserHomeQueryClient());
  return useHomeQuery<MorphoVaultsResult>({
    queryKey: savingsVaultsKey,
    initialData: initialData ?? undefined,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const data = parseVaultsResult(await fetchVaults(signal));
      if (!data) throw new Error("Savings vault metadata is invalid.");
      return retainLastKnownSavingsRates(queryClient.getQueryData<MorphoVaultsResult>(savingsVaultsKey), data);
    },
  });
}
