import { afterEach, describe, expect, test } from "bun:test";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { awaitBalanceSignal } from "./signal";

afterEach(() => setObservabilityLogWriterForTests());

describe("balance signals", () => {
  test("awaits one successful signal", async () => {
    let calls = 0;
    await awaitBalanceSignal(async () => {
      calls += 1;
    }, { timeoutMs: 5 });
    expect(calls).toBe(1);
  });

  test("a rejected signal emits one failure event and does not throw", async () => {
    const writes: string[] = [];
    setObservabilityLogWriterForTests((line) => writes.push(line));

    await expect(awaitBalanceSignal(
      async () => { throw new Error("database unavailable"); },
      { timeoutMs: 5 },
    )).resolves.toBeUndefined();

    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0] ?? "{}")).toMatchObject({
      kind: "balances-signal",
      code: "BALANCE_SIGNAL_FAILED",
      outcome: "unavailable",
    });
  });

  test("a slow signal times out with one failure event and does not throw", async () => {
    const writes: string[] = [];
    setObservabilityLogWriterForTests((line) => writes.push(line));

    await expect(awaitBalanceSignal(
      () => new Promise<void>(() => {}),
      { timeoutMs: 1 },
    )).resolves.toBeUndefined();

    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0] ?? "{}")).toMatchObject({
      kind: "balances-signal",
      code: "BALANCE_SIGNAL_FAILED",
      outcome: "unavailable",
    });
  });
});
