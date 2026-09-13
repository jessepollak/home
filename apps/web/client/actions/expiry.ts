"use client";

import { useCallback, useEffect, useState } from "react";

export function useReactiveExpiry(expiresAt: string | null) {
  const [expiryState, setExpiryState] = useState(() => ({
    expiresAt,
    expired: isExpired(expiresAt),
  }));
  const expired = expiryState.expiresAt === expiresAt ? expiryState.expired : false;

  useEffect(() => {
    if (expiresAt === null) return;
    const deadline = Date.parse(expiresAt);
    let timer: number;
    const update = () => setExpiryState({ expiresAt, expired: true });
    const schedule = () => {
      const remaining = deadline - Date.now();
      if (!Number.isFinite(deadline) || remaining <= 0) {
        timer = window.setTimeout(update, 0);
        return;
      }
      timer = window.setTimeout(schedule, Math.min(remaining, 2_147_483_647));
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [expiresAt]);

  const recheckExpired = useCallback(() => {
    if (!isExpired(expiresAt)) return false;
    setExpiryState({ expiresAt, expired: true });
    return true;
  }, [expiresAt]);

  return { expired, recheckExpired };
}

function isExpired(expiresAt: string | null): boolean {
  if (expiresAt === null) return false;
  const deadline = Date.parse(expiresAt);
  return !Number.isFinite(deadline) || deadline <= Date.now();
}
