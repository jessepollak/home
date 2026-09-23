import { afterAll, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { appendLedger, confirmsForDay, confirmsForRun, readLedger, withLedgerLock, type LedgerEntry } from "./ledger";

const directory = resolve(tmpdir(), `home-verify-ledger-test-${crypto.randomUUID()}`);
const path = resolve(directory, "ledger.jsonl");
afterAll(() => { Bun.spawnSync(["rm", "-rf", directory]); });
const entry = (runId: string, date: string, confirmCount: number): LedgerEntry => ({
  type: "run", timestamp: `${date}T12:00:00.000Z`, runId, host: "home.test", surface: "send",
  role: "operator", mainRevision: "abc", rungReached: 3, confirmCount,
  actionIds: confirmCount ? ["action-id"] : [], incidents: [], clean: false,
});

describe("confirmation ledger", () => {
  test("counts reservations once and does not count the summary entry", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await withLedgerLock(path, async () => {
      await appendLedger(path, entry("run-a", today, 1));
      await appendLedger(path, entry("run-a", today, 0));
    });
    const entries = await readLedger(path);
    expect(confirmsForRun(entries, "run-a")).toBe(1);
    expect(confirmsForDay(entries, today)).toBe(1);
  });
  test("counts existing USD reservations as confirms without migrating the ledger", () => {
    const existing = { ...entry("old", "2026-09-23", 0), confirmCount: undefined, amountsUsd: [0.1, 0.1] };
    expect(confirmsForRun([existing], "old")).toBe(2);
    expect(confirmsForDay([existing], "2026-09-23")).toBe(2);
  });
});
