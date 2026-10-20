import { type Timers } from "../../scripts/performance/readiness";

export const flush = async () => { for (let turn = 0; turn < 16; turn++) await Promise.resolve(); };
export function clock() {
  let now = 0, next = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const delays: number[] = [], cleared: unknown[] = [];
  const timers: Timers = {
    now: () => now,
    setTimeout: (fn, ms) => { const id = ++next; delays.push(ms); pending.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (handle) => { cleared.push(handle); if (typeof handle === "number") pending.delete(handle); },
  };
  return { timers, pending, delays, cleared, elapse: (ms: number) => { now += ms; }, advance: async (ms: number) => {
    await flush();
    const target = now + ms;
    while (true) {
      const due = [...pending.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at;
      pending.delete(due[0]);
      due[1].fn();
      await flush();
    }
    now = target;
    await flush();
  } };
}
