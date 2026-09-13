import { describe, expect, test } from "bun:test";
import { deriveActionStatus, type ActionReceiptState, type DerivedActionStatus } from "./status";

const now = new Date("2026-09-12T12:00:00.000Z");

describe("deriveActionStatus", () => {
  test("derives status only from confirmation age, transaction hash, and receipt", () => {
    const cases: Array<{
      name: string;
      confirmedAt: string;
      transactionHash: string | null;
      receipt: ActionReceiptState | null;
      expected: DerivedActionStatus;
    }> = [
      { name: "young without hash", confirmedAt: "2026-09-12T11:50:01.000Z", transactionHash: null, receipt: null, expected: "pending" },
      { name: "old without hash", confirmedAt: "2026-09-12T11:44:59.000Z", transactionHash: null, receipt: null, expected: "unknown" },
      { name: "hash pending", confirmedAt: "2026-09-12T11:00:00.000Z", transactionHash: `0x${"11".repeat(32)}`, receipt: "pending", expected: "pending" },
      { name: "hash confirmed", confirmedAt: "2026-09-12T11:00:00.000Z", transactionHash: `0x${"22".repeat(32)}`, receipt: "confirmed", expected: "confirmed" },
      { name: "hash reverted", confirmedAt: "2026-09-12T11:00:00.000Z", transactionHash: `0x${"33".repeat(32)}`, receipt: "failed", expected: "failed" },
      { name: "receipt unavailable", confirmedAt: "2026-09-12T11:00:00.000Z", transactionHash: `0x${"44".repeat(32)}`, receipt: "unavailable", expected: "unknown" },
    ];

    for (const item of cases) {
      expect(deriveActionStatus({ ...item, now }), item.name).toBe(item.expected);
    }
  });
});
