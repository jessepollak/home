"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";

const subscribeToMountedState = () => () => {};
const mountedClientSnapshot = () => true;
const mountedServerSnapshot = () => false;

export function useFlowModal() {
  const openedInAppRef = useRef(false);
  const mounted = useSyncExternalStore(
    subscribeToMountedState,
    mountedClientSnapshot,
    mountedServerSnapshot,
  );

  const markOpenedInApp = useCallback(() => {
    openedInAppRef.current = true;
  }, []);

  const takeOpenedInApp = useCallback(() => {
    const opened = openedInAppRef.current;
    openedInAppRef.current = false;
    return opened;
  }, []);

  return { mounted, markOpenedInApp, takeOpenedInApp };
}
