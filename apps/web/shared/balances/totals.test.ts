import { describe, expect, test } from "bun:test";
import {
  borrowPosition,
  buildBalancesSnapshotFixture,
  priced,
  pricedCash,
  ready,
  walletHolding,
} from "./fixtures";
import { exactDecimalToFraction } from "./math";
import { computeBalancesTotals } from "./totals";
import type { BalancesBorrow, BalancesTotal, BorrowMarketKey } from "./types";

const SECOND_MARKET = `0x${"ab".repeat(32)}` as BorrowMarketKey;

function wallet(options: { usdc?: string; cbbtc?: string; vault?: string } = {}) {
  return buildBalancesSnapshotFixture({
    region: "US",
    registry: {
      usdc: {
        balance: ready(options.usdc ? "1" : "0"),
        value: priced("USD", options.usdc ?? "0"),
        cashValue: pricedCash("USD", options.usdc ?? "0"),
      },
      cbbtc: {
        balance: ready(options.cbbtc ? "1" : "0"),
        value: priced("USD", options.cbbtc ?? "0"),
      },
      "morpho-steakhouse-usdc": {
        balance: ready(options.vault ? "1" : "0"),
        underlyingBalance: ready(options.vault ? "1" : "0"),
        value: priced("USD", options.vault ?? "0"),
      },
    },
  });
}

function totals(snapshot: ReturnType<typeof wallet>, borrow: BalancesBorrow = { positions: [] }) {
  return computeBalancesTotals({ quoteCurrency: snapshot.quoteCurrency, holdings: snapshot.holdings, borrow });
}

function cents(total: BalancesTotal): string | null {
  if (!total.value) return null;
  const fraction = exactDecimalToFraction(total.value);
  return ((fraction.numerator * BigInt(100)) / fraction.denominator).toString();
}

