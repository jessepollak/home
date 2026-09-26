import { describe, expect, test } from "bun:test";
import { deriveActionStatus, type ActionReceiptState, type DerivedActionStatus } from "./status";
import type { ActionOutcome } from "./store";

const now = new Date("2026-09-12T12:00:00.000Z");

describe("deriveActionStatus", () => {
  test("stored outcome takes precedence over hints and receipt availability", () => {
    const cases: Array<{
      name: string;
      confirmedAt: string;
      transactionHash: string | null;
      receipt: ActionReceiptState | null;
      outcome: ActionOutcome | null;
      expected: DerivedActionStatus;
    }> = [
      { name: "young without hash", confirmedAt: "2026-09-12T11:50:01.000Z", transactionHash: null, receipt: null, outcome: null, expected: "pending" },
      { name: "old without hash", confirmedAt: "2026-09-12T11:44:59.000Z", transactionHash: null, receipt: null, outcome: null, expected: "unknown" },
      { name: "hash pending", confirmedAt: "2026-09-12T11:00:00.000Z", transactionHash: "0x11", receipt: "pending", outcome: null, expected: "pending" },
      { name: "non-finalized succeeded", confirmedAt: "2026-09-12T11:00:00.000Z", transactionHash: "0x11", receipt: "confirmed", outcome: null, expected: "confirmed" },
      { name: "non-finalized reverted", confirmedAt: "2026-09-12T11:00:00.000Z", transactionHash: "0x11", receipt: "failed", outcome: null, expected: "failed" },
      { name: "stored outcome wins over receipt", confirmedAt: "2026-09-12T11:00:00.000Z", transactionHash: "0x11", receipt: "failed", outcome: "succeeded", expected: "confirmed" },
      { name: "hash unattributable", confirmedAt: "2026-09-12T11:00:00.000Z", transactionHash: "0x22", receipt: "unavailable", outcome: null, expected: "unknown" },
      { name: "hash unavailable", confirmedAt: "2026-09-12T11:00:00.000Z", transactionHash: "0x33", receipt: "unavailable", outcome: null, expected: "unknown" },
      { name: "chain succeeded", confirmedAt: "2026-09-12T11:00:00.000Z", transactionHash: "0x44", receipt: null, outcome: "succeeded", expected: "confirmed" },
      { name: "chain reverted", confirmedAt: "2026-09-12T11:00:00.000Z", transactionHash: "0x55", receipt: null, outcome: "reverted", expected: "failed" },
      { name: "wallet not submitted", confirmedAt: "2026-09-12T11:50:01.000Z", transactionHash: null, receipt: null, outcome: "not_submitted", expected: "failed" },
    ];
    for (const item of cases) expect(deriveActionStatus({ ...item, now }), item.name).toBe(item.expected);
  });
});
