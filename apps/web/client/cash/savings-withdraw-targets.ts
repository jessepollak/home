import type { BalancesSnapshot } from "@/shared/balances/types";
import { BASE_USDC_ADDRESS, getVerifiedSaveVault } from "@/shared/savings/config";
import { MORPHO_API_VERSION, type MorphoVaultCandidate, type MorphoVaultsResult } from "@/shared/savings/types";

export function savingsWithdrawTargets(
  snapshot: BalancesSnapshot | null,
  metadata: MorphoVaultsResult | null,
): { holding: BalancesSnapshot["holdings"][number]; candidate: MorphoVaultCandidate }[] {
  if (!snapshot) return [];
  return snapshot.holdings.flatMap((holding) => {
    if (holding.kind !== "vault-share" || !holding.contractAddress ||
      holding.underlyingBalance?.status !== "ready" ||
      BigInt(holding.underlyingBalance.baseUnits) <= BigInt(0)) return [];
    const configured = getVerifiedSaveVault(holding.contractAddress);
    if (!configured) return [];
    const candidate = metadata?.candidates.find((entry) =>
      entry.vaultAddress.toLowerCase() === configured.address.toLowerCase()
    ) ?? {
      version: MORPHO_API_VERSION,
      vaultAddress: configured.address,
      name: configured.name,
      symbol: configured.symbol,
      listed: false,
      chainId: 8453,
      asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
      curatorAddress: null,
      grossApy: null,
      netApy: null,
      feeRate: null,
      totalAssetsRaw: null,
      liquidityRaw: null,
      stateAsOf: null,
      blockNumber: null,
      source: {
        provider: "Base JSON-RPC",
        blockNumber: snapshot.block.number,
        fetchedAt: new Date(Number(snapshot.block.timestamp) * 1000).toISOString(),
      },
    } satisfies MorphoVaultCandidate;
    return [{ holding, candidate }];
  });
}
