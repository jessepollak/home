import "server-only";

import { presentationRegions, type RegionId } from "@/config/regions";
import {
  BALANCES_CHAIN_ID,
  BALANCES_VERSION,
  type BalancesAddress,
  type BalancesBorrow,
  type BalancesSnapshot,
  type Holding,
} from "@/shared/balances/types";
import {
  addFractions,
  exactDecimalToFraction,
  roundFractionPreservingPositive,
} from "@/shared/balances/math";
import { computeBalancesTotals } from "@/shared/balances/totals";
import type { BalancesRead } from "./types";

export function assembleBalancesSnapshot({
  owner,
  region,
  read,
  holdings,
  borrow,
  stale = false,
}: {
  owner: BalancesAddress;
  region: RegionId;
  read: BalancesRead;
  holdings: Holding[];
  borrow: BalancesBorrow;
  stale?: boolean;
}): BalancesSnapshot {
  const quoteCurrency = presentationRegions[region].currency.code;
  const total: BalancesSnapshot["total"] = quoteCurrency === null
    ? { status: "no-quote-currency", value: null, currency: null }
    : {
        status: "complete",
        value: roundFractionPreservingPositive(addFractions(holdings.flatMap((holding) =>
          holding.value.status === "priced" ? [exactDecimalToFraction(holding.value.amount)] : [],
        ))),
        currency: quoteCurrency,
      };

  return {
    version: BALANCES_VERSION,
    owner: {
      address: owner.toLowerCase() as BalancesAddress,
      chainId: BALANCES_CHAIN_ID,
    },
    region,
    quoteCurrency,
    block: read.block,
    fetchedAt: read.observedAt,
    holdings,
    total,
    borrow,
    totals: computeBalancesTotals({ quoteCurrency, holdings, borrow }),
    ...(stale ? { stale: true as const } : {}),
  };
}
