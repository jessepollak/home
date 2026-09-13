import { describe, expect, test } from "bun:test";
import {
  freshUntilMoved,
  type FreshUntilMovedClock,
} from "./fresh-until-moved";

function fakeClock() {
  let now = 0;
  let id = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock: FreshUntilMovedClock = {
    now: () => now,
    setTimer: (callback, delayMs) => {
      const timerId = ++id;
      timers.set(timerId, { at: now + delayMs, callback });
      return timerId;
    },
    clearTimer: (timer) => { timers.delete(timer as number); },
  };
  return {
    clock,
    async advance(ms: number) {
      const target = now + ms;
      while (true) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].callback();
        await Promise.resolve();
      }
      now = target;
      await Promise.resolve();
    },
    pending: () => timers.size,
  };
}

describe("fresh-until-moved scheduler", () => {
  test("stops after an affected balance moves", async () => {
    const fake = fakeClock();
    let reads = 0;
    const run = freshUntilMoved({
      initial: { usdc: "10" },
      readFresh: async () => ({ usdc: ++reads === 2 ? "11" : "10" }),
      clock: fake.clock,
    });

    await fake.advance(6_000);

    expect(await run.result).toBe("moved");
    expect(reads).toBe(2);
    expect(fake.pending()).toBe(0);
  });

  test("stops at sixty seconds when balances do not move", async () => {
    const fake = fakeClock();
    let reads = 0;
    const run = freshUntilMoved({
      initial: { usdc: "10" },
      readFresh: async () => { reads += 1; return { usdc: "10" }; },
      clock: fake.clock,
    });

    await fake.advance(60_000);

    expect(await run.result).toBe("timed-out");
    expect(reads).toBe(19);
    expect(fake.pending()).toBe(0);
  });
});
