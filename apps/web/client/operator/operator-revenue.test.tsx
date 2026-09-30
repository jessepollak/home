import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { OperatorRevenueEntry, OperatorRevenueSummary } from "@/shared/fees/revenue";

const { cleanup, render, within } = await import("@testing-library/react");
const { OperatorRevenue } = await import("./operator-revenue");

afterEach(cleanup);

const hash = `0x${"ab".repeat(32)}` as const;
const entry: OperatorRevenueEntry = {
  actionId: "action-1",
  actionKind: "trade",
  recordedAt: "2026-09-24T12:00:00.000Z",
  amountBaseUnits: "1250000",
  symbol: "USDC",
  decimals: 6,
  bps: 50,
  recipient: "0x1111111111111111111111111111111111111111",
  collectedBy: "in-batch-transfer",
  result: "succeeded",
  transactionHash: hash,
};

describe("OperatorRevenue", () => {
  test("shows an empty state before any fee is recorded", () => {
    const view = render(<OperatorRevenue summary={{ collectedBaseUnits: "0", days: [], entries: [] }} />);
    expect(view.getByText("No fees yet")).toBeTruthy();
    expect(view.queryByRole("table")).toBeNull();
  });

  test("lists recent fees with their result, rate, and explorer link", () => {
    const summary: OperatorRevenueSummary = {
      collectedBaseUnits: "1250000",
      days: [{ date: "2026-09-23", collectedBaseUnits: "0" }, { date: "2026-09-24", collectedBaseUnits: "1250000" }],
      entries: [entry, { ...entry, actionId: "action-2", result: "not_submitted", transactionHash: null, bps: 25 }],
    };
    const view = render(<OperatorRevenue summary={summary} />);
    expect(view.getByRole("heading", { name: "Expected fees", level: 3 })).toBeTruthy();
    expect(view.getByRole("heading", { name: "Expected fees, last 30 days", level: 3 })).toBeTruthy();
    const [, first, second] = view.getAllByRole("row");
    expect(within(first).getByText("Swap")).toBeTruthy();
    expect(within(first).getByText("0.50%")).toBeTruthy();
    expect(within(first).getByText("Succeeded")).toBeTruthy();
    expect(within(first).getByRole("link").getAttribute("href")).toBe(`https://basescan.org/tx/${hash}`);
    expect(within(second).getByText("Not submitted")).toBeTruthy();
    expect(within(second).getByText("0.25%")).toBeTruthy();
    expect(within(second).queryByRole("link")).toBeNull();
    const daily = view.getByRole("list", { name: "Daily fee revenue" });
    expect(within(daily).getAllByRole("listitem")).toHaveLength(2);
    expect(daily.textContent).toContain("Sep 24: $1.25");
  });
});
