import { describe, expect, it } from "vitest";
import { borrowPosition, buildBalancesSnapshotFixture, priced, ready, unavailableBalance, walletHolding } from "./fixtures";
import { addFractions, exactDecimalToFraction } from "./math";
import { investmentSelection, selectOwnedInvestment, selectOwnedInvestments } from "./owned-investments";
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

  it("keeps unpriced and unreadable wallet assets without implying zero", () => {
    const unpriced = token(21);
    const missing = { ...token(22), balance: unavailableBalance, value: { status: "unavailable" } } as Holding;
    const snapshot = buildBalancesSnapshotFixture({ catalog: [{ ...unpriced, value: { status: "unpriced", reason: "price-unavailable" } }, missing] });
    const rows = selectOwnedInvestments(snapshot);
    expect(rows.find((row) => row.key === unpriced.key)).toMatchObject({ amount: null, holding: { source: "wallet" } });
    expect(rows.find((row) => row.key === missing.key)).toMatchObject({ amount: null, wallet: { balance: { status: "unavailable" } } });
    expect(selectOwnedInvestment(snapshot, missing.key)).toMatchObject({ amount: null, holding: { key: missing.key } });
  });

  it("attaches an unread available balance only to confirmed collateral", () => {
    const snapshot = buildBalancesSnapshotFixture({ registry: { cbbtc: { balance: unavailableBalance, value: { status: "unavailable" } }, eth: { balance: unavailableBalance, value: { status: "unavailable" } } }, borrow: { coverage: "complete", positions: [borrowed] } });
    const rows = selectOwnedInvestments(snapshot);
    expect(rows.map((row) => row.key)).toEqual(expect.arrayContaining([borrowed.collateral.key]));
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.key === borrowed.collateral.key)).toMatchObject({ amount: null, wallet: { balance: { status: "unavailable" } }, collateral: [{ key: borrowed.collateral.key }] });
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

  it("orders unpriced accented and case-equivalent names by English base collation then key", () => {
    const holdings = [token(43, "Zulu"), token(42, "éclair"), token(41, "ECLAIR"), token(40, "Alpha")]
      .map((holding): Holding => ({ ...holding, value: { status: "unpriced", reason: "price-unavailable" } }));
    expect(selectOwnedInvestments(buildBalancesSnapshotFixture({ catalog: holdings })).map((row) => row.holding.id))
      .toEqual([holdings[3]!.id, holdings[2]!.id, holdings[1]!.id, holdings[0]!.id]);
  });

  it("retains a sold holding as a known-zero detail target without including it in the overview", () => {
    const sold = token(99);
    const snapshot = buildBalancesSnapshotFixture({ catalog: [{ ...sold, balance: ready("0"), value: priced("USD", "0") }] });
    expect(selectOwnedInvestments(snapshot).some((row) => row.key === sold.key)).toBe(false);
    expect(selectOwnedInvestment(snapshot, sold.key)).toMatchObject({ wallet: { key: sold.key }, collateral: [], amount: { atoms: "0", scale: 2 } });
    expect(selectOwnedInvestment(buildBalancesSnapshotFixture(), sold.key)).toBeNull();
  });
});

it("selects one investment without valuing or ordering unrelated assets", () => {
  const selected = token(101, "Selected");
  const unrelated = token(102, "Unrelated");
  const snapshot = buildBalancesSnapshotFixture({ catalog: [selected, unrelated] });
  Object.defineProperty(unrelated, "value", { get() { throw new Error("Unrelated valuation accessed"); } });
  expect(selectOwnedInvestment(snapshot, selected.key)?.holding).toBe(selected);
  expect(selectOwnedInvestment(snapshot, token(999).key)).toBeNull();
});

it("focused selections preserve wallet, collateral, unreadable and unpriced overview rows", () => {
  const snapshots = [
    buildBalancesSnapshotFixture({ catalog: [token(103)], borrow: { coverage: "complete", positions: [borrowed] } }),
    buildBalancesSnapshotFixture({ registry: { cbbtc: { balance: unavailableBalance, value: { status: "unavailable" } } }, borrow: { coverage: "complete", positions: [borrowed] } }),
    buildBalancesSnapshotFixture({ registry: { cbbtc: { balance: ready("0"), value: priced("USD", "0") } }, borrow: { coverage: "complete", positions: [borrowed] }, catalog: [{ ...token(104), value: { status: "unpriced", reason: "price-unavailable" } }] }),
  ];
  for (const snapshot of snapshots) for (const row of selectOwnedInvestments(snapshot)) {
    expect(selectOwnedInvestment(snapshot, row.key)).toEqual(row);
  }
});

for (const count of [100, 1000, 10000]) {
  it(`${count} holdings yield throughout selection with linear valuation reads`, () => {
    const holdings = Array.from({ length: count }, (_, index) => token(index + 100, `Token ${index}`, String((index * 7919) % 10007 + 1)));
    const snapshot = buildBalancesSnapshotFixture({ catalog: holdings });
    let reads = 0;
    for (const holding of holdings) {
      const value = holding.value;
      Object.defineProperty(holding, "value", { get: () => { reads++; return value; } });
    }
    const selection = investmentSelection(snapshot);
    let previousReads = 0;
    let next = selection.next();
    while (!next.done) {
      expect(reads - previousReads).toBeLessThanOrEqual(512);
      previousReads = reads;
      next = selection.next();
    }
    expect(reads - previousReads).toBeLessThanOrEqual(512);
    expect(reads).toBeLessThanOrEqual(count * 3);
    expect(next.value.map((row) => row.key)).toEqual(holdings.map((holding, index) => ({ key: holding.key, value: (index * 7919) % 10007 })).sort((a, b) => b.value - a.value).map((entry) => entry.key));
  });
}

it("preserves exact ordering above safe integers and existing sub-attounit rounding ties", () => {
  const first = token(201, "A");
  const second = token(202, "B");
  const third = token(203, "C");
  const fourth = token(204, "D");
  first.value = priced("USD", "9007199254740993", 0);
  second.value = priced("USD", "9007199254740992", 0);
  third.value = priced("USD", "10000000000000000004", 19);
  fourth.value = priced("USD", "10000000000000000003", 19);
  const rows = selectOwnedInvestments(buildBalancesSnapshotFixture({ catalog: [fourth, second, third, first] }));
  expect(rows.map((row) => row.key)).toEqual([first.key, second.key, third.key, fourth.key]);
  const thirdRow = rows[2];
  const fourthRow = rows[3];
  if (!thirdRow || !fourthRow) throw new Error("Missing rounding-tie fixture rows");
  expect(thirdRow.amount).toEqual(fourthRow.amount);
});
