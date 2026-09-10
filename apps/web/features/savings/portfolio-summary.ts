import type { MorphoVaultCandidate, MorphoVaultPosition } from "@/server/morpho/types";

const canonicalIntegerPattern = /^(?:0|[1-9][0-9]*)$/;
const decimalPattern = /^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i;

export const SAVINGS_RATE_FRESHNESS_MS = 5 * 60_000;
const SAVINGS_RATE_MAX_FUTURE_SKEW_MS = 60_000;

export type SavingsAssetIdentity = {
  address: string;
  symbol: string;
  decimals: number;
};

export type SavingsPortfolioPosition = {
  vaultAddress: string;
  position: Pick<MorphoVaultPosition, "assetsRaw"> | null;
};

export type ExactSavingsApy = {
  numerator: bigint;
  denominator: bigint;
};

export type SavingsApySummary =
  | { status: "available"; value: ExactSavingsApy }
  | { status: "partial" | "unavailable" | "stale"; value: null };

export type SavingsRateState =
  | { status: "available"; value: number }
  | { status: "unavailable" | "stale"; value: null };

export type SavingsPortfolioSummary = {
  balance:
    | {
        status: "available";
        asset: SavingsAssetIdentity;
        totalBaseUnits: string;
      }
    | {
        status: "unavailable";
        asset: null;
        totalBaseUnits: null;
        reason: "positions-incomplete" | "asset-mismatch";
      };
  apy: SavingsApySummary;
  funded: boolean;
  vaults: Array<{
    vaultAddress: string;
    balanceBaseUnits: string | null;
  }>;
};

export type SummarizeSavingsPortfolioInput = {
  supportedVaultAddresses: readonly string[];
  requiredAsset: SavingsAssetIdentity;
  candidates: readonly MorphoVaultCandidate[];
  positions: readonly SavingsPortfolioPosition[];
  metadataFetchedAt?: string | null;
  metadataStale?: boolean;
  nowMs?: number;
};

/**
 * Produces the owner-independent savings math shared by Save and future Home previews.
 * All balance weighting and division stays in integer/rational form; rounding belongs
 * only in the presentation formatter below.
 */
export function summarizeSavingsPortfolio({
  supportedVaultAddresses,
  requiredAsset,
  candidates,
  positions,
  metadataFetchedAt = null,
  metadataStale = false,
  nowMs = Date.now(),
}: SummarizeSavingsPortfolioInput): SavingsPortfolioSummary {
  const supported = normalizedUniqueSet(supportedVaultAddresses);
  const positionMap = normalizedUniqueMap(positions, (entry) => entry.vaultAddress);
  const positionsComplete = Boolean(
    supported &&
      positionMap &&
      positionMap.size === supported.size &&
      [...supported].every((address) => positionMap.has(address)),
  );

  const vaults = supportedVaultAddresses.map((vaultAddress) => {
    const entry = positionMap?.get(vaultAddress.toLowerCase());
    const balanceBaseUnits = entry
      ? entry.position === null
        ? "0"
        : canonicalAmount(entry.position.assetsRaw)
      : null;
    return { vaultAddress, balanceBaseUnits };
  });

  if (!positionsComplete || vaults.some((vault) => vault.balanceBaseUnits === null)) {
    return unavailableSummary(vaults, "positions-incomplete");
  }

  const fundedVaults = vaults.filter(
    (vault) => BigInt(vault.balanceBaseUnits!) > BigInt(0),
  );
  if (fundedVaults.length === 0) {
    return {
      balance: {
        status: "available",
        asset: requiredAsset,
        totalBaseUnits: "0",
      },
      apy: { status: "unavailable", value: null },
      funded: false,
      vaults,
    };
  }

  const total = fundedVaults.reduce(
    (sum, vault) => sum + BigInt(vault.balanceBaseUnits!),
    BigInt(0),
  );
  const balance: Extract<SavingsPortfolioSummary["balance"], { status: "available" }> = {
    status: "available",
    asset: requiredAsset,
    totalBaseUnits: total.toString(),
  };
  const candidateMap = normalizedUniqueMap(candidates, (candidate) => candidate.vaultAddress);
  const fundedCandidates = fundedVaults.map((vault) =>
    candidateMap?.get(vault.vaultAddress.toLowerCase()) ?? null
  );

  if (
    fundedCandidates.some((candidate) => candidate && !sameAsset(candidate.asset, requiredAsset))
  ) {
    return unavailableSummary(vaults, "asset-mismatch");
  }

  if (!candidateMap || fundedCandidates.some((candidate) => candidate === null)) {
    return { balance, apy: { status: "unavailable", value: null }, funded: true, vaults };
  }

  const rates = fundedCandidates.map((candidate) => getSavingsRateState(candidate!, {
    metadataFetchedAt,
    metadataStale,
    nowMs,
  }));
  if (rates.some((rate) => rate.status === "stale")) {
    return { balance, apy: { status: "stale", value: null }, funded: true, vaults };
  }

  const exactRates = rates.map((rate) =>
    rate.status === "available" ? exactNonNegativeDecimal(rate.value) : null
  );
  const validRateCount = exactRates.filter((rate) => rate !== null).length;
  if (validRateCount !== exactRates.length) {
    return {
      balance,
      apy: {
        status: validRateCount === 0 ? "unavailable" : "partial",
        value: null,
      },
      funded: true,
      vaults,
    };
  }

  const maximumScale = exactRates.reduce((maximum, rate) => Math.max(maximum, rate!.scale), 0);
  const scaleFactor = BigInt(10) ** BigInt(maximumScale);
  const numerator = fundedVaults.reduce((sum, vault, index) => {
    const rate = exactRates[index]!;
    const alignedRate = rate.atoms * BigInt(10) ** BigInt(maximumScale - rate.scale);
    return sum + BigInt(vault.balanceBaseUnits!) * alignedRate;
  }, BigInt(0));

  return {
    balance,
    apy: {
      status: "available",
      value: {
        numerator,
        denominator: total * scaleFactor,
      },
    },
    funded: true,
    vaults,
  };
}

