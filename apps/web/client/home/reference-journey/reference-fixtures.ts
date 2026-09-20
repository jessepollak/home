import type { AccountWalletClient } from "@/client/account/cdp-client";
import type { UseActivityResult } from "@/client/activity/use-activity";
import type { ActivityPage, ActivityTransfer } from "@/shared/activity/types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import type { SavingsPortfolioPosition } from "@/client/savings/portfolio-summary";
import {
  BASE_USDC_ADDRESS,
  BASE_USDC_DECIMALS,
  MORPHO_V1_CANDIDATE_ADDRESSES,
} from "@/shared/savings/config";
import type { ReferenceMoneyPosition, ReferenceSavedSlice } from "./reference-position";

/**
 * Fixture builders for the reference journey proposal
 * ([issue #654](https://github.com/jessepollak/home/issues/654)).
 *
 * Reference stories and the focused reference behavior tests import the same values, so
 * this module cannot live behind a `*.stories.*` path. It imports no Storybook, MSW, or
 * provider code, and it is not reachable from `HomeShell`. Every amount below is a
 * fixture value; no story or test reaches a provider, database, wallet, or live service.
 */

export const REFERENCE_FIXTURE_ISO = "2026-09-19T12:04:00.000Z";
export const REFERENCE_FIXTURE_NOW_MS = Date.parse(REFERENCE_FIXTURE_ISO);
export const REFERENCE_ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
export const REFERENCE_COUNTERPARTY = "0x2222222222222222222222222222222222222222" as const;
const REFERENCE_SOURCE_FETCHED_AT = "2026-09-19T12:03:00.000Z";
const REFERENCE_HASH = `0x${"ab".repeat(32)}` as const;
const REFERENCE_DEPOSIT_HASH = `0x${"cd".repeat(32)}` as const;
const [STEAKHOUSE, GAUNTLET, RE7] = MORPHO_V1_CANDIDATE_ADDRESSES;

export const referenceSession: VerifiedAccountSession = {
  user: { subject: "reference-journey-owner" },
  smartAccount: { address: REFERENCE_ACCOUNT, chainId: 8453 },
  accountProvider: "cdp-embedded",
};

function candidate(
  vaultAddress: MorphoVaultCandidate["vaultAddress"],
  name: string,
  netApy: number,
  curatorAddress: MorphoVaultCandidate["curatorAddress"] = null,
): MorphoVaultCandidate {
  return {
    version: "v1",
    vaultAddress,
    name,
    symbol: "USDC vault",
    listed: true,
    chainId: 8453,
    asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: BASE_USDC_DECIMALS },
    curatorAddress,
    grossApy: netApy + 0.005,
    netApy,
    feeRate: 0.1,
    totalAssetsRaw: "1250000000000",
    liquidityRaw: "850000000000",
    stateAsOf: REFERENCE_FIXTURE_ISO,
    blockNumber: "51026404",
    source: {
      provider: "Morpho GraphQL",
      endpoint: "https://api.morpho.org/graphql",
      query: "vaults",
      fetchedAt: REFERENCE_SOURCE_FETCHED_AT,
    },
  };
}

const steakhouse = candidate(STEAKHOUSE, "Steakhouse USDC", 0.0385);
const gauntlet = candidate(
  GAUNTLET,
  "Gauntlet USDC Prime",
  0.041,
  "0x1234567890abcdef1234567890abcdef12345678",
);
const re7 = candidate(RE7, "Re7 USDC", 0.0351);

export const referenceVaultMetadata: MorphoVaultsResult = {
  version: "v1",
  chainId: 8453,
  asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: BASE_USDC_DECIMALS },
  candidates: [steakhouse, gauntlet, re7],
  source: {
    provider: "Morpho GraphQL",
    endpoint: "https://api.morpho.org/graphql",
    query: "vaults",
    fetchedAt: REFERENCE_SOURCE_FETCHED_AT,
  },
  stale: false,
};

export const referenceLongLabelMetadata: MorphoVaultsResult = {
  ...referenceVaultMetadata,
  candidates: [
    {
      ...steakhouse,
      name: "Steakhouse International Canonical USDC Savings Reserve",
    },
    {
      ...gauntlet,
      name: "Gauntlet Diversified Onchain Treasury Savings Strategy Prime",
    },
    re7,
  ],
};

