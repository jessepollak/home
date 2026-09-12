import { isBaseAccountEnabled } from "@/shared/account/session-types";
import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import { createSessionHandler } from "@/server/cdp/session";
import { createActivityHandler } from "@/server/activity/handler";
import { getRecentBaseActivity } from "@/server/activity/reader";
import type { RecordedOperationsReader } from "@/server/activity/types";
import { getMoneyActionStore } from "@/server/money-actions/runtime-store";
import type { MoneyActionStore } from "@/server/money-actions/store";
import { writeObservabilityEvent } from "@/server/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const authorizeSession = createSessionHandler({
  getValidator: getCdpAccessTokenValidator,
  baseAccountEnabled: isBaseAccountEnabled(
    process.env.NEXT_PUBLIC_ENABLE_BASE_ACCOUNT,
  ),
});

export type MoneyActionStoreGetter = () => Promise<MoneyActionStore>;

export function createRecordedOperationsReader(
  getStore: MoneyActionStoreGetter = getMoneyActionStore,
): RecordedOperationsReader {
  return async (owner, signal) => {
    if (signal?.aborted) {
      throw signal.reason ??
        new DOMException("Store acquisition aborted.", "AbortError");
    }
    const store = await abortableStoreAcquisition(getStore(), signal);
    await store.list(owner, 50, undefined, {
      signal,
      timeoutMs: 2_000,
    });
  };
}

export const GET = createActivityHandler({
  authorize: authorizeSession,
  readActivity: getRecentBaseActivity,
  readRecordedOperations: createRecordedOperationsReader(),
  observe: writeObservabilityEvent,
});

function abortableStoreAcquisition(
  acquisition: Promise<MoneyActionStore>,
  signal: AbortSignal | undefined,
): Promise<MoneyActionStore> {
  if (!signal) return acquisition;
  if (signal.aborted) {
    return Promise.reject(
      signal.reason ?? new DOMException("Store acquisition aborted.", "AbortError"),
    );
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () =>
      finish(() =>
        reject(
          signal.reason ??
            new DOMException("Store acquisition aborted.", "AbortError"),
        ),
      );
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    void acquisition.then(
      (store) => finish(() => resolve(store)),
      (error) => finish(() => reject(error)),
    );
  });
}
