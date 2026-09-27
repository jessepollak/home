"use client";

import { useEffect, useRef, useState } from "react";
import { useShellPanelActive } from "@/client/home/panel-shared";
import { useReducedMotion } from "@/components/money-ticker";
import type { MorphoVaultCandidate } from "@/shared/savings/types";
import type { SavingsPortfolioSummary } from "./portfolio-summary";
import { nextSavingsRateExpiryAt } from "./portfolio-summary";
import {
  estimateSavingsGrowthBaseUnits,
  isValidSavingsGrowthApy,
  parseSavingsSnapshotTime,
  type SavingsGrowthEstimate,
} from "./estimated-growth";

const SAMPLE_INTERVAL_MS = 250;
const canonicalIntegerPattern = /^(?:0|[1-9][0-9]*)$/;

export type SavingsGrowthAuthority = {
  accountIdentity: string;
  assetIdentity: string;
  blockNumber: string;
  blockHash: string;
  blockTimestamp: string;
  snapshotStale: boolean;
  registryCoverageComplete: boolean;
};

export type SavingsGrowthAnchor = {
  identity: string;
  authoritativeBaseUnits: bigint;
  estimate: SavingsGrowthEstimate | null;
};

export function createSavingsGrowthAnchor({
  authority,
  candidates,
  metadataFetchedAt,
  metadataStale,
  nowMs,
  summary,
}: {
  authority: SavingsGrowthAuthority;
  candidates: readonly MorphoVaultCandidate[];
  metadataFetchedAt: string | null;
  metadataStale: boolean;
  nowMs: number;
  summary: SavingsPortfolioSummary;
}): SavingsGrowthAnchor {
  const rawTotal = summary.balance.status === "available"
    ? summary.balance.totalBaseUnits
    : "0";
  const authoritativeBaseUnits = canonicalIntegerPattern.test(rawTotal)
    ? BigInt(rawTotal)
    : BigInt(0);
  const fundedVaults = summary.vaults.filter(
    (vault) => vault.balanceBaseUnits !== null && BigInt(vault.balanceBaseUnits) > BigInt(0),
  );
  const fundedCandidates = fundedVaults.map((vault) =>
    candidates.find(
      (entry) => entry.vaultAddress.toLowerCase() === vault.vaultAddress.toLowerCase(),
    )
  );
  const fundedComposition = fundedVaults.map((vault, index) => [
    vault.vaultAddress.toLowerCase(),
    vault.balanceBaseUnits,
    fundedCandidates[index]?.netApy ?? null,
  ]);
  const identity = JSON.stringify([
    authority.accountIdentity,
    authority.assetIdentity,
    authority.blockNumber,
    authority.blockHash,
    authority.blockTimestamp,
    rawTotal,
    fundedComposition,
  ]);
  const snapshotTimeMs = parseSavingsSnapshotTime(authority.blockTimestamp);
  const eligibleUntilMs = nextSavingsRateExpiryAt(
    fundedCandidates.filter((candidate): candidate is MorphoVaultCandidate => candidate !== undefined),
    metadataFetchedAt,
    nowMs,
  );
  const eligible =
    authoritativeBaseUnits > BigInt(0) &&
    summary.balance.status === "available" &&
    summary.apy.status === "available" &&
    isValidSavingsGrowthApy(summary.apy.value) &&
    fundedCandidates.every((candidate) => candidate !== undefined) &&
    snapshotTimeMs !== null &&
    authority.snapshotStale !== true &&
    authority.registryCoverageComplete &&
    !metadataStale &&
    eligibleUntilMs !== null;
  const estimate: SavingsGrowthEstimate | null = eligible &&
      summary.apy.status === "available" &&
      snapshotTimeMs !== null &&
      eligibleUntilMs !== null
    ? {
        authoritativeBaseUnits,
        apy: summary.apy.value,
        snapshotTimeMs,
        eligibleUntilMs,
      }
    : null;

  return { identity, authoritativeBaseUnits, estimate };
}

export function useEstimatedSavingsGrowth(
  anchor: SavingsGrowthAnchor,
  now: () => number = Date.now,
): bigint {
  const reducedMotion = useReducedMotion();
  const panelActive = useShellPanelActive();
  const previousPanelActive = useRef(panelActive);
  const [sample, setSample] = useState(() => ({
    identity: anchor.identity,
    value: anchor.authoritativeBaseUnits,
  }));
  const [sampleReducedMotion, setSampleReducedMotion] = useState(reducedMotion);

  if (sampleReducedMotion !== reducedMotion) {
    setSampleReducedMotion(reducedMotion);
    setSample({ identity: anchor.identity, value: anchor.authoritativeBaseUnits });
  }

  const visibleValue = anchor.estimate !== null && sample.identity === anchor.identity
    ? sample.value
    : anchor.authoritativeBaseUnits;

  useEffect(() => {
    const resumed = !previousPanelActive.current && panelActive;
    previousPanelActive.current = panelActive;
    if (reducedMotion || anchor.estimate === null || !panelActive) return;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    const clearSample = () => {
      if (timeout !== null) clearTimeout(timeout);
      timeout = null;
    };
    const compute = () => {
      const value = anchor.estimate
        ? estimateSavingsGrowthBaseUnits(anchor.estimate, now())
        : anchor.authoritativeBaseUnits;
      setSample({ identity: anchor.identity, value });
    };
    const schedule = (delay: number = SAMPLE_INTERVAL_MS) => {
      clearSample();
      if (!active || document.hidden) return;
      timeout = setTimeout(() => {
        timeout = null;
        if (!active || document.hidden) return;
        compute();
        schedule();
      }, delay);
    };
    const onVisibilityChange = () => {
      clearSample();
      if (document.hidden) return;
      compute();
      schedule();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule(resumed ? 0 : SAMPLE_INTERVAL_MS);
    return () => {
      active = false;
      clearSample();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [anchor, now, reducedMotion, panelActive]);

  return reducedMotion ? anchor.authoritativeBaseUnits : visibleValue;
}