export function referencePositions(
  amounts: Partial<Record<string, string | null>> = {},
): SavingsPortfolioPosition[] {
  return MORPHO_V1_CANDIDATE_ADDRESSES.map((vaultAddress) => ({
    vaultAddress,
    position: amounts[vaultAddress] === null
      ? null
      : { assetsRaw: amounts[vaultAddress] ?? "0" },
  }));
}

/** Gauntlet 750 USDC at 4.10% and Steakhouse 250 USDC at 3.85%, Re7 empty. */
export const referenceFundedPositions = referencePositions({
  [GAUNTLET]: "750000000",
  [STEAKHOUSE]: "250000000",
  [RE7]: "0",
});

function savedSlice(
  metadata: MorphoVaultsResult = referenceVaultMetadata,
  positions: SavingsPortfolioPosition[] = referenceFundedPositions,
): ReferenceSavedSlice {
  return { status: "available", metadata, positions };
}

export function referencePosition(overrides: Partial<ReferenceMoneyPosition> = {}): ReferenceMoneyPosition {
  return {
    status: "ready",
    cash: { status: "available", baseUnits: "250000000" },
    saved: savedSlice(),
    debt: { status: "verified", baseUnits: "0" },
    nowMs: REFERENCE_FIXTURE_NOW_MS,
    regionId: "US",
    ...overrides,
  };
}

/** Cash 250 USDC plus saved 1,000 USDC: net position 1,250.00 with verified zero debt. */
export const referenceFundedPosition = referencePosition();

export const referenceLoadingPosition = referencePosition({ status: "loading" });

export const referenceEmptyPosition = referencePosition({
  cash: { status: "available", baseUnits: "0" },
  saved: savedSlice(referenceVaultMetadata, referencePositions()),
});

export const referenceUnavailableCashPosition = referencePosition({
  cash: { status: "unavailable" },
});

export const referenceUnavailableSavedPosition = referencePosition({
  saved: { status: "unavailable" },
});

export const referenceUnavailableDebtPosition = referencePosition({
  debt: { status: "unavailable" },
});

export const referenceDebtPosition = referencePosition({
  debt: { status: "verified", baseUnits: "500000000" },
});

/** Realistic large values plus long localized labels; the shared formatting path renders them. */
export const referenceLongContentPosition = referencePosition({
  cash: { status: "available", baseUnits: "1234567890000" },
  saved: savedSlice(referenceLongLabelMetadata, referencePositions({
    [GAUNTLET]: "9876543210000",
    [STEAKHOUSE]: "1234567890000",
    [RE7]: "0",
  })),
});

/** Local cash without a configured display quote: it renders and the total stays partial. */
export const referenceLocalCashPosition = referencePosition({
  localCash: [
    {
      key: "reference-cash-idr",
      name: "Indonesian rupiah",
      currency: "IDR",
      atoms: "12345678901234",
      scale: 2,
    },
  ],
});

export function referenceActivity(): UseActivityResult {
  const page: ActivityPage = {
    walletAddress: REFERENCE_ACCOUNT,
    chainId: 8453,
    window: { from: "2026-08-19T12:04:00.000Z", to: REFERENCE_FIXTURE_ISO },
    transfers: [
      referenceTransfer("received-250", "incoming", "250000000", "2026-09-19T11:40:00.000Z"),
      referenceTransfer("received-1000", "incoming", "1000000000", "2026-09-18T15:12:00.000Z"),
      referenceTransfer("deposited-1000", "outgoing", "1000000000", "2026-09-18T15:20:00.000Z"),
    ],
    nextCursor: null,
    source: {
      provider: "cdp-sql",
      cached: false,
      stale: false,
      executionTimestamp: REFERENCE_FIXTURE_ISO,
      executionTimeMs: 120,
      fetchedAt: REFERENCE_FIXTURE_ISO,
    },
  };
  return {
    status: "ready",
    page,
    loadingMore: false,
    loadMoreError: false,
    autoLoadPaused: false,
    retry: () => {},
    refresh: () => {},
    loadMore: () => {},
    retryLoadMore: () => {},
  };
}

export function referenceEmptyActivity(): UseActivityResult {
  const base = referenceActivity();
  return {
    ...base,
    status: "ready",
    page: { ...base.page!, transfers: [] },
  };
}

