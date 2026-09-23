import { describe, expect, test } from "bun:test";
import {
  borrowPosition,
  buildBalancesSnapshotFixture,
  decimal,
  FIXTURE_BORROW_MARKET_ID,
  priced,
  pricedCash,
  ready,
  unavailableBalance,
} from "./fixtures";
import { exactDecimalToFraction } from "./math";
import { computeBalancesTotals } from "./totals";
import type { BalancesBorrow, BalancesTotal, BorrowMarketKey, ExactDecimal } from "./types";

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

function totals(snapshot: ReturnType<typeof wallet>, borrow: BalancesBorrow) {
  return computeBalancesTotals({
    quoteCurrency: snapshot.quoteCurrency,
    holdings: snapshot.holdings,
    coverage: snapshot.coverage,
    borrow,
  });
}

function cents(total: BalancesTotal): string | null {
  if (!total.value) return null;
  const fraction = exactDecimalToFraction(total.value);
  return ((fraction.numerator * BigInt(100)) / fraction.denominator).toString();
}

function usd(centsValue: string): ExactDecimal {
  return decimal(centsValue, 2);
}

describe("balances net totals", () => {
  test("no borrow position: net equals the gross wallet and savings total", () => {
    const snapshot = wallet({ usdc: "1234", cbbtc: "5000", vault: "766" });
    const result = totals(snapshot, { coverage: "complete", positions: [] });
    expect(cents(result.cash)).toBe("2000");
    expect(cents(result.investments)).toBe("5000");
    expect(result.borrow).toMatchObject({ status: "complete" });
    expect(cents(result.borrow)).toBe("0");
    expect(result.net).toMatchObject({ status: "complete", currency: "USD", negative: false });
    expect(cents(result.net)).toBe("7000");
  });

  test("collateral with debt counts in Investments and the debt is subtracted", () => {
    const snapshot = wallet({ usdc: "1234" });
    const result = totals(snapshot, {
      coverage: "complete",
      positions: [borrowPosition({
        collateralBaseUnits: "100000",
        collateralValue: priced("USD", "10000"),
        debtBaseUnits: "30010000",
        debtValue: { status: "priced", currency: "USD", amount: usd("3001"), asOf: "2026-09-13T11:59:30.000Z" },
      })],
    });
    expect(cents(result.cash)).toBe("1234");
    expect(cents(result.investments)).toBe("10000");
    expect(cents(result.borrow)).toBe("3001");
    expect(result.net).toMatchObject({ status: "complete", negative: false });
    expect(cents(result.net)).toBe("8233");
  });

  test("borrow-only: debt larger than assets yields a negative net magnitude", () => {
    const snapshot = wallet();
    const result = totals(snapshot, {
      coverage: "complete",
      positions: [borrowPosition({
        collateralBaseUnits: "0",
        collateralValue: priced("USD", "0"),
        debtBaseUnits: "5000000",
        debtValue: priced("USD", "500"),
      })],
    });
    expect(cents(result.borrow)).toBe("500");
    expect(result.net).toMatchObject({ status: "complete", negative: true });
    expect(cents(result.net)).toBe("500");
  });

  test("collateral without debt adds to Investments and net with a zero Borrow line", () => {
    const snapshot = wallet({ usdc: "100" });
    const result = totals(snapshot, {
      coverage: "complete",
      positions: [borrowPosition({
        collateralBaseUnits: "100000",
        collateralValue: priced("USD", "10000"),
        debtBaseUnits: "0",
        debtValue: priced("USD", "0"),
      })],
    });
    expect(cents(result.investments)).toBe("10000");
    expect(result.borrow).toMatchObject({ status: "complete" });
    expect(cents(result.borrow)).toBe("0");
    expect(cents(result.net)).toBe("10100");
  });

  test("multiple markets each contribute collateral and debt exactly once", () => {
    const snapshot = wallet({ cbbtc: "1000" });
    const result = totals(snapshot, {
      coverage: "complete",
      positions: [
        borrowPosition({
          collateralBaseUnits: "100000",
          collateralValue: priced("USD", "10000"),
          debtBaseUnits: "30000000",
          debtValue: priced("USD", "3000"),
        }),
        borrowPosition({
          marketId: SECOND_MARKET,
          collateralBaseUnits: "50000",
          collateralValue: priced("USD", "5000"),
          debtBaseUnits: "10000000",
          debtValue: priced("USD", "1000"),
        }),
      ],
    });
    expect(cents(result.investments)).toBe("16000");
    expect(cents(result.borrow)).toBe("4000");
    expect(cents(result.net)).toBe("12000");
    expect(result.net.status).toBe("complete");
  });

  test("a failed borrow read never reports the gross total as a complete net", () => {
    const snapshot = wallet({ usdc: "1234" });
    const result = totals(snapshot, { coverage: "partial", positions: [] });
    expect(result.cash.status).toBe("complete");
    expect(result.investments.status).toBe("unavailable");
    expect(result.borrow).toEqual({ status: "unavailable", value: null, currency: "USD" });
    expect(result.net.status).toBe("partial");
    expect(cents(result.net)).toBe("1234");
  });

  test("an unpriced debt line keeps the Borrow component and net partial", () => {
    const snapshot = wallet({ usdc: "5000" });
    const result = totals(snapshot, {
      coverage: "complete",
      positions: [borrowPosition({
        collateralBaseUnits: "100000",
        collateralValue: priced("USD", "10000"),
        debtBaseUnits: "30000000",
        debtValue: { status: "unpriced", reason: "fx-unavailable" },
      })],
    });
    expect(result.borrow.status).toBe("unavailable");
    expect(result.net.status).toBe("partial");
  });

  test("an unavailable cash row keeps cash and net partial without touching Borrow", () => {
    const snapshot = buildBalancesSnapshotFixture({
      region: "US",
      registry: {
        usdc: { balance: unavailableBalance, value: { status: "unavailable" }, cashValue: { status: "unavailable" } },
        cbbtc: { balance: ready("1"), value: priced("USD", "700") },
      },
    });
    const result = totals(snapshot, { coverage: "complete", positions: [] });
    expect(result.cash.status).toBe("unavailable");
    expect(result.investments.status).toBe("complete");
    expect(result.net.status).toBe("partial");
    expect(cents(result.net)).toBe("700");
  });

  test("nothing priced with no borrow is an unavailable net, not a partial zero", () => {
    const snapshot = buildBalancesSnapshotFixture({
      region: "US",
      registry: {
        usdc: { balance: ready("1"), value: { status: "unpriced", reason: "price-unavailable" }, cashValue: { status: "unpriced", reason: "price-unavailable" } },
        cbbtc: { balance: ready("1"), value: { status: "unpriced", reason: "price-unavailable" } },
      },
    });
    const result = totals(snapshot, { coverage: "complete", positions: [] });
    expect(result.borrow.status).toBe("complete");
    expect(result.net).toEqual({ status: "unavailable", value: null, currency: "USD", negative: false });
  });

  test("regions without a quote currency report every total as no-quote-currency", () => {
    const snapshot = buildBalancesSnapshotFixture({ region: "GLOBAL" });
    const result = totals(snapshot, {
      coverage: "complete",
      positions: [borrowPosition({
        marketId: FIXTURE_BORROW_MARKET_ID,
        collateralBaseUnits: "1",
        collateralValue: { status: "unpriced", reason: "no-quote-currency" },
        debtBaseUnits: "1",
        debtValue: { status: "unpriced", reason: "no-quote-currency" },
      })],
    });
    expect(result.net).toEqual({ status: "no-quote-currency", value: null, currency: null, negative: false });
    expect(result.borrow.status).toBe("no-quote-currency");
  });
});
