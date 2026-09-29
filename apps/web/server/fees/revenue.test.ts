import { describe, expect, test } from "bun:test";
import type { SqlExecutor, SqlQueryResult } from "@/server/db/sql";
import { OPERATOR_REVENUE_MAX_DAYS, OPERATOR_REVENUE_MAX_ENTRIES, readOperatorRevenue } from "./revenue";

const recipient = "0x52908400098527886e0f7030069857d2e4169ee7" as const;

function stub(row: { amount?: string; daily?: unknown[]; recent?: unknown[] } = {}) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const executor: SqlExecutor = {
    async query<T>(text: string, values?: unknown[]): Promise<SqlQueryResult<T>> {
      queries.push({ text, values });
      return { rows: [{ amount: row.amount ?? "0", daily: row.daily ?? [], recent: row.recent ?? [] }] as T[], rowCount: 1 };
    },
    transaction: async () => { throw new Error("revenue reads must be one statement, not a transaction"); },
  };
  return { executor, queries };
}

describe("operator revenue windows", () => {
  test("defaults to the 30-day UTC window and 50 newest entries without inventing days", async () => {
    const { executor, queries } = stub({ daily: [{ date: "2026-09-26", amount: "7" }] });
    const summary = await readOperatorRevenue(executor, { now: new Date("2026-09-26T23:30:00Z") });
    expect(summary.days).toHaveLength(30);
    expect(summary.days[0]).toEqual({ date: "2026-08-28", collectedBaseUnits: "0" });
    expect(summary.days.at(-1)).toEqual({ date: "2026-09-26", collectedBaseUnits: "7" });
    expect(summary.days.filter((day) => day.collectedBaseUnits === "0")).toHaveLength(29);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.values).toEqual(["2026-08-28", "2026-09-26", 50]);
  });

  test("reads totals, daily sums and recent entries from one statement", async () => {
    const { executor, queries } = stub({ amount: "17", daily: [{ date: "2026-09-26", amount: "7" }] });
    const summary = await readOperatorRevenue(executor, { now: new Date("2026-09-26T00:00:00Z") });
    expect(queries).toHaveLength(1);
    expect(summary.collectedBaseUnits).toBe("17");
  });

  test("normalizes recent fee entries from the same statement", async () => {
    const { executor } = stub({ recent: [
      { action_id: "a-1", action_kind: "trade", recorded_at: "2026-09-26T12:00:00.000Z", amount_base_units: "2500000", bps: 50, recipient, collected_by: "in-batch-transfer", outcome: "succeeded", transaction_hash: `0x${"AB".repeat(32)}` },
      { action_id: "a-2", action_kind: "trade", recorded_at: new Date("2026-09-25T12:00:00.000Z"), amount_base_units: "1", bps: 1, recipient, collected_by: "provider-native", outcome: null, transaction_hash: "0x12" },
    ] });
    const summary = await readOperatorRevenue(executor, { now: new Date("2026-09-26T23:30:00Z") });
    expect(summary.entries).toEqual([
      { actionId: "a-1", actionKind: "trade", recordedAt: "2026-09-26T12:00:00.000Z", amountBaseUnits: "2500000", symbol: "USDC", decimals: 6, bps: 50, recipient, collectedBy: "in-batch-transfer", result: "succeeded", transactionHash: `0x${"ab".repeat(32)}` },
      { actionId: "a-2", actionKind: "trade", recordedAt: "2026-09-25T12:00:00.000Z", amountBaseUnits: "1", symbol: "USDC", decimals: 6, bps: 1, recipient, collectedBy: "provider-native", result: "unresolved", transactionHash: null },
    ]);
  });

  test("rejects a non-positive, unsafe or oversized window and entry limit before reading", async () => {
    for (const options of [{ days: 0 }, { days: 1.5 }, { days: Number.MAX_SAFE_INTEGER + 1 }, { days: Number.MAX_SAFE_INTEGER }, { days: OPERATOR_REVENUE_MAX_DAYS + 1 }, { limit: 0 }, { limit: Number.NaN }, { limit: OPERATOR_REVENUE_MAX_ENTRIES + 1 }]) {
      const { executor, queries } = stub();
      await expect(readOperatorRevenue(executor, { now: new Date("2026-09-26T00:00:00Z"), ...options }))
        .rejects.toThrow(/Revenue (days|limit) must be an integer between/);
      expect(queries).toHaveLength(0);
    }
    const { executor, queries } = stub();
    await expect(readOperatorRevenue(executor, { now: new Date("not a date") })).rejects.toThrow("Invalid revenue date.");
    expect(queries).toHaveLength(0);
  });

  test("propagates a rejecting store read instead of returning an empty summary", async () => {
    const executor: SqlExecutor = {
      async query<T>(): Promise<SqlQueryResult<T>> {
        throw new Error("database unavailable");
      },
      transaction: async () => { throw new Error("revenue reads must be one statement, not a transaction"); },
    };
    await expect(readOperatorRevenue(executor, { now: new Date("2026-09-26T00:00:00Z") })).rejects.toThrow("database unavailable");
  });

  test("rejects a malformed read that returns no summary row", async () => {
    const executor: SqlExecutor = {
      async query<T>(): Promise<SqlQueryResult<T>> {
        return { rows: [] as T[], rowCount: 0 };
      },
      transaction: async () => { throw new Error("revenue reads must be one statement, not a transaction"); },
    };
    await expect(readOperatorRevenue(executor, { now: new Date("2026-09-26T00:00:00Z") })).rejects.toThrow("Revenue summary row missing.");
  });
});
