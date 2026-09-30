import { investmentSelection, type OwnedInvestment } from "@/shared/balances/owned-investments";
import type { BalancesSnapshot } from "@/shared/balances/types";

export function scheduleInvestmentSelection(snapshot: BalancesSnapshot, signal: AbortSignal,
  complete: (rows: OwnedInvestment[]) => void, failed: () => void) {
  if (signal.aborted) return;
  const selection = investmentSelection(snapshot);
  let channel: MessageChannel;
  try { channel = new MessageChannel(); } catch { return failed(); }
  const stop = () => {
    channel.port1.onmessage = null;
    channel.port1.close();
    channel.port2.close();
    selection.return([]);
    signal.removeEventListener("abort", stop);
  };
  signal.addEventListener("abort", stop, { once: true });
  channel.port1.onmessage = () => {
    if (signal.aborted) return;
    try {
      const deadline = performance.now() + 4;
      let next = selection.next();
      while (!next.done && performance.now() < deadline && !signal.aborted) next = selection.next();
      if (signal.aborted) return;
      if (next.done) {
        stop();
        complete(next.value);
      } else channel.port2.postMessage(null);
    } catch {
      stop();
      failed();
    }
  };
  try { channel.port2.postMessage(null); } catch { stop(); failed(); }
}
