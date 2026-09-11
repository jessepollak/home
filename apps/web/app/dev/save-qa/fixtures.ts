import { presentationRegions, type RegionId } from "@/config/regions";
import type { AccountWalletClient } from "@/features/account/cdp-client";
import { BASE_CHAIN_ID } from "@/features/account/session-types";
import type { PreparedMoneyAction } from "@/features/money-actions/types";
import { PORTFOLIO_BASE_USDC_ADDRESS } from "@/features/portfolio/types";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/server/morpho/config";
import type { Address, MorphoVaultCandidate, MorphoVaultPosition, MorphoVaultsResult } from "@/server/morpho/types";

export const SAVE_QA_CLOCK_MS = Date.parse("2026-09-11T12:00:00.000Z");
export const SAVE_QA_OWNER_A = "0x1111111111111111111111111111111111111111" as const;
export const SAVE_QA_OWNER_B = "0x2222222222222222222222222222222222222222" as const;
export const SAVE_QA_GAUNTLET = MORPHO_V1_CANDIDATE_ADDRESSES[1];
export const SAVE_QA_STEAKHOUSE = MORPHO_V1_CANDIDATE_ADDRESSES[0];

export type SaveQaOwner = "a" | "b";
export type SaveQaVaultVariant = "standard" | "missing-rate" | "stale" | "long";
export type SaveQaPositionVariant =
  | "weighted"
  | "zero"
  | "balance-before-apy"
  | "large"
  | "incomplete"
  | "malformed";

export type SaveQaCounters = {
  portfolioReads: number;
  valuationReads: number;
  positionReads: number;
  preparations: number;
  checks: number;
  executions: number;
  sends: number;
  signIns: number;
  signatures: number;
  accountResourceReads: number;
};

export function newSaveQaCounters(): SaveQaCounters {
  return {
    portfolioReads: 0,
    valuationReads: 0,
    positionReads: 0,
    preparations: 0,
    checks: 0,
    executions: 0,
    sends: 0,
    signIns: 0,
    signatures: 0,
    accountResourceReads: 0,
  };
}

export function saveQaAddress(owner: SaveQaOwner): typeof SAVE_QA_OWNER_A | typeof SAVE_QA_OWNER_B {
  return owner === "a" ? SAVE_QA_OWNER_A : SAVE_QA_OWNER_B;
}

export function saveQaSubject(owner: SaveQaOwner): string {
  return `save-qa-subject-${owner}`;
}

function isoAt(clockMs: number, offsetMs = 0): string {
  return new Date(clockMs + offsetMs).toISOString();
}

function candidate(
  vaultAddress: Address,
  name: string,
  netApy: number | null,
  clockMs: number,
): MorphoVaultCandidate {
  const fetchedAt = isoAt(clockMs, -30_000);
  return {
    version: "v1",
    vaultAddress,
    name,
    symbol: "USDC vault",
    listed: true,
    chainId: BASE_CHAIN_ID,
    asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
    curatorAddress: null,
    grossApy: netApy === null ? null : netApy + 0.005,
    netApy,
    feeRate: 0.1,
    totalAssetsRaw: "1000000000000",
    liquidityRaw: "500000000000",
    stateAsOf: fetchedAt,
    blockNumber: "51026404",
    source: {
      provider: "Morpho GraphQL",
      endpoint: "https://api.morpho.org/graphql",
      query: "vaults",
      fetchedAt,
    },
  };
}

export function createSaveQaVaults(
  variant: SaveQaVaultVariant = "standard",
  clockMs = SAVE_QA_CLOCK_MS,
): MorphoVaultsResult {
  const stale = variant === "stale";
  const fixtureClock = stale ? clockMs - 3_600_000 : clockMs;
  const longName = "Institutional USDC Income Strategy With An Intentionally Long Curator Label";
  const steakhouse = candidate(
    SAVE_QA_STEAKHOUSE,
    variant === "long" ? longName : "Steakhouse USDC",
    variant === "missing-rate" ? null : 0.06,
    fixtureClock,
  );
  const gauntlet = candidate(
    SAVE_QA_GAUNTLET,
    variant === "long" ? `${longName} Prime` : "Gauntlet USDC Prime",
    0.04,
    fixtureClock,
  );
  const third = candidate(
    MORPHO_V1_CANDIDATE_ADDRESSES[2],
    "Third USDC Vault",
    0.07,
    fixtureClock,
  );
  return {
    version: "v1",
    chainId: BASE_CHAIN_ID,
    asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
    candidates: [steakhouse, gauntlet, third],
    source: {
      provider: "Morpho GraphQL",
      endpoint: "https://api.morpho.org/graphql",
      query: "vaults",
      fetchedAt: isoAt(fixtureClock, -30_000),
    },
    stale,
  };
}

