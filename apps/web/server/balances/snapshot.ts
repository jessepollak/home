import "server-only";

import type { FiatCurrencyCode, RegionId } from "@/config/regions";
import {
  BALANCES_CHAIN_ID,
  BALANCES_VERSION,
  type BalancesAddress,
  type BalancesBorrow,
  type BalancesSnapshot,
  type Holding,
} from "@/shared/balances/types";
import { computeBalancesTotals, computeGrossTotal } from "@/shared/balances/totals";
import type { BalancesRead } from "./types";

export function assembleBalancesSnapshot({
  owner,
  region,
  quoteCurrency,
  read,
  holdings,
  borrow,
  stale = false,
}: {
  owner: BalancesAddress;
  region: RegionId;
  quoteCurrency: FiatCurrencyCode | null;
  read: BalancesRead;
  holdings: Holding[];
  borrow: BalancesBorrow;
  stale?: boolean;
}): BalancesSnapshot {
  const total: BalancesSnapshot["total"] = computeGrossTotal({ quoteCurrency, holdings });

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
