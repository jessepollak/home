import "server-only";

export function composeDeadline(parent: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!parent) return timeout;
  const signal = AbortSignal.any([parent, timeout]);
  if (signal.aborted) return signal;
  const retainSources = () => parent.aborted || timeout.aborted;
  signal.addEventListener("abort", retainSources, { once: true });
  return signal;
}
