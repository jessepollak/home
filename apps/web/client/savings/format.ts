import { BASE_USDC_DECIMALS } from "@/shared/savings/config";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import { formatPresentationPercentage } from "@/shared/formatting";
import { getSavingsRateState } from "./portfolio-summary";
export { readUsdcBaseUnits } from "@/shared/savings/contracts/positions";

export function preferredSavingsCandidates(
  candidates: readonly MorphoVaultCandidate[],
): MorphoVaultCandidate[] {
  return [...candidates].sort(
    (left, right) =>
      Number(/gauntlet/i.test(right.name)) -
      Number(/gauntlet/i.test(left.name)),
  );
}

export function savingsVaultApyLabel(
  candidate: MorphoVaultCandidate,
  metadata: MorphoVaultsResult,
  nowMs: number,
): string | null {
  const rate = getSavingsRateState(candidate, {
    metadataFetchedAt: metadata.source.fetchedAt,
    metadataStale: metadata.stale,
    nowMs,
  });
  if (rate.status === "unavailable") return null;
  return `${formatPresentationPercentage(rate.value)} APY`;
}

export function parseUsdcAmount(value: string): string {
  const match = /^([0-9]+)(?:\.([0-9]+))?$/.exec(value.trim().replace(/\.$/, ""));
  if (!match) {
    throw new Error("Enter a positive USDC amount using decimal digits only.");
  }
  const fraction = match[2] ?? "";
  if (fraction.length > BASE_USDC_DECIMALS) {
    throw new Error("USDC supports at most 6 decimal places.");
  }
  const whole = match[1].replace(/^0+(?=\d)/, "");
  const raw = BigInt(`${whole}${fraction.padEnd(BASE_USDC_DECIMALS, "0")}`);
  if (raw <= BigInt(0)) {
    throw new Error("Enter a positive USDC amount.");
  }
  return raw.toString(10);
}
