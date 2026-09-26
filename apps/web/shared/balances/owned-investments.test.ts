import { describe, expect, it } from "vitest";
import { borrowPosition, buildBalancesSnapshotFixture, priced, ready, unavailableBalance, walletHolding } from "./fixtures";
import { addFractions, exactDecimalToFraction } from "./math";
import { selectOwnedInvestment, selectOwnedInvestments } from "./owned-investments";
import type { Holding } from "./types";

const token = (index: number, name = `Holding ${index}`, amount = String(index * 100)) => walletHolding({ address: `0x${index.toString(16).padStart(40, "0")}`, name, symbol: `T${index}`, decimals: 18 }, "1000000000000000000", priced("USD", amount));
const borrowed = borrowPosition({ collateralBaseUnits: "50000000", collateralValue: priced("USD", "3500000"), debtBaseUnits: "100000000", debtValue: priced("USD", "10000") });

describe("owned investments", () => {
  it("reconciles exactly with investments totals through the real totals path", () => {
    const snapshot = buildBalancesSnapshotFixture({ registry: { cbbtc: { balance: ready("80000000"), value: priced("USD", "5600000") }, usdc: { balance: ready("20000000"), value: priced("USD", "2000") }, aaveUsdc: { balance: ready("1000000"), value: priced("USD", "100") } }, catalog: [token(20)], borrow: { coverage: "complete", positions: [borrowed] } });
    const rows = selectOwnedInvestments(snapshot);
    expect(snapshot.totals.investments.status).toBe("complete");
    expect(rows.some((row) => row.holding.cashCurrency !== null || row.holding.kind === "vault-share")).toBe(false);
    expect(rows.filter((row) => row.key === borrowed.collateral.key)).toHaveLength(1);
    expect(rows.find((row) => row.key === borrowed.collateral.key)?.collateral).toHaveLength(1);
    const actual = addFractions(rows.map((row) => exactDecimalToFraction(row.amount!)));
    const expected = exactDecimalToFraction(snapshot.totals.investments.value!);
    expect(actual.numerator * expected.denominator).toBe(expected.numerator * actual.denominator);
  });

  it("keeps unpriced wallet assets without implying zero and excludes unread balances", () => {
    const unpriced = token(21);
    const missing = { ...token(22), balance: unavailableBalance, value: { status: "unavailable" } } as Holding;
    const snapshot = buildBalancesSnapshotFixture({ catalog: [{ ...unpriced, value: { status: "unpriced", reason: "price-unavailable" } }, missing] });
    const rows = selectOwnedInvestments(snapshot);
    expect(rows.find((row) => row.key === unpriced.key)).toMatchObject({ amount: null, holding: { source: "wallet" } });
    expect(rows.some((row) => row.key === missing.key)).toBe(false);
  });

  it("attaches an unread available balance only to confirmed collateral", () => {
    const snapshot = buildBalancesSnapshotFixture({ registry: { cbbtc: { balance: unavailableBalance, value: { status: "unavailable" } }, eth: { balance: unavailableBalance, value: { status: "unavailable" } } }, borrow: { coverage: "complete", positions: [borrowed] } });
    const rows = selectOwnedInvestments(snapshot);
    expect(rows.map((row) => row.key)).toEqual([borrowed.collateral.key]);
    expect(rows[0]).toMatchObject({ amount: null, wallet: { balance: { status: "unavailable" } }, collateral: [{ key: borrowed.collateral.key }] });
  });

  it("sorts equal values by name then key regardless of input order", () => {
    const first = token(31, "Alpha", "500");
    const second = token(32, "Alpha", "500");
    const third = token(33, "Beta", "500");
    const rows = (catalog: Holding[]) => selectOwnedInvestments(buildBalancesSnapshotFixture({ catalog })).map((row) => row.key);
    expect(rows([third, second, first])).toEqual([first.key, second.key, third.key]);
    expect(rows([first, second, third])).toEqual([first.key, second.key, third.key]);
  });

  it("returns all 65 owned holdings without truncation", () => {
    const snapshot = buildBalancesSnapshotFixture({ catalog: Array.from({ length: 65 }, (_, index) => token(index + 100)) });
    expect(selectOwnedInvestments(snapshot)).toHaveLength(65);
  });

  it("retains a sold holding as a known-zero detail target without including it in the overview", () => {
    const sold = token(99);
    const snapshot = buildBalancesSnapshotFixture({ catalog: [{ ...sold, balance: ready("0"), value: priced("USD", "0") }] });
    expect(selectOwnedInvestments(snapshot).some((row) => row.key === sold.key)).toBe(false);
    expect(selectOwnedInvestment(snapshot, sold.key)).toMatchObject({ wallet: { key: sold.key }, collateral: [], amount: { atoms: "0", scale: 2 } });
    expect(selectOwnedInvestment(buildBalancesSnapshotFixture(), sold.key)).toBeNull();
  });
});
