import { describe, expect, test } from "bun:test";
import { parseBalancesSnapshot } from "@/shared/balances/contract";
import {
  balancesSnapshotFixture,
  FIXTURE_FETCHED_AT,
  FIXTURE_OWNER_ADDRESS,
  FIXTURE_WALLET_TOKEN,
  walletHolding,
} from "@/shared/balances/fixtures";
import type { ExactDecimal, Holding } from "@/shared/balances/types";
import { assembleBalancesSnapshot } from "./snapshot";
import type { BalancesRead } from "./types";

const read: BalancesRead = {
  block: balancesSnapshotFixture.block,
  observedAt: FIXTURE_FETCHED_AT,
  holdings: [],
  coverage: balancesSnapshotFixture.coverage,
};

function fixtureHolding(id: string): Holding {
  const holding = balancesSnapshotFixture.holdings.find(
    (candidate) => candidate.id === id,
  );
  if (!holding) {
    throw new Error(`Missing fixture holding ${id}.`);
  }
  return holding;
}

function decimal(atoms: string): ExactDecimal {
  return {
    atoms,
    scale: 0,
  };
}

function totalDecimal(wholeUnits: string): ExactDecimal {
  return {
    atoms: `${wholeUnits}${"0".repeat(18)}`,
    scale: 18,
  };
}

function registryHolding(
  id: string,
  baseUnits: string,
  value: Holding["value"],
): Holding {
  const holding = fixtureHolding(id);
  return {
    ...holding,
    balance: {
      status: "ready",
      baseUnits,
    },
    value,
  };
}

function catalogHolding(amount: ExactDecimal): Holding {
  const holding = balancesSnapshotFixture.holdings.find(
    (candidate) => candidate.source === "catalog",
  );
  if (!holding) {
    throw new Error("Missing catalog fixture holding.");
  }
  return {
    ...holding,
    value: {
      status: "priced",
      currency: "USD",
      amount,
      asOf: FIXTURE_FETCHED_AT,
    },
  };
}

const priced = (atoms: string): Holding["value"] => ({
  status: "priced",
  currency: "USD",
  amount: decimal(atoms),
  asOf: FIXTURE_FETCHED_AT,
});

describe("balances snapshot", () => {
  test("assembles catalog and wallet rows accepted by the locked contract", () => {
    const holdings = [
      ...balancesSnapshotFixture.holdings,
      walletHolding(FIXTURE_WALLET_TOKEN, "25", {
        status: "unpriced",
        reason: "below-market-gate",
      }),
    ];
    const snapshot = assembleBalancesSnapshot({
      owner: FIXTURE_OWNER_ADDRESS,
      region: "US",
      read,
      holdings,
    });
    expect(parseBalancesSnapshot(
      snapshot,
      {
        subject: "fixture",
        smartAccountAddress: FIXTURE_OWNER_ADDRESS,
        chainId: 8453,
      },
      "US",
    )).toEqual(snapshot);
  });

  test.each([
    {
      name: "FX outage with positive USDC and zero cbBTC is unavailable",
      holdings: [
        registryHolding(
          "usdc",
          "1000000",
          { status: "unpriced", reason: "fx-unavailable" },
        ),
        registryHolding("cbbtc", "0", priced("0")),
      ],
      expected: {
        status: "unavailable",
        value: null,
        currency: "USD",
      },
    },
    {
      name: "an incomplete registry with a non-zero priced row is partial",
      holdings: [
        registryHolding("usdc", "1000000", priced("10")),
        registryHolding(
          "cbbtc",
          "100000",
          { status: "unpriced", reason: "price-unavailable" },
        ),
      ],
      expected: {
        status: "partial",
        value: totalDecimal("10"),
        currency: "USD",
      },
    },
    {
      name: "an entirely priced registry is complete",
      holdings: [
        registryHolding("usdc", "1000000", priced("10")),
        registryHolding("cbbtc", "100000", priced("2")),
      ],
      expected: {
        status: "complete",
        value: totalDecimal("12"),
        currency: "USD",
      },
    },
    {
      name: "catalog value adds while an unpriced wallet row cannot affect the total",
      holdings: [
        registryHolding("usdc", "0", priced("0")),
        registryHolding("cbbtc", "0", priced("0")),
        catalogHolding(decimal("7")),
        walletHolding(FIXTURE_WALLET_TOKEN, "25", {
          status: "unpriced",
          reason: "below-market-gate",
        }),
      ],
      expected: {
        status: "complete",
        value: totalDecimal("7"),
        currency: "USD",
      },
    },
  ])("computes totals: $name", ({ holdings, expected }) => {
    const snapshot = assembleBalancesSnapshot({
      owner: FIXTURE_OWNER_ADDRESS,
      region: "US",
      read,
      holdings: [...holdings],
    });
    expect(snapshot.total).toEqual(expected);
  });
});