function referenceTransfer(
  id: string,
  direction: ActivityTransfer["direction"],
  amountBaseUnits: string,
  blockTimestamp: string,
): ActivityTransfer {
  return {
    id,
    logId: id,
    chainId: 8453,
    assetId: "usdc",
    tokenAddress: BASE_USDC_ADDRESS,
    tokenSymbol: "USDC",
    tokenDecimals: BASE_USDC_DECIMALS,
    walletAddress: REFERENCE_ACCOUNT,
    fromAddress: direction === "incoming" ? REFERENCE_COUNTERPARTY : REFERENCE_ACCOUNT,
    toAddress: direction === "incoming" ? REFERENCE_ACCOUNT : REFERENCE_COUNTERPARTY,
    direction,
    amountBaseUnits,
    blockNumber: "51026404",
    blockHash: REFERENCE_HASH,
    // Each transfer keeps a distinct transaction hash so a recorded Home action is not
    // deduped against it by the production activity feed.
    transactionHash: `0x${id.replace(/[^0-9a-f]/gi, "0").toLowerCase().padEnd(64, "0").slice(0, 64)}`,
    logIndex: "0",
    blockTimestamp,
  };
}

export function referencePreparedDeposit(input: {
  vaultAddress: string;
  vaultName: string;
  amountBaseUnits: string;
  netApy: number;
}): PreparedMoneyAction {
  const sharePreviewBaseUnits = referenceSharePreviewBaseUnits(input.amountBaseUnits);
  return {
    id: `reference-${input.vaultAddress.slice(2, 8)}-${input.amountBaseUnits}`,
    kind: "savings-deposit",
    title: "Deposit USDC",
    createdAt: REFERENCE_FIXTURE_ISO,
    expiresAt: "2099-09-19T12:04:00.000Z",
    calls: [],
    amounts: [
      {
        assetId: "usdc",
        symbol: "USDC",
        decimals: BASE_USDC_DECIMALS,
        amountBaseUnits: input.amountBaseUnits,
        direction: "spend",
      },
      {
        assetId: "vault",
        symbol: "vault shares",
        decimals: 18,
        amountBaseUnits: sharePreviewBaseUnits,
        direction: "receive",
        estimated: true,
      },
    ],
    warnings: [],
    metadata: {
      product: "savings",
      operation: "deposit",
      vaultAddress: input.vaultAddress as `0x${string}`,
      vaultName: input.vaultName,
      network: { name: "Base", chainId: 8453 },
      feeWad: "100000000000000000",
      limitBaseUnits: "500000000",
      previewSharesBaseUnits: sharePreviewBaseUnits,
      shareDecimals: 18,
      exchangeConstraint: "deposit-preview-no-minimum-shares",
      discoveryRate: {
        status: "current",
        netApy: input.netApy.toString(),
        fetchedAt: REFERENCE_SOURCE_FETCHED_AT,
        stateAsOf: REFERENCE_FIXTURE_ISO,
      },
      source: {
        blockNumber: "51026404",
        blockHash: REFERENCE_HASH,
        blockTimestamp: "1789041840",
      },
    },
    owner: {
      subject: referenceSession.user.subject,
      address: REFERENCE_ACCOUNT,
      chainId: 8453,
      accountProvider: referenceSession.accountProvider,
    },
  };
}

/** Echoes the requested vault and amount so the existing dialog review stays authoritative. */
export function referencePrepareMoneyAction(
  metadata: MorphoVaultsResult,
): AccountWalletClient["prepareMoneyAction"] {
  return async (_endpoint, rawInput) => {
    const input = rawInput as {
      vaultAddress?: string;
      amountBaseUnits?: string;
    };
    const vault = metadata.candidates.find(
      (entry) => entry.vaultAddress.toLowerCase() === (input.vaultAddress ?? "").toLowerCase(),
    );
    if (!vault || !input.amountBaseUnits || typeof vault.netApy !== "number") {
      throw new Error("The reference fixture only prepares deposits for its own vaults.");
    }
    return referencePreparedDeposit({
      vaultAddress: vault.vaultAddress,
      vaultName: vault.name,
      netApy: vault.netApy,
      amountBaseUnits: input.amountBaseUnits,
    });
  };
}

/** Resolves on the next microtask; no fixture or test sleeps on wall-clock time. */
export function referenceExecuteMoneyAction(
  status: "confirmed" | "failed",
): AccountWalletClient["executeMoneyAction"] {
  return async (action) => status === "failed"
    ? { id: action.id, status: "failed" }
    : { id: action.id, status: "confirmed", transactionHash: REFERENCE_DEPOSIT_HASH };
}

/** USDC has 6 decimals and vault shares have 18, so the preview scales by 10^12. */
export function referenceSharePreviewBaseUnits(usdcBaseUnits: string): string {
  return (BigInt(usdcBaseUnits) * BigInt("1000000000000")).toString(10);
}
