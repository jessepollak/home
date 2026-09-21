import { afterEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { appendLedger, armEvent, readLedger, spendForDay, spendForRun, surfaceArmState, withLedgerLock, type LedgerEntry, type LedgerRun } from "./ledger";

const temporaryDirectories: string[] = [];
const revision = "abc123";

function run(overrides: Partial<LedgerRun> = {}): LedgerRun {
  return {
    type: "run",
    timestamp: "2026-09-21T12:00:00.000Z",
    runId: "run-1",
    host: "preview.example",
    surface: "send",
    role: "factory",
    mainRevision: revision,
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

  test("arms after three clean rung 2 runs on current main only", () => {
    expect(surfaceArmState([run(), run({ runId: "2" })], "send", revision)).toEqual({
      armed: false,
      cleanRuns: 2,
      reason: "insufficient-clean-runs",
    });
    expect(surfaceArmState([run(), run({ runId: "2" }), run({ runId: "3" })], "send", revision)).toEqual({
      armed: true,
      cleanRuns: 3,
      reason: "clean-runs",
    });
    expect(surfaceArmState([
      run(),
      run({ runId: "2", clean: false }),
      run({ runId: "3", incidents: ["unexpected-host"] }),
      run({ runId: "4", mainRevision: "old" }),
    ], "send", revision).armed).toBe(false);
  });

  test("an incident disarms until a later Jesse arm event", () => {
    const entries: LedgerEntry[] = [run(), run({ runId: "2" }), run({ runId: "3" })];
    entries.push({
      type: "disarm",
      timestamp: "2026-09-21T13:00:00.000Z",
      surface: "send",
      incidents: ["ambiguous-result"],
      runId: "4",
    });
    expect(surfaceArmState(entries, "send", revision).reason).toBe("incident");
    entries.push(armEvent("send", "https://github.com/jessepollak/home/issues/1#issuecomment-123"));
    expect(surfaceArmState(entries, "send", revision)).toEqual({ armed: true, cleanRuns: 0, reason: "jesse-arm" });
  });

  test("validates arm authority pointers", () => {
    expect(armEvent("send", "https://github.com/jessepollak/home/pull/7#issuecomment-42").by).toContain("issuecomment-42");
    expect(() => armEvent("send", "https://example.com/comment/1")).toThrow("GitHub issue or pull-request comment URL");
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
});
