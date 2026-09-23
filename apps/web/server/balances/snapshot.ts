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
  let total: BalancesSnapshot["total"];

  if (quoteCurrency === null) {
    total = {
      status: "no-quote-currency",
      value: null,
      currency: null,
    };
  } else {
    const knownPositive = holdings.filter(
      (holding) => holding.balance.status === "ready" &&
        BigInt(holding.balance.baseUnits) > BigInt(0),
    );
    const incomplete = read.coverage.registry !== "complete" ||
      read.coverage.catalog !== "complete" ||
      knownPositive.some((holding) => holding.value.status !== "priced");
    const hasPositivePricedContribution = knownPositive.some(
      (holding) => holding.value.status === "priced" &&
        exactDecimalToFraction(holding.value.amount).numerator > BigInt(0),
    );

    if (incomplete && !hasPositivePricedContribution) {
      total = {
        status: "unavailable",
        value: null,
        currency: quoteCurrency,
      };
    } else {
      const fractions = holdings.flatMap((holding) =>
        holding.value.status === "priced"
          ? [exactDecimalToFraction(holding.value.amount)]
          : [],
      );
      total = {
        status: incomplete ? "partial" : "complete",
        value: roundFractionPreservingPositive(addFractions(fractions)),
        currency: quoteCurrency,
      };
    }
  }

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
    coverage: read.coverage,
    total,
    borrow,
    totals: computeBalancesTotals({
      quoteCurrency,
      holdings,
      coverage: read.coverage,
      borrow,
    }),
    ...(stale ? { stale: true as const } : {}),
  };
}
