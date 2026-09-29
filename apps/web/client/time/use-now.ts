"use client";

import { useMemo, useSyncExternalStore } from "react";

export function useNow(
  refreshKey: unknown,
  nextDeadline: (nowMs: number) => number | null,
  now: () => number = Date.now,
): number {
  const store = useMemo(() => {
    let snapshot = now();
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const getSnapshot = () => snapshot;
    const subscribe = (notify: () => void) => {
      const schedule = () => {
        const deadline = nextDeadline(snapshot);
        if (deadline === null || deadline <= snapshot) return;
        const wake = () => {
          const current = now();
          if (current < deadline) {
            timeout = setTimeout(wake, Math.max(1, deadline - current));
            return;
          }
          snapshot = current;
          notify();
          schedule();
        };
        timeout = setTimeout(wake, Math.max(1, deadline - now()));
      };
      schedule();
      return () => {
        if (timeout !== null) clearTimeout(timeout);
      };
    };
    return { refreshKey, getSnapshot, subscribe };
  }, [refreshKey, nextDeadline, now]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
