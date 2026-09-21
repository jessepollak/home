import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { appendLedger, armAuthorityError, armCommentId, armEvent, armReplayError, readLedger, spendForDay, spendForRun, surfaceArmState, withLedgerLock, type ArmComment, type LedgerDisarm, type LedgerEntry, type LedgerRun } from "./ledger";

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

  test("clears a stale spend lock whose owner process is gone", async () => {
    const directory = resolve(tmpdir(), `home-ledger-stale-${crypto.randomUUID()}`);
    Bun.spawnSync(["mkdir", "-p", directory]);
    temporaryDirectories.push(directory);
    const path = resolve(directory, "ledger.jsonl");
    const lockPath = `${path}.lock`;
    await mkdir(lockPath, { mode: 0o700 });
    await writeFile(resolve(lockPath, "owner.json"), JSON.stringify({ pid: 999999, timestamp: Date.now() - 11 * 60 * 1000 }));
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
    await mkdir(lockPath, { mode: 0o700 });
    await writeFile(resolve(lockPath, "owner.json"), JSON.stringify({ pid: process.pid, timestamp: Date.now() - 11 * 60 * 1000 }));
    await expect(withLedgerLock(path, async () => undefined)).rejects.toThrow(`rm -rf ${lockPath}`);
    await writeFile(resolve(lockPath, "owner.json"), JSON.stringify({ pid: 999999, timestamp: Date.now() }));
    await expect(withLedgerLock(path, async () => undefined)).rejects.toThrow("reserving spend");
    await rm(lockPath, { recursive: true, force: true });
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
    const by = "https://github.com/jessepollak/home/issues/1#issuecomment-123";
    entries.push(armEvent("send", by, { html_url: by, body: "/verify arm send", user: { login: "jessepollak" }, created_at: "2026-09-21T13:30:00.000Z" }));
    expect(surfaceArmState(entries, "send", revision)).toEqual({ armed: true, cleanRuns: 0, reason: "jesse-arm" });
  });

  test("an incident run disarms even when the disarm entry is lost", () => {
    const cleanRuns = [run(), run({ runId: "2" }), run({ runId: "3" })];
    expect(surfaceArmState([...cleanRuns, run({ runId: "4", clean: false, incidents: ["ambiguous-result"] })], "send", revision)).toEqual({
      armed: false,
      cleanRuns: 0,
      reason: "incident",
    });
    const by = "https://github.com/jessepollak/home/issues/1#issuecomment-123";
    const armed = [...cleanRuns, armEvent("send", by, { html_url: by, body: "/verify arm send", user: { login: "jessepollak" }, created_at: "2026-09-21T13:30:00.000Z" })];
    expect(surfaceArmState([...armed, run({ runId: "5", clean: false, incidents: ["post-confirm-failure"] })], "send", revision)).toEqual({
      armed: false,
      cleanRuns: 0,
      reason: "incident",
    });
  });

  test("validates the re-arm repository, author, exact command, and resolved URL", () => {
    const by = "https://github.com/jessepollak/home/pull/7#issuecomment-42";
    const comment: ArmComment = { html_url: by, body: "/verify arm send", user: { login: "jessepollak" }, created_at: "2026-09-21T13:00:00.000Z" };
    expect(armCommentId(by)).toBe("42");
    expect(armEvent("send", by, comment).by).toBe(by);
    expect(() => armCommentId("https://github.com/other/repo/issues/1#issuecomment-42")).toThrow("jessepollak/home");
    expect(armAuthorityError("send", by, { ...comment, user: { login: "someone-else" } })).toContain("Only");
    expect(armAuthorityError("send", by, { ...comment, body: "/verify arm save" })).toContain("exactly");
    expect(armAuthorityError("send", by, { ...comment, html_url: "https://github.com/jessepollak/home/issues/8#issuecomment-42" })).toContain("does not match");
    expect(armAuthorityError("send", by, { ...comment, created_at: undefined })).toContain("creation time");
  });

  test("refuses a replayed re-arm comment and one that predates the latest disarm", () => {
    const by = "https://github.com/jessepollak/home/issues/1#issuecomment-123";
    const comment: ArmComment = { html_url: by, body: "/verify arm send", user: { login: "jessepollak" }, created_at: "2026-09-22T00:00:00.000Z" };
    const armed: LedgerEntry[] = [armEvent("send", by, comment, new Date("2026-09-22T00:00:05.000Z"))];
    expect(armed[0]).toMatchObject({ type: "arm", commentId: "123", createdAt: "2026-09-22T00:00:00.000Z" });
    expect(armReplayError(armed, "send", "123", "2026-09-23T00:00:00.000Z")).toContain("already");
    expect(armReplayError([], "send", "123", "2026-09-23T00:00:00.000Z")).toBeNull();
    const disarm: LedgerDisarm = { type: "disarm", timestamp: "2026-09-25T00:00:00.000Z", surface: "send", incidents: ["ambiguous-result"], runId: "run-9" };
    expect(armReplayError([disarm], "send", "124", "2026-09-24T00:00:00.000Z")).toContain("predates");
    expect(armReplayError([disarm], "save", "124", "2026-09-24T00:00:00.000Z")).toBeNull();
    expect(armReplayError([disarm], "send", "124", "2026-09-26T00:00:00.000Z")).toBeNull();
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