describe("balances net totals", () => {
  test("no borrow position: net equals the gross wallet and savings total", () => {
    const result = totals(wallet({ usdc: "1234", cbbtc: "5000", vault: "766" }));
    expect(cents(result.cash)).toBe("2000");
    expect(cents(result.investments)).toBe("5000");
    expect(cents(result.borrow)).toBe("0");
    expect(result.net).toMatchObject({ status: "complete", currency: "USD", negative: false });
    expect(cents(result.net)).toBe("7000");
  });

  test("unpriced wallet tokens are excluded without reducing priced cash and investments", () => {
    const snapshot = buildBalancesSnapshotFixture({
      registry: {
        usdc: { balance: ready("12000000"), cashValue: pricedCash("USD", "1200"), value: priced("USD", "1200") },
        eth: { balance: ready("1000000000000000000"), value: priced("USD", "300000") },
      },
      catalog: [walletHolding({ address: "0x8888888888888888888888888888888888888888", name: "Unpriced token", symbol: "UNP", decimals: 18 }, "2000000000000000000", { status: "unpriced", reason: "price-unavailable" })],
    });
    const result = totals(snapshot);
    expect(cents(result.cash)).toBe("1200");
    expect(cents(result.investments)).toBe("300000");
    expect(cents(result.net)).toBe("301200");
    expect(totals({ ...snapshot, stale: true })).toEqual(result);
  });

  test("collateral with debt counts in Investments and the debt is subtracted", () => {
    const result = totals(wallet({ usdc: "1234" }), {
      positions: [borrowPosition({
        collateralBaseUnits: "100000",
        collateralValue: priced("USD", "10000"),
        debtBaseUnits: "30010000",
        debtValue: priced("USD", "3001"),
      })],
    });
    expect(cents(result.investments)).toBe("10000");
    expect(cents(result.borrow)).toBe("3001");
    expect(result.net.negative).toBe(false);
    expect(cents(result.net)).toBe("8233");
  });

  test("borrow-only: debt larger than assets yields a negative net magnitude", () => {
    const result = totals(wallet(), {
      positions: [borrowPosition({
        collateralBaseUnits: "0",
        collateralValue: priced("USD", "0"),
        debtBaseUnits: "5000000",
        debtValue: priced("USD", "500"),
      })],
    });
    expect(result.net).toMatchObject({ status: "complete", negative: true });
    expect(cents(result.net)).toBe("500");
  });

  test("collateral without debt adds to Investments and net with a zero Borrow line", () => {
    const result = totals(wallet({ usdc: "100" }), {
      positions: [borrowPosition({
        collateralBaseUnits: "100000",
        collateralValue: priced("USD", "10000"),
        debtBaseUnits: "0",
        debtValue: priced("USD", "0"),
      })],
    });
    expect(cents(result.investments)).toBe("10000");
    expect(cents(result.borrow)).toBe("0");
    expect(cents(result.net)).toBe("10100");
  });

  test("multiple markets each contribute collateral and debt exactly once", () => {
    const result = totals(wallet({ cbbtc: "1000" }), {
      positions: [
        borrowPosition({
          collateralBaseUnits: "100000", collateralValue: priced("USD", "10000"),
          debtBaseUnits: "30000000", debtValue: priced("USD", "3000"),
        }),
        borrowPosition({
          marketId: SECOND_MARKET,
          collateralBaseUnits: "50000", collateralValue: priced("USD", "5000"),
          debtBaseUnits: "10000000", debtValue: priced("USD", "1000"),
        }),
      ],
    });
    expect(cents(result.investments)).toBe("16000");
    expect(cents(result.borrow)).toBe("4000");
    expect(cents(result.net)).toBe("12000");
  });

  test("unpriced debt is excluded while priced collateral and cash remain in net", () => {
    const result = totals(wallet({ usdc: "5000" }), {
      positions: [borrowPosition({
        collateralBaseUnits: "100000", collateralValue: priced("USD", "10000"),
        debtBaseUnits: "30000000", debtValue: { status: "unpriced", reason: "fx-unavailable" },
      })],
    });
    expect(result.borrow.status).toBe("complete");
    expect(cents(result.borrow)).toBe("0");
    expect(result.net.status).toBe("complete");
    expect(cents(result.net)).toBe("15000");
  });

  test("unpriced cash, savings and collateral do not hide priced investments or debt", () => {
    const snapshot = buildBalancesSnapshotFixture({ registry: {
      usdc: { balance: ready("1"), value: { status: "unpriced", reason: "price-unavailable" } },
      cbbtc: { balance: ready("1"), value: priced("USD", "700") },
      "morpho-steakhouse-usdc": { balance: ready("1"), value: { status: "unpriced", reason: "fx-unavailable" } },
    } });
    const result = totals(snapshot, { positions: [borrowPosition({
      collateralBaseUnits: "100000", collateralValue: { status: "unpriced", reason: "price-unavailable" },
      debtBaseUnits: "10000000", debtValue: priced("USD", "1000"),
    })] });
    expect(cents(result.cash)).toBe("0");
    expect(cents(result.investments)).toBe("700");
    expect(result.net.status).toBe("complete");
    expect(result.net.negative).toBe(true);
    expect(cents(result.net)).toBe("300");
  });

  test("nothing priced contributes a complete zero rather than an unavailable total", () => {
    const snapshot = buildBalancesSnapshotFixture({ registry: {
      usdc: { balance: ready("1"), value: { status: "unpriced", reason: "price-unavailable" } },
      cbbtc: { balance: ready("1"), value: { status: "unpriced", reason: "price-unavailable" } },
    } });
    const result = totals(snapshot);
    for (const total of Object.values(result)) {
      expect(total.status).toBe("complete");
      expect(cents(total)).toBe("0");
    }
    expect(result.net.negative).toBe(false);
  });

  test("net subtracts exact values before rounding and zero net is never negative", () => {
    const snapshot = buildBalancesSnapshotFixture({ registry: {
      usdc: { balance: ready("1"), value: priced("USD", "14", 3) },
      cbbtc: { balance: ready("1"), value: priced("USD", "14", 3) },
    } });
    const position = borrowPosition({
      collateralBaseUnits: "0", collateralValue: priced("USD", "0"),
      debtBaseUnits: "1", debtValue: priced("USD", "21", 3),
    });
    const positive = totals(snapshot, { positions: [position] }).net;
    if (!positive.value) throw new Error("Expected a priced net balance");
    expect(exactDecimalToFraction(positive.value)).toEqual({ numerator: BigInt(7), denominator: BigInt(1000) });
    expect(positive.negative).toBe(false);
    position.debt.value = priced("USD", "28", 3);
    const zero = totals(snapshot, { positions: [position] }).net;
    expect(cents(zero)).toBe("0");
    expect(zero.negative).toBe(false);
  });

  test("regions without a quote currency report every total as no-quote-currency", () => {
    const snapshot = buildBalancesSnapshotFixture({ region: "GLOBAL" });
    const result = totals(snapshot, { positions: [borrowPosition({
      collateralBaseUnits: "1", collateralValue: { status: "unpriced", reason: "no-quote-currency" },
      debtBaseUnits: "1", debtValue: { status: "unpriced", reason: "no-quote-currency" },
    })] });
    for (const total of Object.values(result)) {
      expect(total).toMatchObject({ status: "no-quote-currency", value: null, currency: null });
    }
    expect(result.net.negative).toBe(false);
  });
});
