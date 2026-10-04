import { HttpResponse, http } from "msw";
import { buildBalancesSnapshotFixture, priced, pricedCash, ready } from "@/shared/balances/fixtures";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";

const ACCOUNT: `0x${string}` = "0x1111111111111111111111111111111111111111";
const FIXTURE_TIME = "2026-09-10T12:04:00.000Z";
export const fixedNow = () => Date.parse(FIXTURE_TIME);
const [GAUNTLET, SPARK] = MORPHO_V1_CANDIDATE_ADDRESSES;
export const SELECTED_VAULT = SPARK;

export const session: VerifiedAccountSession = {
  user: { subject: "storybook-savings-journey-owner" },
  smartAccount: { address: ACCOUNT, chainId: 8453 },
  accountProvider: "cdp-embedded",
};

function candidate(vaultAddress: MorphoVaultCandidate["vaultAddress"], name: string, netApy: number,
  curatorAddress: MorphoVaultCandidate["curatorAddress"] = null): MorphoVaultCandidate {
  return {
    version: "v1", vaultAddress, name, symbol: "USDC vault", listed: true, chainId: 8453,
    asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 }, curatorAddress,
    grossApy: netApy + 0.005, netApy, feeRate: 0.1, totalAssetsRaw: "1250000000000", liquidityRaw: "850000000000",
    stateAsOf: "2026-09-10T12:00:00.000Z", blockNumber: "51026404",
    source: { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt: "2026-09-10T12:00:00.000Z" },
  };
}

const gauntlet = candidate(GAUNTLET, "Gauntlet USDC Prime", 0.0385);
export const spark = candidate(SPARK, "Spark USDC Vault", 0.041);
export const vaultsFixture: MorphoVaultsResult = {
  version: "v1", chainId: 8453, asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
  candidates: [spark, gauntlet],
  source: { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt: "2026-09-10T12:00:00.000Z" },
  stale: false,
};
export const savingsVaultHandlers = [http.get("/api/savings/vaults", () => HttpResponse.json(vaultsFixture))];

export const startingSnapshot = buildBalancesSnapshotFixture({ registry: {
  usdc: { balance: ready("250000000"), value: priced("USD", "25000"), cashValue: pricedCash("USD", "25000") },
} });
export const fundedSnapshot = buildBalancesSnapshotFixture({ registry: {
  usdc: { balance: ready("250000000"), value: priced("USD", "25000"), cashValue: pricedCash("USD", "25000") },
  "morpho-steakhouse-usdc": { balance: ready("987654321000000000000"), underlyingBalance: ready("987654321"), value: priced("USD", "98765") },
  "morpho-re7-usdc": { balance: ready("123456789000000000000"), underlyingBalance: ready("123456789"), value: priced("USD", "12345") },
} });

export function preparedAction(vault: MorphoVaultCandidate, amountBaseUnits: string): PreparedMoneyAction {
  return {
    id: "storybook-journey-savings-deposit", kind: "savings-deposit", title: "Deposit USDC",
    createdAt: "2026-09-10T12:03:00.000Z", expiresAt: "2099-09-10T12:03:00.000Z", calls: [],
    amounts: [
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits, direction: "spend" },
      { assetId: "vault", symbol: "vault shares", decimals: 18, amountBaseUnits: "24000000000000000000", direction: "receive", estimated: true },
    ],
    warnings: [],
    metadata: {
      product: "savings", operation: "deposit", vaultAddress: vault.vaultAddress, vaultName: vault.name,
      network: { name: "Base", chainId: 8453 }, feeWad: "100000000000000000", limitBaseUnits: "250000000",
      previewSharesBaseUnits: "24000000000000000000", shareDecimals: 18,
      exchangeConstraint: "deposit-minimum-shares-or-revert", minimumSharesBaseUnits: "23976000000000000000",
      discoveryRate: { status: "current", netApy: String(vault.netApy), fetchedAt: FIXTURE_TIME, stateAsOf: FIXTURE_TIME },
      source: { blockNumber: "51026404", blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: "1789041840" },
    },
    owner: { subject: session.user.subject, address: ACCOUNT, chainId: 8453, accountProvider: session.accountProvider },
  };
}
