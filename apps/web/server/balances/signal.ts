import "server-only";

import { emitServerEvent } from "@/server/observability/log";

export async function awaitBalanceSignal(
  run: () => Promise<void> | undefined,
  options: { timeoutMs: number },
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const pending = run();
    if (!pending) return;
    await Promise.race([
      pending,
      new Promise<void>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Balance signal timed out.")), options.timeoutMs);
      }),
    ]);
  } catch {
    observeFailure();
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function observeFailure(): void {
  emitServerEvent("balances-signal", {
    route: "/api/balances",
    code: "BALANCE_SIGNAL_FAILED",
    outcome: "unavailable",
    durationMs: 0,
  });
}
