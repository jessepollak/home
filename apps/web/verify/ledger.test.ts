import { afterEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { appendLedger, readLedger, spendForDay, spendForRun, withLedgerLock, type LedgerRun } from "./ledger";

const temporaryDirectories: string[] = [];

function run(overrides: Partial<LedgerRun> = {}): LedgerRun {
  return {
    type: "run",
    timestamp: "2026-09-21T12:00:00.000Z",
    runId: "run-1",
    host: "preview.example",
    surface: "send",
    role: "factory",
    mainRevision: "abc123",
    rungReached: 2,
    amountsUsd: [],
    incidents: [],
    clean: true,
    ...overrides,
  };
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) Bun.spawnSync(["rm", "-rf", path]);
});

describe("verification ledger", () => {
  test("creates private append-only storage and reads appended entries", async () => {
    const directory = resolve(tmpdir(), `home-ledger-test-${crypto.randomUUID()}`);
    Bun.spawnSync(["mkdir", "-p", directory]);
    temporaryDirectories.push(directory);
    const path = resolve(directory, "private", "ledger.jsonl");
    await appendLedger(path, run());
    await appendLedger(path, run({ runId: "run-2" }));
    expect(await readLedger(path)).toHaveLength(2);
  });

  test("records incidents as evidence without altering later run records", async () => {
    const directory = resolve(tmpdir(), `home-ledger-incidents-${crypto.randomUUID()}`);
    Bun.spawnSync(["mkdir", "-p", directory]);
    temporaryDirectories.push(directory);
    const path = resolve(directory, "ledger.jsonl");
    await appendLedger(path, run({ runId: "run-1", clean: false, incidents: ["unexpected-host"] }));
    await appendLedger(path, run({ runId: "run-2", rungReached: 3, clean: true }));
    const entries = await readLedger(path);
    expect(entries[0].incidents).toEqual(["unexpected-host"]);
    expect(entries[1].incidents).toEqual([]);
    expect(entries[1].clean).toBe(true);
  });

  test("skips legacy arm and disarm events left in an existing ledger", async () => {
    const directory = resolve(tmpdir(), `home-ledger-legacy-${crypto.randomUUID()}`);
    Bun.spawnSync(["mkdir", "-p", directory]);
    temporaryDirectories.push(directory);
    const path = resolve(directory, "ledger.jsonl");
    await Bun.write(path, [
      JSON.stringify(run({ runId: "run-1", clean: false, incidents: ["unexpected-host"] })),
      JSON.stringify({ type: "disarm", timestamp: "2026-09-22T00:00:01.000Z", host: "example.com", surface: "send", incidents: ["unexpected-host"] }),
      JSON.stringify({ type: "arm", timestamp: "2026-09-22T00:00:02.000Z", host: "example.com", surface: "send", by: "https://github.com/example-org/home/issues/1#issuecomment-1" }),
      "",
    ].join("\n"));
    await appendLedger(path, run({ runId: "run-2", rungReached: 3, clean: true }));
    const entries = await readLedger(path);
    expect(entries.map((entry) => entry.runId)).toEqual(["run-1", "run-2"]);
    expect(entries.every((entry) => entry.type === "run")).toBe(true);
  });

  test("serializes spend reservations and releases the lock", async () => {
    const directory = resolve(tmpdir(), `home-ledger-lock-${crypto.randomUUID()}`);
    Bun.spawnSync(["mkdir", "-p", directory]);
    temporaryDirectories.push(directory);
    const path = resolve(directory, "ledger.jsonl");
    await withLedgerLock(path, async () => {
      await expect(withLedgerLock(path, async () => undefined)).rejects.toThrow("reserving spend");
    });
    await expect(withLedgerLock(path, async () => "released")).resolves.toBe("released");
  });

  test("clears a stale spend lock whose owner process is gone", async () => {
    const directory = resolve(tmpdir(), `home-ledger-stale-${crypto.randomUUID()}`);
    Bun.spawnSync(["mkdir", "-p", directory]);
    temporaryDirectories.push(directory);
    const path = resolve(directory, "ledger.jsonl");
    const lockPath = `${path}.lock`;
    Bun.spawnSync(["mkdir", "-p", lockPath]);
    await Bun.write(resolve(lockPath, "owner.json"), JSON.stringify({ pid: 999999, timestamp: Date.now() - 11 * 60 * 1000 }));
    const notices: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]) => {
      notices.push(values.join(" "));
    };
    try {
      await expect(withLedgerLock(path, async () => "acquired")).resolves.toBe("acquired");
    } finally {
      console.error = originalError;
    }
    expect(notices.join(" ")).toContain("stale");
  });

  test("keeps refusing a live or fresh lock and names the removal command", async () => {
    const directory = resolve(tmpdir(), `home-ledger-live-${crypto.randomUUID()}`);
    Bun.spawnSync(["mkdir", "-p", directory]);
    temporaryDirectories.push(directory);
    const path = resolve(directory, "ledger.jsonl");
    const lockPath = `${path}.lock`;
    Bun.spawnSync(["mkdir", "-p", lockPath]);
    await Bun.write(resolve(lockPath, "owner.json"), JSON.stringify({ pid: process.pid, timestamp: Date.now() - 11 * 60 * 1000 }));
    await expect(withLedgerLock(path, async () => undefined)).rejects.toThrow(`rm -rf ${lockPath}`);
    await Bun.write(resolve(lockPath, "owner.json"), JSON.stringify({ pid: 999999, timestamp: Date.now() }));
    await expect(withLedgerLock(path, async () => undefined)).rejects.toThrow("reserving spend");
    Bun.spawnSync(["rm", "-rf", lockPath]);
  });

  test("sums daily factory and per-run confirmed amounts", () => {
    const entries = [
      run({ rungReached: 3, amountsUsd: [1] }),
      run({ runId: "run-2", rungReached: 3, amountsUsd: [1, 0.5] }),
      run({ runId: "run-3", role: "operator", rungReached: 3, amountsUsd: [4] }),
      run({ runId: "run-4", timestamp: "2026-09-20T23:00:00.000Z", rungReached: 3, amountsUsd: [1] }),
    ];
    expect(spendForDay(entries, "2026-09-21")).toBe(2.5);
    expect(spendForRun(entries, "run-2")).toBe(1.5);
  });

  test("refuses when another process wins the stale-lock removal race", async () => {
    const directory = resolve(tmpdir(), `home-ledger-race-${crypto.randomUUID()}`);
    Bun.spawnSync(["mkdir", "-p", directory]);
    temporaryDirectories.push(directory);
    const path = resolve(directory, "ledger.jsonl");
    const lockPath = `${path}.lock`;
    const winnerPath = `${lockPath}.winner`;
    Bun.spawnSync(["mkdir", "-p", lockPath]);
    await Bun.write(resolve(lockPath, "owner.json"), JSON.stringify({ pid: 999999, timestamp: Date.now() - 11 * 60 * 1000 }));
    const entered: string[] = [];
    await expect(withLedgerLock(path, async () => {
      entered.push("loser");
      return "loser";
    }, {
      beforeStaleLockRemoval: async () => {
        Bun.spawnSync(["mv", lockPath, winnerPath]);
      },
    })).rejects.toThrow("reserving spend");
    expect(entered).toEqual([]);
    expect(Bun.spawnSync(["test", "-d", winnerPath]).exitCode).toBe(0);
  });

  test("restores a newer lock it displaced and refuses instead of holding twice", async () => {
    const directory = resolve(tmpdir(), `home-ledger-displaced-${crypto.randomUUID()}`);
    Bun.spawnSync(["mkdir", "-p", directory]);
    temporaryDirectories.push(directory);
    const path = resolve(directory, "ledger.jsonl");
    const lockPath = `${path}.lock`;
    const winnerPath = `${lockPath}.winner`;
    Bun.spawnSync(["mkdir", "-p", lockPath]);
    await Bun.write(resolve(lockPath, "owner.json"), JSON.stringify({ pid: 999999, timestamp: Date.now() - 11 * 60 * 1000 }));
    const entered: string[] = [];
    await expect(withLedgerLock(path, async () => {
      entered.push("loser");
      return "loser";
    }, {
      beforeStaleLockRemoval: async () => {
        Bun.spawnSync(["mv", lockPath, winnerPath]);
        Bun.spawnSync(["mkdir", "-p", lockPath]);
        await Bun.write(resolve(lockPath, "owner.json"), JSON.stringify({ pid: process.pid, timestamp: Date.now() }));
      },
    })).rejects.toThrow("reserving spend");
    expect(entered).toEqual([]);
    await expect(withLedgerLock(path, async () => "second")).rejects.toThrow("reserving spend");
    Bun.spawnSync(["rm", "-rf", lockPath]);
    await expect(withLedgerLock(path, async () => "after")).resolves.toBe("after");
  });
});
