import "server-only";

import { presentationRegions, type RegionId } from "@/config/regions";
import {
  BALANCES_CHAIN_ID,
  BALANCES_VERSION,
  type BalancesAddress,
  type BalancesSnapshot,
  type Holding,
} from "@/shared/balances/types";
import {
  addFractions,
  exactDecimalToFraction,
  roundFractionPreservingPositive,
} from "@/shared/balances/math";
import type { BalancesRead } from "./types";

export function assembleBalancesSnapshot({
  owner,
  region,
  read,
  holdings,
  stale = false,
}: {
  owner: BalancesAddress;
  region: RegionId;
  read: BalancesRead;
  holdings: Holding[];
  stale?: boolean;
}): BalancesSnapshot {
  const quoteCurrency = presentationRegions[region].currency.code;
  const registry = holdings.filter((holding) => holding.source === "registry");
  let total: BalancesSnapshot["total"];

  if (quoteCurrency === null) {
    total = {
      status: "no-quote-currency",
      value: null,
      currency: null,
    };
  } else {
    const incomplete = registry.some(
      (holding) => holding.value.status !== "priced",
    );
    const hasNonzero = registry.some(
      (holding) =>
        holding.value.status === "priced" &&
        exactDecimalToFraction(holding.value.amount).numerator > BigInt(0),
    );

    if (incomplete && !hasNonzero) {
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
    ...(stale ? { stale: true as const } : {}),
  };
}
