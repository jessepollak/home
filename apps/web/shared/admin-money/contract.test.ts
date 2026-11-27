import { expect, test } from "bun:test";
import { parseHash32, requireAddress } from "@/shared/chain/hex";
import { csvCell, moneyMovementsCsv, parseMoneyExportRequest, type MoneyMovement } from "./contract";

test("export requests accept the whole list or a valid UTC date range and reject everything else", () => {
  expect(parseMoneyExportRequest({ version: 1, from: null, to: null })).toEqual({ version: 1, from: null, to: null });
  expect(parseMoneyExportRequest({ version: 1, from: "2026-02-28", to: "2026-02-28" })).toEqual({ version: 1, from: "2026-02-28", to: "2026-02-28" });
  expect(parseMoneyExportRequest({ version: 1, from: "2026-01-01", to: null })).toEqual({ version: 1, from: "2026-01-01", to: null });
  for (const value of [
    { version: 2, from: null, to: null },
    { version: 1, from: null },
    { version: 1, from: "2026-03-02", to: "2026-03-01" },
    { version: 1, from: "2026-02-30", to: null },
    { version: 1, from: "2026-2-01", to: null },
    { version: 1, from: "2026-01-01T00:00:00Z", to: null },
    { version: 1, from: null, to: null, limit: 10 },
  ]) {
    expect(parseMoneyExportRequest(value)).toBeNull();
  }
});

test("csv cells neutralize spreadsheet formulas and quote delimiters", () => {
  expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
  expect(csvCell("+1")).toBe("'+1");
  expect(csvCell("-1")).toBe("'-1");
  expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  expect(csvCell("\tcmd")).toBe("'\tcmd");
  expect(csvCell("a,b")).toBe("\"a,b\"");
  expect(csvCell("line\nbreak")).toBe("\"line\nbreak\"");
  expect(csvCell("0x12ab")).toBe("0x12ab");
});

test("the csv has one header and one row per movement with exact decimal amounts", () => {
  const movement: MoneyMovement = {
    id: "fee:1", occurredAt: "2026-03-01T12:00:00.000Z", category: "fee", amountBaseUnits: "9007199254740993", decimals: 6,
    customerId: "11111111-1111-4111-8111-111111111111", payoutAddress: null,
    transactionHash: parseHash32(`0x${"ab".repeat(32)}`), status: "reverted", bps: 50,
  };
  const payout = { ...movement, id: "fee:2", amountBaseUnits: "1", customerId: null, transactionHash: null, payoutAddress: requireAddress(`0x${"12".repeat(20)}`), status: "unresolved" as const };
  expect(moneyMovementsCsv([movement, payout]).split("\r\n")).toEqual([
    "date,category,amount_usdc,rate_bps,customer_id,payout_address,transaction_hash,status",
    `2026-03-01T12:00:00.000Z,fee,9007199254.740993,50,11111111-1111-4111-8111-111111111111,,0x${"ab".repeat(32)},reverted`,
    `2026-03-01T12:00:00.000Z,fee,0.000001,50,,0x${"12".repeat(20)},,unresolved`,
    "",
  ]);
  expect(moneyMovementsCsv([])).toBe("date,category,amount_usdc,rate_bps,customer_id,payout_address,transaction_hash,status\r\n");
});