function position(
  accountAddress: Address,
  vaultAddress: Address,
  assetsRaw: string | null,
  clockMs: number,
): MorphoVaultPosition {
  return {
    version: "v1",
    accountAddress,
    vaultAddress,
    assetsRaw,
    sharesRaw: assetsRaw ?? "0",
    indexedAt: isoAt(clockMs, -20_000),
    source: {
      provider: "Morpho GraphQL",
      endpoint: "https://api.morpho.org/graphql",
      query: "vaultPosition",
      fetchedAt: isoAt(clockMs, -15_000),
    },
    withdrawableRaw: null,
    withdrawableNote: "QA fixture does not query or authorize withdrawal execution.",
  };
}

export function createSaveQaPositions(
  owner: SaveQaOwner,
  variant: SaveQaPositionVariant = "weighted",
  clockMs = SAVE_QA_CLOCK_MS,
): unknown {
  const address = saveQaAddress(owner);
  if (variant === "malformed") return { accountAddress: address, vaults: "invalid" };

  const amounts: Record<string, string | null | undefined> = variant === "weighted"
    ? { [SAVE_QA_GAUNTLET]: "100000000", [SAVE_QA_STEAKHOUSE]: "300000000" }
    : variant === "zero"
      ? {}
      : variant === "large"
        ? { [SAVE_QA_GAUNTLET]: "987654321098765", [SAVE_QA_STEAKHOUSE]: "123456789012345" }
        : variant === "balance-before-apy"
          ? { [SAVE_QA_GAUNTLET]: "100000000" }
          : { [SAVE_QA_GAUNTLET]: "100000000" };

  const vaults = MORPHO_V1_CANDIDATE_ADDRESSES.map((vaultAddress, index) => ({
    vaultAddress,
    position: variant === "incomplete" && index === MORPHO_V1_CANDIDATE_ADDRESSES.length - 1
      ? undefined
      : amounts[vaultAddress]
        ? position(address, vaultAddress, amounts[vaultAddress] ?? null, clockMs)
        : null,
  }));
  if (variant === "incomplete") vaults.pop();

  return {
    accountAddress: address,
    fetchedAt: isoAt(clockMs, -10_000),
    vaults,
  };
}

export function createSaveQaPortfolio(owner: SaveQaOwner, clockMs = SAVE_QA_CLOCK_MS) {
  return {
    walletAddress: saveQaAddress(owner),
    chainId: BASE_CHAIN_ID,
    blockNumber: "51026404",
    blockHash: `0x${"ab".repeat(32)}`,
    blockTimestamp: String(Math.floor(clockMs / 1000)),
    fetchedAt: isoAt(clockMs, -5_000),
    assets: [
      {
        id: "usdc",
        symbol: "USDC",
        decimals: 6,
        kind: "erc20",
        tokenAddress: PORTFOLIO_BASE_USDC_ADDRESS,
        balanceBaseUnits: "999999999999",
      },
      { id: "eth", symbol: "ETH", decimals: 18, kind: "native", balanceBaseUnits: "0" },
    ],
  };
}

