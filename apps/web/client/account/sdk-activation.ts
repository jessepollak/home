export const CDP_ACTIVATION_TIMEOUT_MS = 10_000;

export type SdkActivationGate<T> = {
  activate: () => Promise<T>;
  publish: (value: T, isReady: boolean) => void;
  fail: (error: unknown) => void;
};

type ActivationTimeoutScheduler = (
  onTimeout: () => void,
  timeoutMs: number,
) => () => void;

type SdkActivationGateOptions = {
  timeoutMs?: number;
  onTimeout?: () => void;
  scheduleTimeout?: ActivationTimeoutScheduler;
};

function scheduleBrowserTimeout(onTimeout: () => void, timeoutMs: number): () => void {
  const timer = setTimeout(onTimeout, timeoutMs);
  return () => clearTimeout(timer);
}

export function createSdkActivationGate<T>(
  onActivate: () => void,
  {
    timeoutMs = CDP_ACTIVATION_TIMEOUT_MS,
    onTimeout,
    scheduleTimeout = scheduleBrowserTimeout,
  }: SdkActivationGateOptions = {},
): SdkActivationGate<T> {
  let current: T | null = null;
  let acceptingPublications = false;
  let pending: {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
    cancelTimeout: () => void;
  } | null = null;

  const rejectPending = (error: unknown) => {
    current = null;
    acceptingPublications = false;
    const attempt = pending;
    pending = null;
    attempt?.cancelTimeout();
    attempt?.reject(error);
  };

  return {
    activate() {
      if (current !== null) return Promise.resolve(current);
      if (pending !== null) return pending.promise;
      let resolve!: (value: T) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      acceptingPublications = true;
      const attempt = {
        promise,
        resolve,
        reject,
        cancelTimeout: () => {},
      };
      pending = attempt;
      attempt.cancelTimeout = scheduleTimeout(() => {
        if (pending !== attempt) return;
        rejectPending(new Error(`CDP activation timed out after ${timeoutMs}ms.`));
        onTimeout?.();
      }, timeoutMs);
      onActivate();
      return promise;
    },
    publish(value, isReady) {
      if (!acceptingPublications) return;
      if (!isReady) {
        current = null;
        return;
      }
      current = value;
      const attempt = pending;
      pending = null;
      attempt?.cancelTimeout();
      attempt?.resolve(value);
    },
    fail(error) {
      rejectPending(error);
    },
  };
}
