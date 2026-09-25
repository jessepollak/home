"use client";

import {
  createElement,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ComponentType,
} from "react";
import { reportClientError } from "@/client/observability/client-reporter";

type SheetProps = { open?: boolean };

const AUTOMATIC_LOAD_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_000;

export type DeferredSheet<P extends SheetProps> = ComponentType<P> & {
  preload: () => Promise<void>;
};

export function useIdlePreload(preload: () => Promise<void>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(() => void preload(), { timeout: 2_000 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(() => void preload(), 500);
    return () => window.clearTimeout(handle);
  }, [enabled, preload]);
}

export function deferSheet<P extends SheetProps>(
  load: () => Promise<ComponentType<P>>,
): DeferredSheet<P> {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<void> | null = null;
  let failures = 0;
  let visibleInstances = 0;
  const listeners = new Set<() => void>();

  function preload(): Promise<void> {
    pending ??= load().then(
      (component) => {
        loaded = component;
        listeners.forEach((listener) => listener());
      },
      (error: unknown) => {
        pending = null;
        failures += 1;
        void reportClientError({
          name: error instanceof Error ? error.name : "Error",
          message: "A deferred sheet failed to load.",
          route: window.location.pathname,
        });
        listeners.forEach((listener) => listener());
      },
    );
    return pending;
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  const readLoaded = () => loaded;
  const readFailures = () => failures;
  const readServer = () => null;
  const readServerFailures = () => 0;

  function Sheet(props: P) {
    const open = props.open ?? true;
    const Loaded = useSyncExternalStore(subscribe, readLoaded, readServer);
    const failed = useSyncExternalStore(subscribe, readFailures, readServerFailures);
    const [staging, setStaging] = useState(() => open && visibleInstances === 0);
    if (open && !Loaded && !staging) setStaging(true);
    const visible = Loaded !== null && open && !staging;

    useLayoutEffect(() => {
      if (!visible) return;
      visibleInstances += 1;
      return () => {
        visibleInstances -= 1;
      };
    }, [visible]);

    useEffect(() => {
      if (!open || Loaded) return;
      if (failed === 0) {
        void preload();
        return;
      }
      if (failed >= AUTOMATIC_LOAD_ATTEMPTS) return;
      const timer = window.setTimeout(() => void preload(), RETRY_DELAY_MS * failed);
      return () => window.clearTimeout(timer);
    }, [open, Loaded, failed]);

    useEffect(() => {
      if (!Loaded || !staging) return;
      const frame = window.requestAnimationFrame(() => setStaging(false));
      return () => window.cancelAnimationFrame(frame);
    }, [Loaded, staging]);

    if (!Loaded) return null;
    return createElement(Loaded, { ...props, open: visible });
  }

  return Object.assign(Sheet, { preload });
}
