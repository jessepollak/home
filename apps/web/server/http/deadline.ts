import "server-only";

export function composeSignals(sources: readonly AbortSignal[]): AbortSignal {
  const signal = AbortSignal.any([...sources]);
  if (signal.aborted) return signal;
  const retainSources = () => sources.some((source) => source.aborted);
  signal.addEventListener("abort", retainSources, { once: true });
  return signal;
}

export function composeDeadline(parent: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return parent ? composeSignals([parent, timeout]) : timeout;
}
