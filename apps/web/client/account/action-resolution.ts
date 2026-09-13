import type { OwnerGenerationFence } from "./cdp-session-lifecycle";

const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const resolutionInitialDelayMs = 1_500;
const resolutionPollIntervalMs = 2_500;
const resolutionTimeoutMs = 3 * 60_000;

type GenerationGuard = Pick<OwnerGenerationFence, "assertCurrent">;

/** Provider operation status folded to what Home acts on. */
export type ResolutionState = {
  status: "pending" | "complete" | "failed" | "unavailable";
  transactionHash?: string;
  reason?: string;
};

const CDP_STATUS_MAP: Record<string, ResolutionState["status"]> = {
  pending: "pending",
  signed: "pending",
  broadcast: "pending",
  complete: "complete",
  failed: "failed",
  dropped: "failed",
};

export type ResolutionClock = {
  now: () => number;
  setTimer: (callback: () => void, delayMs: number) => unknown;
  clearTimer: (timer: unknown) => void;
};

const browserResolutionClock: ResolutionClock = {
  now: Date.now,
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export function pollTransactionResolution(input: {
  generation: number;
  fence: GenerationGuard;
  check: () => Promise<ResolutionState>;
  recordTransactionHash: (transactionHash: string) => Promise<void>;
  onFailedWithoutHash: (reason: string) => void;
  clock?: ResolutionClock;
  initialDelayMs?: number;
  intervalMs?: number;
  timeoutMs?: number;
}): { result: Promise<void>; cancel: () => void } {
  const clock = input.clock ?? browserResolutionClock;
  const startedAt = clock.now();
  const intervalMs = input.intervalMs ?? resolutionPollIntervalMs;
  const timeoutMs = input.timeoutMs ?? resolutionTimeoutMs;
  let timer: unknown;
  let settled = false;
  let resolveResult!: () => void;
  const result = new Promise<void>((resolve) => { resolveResult = resolve; });
  const finish = () => {
    if (settled) return;
    settled = true;
    if (timer !== undefined) clock.clearTimer(timer);
    resolveResult();
  };
  const schedule = (delayMs: number) => {
    if (!settled) timer = clock.setTimer(() => void poll(), delayMs);
  };
  const poll = async () => {
    if (settled || clock.now() - startedAt >= timeoutMs) {
      finish();
      return;
    }
    try {
      input.fence.assertCurrent(input.generation);
    } catch {
      finish();
      return;
    }
    let state: ResolutionState;
    try {
      state = await input.check();
    } catch {
      schedule(intervalMs);
      return;
    }
    if (settled) return;
    try {
      input.fence.assertCurrent(input.generation);
    } catch {
      finish();
      return;
    }
    if ((state.status === "complete" || state.status === "failed") && state.transactionHash) {
      try {
        await input.recordTransactionHash(state.transactionHash);
      } catch {
        schedule(intervalMs);
        return;
      }
      finish();
      return;
    }
    if (state.status === "failed") {
      input.onFailedWithoutHash(state.reason ?? "The wallet operation failed.");
      finish();
      return;
    }
    if (state.status === "unavailable") {
      finish();
      return;
    }
    schedule(intervalMs);
  };
  schedule(input.initialDelayMs ?? resolutionInitialDelayMs);
  return { result, cancel: finish };
}

export function normalizeResolutionState(value: unknown): ResolutionState {
  const status = isRecord(value) ? CDP_STATUS_MAP[String(value.status)] : undefined;
  if (!isRecord(value) || !status) throw new Error("Invalid operation status.");
  const reason = failureReason(value)
    ?? (value.status === "dropped" ? "The operation was dropped before it was included." : null);
  return {
    status,
    ...(typeof value.transactionHash === "string" && hashPattern.test(value.transactionHash)
      ? { transactionHash: value.transactionHash }
      : {}),
    ...(reason ? { reason } : {}),
  };
}

function failureReason(value: Record<string, unknown>): string | null {
  for (const key of ["failureReason", "error", "message"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (isRecord(candidate) && typeof candidate.message === "string" && candidate.message.trim()) {
      return candidate.message.trim();
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
