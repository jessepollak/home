"use client";

import {
  createElement,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import { reportClientError } from "@/client/observability/client-reporter";

type SheetProps = { open?: boolean };

const AUTOMATIC_LOAD_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_000;

export type DeferredSheetLoading<P> = (props: P) => {
  onCancel: () => void;
  onClosed?: () => void;
  render: (state: { open: boolean; failed: boolean; retry: () => void; onCancel: () => void; onClosed: () => void; onEntered: () => void }) => ReactNode;
  renderLoaded?: (sheet: ReactNode) => ReactNode;
};

export type DeferredSheet<P extends SheetProps> = ComponentType<P> & {
  preload: () => Promise<void>;
};

/** @public shared money-flow step contract (#1058) */
export type DeferredStep<P extends object> = ComponentType<P & { fallback: (state: { failed: boolean; retry: () => void }) => ReactNode }> & {
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

function createDeferredLoader<P>(load: () => Promise<ComponentType<P>>, failureMessage: string) {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<void> | null = null;
  let failures = 0;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  function preload(): Promise<void> {
    if (pending) return pending;
    pending = load().then(
      (component) => {
        loaded = component;
        notify();
      },
      (error: unknown) => {
        pending = null;
        failures += 1;
        void reportClientError({
          name: error instanceof Error ? error.name : "Error",
          message: failureMessage,
          route: window.location.pathname,
        });
        notify();
      },
    );
    if (failures >= AUTOMATIC_LOAD_ATTEMPTS) notify();
    return pending;
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  return {
    preload,
    subscribe,
    readLoaded: () => loaded,
    readFailures: () => failures,
    readPending: () => pending !== null,
    readServer: () => null,
    readServerFailures: () => 0,
    readServerPending: () => false,
  };
}

function useAutomaticLoad<P>(loader: ReturnType<typeof createDeferredLoader<P>>, active: boolean, loaded: ComponentType<P> | null, failures: number) {
  useEffect(() => {
    if (!active || loaded) return;
    if (failures === 0) {
      void loader.preload();
      return;
    }
    if (failures >= AUTOMATIC_LOAD_ATTEMPTS) return;
    const timer = window.setTimeout(() => void loader.preload(), RETRY_DELAY_MS * failures);
    return () => window.clearTimeout(timer);
  }, [active, loaded, failures, loader]);
}

export function deferSheet<P extends SheetProps>(
  load: () => Promise<ComponentType<P>>,
  loading?: DeferredSheetLoading<P>,
): DeferredSheet<P> {
  const loader = createDeferredLoader(load, "A deferred sheet failed to load.");
  let visibleInstances = 0;

  function Sheet(props: P) {
    const open = props.open ?? true;
    const Loaded = useSyncExternalStore(loader.subscribe, loader.readLoaded, loader.readServer);
    const failed = useSyncExternalStore(loader.subscribe, loader.readFailures, loader.readServerFailures);
    const pending = useSyncExternalStore(loader.subscribe, loader.readPending, loader.readServerPending);
    const [showLoadingShell, setShowLoadingShell] = useState(false);
    const [closingShell, setClosingShell] = useState(false);
    const [shellFinished, setShellFinished] = useState(false);
    const [shellEntered, setShellEntered] = useState(false);
    const [staging, setStaging] = useState(() => open && visibleInstances === 0);
    if (open && !Loaded && !staging) setStaging(true);
    if (loading && open && !Loaded && !showLoadingShell) setShowLoadingShell(true);
    const visible = Loaded !== null && open && (!staging || showLoadingShell);
    if (open) {
      if (closingShell) setClosingShell(false);
    } else if (loading && showLoadingShell && !shellFinished && !closingShell) {
      setClosingShell(true);
    }

    useLayoutEffect(() => {
      if (!visible) return;
      visibleInstances += 1;
      return () => { visibleInstances -= 1; };
    }, [visible]);

    useAutomaticLoad(loader, open, Loaded, failed);

    useEffect(() => {
      if (!Loaded || !staging || showLoadingShell) return;
      const frame = window.requestAnimationFrame(() => setStaging(false));
      return () => window.cancelAnimationFrame(frame);
    }, [Loaded, staging, showLoadingShell]);

    if (loading && showLoadingShell && (!Loaded || closingShell || (open && !shellEntered && !shellFinished))) {
      if (open && !Loaded && !closingShell && shellFinished) setShellFinished(false);
      const shell = loading(props);
      return shell.render({
        open: open && !closingShell,
        failed: failed >= AUTOMATIC_LOAD_ATTEMPTS && !pending,
        retry: () => { void loader.preload(); },
        onCancel: () => { setClosingShell(true); shell.onCancel(); },
        onClosed: () => { setClosingShell(false); setShellFinished(true); setShellEntered(false); shell.onClosed?.(); },
        onEntered: () => { setShellEntered(true); },
      });
    }
    if (!Loaded) return null;
    if (!shellFinished) setShellFinished(true);
    const sheet = createElement(Loaded, { ...props, open: visible });
    return loading && showLoadingShell ? loading(props).renderLoaded?.(sheet) ?? sheet : sheet;
  }

  return Object.assign(Sheet, { preload: loader.preload });
}

/** @public shared money-flow step contract (#1058) */
export function deferStep<P extends object>(load: () => Promise<ComponentType<P>>): DeferredStep<P> {
  const loader = createDeferredLoader(load, "A deferred step failed to load.");

  function Step({ fallback, ...props }: P & { fallback: (state: { failed: boolean; retry: () => void }) => ReactNode }) {
    const Loaded = useSyncExternalStore(loader.subscribe, loader.readLoaded, loader.readServer);
    const failures = useSyncExternalStore(loader.subscribe, loader.readFailures, loader.readServerFailures);
    const pending = useSyncExternalStore(loader.subscribe, loader.readPending, loader.readServerPending);
    useAutomaticLoad(loader, true, Loaded, failures);
    if (!Loaded) return fallback({ failed: failures >= AUTOMATIC_LOAD_ATTEMPTS && !pending, retry: () => { void loader.preload(); } });
    return createElement(Loaded, props as P);
  }

  return Object.assign(Step, { preload: loader.preload });
}
