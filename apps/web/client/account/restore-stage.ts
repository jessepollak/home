import { beginHomeAuthRestoreStage, endHomeAuthRestoreStage } from "@/client/observability/auth-performance";

export const ACCOUNT_RESTORE_STAGE_TIMEOUT_MS = 8_000;

type AccountRestoreStage = "token" | "validation";

export class AccountRestoreStageTimeoutError extends Error {
  constructor(readonly stage: AccountRestoreStage) {
    super(`Account restore ${stage} timed out.`);
    this.name = "AccountRestoreStageTimeoutError";
  }
}

export function runAccountRestoreStage<T>(
  stage: AccountRestoreStage,
  signal: AbortSignal,
  work: (signal: AbortSignal) => Promise<T> | T,
  timeoutMs = ACCOUNT_RESTORE_STAGE_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const inner = new AbortController();
    let finished = false;
    const timer: { current?: ReturnType<typeof setTimeout> } = {};
    const settle = (outcome: "settled" | "timeout" | "cancelled", result: () => void) => {
      if (finished) return;
      finished = true;
      if (timer.current !== undefined) clearTimeout(timer.current);
      signal.removeEventListener("abort", onAbort);
      endHomeAuthRestoreStage(stage, outcome);
      result();
    };
    const onAbort = () => {
      inner.abort(signal.reason);
      settle("cancelled", () => reject(signal.reason ?? new DOMException("Aborted", "AbortError")));
    };

    beginHomeAuthRestoreStage(stage);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    timer.current = setTimeout(() => {
      inner.abort();
      settle("timeout", () => reject(new AccountRestoreStageTimeoutError(stage)));
    }, timeoutMs);
    void Promise.resolve().then(() => {
      if (finished) return;
      void Promise.resolve(work(inner.signal)).then(
        (value) => settle("settled", () => resolve(value)),
        (error: unknown) => settle("settled", () => reject(error)),
      );
    }).catch((error: unknown) => settle("settled", () => reject(error)));
  });
}
