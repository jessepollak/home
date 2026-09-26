"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type ExpiryScheduler = {
  now(): number;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(id: number): void;
};

const defaultScheduler: ExpiryScheduler = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};

export const ExpirySchedulerContext = createContext<ExpiryScheduler>(defaultScheduler);

export function useReactiveExpiry(expiresAt: string | null) {
  const scheduler = useContext(ExpirySchedulerContext);
  const [expiryState, setExpiryState] = useState(() => ({
    expiresAt,
    expired: isExpired(expiresAt, scheduler),
  }));
  const expired = expiryState.expiresAt === expiresAt ? expiryState.expired : false;

  useEffect(() => {
    if (expiresAt === null) return;
    const deadline = Date.parse(expiresAt);
    let timer: number;
    const update = () => setExpiryState({ expiresAt, expired: true });
    const schedule = () => {
      const remaining = deadline - scheduler.now();
      if (!Number.isFinite(deadline) || remaining <= 0) {
        timer = scheduler.setTimeout(update, 0);
        return;
      }
      timer = scheduler.setTimeout(schedule, Math.min(remaining, 2_147_483_647));
    };
    schedule();
    return () => scheduler.clearTimeout(timer);
  }, [expiresAt, scheduler]);

  const recheckExpired = useCallback(() => {
    if (!isExpired(expiresAt, scheduler)) return false;
    setExpiryState({ expiresAt, expired: true });
    return true;
  }, [expiresAt, scheduler]);

  return { expired, recheckExpired };
}

function isExpired(expiresAt: string | null, scheduler: ExpiryScheduler): boolean {
  if (expiresAt === null) return false;
  const deadline = Date.parse(expiresAt);
  return !Number.isFinite(deadline) || deadline <= scheduler.now();
}
