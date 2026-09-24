"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onlineManager } from "@tanstack/react-query";
import type { RecoverableBalancesState } from "@/client/balances/use-balances";
import { initialInterruptionState, reduceInterruption, visibleInterruption } from "./interruption";

export type InterruptionClock = {
  now: () => number;
  setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
};

const browserClock: InterruptionClock = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (timer) => clearTimeout(timer),
};

export function useInterruption(
  observation: RecoverableBalancesState["observation"],
  enabled: boolean,
  retryBalances: () => Promise<void>,
  clock: InterruptionClock = browserClock,
) {
  const [state, setState] = useState(initialInterruptionState);
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  const foreground = useRef({ elapsed: 0, last: clock.now(), visible });
  const issued = useRef({ identity: null as string | null, requests: 0 });
  const latest = useRef({ observation, enabled });

  const foregroundNow = useCallback(() => {
    const current = foreground.current;
    const now = clock.now();
    if (current.visible) current.elapsed += Math.max(0, now - current.last);
    current.last = now;
    return current.elapsed;
  }, [clock]);
  const connectivity = useCallback(() => onlineManager.isOnline() &&
    (typeof navigator === "undefined" || navigator.onLine), []);
  const observe = useCallback(() => {
    const current = latest.current;
    const now = foregroundNow();
    setState((previous) => reduceInterruption(previous, {
      type: "observe", observation: current.observation, enabled: current.enabled,
      now, wallNow: clock.now(), online: connectivity(),
    }));
  }, [clock, connectivity, foregroundNow]);

  useEffect(() => {
    latest.current = { observation, enabled };
    observe();
  }, [observe, observation, enabled]);

  useEffect(() => {
    const onConnectivity = () => {
      const now = foregroundNow();
      setState((previous) => reduceInterruption(previous, {
        type: "connectivity", now, wallNow: clock.now(), online: connectivity(),
      }));
    };
    const unsubscribe = onlineManager.subscribe(onConnectivity);
    window.addEventListener("online", onConnectivity);
    window.addEventListener("offline", onConnectivity);
    return () => {
      unsubscribe();
      window.removeEventListener("online", onConnectivity);
      window.removeEventListener("offline", onConnectivity);
    };
  }, [clock, connectivity, foregroundNow]);

  useEffect(() => {
    const onVisibility = () => {
      const now = foregroundNow();
      foreground.current.visible = document.visibilityState === "visible";
      setVisible(foreground.current.visible);
      setState((previous) => reduceInterruption(previous, { type: "tick", now }));
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [foregroundNow]);

  useEffect(() => {
    if (!visible || state.deadline === null) return;
    const delay = Math.max(0, state.deadline - foregroundNow());
    const timer = clock.setTimeout(() => {
      const now = foregroundNow();
      setState((previous) => reduceInterruption(previous, { type: "tick", now }));
    }, delay);
    return () => clock.clearTimeout(timer);
  }, [clock, foregroundNow, state, visible]);

  useEffect(() => {
    if (issued.current.identity !== state.identity || state.requests < issued.current.requests) {
      issued.current = { identity: state.identity, requests: 0 };
    }
    if (state.requests > issued.current.requests) {
      issued.current.requests = state.requests;
      void retryBalances();
    }
  }, [retryBalances, state.identity, state.requests]);

  const retry = useCallback(() => {
    setState((previous) => latest.current.enabled && latest.current.observation.identity === previous.identity
      ? reduceInterruption(previous, { type: "retry" }) : previous);
  }, []);
  const kind = enabled && state.identity === observation.identity ? visibleInterruption(state) : null;
  return {
    interruption: kind ? { kind } : null,
    announcement: kind && state.firstShown && state.announcement ? state.firstShown : null,
    retry,
  };
}
