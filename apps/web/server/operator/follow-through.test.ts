import { afterEach, expect, spyOn, test } from "bun:test";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { scheduleOperatorRecheck } from "./follow-through";

const operator = { kind: "operator", address: "0x1111111111111111111111111111111111111111" } as const;

afterEach(() => setObservabilityLogWriterForTests());

test("operator page access schedules bounded background re-checks, throttles reloads, and contains failures", async () => {
  const tasks: Array<() => Promise<void>> = [];
  const calls: Array<{ signal: AbortSignal; limit?: number; route: string }> = [];
  const lines: string[] = [];
  const deadlines: number[] = [];
  const timeout = spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    deadlines.push(ms);
    return new AbortController().signal;
  });
  setObservabilityLogWriterForTests((line) => { lines.push(line); });
  let now = Date.parse("2026-09-28T12:01:00.000Z");
  let fail = false;
  const deps = { now: () => now, recheck: async (options: { signal: AbortSignal; limit?: number; route: string }) => {
    calls.push(options);
    if (fail) throw new Error("store unavailable");
  } };
  const schedule = (task: () => Promise<void>) => { tasks.push(task); };
  try {
    scheduleOperatorRecheck({ kind: "unauthenticated" }, schedule, "/admin", deps);
    scheduleOperatorRecheck({ kind: "forbidden" }, schedule, "/admin/customers", deps);
    expect(tasks).toHaveLength(0);

    scheduleOperatorRecheck(operator, schedule, "/admin", deps);
    expect(tasks).toHaveLength(1);
    expect(calls).toHaveLength(0);
    await tasks[0]!();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ limit: 10, route: "/admin" });
    expect(calls[0]?.signal.aborted).toBe(false);
    expect(deadlines).toEqual([20_000]);

    now += 29_999;
    scheduleOperatorRecheck(operator, schedule, "/admin/customers", deps);
    await tasks[1]!();
    expect(calls).toHaveLength(1);

    now += 1;
    fail = true;
    scheduleOperatorRecheck(operator, schedule, "/admin/customers", deps);
    await expect(tasks[2]!()).resolves.toBeUndefined();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ limit: 10, route: "/admin/customers" });
    expect(deadlines).toEqual([20_000, 20_000]);
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ kind: "action-reconcile", route: "/admin", code: "OPERATOR_RECHECK_COMPLETED", outcome: "ok" }),
      expect.objectContaining({ kind: "action-reconcile", route: "/admin/customers", code: "OPERATOR_RECHECK_FAILED", outcome: "failed" }),
    ]);
    expect(lines.join(" ")).not.toContain(operator.address);
  } finally {
    timeout.mockRestore();
  }
});

test("unavailable background scheduling never throws into page render", () => {
  const lines: string[] = [];
  setObservabilityLogWriterForTests((line) => { lines.push(line); });
  expect(() => scheduleOperatorRecheck(operator, () => { throw new Error("after unavailable"); }, "/admin")).not.toThrow();
  expect(lines.map((line) => JSON.parse(line))).toEqual([
    expect.objectContaining({ kind: "action-reconcile", route: "/admin", code: "OPERATOR_RECHECK_UNAVAILABLE", outcome: "unavailable" }),
  ]);
});
