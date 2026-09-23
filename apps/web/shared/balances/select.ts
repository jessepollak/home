import { canonicalUsdcAsset, verifiedLocalCashAssets } from "@/config/portfolio-assets";
import { presentationRegions, type FiatCurrencyCode } from "@/config/regions";
import { exactDecimalToFraction } from "@/shared/balances/math";
import { getTransferAsset } from "@/shared/transfers/transfer-helpers";
import type { TransferAsset } from "@/shared/transfers/types";
import type {
  BalancesSnapshot,
  BalancesTotals,
  BorrowCollateralHolding,
  BorrowPosition,
  ExactDecimal,
  Holding,
} from "./types";

export type SendableBalance = TransferAsset & { balanceBaseUnits: string; imageUrl?: string };

export type CashSelection =
  | { kind: "holding"; holding: Holding }
  | {
      kind: "unsupported";
      key: string;
      currency: FiatCurrencyCode;
      name: string;
      symbol: string;
    };

export type MoneyGroups = {
  cash: CashSelection[];
  investments: Holding[];
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
    return asset
      ? [{
          ...asset,
          balanceBaseUnits: holding.balance.baseUnits,
          ...(holding.imageUrl ? { imageUrl: holding.imageUrl } : {}),
        }]
      : [];
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

export function selectMoneyGroups(snapshot: BalancesSnapshot): MoneyGroups {
  const cash = selectCash(snapshot);
  const selectedCashIds = new Set(
    cash.flatMap((entry) => entry.kind === "holding" ? [entry.holding.id] : []),
  );
  const investments = snapshot.holdings.filter((holding) =>
    holding.kind !== "vault-share" &&
    holding.cashCurrency === null &&
    !selectedCashIds.has(holding.id) &&
    holding.balance.status === "ready" &&
    holding.balance.baseUnits !== "0"
  );

  return {
    cash,
    investments: investments.sort(compareHoldings),
  };
}

/** @public exercised by shared/balances/select.test.ts */
export function selectAssetCount(snapshot: BalancesSnapshot): number {
  const groups = selectMoneyGroups(snapshot);
  return groups.cash.length + groups.investments.length;
}

export function selectTotal(snapshot: BalancesSnapshot): BalancesSnapshot["total"] {
  return snapshot.total;
}

/** @public Home net-worth consumer lands in #789; exercised by shared/balances/select.test.ts */
export function selectBalanceTotals(snapshot: BalancesSnapshot): BalancesTotals {
  return snapshot.totals;
}

/** @public Home Borrow row lands in #789; exercised by shared/balances/select.test.ts */
export function selectBorrowPositions(snapshot: BalancesSnapshot): BorrowPosition[] {
  return snapshot.borrow.positions;
}

/** @public Home Investments consumer lands in #789; exercised by shared/balances/select.test.ts */
export function selectCollateralHoldings(snapshot: BalancesSnapshot): BorrowCollateralHolding[] {
  return snapshot.borrow.positions.flatMap((position) =>
    position.collateral.balance.baseUnits === "0" ? [] : [position.collateral]
  ).sort(compareHoldings);
}

function compareHoldings(left: Holding, right: Holding): number {
  const leftValue = pricedValue(left);
  const rightValue = pricedValue(right);
  if (leftValue && rightValue) {
    return compareExactDecimals(rightValue, leftValue) || compareHoldingNames(left, right);
  }
  if (leftValue || rightValue) return leftValue ? -1 : 1;
  return compareHoldingNames(left, right);
}

function pricedValue(holding: Holding): ExactDecimal | null {
  return holding.value.status === "priced" ? holding.value.amount : null;
}

function compareExactDecimals(left: ExactDecimal, right: ExactDecimal): number {
  const leftFraction = exactDecimalToFraction(left);
  const rightFraction = exactDecimalToFraction(right);
  const leftScaled = leftFraction.numerator * rightFraction.denominator;
  const rightScaled = rightFraction.numerator * leftFraction.denominator;
  return leftScaled < rightScaled ? -1 : leftScaled > rightScaled ? 1 : 0;
}

function compareHoldingNames(left: Holding, right: Holding): number {
  return left.name.localeCompare(right.name, "en", { sensitivity: "base" });
}
