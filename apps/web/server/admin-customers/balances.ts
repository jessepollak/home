import "server-only";

import { borrowReadCurrent } from "@/server/balances/borrow";
import { BALANCES_BACKSTOP_MS } from "@/server/balances/coalesce";
import { createBalancesPricer } from "@/server/balances/price";
import { assembleBalancesSnapshot } from "@/server/balances/snapshot";
import type { BalanceSnapshotStore } from "@/server/balances/snapshot-store";
import type { BalancesRead } from "@/server/balances/types";
import { formatDecimalAmount } from "@/shared/amounts/decimal";
import type { BalancesTotal, Holding } from "@/shared/balances/types";
import { BALANCES_CHAIN_ID } from "@/shared/balances/types";
import type { Address } from "@/shared/chain/hex";
import type { CustomerWalletBalance } from "@/shared/admin-customers/contract";
import type { BalanceReader } from "./store";

type Pricer = ReturnType<typeof createBalancesPricer>;
type Snapshot = NonNullable<CustomerWalletBalance["snapshot"]>;

const REGION = "US";

function decimal(value: { atoms: string; scale: number }): string {
  return formatDecimalAmount(BigInt(value.atoms), value.scale);
}

function total(value: BalancesTotal): string | null {
  return value.status === "complete" && value.value ? decimal(value.value) : null;
}

function priced(holding: Pick<Holding, "value">): string | null {
  return holding.value.status === "priced" ? decimal(holding.value.amount) : null;
}

function category(holding: Holding): Snapshot["holdings"][number]["category"] {
  if (holding.kind === "vault-share") return "savings";
  return holding.cashCurrency !== null ? "cash" : "investment";
}

function quantity(holding: Holding): string {
  if (holding.kind === "vault-share" && holding.underlying && holding.underlyingBalance) {
    return formatDecimalAmount(BigInt(holding.underlyingBalance.baseUnits), holding.underlying.decimals);
  }
  return formatDecimalAmount(BigInt(holding.balance.baseUnits), holding.decimals);
}

export function createSnapshotBalanceReader(store: BalanceSnapshotStore, pricer: Pricer = createBalancesPricer({ schedule: () => {} }), now: () => number = Date.now): BalanceReader {
  return async (wallets, signal) => Promise.all(wallets.map(async (address: Address): Promise<CustomerWalletBalance> => {
    const row = await store.get(BALANCES_CHAIN_ID, address);
    if (!row) return { address, snapshot: null };
    const read: BalancesRead = {
      block: { number: row.blockNumber, hash: row.blockHash, timestamp: row.blockTimestamp },
      observedAt: row.observedAt, holdings: row.holdings, coverage: row.coverage,
      enumerationCursor: row.enumerationCursor, borrow: row.borrow,
    };
    const valued = await pricer(read, REGION, "cached", signal);
    const snapshot = assembleBalancesSnapshot({ owner: address, region: REGION, read, holdings: valued.holdings, borrow: valued.borrow });
    const complete = borrowReadCurrent(read) && row.coverage.registry === "complete" && row.coverage.catalog === "complete" &&
      row.holdings.every((holding) => holding.balance.status !== "unavailable") &&
      snapshot.holdings.every((holding) => holding.balance.baseUnits === "0" || holding.value.status === "priced") &&
      snapshot.borrow.positions.every((position) => position.collateral.value.status === "priced" && position.debt.value.status === "priced");
    return {
      address,
      snapshot: {
        observedAt: new Date(row.observedAt).toISOString(),
        stale: (row.staleAt !== null && Date.parse(row.staleAt) > Date.parse(row.observedAt)) || now() - Date.parse(row.observedAt) > BALANCES_BACKSTOP_MS,
        complete,
        currency: snapshot.quoteCurrency === "USD" ? "USD" : null,
        cash: complete ? total(snapshot.totals.cash) : null,
        investments: complete ? total(snapshot.totals.investments) : null,
        debt: complete ? total(snapshot.totals.borrow) : null,
        net: complete ? total(snapshot.totals.net) : null,
        netNegative: complete && snapshot.totals.net.negative,
        holdings: [
          ...snapshot.holdings.filter((holding) => holding.balance.baseUnits !== "0").map((holding) => ({ symbol: holding.symbol, name: holding.name, category: category(holding), amount: quantity(holding), value: priced(holding) })),
          ...snapshot.borrow.positions.map((position) => ({
            symbol: position.collateral.symbol, name: position.collateral.name, category: "collateral" as const,
            amount: formatDecimalAmount(BigInt(position.collateral.balance.baseUnits), position.collateral.decimals), value: priced(position.collateral),
          })),
        ],
        debts: snapshot.borrow.positions.map((position) => ({
          symbol: position.debt.asset.symbol,
          amount: formatDecimalAmount(BigInt(position.debt.balance.baseUnits), position.debt.asset.decimals),
          value: priced(position.debt),
        })),
      },
    };
  }));
}