export function getSavingsRateState(
  candidate: MorphoVaultCandidate,
  {
    metadataFetchedAt,
    metadataStale = false,
    nowMs = Date.now(),
  }: {
    metadataFetchedAt?: string | null;
    metadataStale?: boolean;
    nowMs?: number;
  } = {},
): SavingsRateState {
  if (exactNonNegativeDecimal(candidate.netApy) === null) {
    return { status: "unavailable", value: null };
  }

  const timestamps = [candidate.stateAsOf, candidate.source.fetchedAt, metadataFetchedAt];
  const parsed = timestamps.map(parseTimestamp);
  if (parsed.some((timestamp) => timestamp === null)) {
    return { status: "unavailable", value: null };
  }
  if (parsed.some((timestamp) => timestamp! > nowMs + SAVINGS_RATE_MAX_FUTURE_SKEW_MS)) {
    return { status: "unavailable", value: null };
  }
  if (
    metadataStale ||
    parsed.some((timestamp) => nowMs - timestamp! > SAVINGS_RATE_FRESHNESS_MS)
  ) {
    return { status: "stale", value: null };
  }
  return { status: "available", value: candidate.netApy! };
}

export function nextSavingsRateExpiryAt(
  candidates: readonly MorphoVaultCandidate[],
  metadataFetchedAt: string | null,
  nowMs: number,
): number | null {
  const timestamps = candidates.flatMap((candidate) => [
    parseTimestamp(candidate.stateAsOf),
    parseTimestamp(candidate.source.fetchedAt),
  ]);
  timestamps.push(parseTimestamp(metadataFetchedAt));
  const futureExpirations = timestamps
    .filter((timestamp): timestamp is number => timestamp !== null)
    .map((timestamp) => timestamp + SAVINGS_RATE_FRESHNESS_MS + 1)
    .filter((expiresAt) => expiresAt > nowMs);
  return futureExpirations.length > 0 ? Math.min(...futureExpirations) : null;
}

export function formatExactSavingsApy(value: ExactSavingsApy): string {
  if (value.denominator <= BigInt(0) || value.numerator < BigInt(0)) return "—";
  const percentageHundredths = divideAndRound(
    value.numerator * BigInt(10_000),
    value.denominator,
  );
  if (percentageHundredths === BigInt(0)) return "0%";
  const whole = percentageHundredths / BigInt(100);
  const fraction = (percentageHundredths % BigInt(100)).toString().padStart(2, "0");
  return `${whole}.${fraction}%`;
}

function unavailableSummary(
  vaults: SavingsPortfolioSummary["vaults"],
  reason: Extract<SavingsPortfolioSummary["balance"], { status: "unavailable" }>["reason"],
): SavingsPortfolioSummary {
  return {
    balance: { status: "unavailable", asset: null, totalBaseUnits: null, reason },
    apy: { status: "unavailable", value: null },
    funded: vaults.some(
      (vault) =>
        vault.balanceBaseUnits !== null && BigInt(vault.balanceBaseUnits) > BigInt(0),
    ),
    vaults,
  };
}

function canonicalAmount(value: string | null): string | null {
  return value !== null && canonicalIntegerPattern.test(value) ? value : null;
}

function normalizedUniqueSet(values: readonly string[]): Set<string> | null {
  const normalized = values.map((value) => value.toLowerCase());
  const result = new Set(normalized);
  return result.size === normalized.length ? result : null;
}

function normalizedUniqueMap<T>(
  values: readonly T[],
  address: (value: T) => string,
): Map<string, T> | null {
  const result = new Map<string, T>();
  for (const value of values) {
    const normalized = address(value).toLowerCase();
    if (result.has(normalized)) return null;
    result.set(normalized, value);
  }
  return result;
}

function sameAsset(left: SavingsAssetIdentity, right: SavingsAssetIdentity): boolean {
  return left.address.toLowerCase() === right.address.toLowerCase() &&
    left.symbol.toUpperCase() === right.symbol.toUpperCase() &&
    left.decimals === right.decimals;
}

function exactNonNegativeDecimal(value: number | null): { atoms: bigint; scale: number } | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  const match = decimalPattern.exec(value.toString());
  if (!match) return null;

  const fraction = match[2] ?? "";
  const exponent = Number(match[3] ?? "0");
  if (!Number.isSafeInteger(exponent)) return null;

  let digits = `${match[1]}${fraction}`.replace(/^0+(?=\d)/, "");
  let scale = fraction.length - exponent;
  if (scale < 0) {
    digits += "0".repeat(-scale);
    scale = 0;
  }
  if (scale > 10_000) return null;
  return { atoms: BigInt(digits || "0"), scale };
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function divideAndRound(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * BigInt(2) >= denominator ? quotient + BigInt(1) : quotient;
}
