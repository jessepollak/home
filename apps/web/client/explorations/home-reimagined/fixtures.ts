import type { RegionId } from "@/config/regions";
import type { SavingsPortfolioPosition } from "@/client/savings/portfolio-summary";
import type { ActivityTransfer } from "@/shared/activity/types";
import {
  BASE_USDC_ADDRESS,
  BASE_USDC_DECIMALS,
  MORPHO_V1_CANDIDATE_ADDRESSES,
} from "@/shared/savings/config";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import type {
  ExplorationMoneyState,
  ExplorationMovement,
  MoveMoneyOutcome,
} from "./money-state";

/**
 * Fixed facts for the Home reimagined exploration of
 * [issue #662](https://github.com/jessepollak/home/issues/662).
 *
 * Every value here is a fixture. Nothing in this module reaches a provider, database,
 * wallet, or live service, and each story or test that uses it renders the same clock,
 * the same balances, and the same movement history.
 *
 * The funded set is:
 * - cash 250 USDC available to use
 * - Gauntlet 750 USDC at 4.10% and Steakhouse 250 USDC at 3.85% (Re7 empty)
 * - saved 1,000 USDC, weighted rate 4.04%, net position 1,250 USDC, verified zero debt
 *
 * The shared move-money action saves 100 USDC into Gauntlet and, only once confirmed,
 * lands on cash 150, Gauntlet 850, saved 1,100, net position 1,250.
 */

export const REIMAGINED_CLOCK_ISO = "2026-09-19T12:04:00.000Z";
export const REIMAGINED_CLOCK_MS = Date.parse(REIMAGINED_CLOCK_ISO);
export const REIMAGINED_REGION: RegionId = "US";
export const REIMAGINED_ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
export const REIMAGINED_COUNTERPARTY = "0x2222222222222222222222222222222222222222" as const;
/** A plain outgoing counterparty; the history does not attribute the deposit to a vault. */
export const REIMAGINED_OUTGOING_COUNTERPARTY =
  "0x3333333333333333333333333333333333333333" as const;
export const REIMAGINED_SAVE_AMOUNT_BASE_UNITS = "100000000";

const SOURCE_FETCHED_AT = "2026-09-19T12:03:00.000Z";
const TRANSFER_HASH = `0x${"ab".repeat(32)}` as const;
const CONFIRMED_HASH = `0x${"cd".repeat(32)}` as const;

/** Token address for a plain USDC transfer; deposit rows use the vault address. */
const USDC_TOKEN_ADDRESS = BASE_USDC_ADDRESS;
const vaultAddressList = MORPHO_V1_CANDIDATE_ADDRESSES;

function candidateAt(index: number, name: string, netApy: number): MorphoVaultCandidate {
  return {
    version: "v1",
    vaultAddress: vaultAddressList[index],
    name,
    symbol: "USDC vault",
    listed: true,
    chainId: 8453,
    asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: BASE_USDC_DECIMALS },
    curatorAddress: null,
    grossApy: netApy + 0.0025,
    netApy,
    feeRate: 0.1,
    totalAssetsRaw: "1250000000000",
    liquidityRaw: "850000000000",
    stateAsOf: REIMAGINED_CLOCK_ISO,
    blockNumber: "51026404",
    source: {
      provider: "Morpho GraphQL",
      endpoint: "https://api.morpho.org/graphql",
      query: "vaults",
      fetchedAt: SOURCE_FETCHED_AT,
    },
  };
}

export type ReimaginedVaultKey = "steakhouse" | "gauntlet" | "re7";

const vaultIndex: Record<ReimaginedVaultKey, number> = {
  steakhouse: 0,
  gauntlet: 1,
  re7: 2,
};

const vaultDisplayName: Record<ReimaginedVaultKey, string> = {
  steakhouse: "Steakhouse USDC vault",
  gauntlet: "Gauntlet USDC Core vault",
  re7: "Re7 USDC vault",
};

const vaultRate: Record<ReimaginedVaultKey, number> = {
  steakhouse: 0.0385,
  gauntlet: 0.041,
  re7: 0.0351,
};

export const REIMAGINED_VAULT_ADDRESSES = {
  steakhouse: vaultAddressList[vaultIndex.steakhouse],
  gauntlet: vaultAddressList[vaultIndex.gauntlet],
  re7: vaultAddressList[vaultIndex.re7],
} as const;

export function reimaginedVaultMetadata(
  overrides: Partial<Record<ReimaginedVaultKey, string>> = {},
): MorphoVaultsResult {
  return {
    version: "v1",
    chainId: 8453,
    asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: BASE_USDC_DECIMALS },
    candidates: (["steakhouse", "gauntlet", "re7"] as const).map((key) =>
      candidateAt(
        vaultIndex[key],
        overrides[key] ?? vaultDisplayName[key],
        vaultRate[key],
      ),
    ),
    source: {
      provider: "Morpho GraphQL",
      endpoint: "https://api.morpho.org/graphql",
      query: "vaults",
      fetchedAt: SOURCE_FETCHED_AT,
    },
    stale: false,
  };
}

