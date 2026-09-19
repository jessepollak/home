import { describe, expect, test } from "bun:test";
import { CDP_ACTIVATION_TIMEOUT_MS, createSdkActivationGate } from "./sdk-activation";

describe("CDP SDK activation gate", () => {
  test("deduplicates concurrent activation and reuses the ready boundary", async () => {
    let activations = 0;
    const gate = createSdkActivationGate<{ id: number }>(() => { activations += 1; });
    const first = gate.activate();
    const second = gate.activate();
    expect(first).toBe(second);
    expect(activations).toBe(1);

    const boundary = { id: 1 };
    gate.publish(boundary, true);
    expect(await first).toBe(boundary);
    expect(await gate.activate()).toBe(boundary);
    expect(activations).toBe(1);
  });

  test("rejects failed activation and permits a clean retry", async () => {
    let activations = 0;
    const gate = createSdkActivationGate<{ id: number }>(() => { activations += 1; });
    const failed = gate.activate();
    gate.fail(new Error("initialization failed"));
    await expect(failed).rejects.toThrow("initialization failed");

    const retried = gate.activate();
    expect(activations).toBe(2);
    gate.publish({ id: 2 }, true);
    await expect(retried).resolves.toEqual({ id: 2 });
  });

  test("bounds a hung activation, ignores stale publication, and permits one clean retry", async () => {
    let activations = 0;
    let resets = 0;
    const scheduled: Array<{ callback: () => void; cancelled: boolean; timeoutMs: number }> = [];
    const gate = createSdkActivationGate<{ id: number }>(
      () => { activations += 1; },
      {
        timeoutMs: 25,
        onTimeout: () => { resets += 1; },
        scheduleTimeout: (callback, timeoutMs) => {
          const timer = { callback, cancelled: false, timeoutMs };
          scheduled.push(timer);
          return () => { timer.cancelled = true; };
        },
      },
    );

    const first = gate.activate();
    expect(gate.activate()).toBe(first);
    expect(activations).toBe(1);
    expect(scheduled[0]?.timeoutMs).toBe(25);
    scheduled[0]?.callback();
    await expect(first).rejects.toThrow("timed out after 25ms");
    expect(resets).toBe(1);

    gate.publish({ id: 1 }, true);
    const retry = gate.activate();
    expect(activations).toBe(2);
    gate.publish({ id: 2 }, true);
    await expect(retry).resolves.toEqual({ id: 2 });
    expect(scheduled[1]?.cancelled).toBe(true);
  });

  test("uses the published activation timeout when only a scheduler is injected", async () => {
    const scheduledMs: number[] = [];
    const gate = createSdkActivationGate<{ id: number }>(() => {}, {
      scheduleTimeout: (_callback, timeoutMs) => {
        scheduledMs.push(timeoutMs);
        return () => {};
      },
    });

    void gate.activate().catch(() => {});
    expect(CDP_ACTIVATION_TIMEOUT_MS).toBe(10_000);
    expect(scheduledMs).toEqual([CDP_ACTIVATION_TIMEOUT_MS]);
  });

  test("keeps activation pending through an uninitialized publication", async () => {
    const gate = createSdkActivationGate<{ initialized: boolean }>(() => {});
    const activation = gate.activate();
    let settled = false;
    void activation.finally(() => { settled = true; });

    gate.publish({ initialized: false }, false);
    await Promise.resolve();
    expect(settled).toBe(false);

    const initialized = { initialized: true };
    gate.publish(initialized, true);
    await expect(activation).resolves.toBe(initialized);
  });
});
