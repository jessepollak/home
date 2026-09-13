export type BalanceSnapshot = Readonly<Record<string, string | null>>;

export type FreshUntilMovedResult = "moved" | "timed-out";

export type FreshUntilMovedClock = {
  now: () => number;
  setTimer: (callback: () => void, delayMs: number) => unknown;
  clearTimer: (timer: unknown) => void;
};

export const balanceFreshPollIntervalMs = 3_000;
export const balanceFreshTimeoutMs = 60_000;

export function balancesMoved(
  initial: BalanceSnapshot,
  next: BalanceSnapshot,
): boolean {
  return Object.keys(initial).some((assetId) => next[assetId] !== initial[assetId]);
}

export function freshUntilMoved(options: {
  initial: BalanceSnapshot;
  readFresh: () => Promise<BalanceSnapshot>;
  clock?: FreshUntilMovedClock;
  intervalMs?: number;
  timeoutMs?: number;
}): { result: Promise<FreshUntilMovedResult>; cancel: () => void } {
  const clock = options.clock ?? browserClock;
  const intervalMs = options.intervalMs ?? balanceFreshPollIntervalMs;
  const timeoutMs = options.timeoutMs ?? balanceFreshTimeoutMs;
  const startedAt = clock.now();
  let timer: unknown;
  let settled = false;
  let resolveResult!: (result: FreshUntilMovedResult) => void;
  const result = new Promise<FreshUntilMovedResult>((resolve) => {
    resolveResult = resolve;
  });

  const finish = (value: FreshUntilMovedResult) => {
    if (settled) return;
    settled = true;
    if (timer !== undefined) clock.clearTimer(timer);
    resolveResult(value);
  };
  const poll = async () => {
    if (settled) return;
    if (clock.now() - startedAt >= timeoutMs) {
      finish("timed-out");
      return;
    }
    try {
      const next = await options.readFresh();
      if (balancesMoved(options.initial, next)) {
        finish("moved");
        return;
      }
    } catch {
      // A transient fresh-read failure consumes no invented data; keep polling.
    }
    if (!settled) timer = clock.setTimer(() => void poll(), intervalMs);
  };

  timer = clock.setTimer(() => void poll(), intervalMs);
  return { result, cancel: () => finish("timed-out") };
}

const browserClock: FreshUntilMovedClock = {
  now: Date.now,
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};