export function reimaginedPositions(
  amounts: Partial<Record<ReimaginedVaultKey, string | null>> = {},
): SavingsPortfolioPosition[] {
  return (["steakhouse", "gauntlet", "re7"] as const).map((key) => ({
    vaultAddress: vaultAddressList[vaultIndex[key]],
    position: amounts[key] === null
      ? null
      : { assetsRaw: amounts[key] ?? "0" },
  }));
}

/** Gauntlet 750 and Steakhouse 250; Re7 holds nothing. */
function reimaginedFundedPositions(): SavingsPortfolioPosition[] {
  return reimaginedPositions({
    steakhouse: "250000000",
    gauntlet: "750000000",
    re7: "0",
  });
}

function savedSlice(
  metadata: MorphoVaultsResult = reimaginedVaultMetadata(),
  positions: readonly SavingsPortfolioPosition[] = reimaginedFundedPositions(),
): Extract<ExplorationMoneyState["saved"], { status: "available" }> {
  return { status: "available", metadata, positions };
}

function reimaginedTransfers(): ActivityTransfer[] {
  return [
    reimaginedTransfer({
      id: "received-250",
      direction: "incoming",
      amountBaseUnits: "250000000",
      blockTimestamp: "2026-09-19T11:40:00.000Z",
    }),
    reimaginedTransfer({
      id: "received-1000",
      direction: "incoming",
      amountBaseUnits: "1000000000",
      blockTimestamp: "2026-09-18T15:12:00.000Z",
    }),
    reimaginedTransfer({
      id: "deposited-1000",
      direction: "outgoing",
      amountBaseUnits: "1000000000",
      blockTimestamp: "2026-09-18T15:20:00.000Z",
    }),
  ];
}

/**
 * Each row keeps a distinct transaction hash and log index so a recorded movement is never
 * deduped against a fixture transfer. The historical deposit carries an opaque counterparty
 * rather than a vault attribution the funded facts do not support.
 */
function reimaginedTransfer(input: {
  id: string;
  direction: ActivityTransfer["direction"];
  amountBaseUnits: string;
  blockTimestamp: string;
}): ActivityTransfer {
  return {
    id: input.id,
    logId: input.id,
    chainId: 8453,
    assetId: "usdc",
    tokenAddress: USDC_TOKEN_ADDRESS,
    tokenSymbol: "USDC",
    tokenDecimals: BASE_USDC_DECIMALS,
    walletAddress: REIMAGINED_ACCOUNT,
    fromAddress: input.direction === "incoming" ? REIMAGINED_COUNTERPARTY : REIMAGINED_ACCOUNT,
    toAddress: input.direction === "incoming"
      ? REIMAGINED_ACCOUNT
      : REIMAGINED_OUTGOING_COUNTERPARTY,
    direction: input.direction,
    amountBaseUnits: input.amountBaseUnits,
    blockNumber: "51026404",
    blockHash: TRANSFER_HASH,
    transactionHash: `0x${input.id.replace(/[^a-z0-9]/gi, "").toLowerCase().padEnd(64, "0").slice(0, 64)}` as `0x${string}`,
    logIndex: input.direction === "incoming" ? "0" : "1",
    blockTimestamp: input.blockTimestamp,
  };
}

function movement(input: {
  id: string;
  key: ReimaginedVaultKey;
  amountBaseUnits?: string;
  status: ExplorationMovement["status"];
  recordedAt: string;
  resolvedAt?: string;
  transactionHash?: string;
}): ExplorationMovement {
  return {
    id: input.id,
    kind: "save",
    vaultAddress: REIMAGINED_VAULT_ADDRESSES[input.key],
    vaultName: vaultDisplayName[input.key],
    amountBaseUnits: input.amountBaseUnits ?? REIMAGINED_SAVE_AMOUNT_BASE_UNITS,
    status: input.status,
    recordedAt: input.recordedAt,
    resolvedAt: input.resolvedAt ?? null,
    transactionHash: input.transactionHash ?? null,
  };
}

export function reimaginedMovement(
  overrides: Partial<ExplorationMovement> = {},
): ExplorationMovement {
  return { ...movement({
    id: "movement-gauntlet-100",
    key: "gauntlet",
    status: "pending",
    recordedAt: "2026-09-19T12:03:00.000Z",
  }), ...overrides };
}

function baseState(
  overrides: Partial<ExplorationMoneyState> = {},
): ExplorationMoneyState {
  return {
    status: "ready",
    cash: { status: "available", baseUnits: "250000000" },
    saved: savedSlice(),
    debt: { status: "verified", baseUnits: "0" },
    history: reimaginedTransfers(),
    movements: [],
    nowMs: REIMAGINED_CLOCK_MS,
    regionId: REIMAGINED_REGION,
    ...overrides,
  };
}

