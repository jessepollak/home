import { canonicalUsdcAsset, verifiedLocalCashAssets } from "@/config/portfolio-assets";
import { presentationRegions, type FiatCurrencyCode } from "@/config/regions";
import { getTransferAsset } from "@/shared/transfers/transfer-helpers";
import type { TransferAsset } from "@/shared/transfers/types";
import type { BalancesSnapshot, Holding } from "./types";

export type SendableBalance = TransferAsset & { balanceBaseUnits: string };

export type CashSelection =
  | { kind: "holding"; holding: Holding }
  | {
      kind: "unsupported";
      key: string;
      currency: FiatCurrencyCode;
      name: string;
      symbol: string;
    };

export function selectHolding(snapshot: BalancesSnapshot, id: string): Holding | null {
  return snapshot.holdings.find((holding) => holding.id === id) ?? null;
}

export function selectBalanceBaseUnits(snapshot: BalancesSnapshot, id: string): string | null {
  const holding = selectHolding(snapshot, id);
  return holding?.balance.status === "ready" ? holding.balance.baseUnits : null;
}

export function selectVaultPositions(snapshot: BalancesSnapshot): Array<{
  vaultAddress: string;
  position: { assetsRaw: string } | null;
}> {
  return snapshot.holdings.flatMap((holding) => {
    if (holding.kind !== "vault-share" || !holding.contractAddress) return [];
    return [{
      vaultAddress: holding.contractAddress,
      position: holding.underlyingBalance?.status === "ready"
        ? { assetsRaw: holding.underlyingBalance.baseUnits }
        : null,
    }];
  });
}

export function selectSendable(snapshot: BalancesSnapshot): SendableBalance[] {
  return snapshot.holdings.flatMap((holding) => {
    if (
      holding.source !== "registry" ||
      holding.kind === "vault-share" ||
      holding.balance.status !== "ready" ||
      holding.balance.baseUnits === "0"
    ) return [];
    const asset = getTransferAsset(holding.id);
    return asset ? [{ ...asset, balanceBaseUnits: holding.balance.baseUnits }] : [];
  });
}

export function selectCash(snapshot: BalancesSnapshot): CashSelection[] {
  const currency = presentationRegions[snapshot.region].currency.code;
  const localAsset = currency
    ? Object.values(verifiedLocalCashAssets).find((asset) => asset.cashCurrency === currency)
    : undefined;
  const cashHoldings = snapshot.holdings.filter((holding) => holding.cashCurrency !== null);
  const byId = new Map(cashHoldings.map((holding) => [holding.id, holding]));
  const selected: CashSelection[] = [];
  const used = new Set<string>();

  if (localAsset) {
    const holding = byId.get(localAsset.id);
    if (holding) {
      selected.push({ kind: "holding", holding });
      used.add(holding.id);
    }
  } else if (currency && currency !== "USD") {
    const candidate = presentationRegions[snapshot.region].candidateAsset;
    if (candidate) {
      selected.push({
        kind: "unsupported",
        key: `cash:unsupported:${currency}`,
        currency,
        name: presentationRegions[snapshot.region].currency.name,
        symbol: candidate.symbol,
      });
    }
  }

  const usd = byId.get(canonicalUsdcAsset.id);
  if (usd && !used.has(usd.id)) {
    selected.push({ kind: "holding", holding: usd });
    used.add(usd.id);
  }

  for (const holding of cashHoldings) {
    if (
      used.has(holding.id) ||
      holding.balance.status !== "ready" ||
      holding.balance.baseUnits === "0"
    ) continue;
    selected.push({ kind: "holding", holding });
    used.add(holding.id);
  }
  return selected;
}

export function selectTotal(snapshot: BalancesSnapshot): BalancesSnapshot["total"] {
  return snapshot.total;
}
