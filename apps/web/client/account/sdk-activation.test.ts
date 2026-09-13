import { describe, expect, test } from "bun:test";
import { scheduleSdkActivation } from "./cdp-client";

describe("deferred SDK activation", () => {
  test("a provider hint activates on the next microtask", async () => {
    let activated = 0;
    scheduleSdkActivation(() => { activated += 1; }, { hasHint: true, requestIdle: () => () => {} });
    await Promise.resolve();
    expect(activated).toBe(1);
  });

  test("without a hint it still activates once the browser is idle", () => {
    let activated = 0;
    const idle: { run: (() => void) | null } = { run: null };
    scheduleSdkActivation(() => { activated += 1; }, {
      hasHint: false,
      requestIdle: (callback) => { idle.run = callback; return () => { idle.run = null; }; },
    });
    expect(activated).toBe(0);
    idle.run?.();
    expect(activated).toBe(1);
  });

  test("cancel before idle prevents activation", () => {
    let activated = 0;
    const idle: { run: (() => void) | null } = { run: null };
    const cancel = scheduleSdkActivation(() => { activated += 1; }, {
      hasHint: false,
      requestIdle: (callback) => { idle.run = callback; return () => { idle.run = null; }; },
    });
    cancel();
    expect(idle.run).toBeNull();
    expect(activated).toBe(0);
  });
});