export function createSaveQaValuation(owner: SaveQaOwner, region: RegionId, clockMs = SAVE_QA_CLOCK_MS) {
  const currency = presentationRegions[region].currency.code;
  const usdcKey = `eip155:8453/erc20:${PORTFOLIO_BASE_USDC_ADDRESS.toLowerCase()}` as const;
  const holdings = [
    {
      kind: "direct",
      id: "eth",
      assetKey: "eip155:8453/native",
      name: "Ethereum",
      symbol: "ETH",
      decimals: 18,
      assetKind: "native",
      contractAddress: null,
      cashCurrency: null,
      balanceBaseUnits: "0",
      readStatus: "ready",
    },
    {
      kind: "direct",
      id: "usdc",
      assetKey: usdcKey,
      name: "US dollar",
      symbol: "USDC",
      decimals: 6,
      assetKind: "erc20",
      contractAddress: PORTFOLIO_BASE_USDC_ADDRESS,
      cashCurrency: "USD",
      balanceBaseUnits: "999999999999",
      readStatus: "ready",
    },
    ...MORPHO_V1_CANDIDATE_ADDRESSES.map((address, index) => ({
      kind: "vault-position",
      id: `vault-${index}`,
      assetKey: `eip155:8453/erc20:${address.toLowerCase()}`,
      name: `Vault ${index}`,
      symbol: "USDC vault",
      vaultAddress: address,
      decimals: 18,
      underlyingAssetKey: usdcKey,
      underlyingSymbol: "USDC",
      underlyingDecimals: 6,
      sharesBaseUnits: "0",
      underlyingBaseUnits: "0",
      readStatus: "ready",
      conversionMethod: "erc4626-convertToAssets",
    })),
  ];
  return {
    version: 2,
    walletAddress: saveQaAddress(owner),
    chainId: BASE_CHAIN_ID,
    selectedRegion: region,
    quoteCurrency: currency,
    block: { number: "51026404", hash: `0x${"cd".repeat(32)}`, timestamp: String(Math.floor(clockMs / 1000)) },
    fetchedAt: isoAt(clockMs, -5_000),
    inventory: { scope: "configured-base-assets-v1", walletDiscoveryComplete: false, holdings, omissions: [] },
    prices: [],
    fx: currency ? {
      baseCurrency: "USD",
      quoteCurrency: currency,
      quoteUnitsPerUsd: { atoms: "1", scale: 0 },
      sourceValue: "1",
      status: "fresh",
      source: { provider: "Coinbase Exchange Rates", method: "QA fixture", fetchedAt: isoAt(clockMs, -5_000), asOf: null, timeBasis: "retrieved-at" },
    } : null,
    nativeEthQuote: {
      baseCurrency: "USD",
      assetSymbol: "ETH",
      assetUnitsPerUsd: { atoms: "5", scale: 4 },
      sourceValue: "0.0005",
      status: "fresh",
      source: { provider: "Coinbase Exchange Rates", method: "QA fixture", fetchedAt: isoAt(clockMs, -5_000), asOf: null, timeBasis: "retrieved-at" },
    },
    lines: currency ? holdings.map((holding) => ({ holdingAssetKey: holding.assetKey, valueCurrency: currency, value: { atoms: "0", scale: 0 }, status: "priced", reason: null })) : [],
    cashBuckets: [{
      id: `cash:${usdcKey}`,
      roles: currency === "USD" ? ["canonical-usd", "selected-local"] : ["canonical-usd"],
      assetKey: usdcKey,
      symbol: "USDC",
      denominationCurrency: "USD",
      tokenAmountBaseUnits: "999999999999",
      tokenDecimals: 6,
      indicativeValue: { atoms: "999999999999", scale: 6 },
      valuationStatus: "priced",
    }],
    total: {
      label: "supported-portfolio-value",
      status: currency ? "all-supported-read-holdings-priced" : "unavailable-no-quote-currency",
      value: currency ? { atoms: "999999999999", scale: 6 } : null,
      currency,
      unpricedAssetKeys: [],
      unavailableAssetKeys: [],
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createSaveQaPreparedAction(
  owner: SaveQaOwner,
  endpoint: string,
  input: unknown,
  clockMs = SAVE_QA_CLOCK_MS,
): PreparedMoneyAction {
  if (endpoint !== "/api/savings/actions" || !isRecord(input)) {
    throw new Error("QA preparation rejected an unexpected endpoint or payload.");
  }
  const kind = input.kind;
  const vaultAddress = input.vaultAddress;
  const amountBaseUnits = input.amountBaseUnits;
  if (
    (kind !== "deposit" && kind !== "withdraw") ||
    typeof vaultAddress !== "string" ||
    !MORPHO_V1_CANDIDATE_ADDRESSES.some((address) => address.toLowerCase() === vaultAddress.toLowerCase()) ||
    typeof amountBaseUnits !== "string" ||
    !/^[1-9][0-9]*$/.test(amountBaseUnits)
  ) {
    throw new Error("QA preparation rejected a mismatched savings request.");
  }
  const accountProvider = "cdp-embedded" as const;
  return {
    id: `save-qa-${kind}-${amountBaseUnits}`,
    kind: kind === "deposit" ? "save-deposit" : "save-withdraw",
    title: kind === "deposit" ? "Deposit" : "Withdraw",
    calls: [],
    amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits, direction: kind === "deposit" ? "spend" : "receive" }],
    warnings: ["Credential-free QA review fixture. Execution is disabled."],
    createdAt: isoAt(clockMs),
    expiresAt: isoAt(clockMs, 15 * 60_000),
    reviewHash: `qa-review-${kind}-${vaultAddress.toLowerCase()}-${amountBaseUnits}`,
    owner: { subject: saveQaSubject(owner), address: saveQaAddress(owner), chainId: BASE_CHAIN_ID, accountProvider },
  };
}

export function failClosed(method: string): never {
  throw new Error(`SAVE_QA_FAIL_CLOSED:${method}`);
}

export type SaveQaClientOverrides = Pick<AccountWalletClient, "fetchSavingsPositions">;