/** Cash 250 + saved 1,000 − debt 0: net 1,250.00 with a weighted 4.04% rate. */
export function reimaginedFundedState(): ExplorationMoneyState {
  return baseState();
}

export function reimaginedLoadingState(): ExplorationMoneyState {
  return baseState({
    status: "loading",
    cash: { status: "loading" },
    saved: { status: "loading" },
    debt: { status: "loading" },
    movements: [],
  });
}

/** A verified read that genuinely holds nothing: every slice answered, all zeros. */
export function reimaginedEmptyState(): ExplorationMoneyState {
  return baseState({
    cash: { status: "available", baseUnits: "0" },
    saved: savedSlice(reimaginedVaultMetadata(), reimaginedPositions()),
    movements: [],
    history: [],
  });
}

export function reimaginedSavedUnavailableState(): ExplorationMoneyState {
  return baseState({ saved: { status: "unavailable" } });
}

export function reimaginedCashUnavailableState(): ExplorationMoneyState {
  return baseState({ cash: { status: "unavailable" } });
}

/** Positive debt stays visible and is subtracted from the net position. */
export function reimaginedDebtState(): ExplorationMoneyState {
  return baseState({ debt: { status: "verified", baseUnits: "500000000" } });
}

/** A movement recorded before it settles; balances stay exactly as funded. */
export function reimaginedPendingState(): ExplorationMoneyState {
  return baseState({ movements: [reimaginedMovement()] });
}

export function reimaginedFailedState(): ExplorationMoneyState {
  return baseState({
    movements: [
      reimaginedMovement({
        id: "movement-gauntlet-100-failed",
        status: "failed",
        recordedAt: "2026-09-19T11:52:00.000Z",
        resolvedAt: "2026-09-19T11:53:00.000Z",
      }),
    ],
  });
}

/** An outcome the wallet could not confirm. Nothing moved and nothing retries. */
export function reimaginedUnknownState(): ExplorationMoneyState {
  return baseState({
    movements: [
      reimaginedMovement({
        id: "movement-gauntlet-100-unknown",
        status: "unknown",
        recordedAt: "2026-09-19T11:30:00.000Z",
        resolvedAt: "2026-09-19T11:31:00.000Z",
      }),
    ],
  });
}

export function reimaginedConfirmedState(): ExplorationMoneyState {
  const funded = reimaginedFundedState();
  return {
    ...funded,
    movements: [
      reimaginedMovement({
        id: "movement-gauntlet-100-confirmed",
        status: "confirmed",
        recordedAt: "2026-09-19T11:10:00.000Z",
        resolvedAt: "2026-09-19T11:10:30.000Z",
        transactionHash: CONFIRMED_HASH,
      }),
    ],
    cash: { status: "available", baseUnits: "150000000" },
    saved: savedSlice(
      reimaginedVaultMetadata(),
      reimaginedPositions({
        steakhouse: "250000000",
        gauntlet: "850000000",
        re7: "0",
      }),
    ),
  };
}

/**
 * Large balances, long vault names, and a local cash holding with no configured display
 * quote: the money path must keep every value exact and name the excluded slice.
 */
export function reimaginedLongLocalizedState(): ExplorationMoneyState {
  return baseState({
    cash: { status: "available", baseUnits: "1234567890000" },
    saved: savedSlice(
      reimaginedVaultMetadata({
        gauntlet: "Gauntlet Diversified Onchain Treasury Savings Strategy Core",
        steakhouse: "Steakhouse International Canonical USDC Savings Reserve",
      }),
      reimaginedPositions({
        steakhouse: "1234567890000",
        gauntlet: "9876543210000",
        re7: "0",
      }),
    ),
    localCash: [
      {
        key: "reimagined-cash-idr",
        name: "Indonesian rupiah",
        currency: "IDR",
        atoms: "12345678901234",
        scale: 2,
      },
    ],
    movements: [],
    history: [
      reimaginedTransfer({
        id: "received-large",
        direction: "incoming",
        amountBaseUnits: "9876543210000",
        blockTimestamp: "2026-09-19T09:05:00.000Z",
      }),
    ],
  });
}

function reimaginedMovementOutcome(
  status: ExplorationMovement["status"],
): MoveMoneyOutcome {
  if (status === "confirmed") return { status, transactionHash: CONFIRMED_HASH };
  return { status };
}

/**
 * Fixture executor for the move-money flow. It resolves on the next microtask, so no
 * story or test waits on wall-clock time, and it never reaches a provider.
 */
export function reimaginedMoveExecutor(
  status: ExplorationMovement["status"],
): () => Promise<MoveMoneyOutcome> {
  return async () => reimaginedMovementOutcome(status);
}
