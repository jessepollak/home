import "server-only";

import { presentationRegions, type RegionId } from "@/config/regions";
import {
  BALANCES_CHAIN_ID,
  BALANCES_VERSION,
  type BalancesAddress,
  type BalancesSnapshot,
  type ExactDecimal,
  type Holding,
} from "@/shared/balances/types";
import { addFractions, exactDecimalToFraction, roundFractionPreservingPositive } from "@/shared/portfolio/valuation-math";
import type { BalancesRead } from "./types";

export function assembleBalancesSnapshot({
  owner,
  region,
  read,
  holdings,
  now = () => new Date(),
}: {
  owner: BalancesAddress;
  region: RegionId;
  read: BalancesRead;
  holdings: Holding[];
  now?: () => Date;
}): BalancesSnapshot {
  const quoteCurrency = presentationRegions[region].currency.code;
  const registry = holdings.filter((holding) => holding.source === "registry");
  let total: BalancesSnapshot["total"];
  if (quoteCurrency === null) {
    total = { status: "no-quote-currency", value: null, currency: null };
  } else {
    const pricedRegistry = registry.filter((holding) => holding.value.status === "priced");
    const allRegistryUnavailable = registry.every((holding) => holding.balance.status === "unavailable");
    if (allRegistryUnavailable || pricedRegistry.length === 0) {
      total = { status: "unavailable", value: null, currency: quoteCurrency };
    } else {
      const fractions = holdings.flatMap((holding) => holding.value.status === "priced" ? [exactDecimalToFraction(holding.value.amount)] : []);
      const complete = registry.every((holding) => holding.value.status === "priced");
      total = {
        status: complete ? "complete" : "partial",
        value: roundFractionPreservingPositive(addFractions(fractions)),
        currency: quoteCurrency,
      };
    }
  }
  return {
    version: BALANCES_VERSION,
    owner: { address: owner.toLowerCase() as BalancesAddress, chainId: BALANCES_CHAIN_ID },
    region,
    quoteCurrency,
    block: read.block,
    fetchedAt: now().toISOString(),
    holdings,
    coverage: read.coverage,
    total,
  };
}

export function sumExactDecimals(values: readonly ExactDecimal[]): ExactDecimal {
  return roundFractionPreservingPositive(addFractions(values.map(exactDecimalToFraction)));
}
