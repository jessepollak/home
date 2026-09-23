import { afterAll, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { appendLedger, confirmsForDay, confirmsForRun, readLedger, withLedgerLock, type LedgerEntry } from "./ledger";

const directory = resolve(tmpdir(), `home-verify-ledger-test-${crypto.randomUUID()}`);
const path = resolve(directory, "ledger.jsonl");
const extraDirectories: string[] = [];
function lockPath(label: string): string {
  const temporary = resolve(tmpdir(), `home-ledger-${label}-${crypto.randomUUID()}`);
  Bun.spawnSync(["mkdir", "-p", temporary]);
  extraDirectories.push(temporary);
  return resolve(temporary, "ledger.jsonl");
}
afterAll(() => {
  Bun.spawnSync(["rm", "-rf", directory]);
  for (const temporary of extraDirectories) Bun.spawnSync(["rm", "-rf", temporary]);
});
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

  test("creates private append-only storage", async () => {
    const ledger = lockPath("private");
    await appendLedger(ledger, entry("first", "2026-09-23", 1));
    await appendLedger(ledger, entry("second", "2026-09-23", 0));
    expect((await readLedger(ledger)).map((item) => item.runId)).toEqual(["first", "second"]);
    const mode = Bun.spawnSync(["stat", "-f", "%Lp", ledger], { stdout: "pipe" });
    if (mode.exitCode === 0) expect(mode.stdout.toString().trim()).toBe("600");
  });

  test("skips legacy non-run records without altering later runs", async () => {
    const ledger = lockPath("legacy");
    await Bun.write(ledger, `${JSON.stringify(entry("first", "2026-09-23", 1))}\n${JSON.stringify({ type: "disarm", runId: "legacy" })}\n`);
    await appendLedger(ledger, entry("second", "2026-09-23", 0));
    expect((await readLedger(ledger)).map((item) => item.runId)).toEqual(["first", "second"]);
  });

  test("serializes reservations and releases the lock", async () => {
    const ledger = lockPath("serialization");
    await withLedgerLock(ledger, async () => {
      await expect(withLedgerLock(ledger, async () => undefined)).rejects.toThrow("reserving a confirmation");
    });
    await expect(withLedgerLock(ledger, async () => "released")).resolves.toBe("released");
  });

  test("clears a stale lock whose owner process is gone", async () => {
    const ledger = lockPath("stale");
    const lock = `${ledger}.lock`;
    Bun.spawnSync(["mkdir", "-p", lock]);
    await Bun.write(resolve(lock, "owner.json"), JSON.stringify({ pid: 999999, timestamp: Date.now() - 11 * 60 * 1000 }));
    const notices: string[] = [];
    const previous = console.error;
    console.error = (...values: unknown[]) => { notices.push(values.join(" ")); };
    try { await expect(withLedgerLock(ledger, async () => "acquired")).resolves.toBe("acquired"); }
    finally { console.error = previous; }
    expect(notices.join(" ")).toContain("stale");
  });

  test("refuses live and fresh locks and names the manual removal command", async () => {
    const ledger = lockPath("live");
    const lock = `${ledger}.lock`;
    Bun.spawnSync(["mkdir", "-p", lock]);
    await Bun.write(resolve(lock, "owner.json"), JSON.stringify({ pid: process.pid, timestamp: Date.now() - 11 * 60 * 1000 }));
    await expect(withLedgerLock(ledger, async () => undefined)).rejects.toThrow(`rm -rf ${lock}`);
    await Bun.write(resolve(lock, "owner.json"), JSON.stringify({ pid: 999999, timestamp: Date.now() }));
    await expect(withLedgerLock(ledger, async () => undefined)).rejects.toThrow("reserving a confirmation");
  });

  test("refuses when another process wins stale-lock removal", async () => {
    const ledger = lockPath("race");
    const lock = `${ledger}.lock`;
    const winner = `${lock}.winner`;
    Bun.spawnSync(["mkdir", "-p", lock]);
    await Bun.write(resolve(lock, "owner.json"), JSON.stringify({ pid: 999999, timestamp: Date.now() - 11 * 60 * 1000 }));
    const entered: string[] = [];
    await expect(withLedgerLock(ledger, async () => { entered.push("loser"); }, {
      beforeStaleLockRemoval: () => { Bun.spawnSync(["mv", lock, winner]); },
    })).rejects.toThrow("reserving a confirmation");
    expect(entered).toEqual([]);
    expect(Bun.spawnSync(["test", "-d", winner]).exitCode).toBe(0);
  });

  test("restores a newer lock it displaced and refuses instead of holding twice", async () => {
    const ledger = lockPath("displaced");
    const lock = `${ledger}.lock`;
    const winner = `${lock}.winner`;
    Bun.spawnSync(["mkdir", "-p", lock]);
    await Bun.write(resolve(lock, "owner.json"), JSON.stringify({ pid: 999999, timestamp: Date.now() - 11 * 60 * 1000 }));
    const entered: string[] = [];
    await expect(withLedgerLock(ledger, async () => { entered.push("loser"); }, {
      beforeStaleLockRemoval: async () => {
        Bun.spawnSync(["mv", lock, winner]);
        Bun.spawnSync(["mkdir", "-p", lock]);
        await Bun.write(resolve(lock, "owner.json"), JSON.stringify({ pid: process.pid, timestamp: Date.now() }));
      },
    })).rejects.toThrow("reserving a confirmation");
    expect(entered).toEqual([]);
    await expect(withLedgerLock(ledger, async () => "second")).rejects.toThrow("reserving a confirmation");
    Bun.spawnSync(["rm", "-rf", lock]);
    await expect(withLedgerLock(ledger, async () => "after")).resolves.toBe("after");
  });
});
