"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type NestedAppChrome = {
  title: string;
  onBack: () => void;
  backLabel: string;
};

type AppChromeContextValue = {
  nested: NestedAppChrome | null;
  setNested: (next: NestedAppChrome | null) => void;
};

const AppChromeContext = createContext<AppChromeContextValue | null>(null);

export function AppChromeProvider({ children }: { children: ReactNode }) {
  const [nested, setNested] = useState<NestedAppChrome | null>(null);
  const value = useMemo(() => ({ nested, setNested }), [nested]);
  return (
    <AppChromeContext.Provider value={value}>{children}</AppChromeContext.Provider>
  );
}

export function useOptionalAppChrome() {
  return useContext(AppChromeContext);
}

export function useNestedAppChrome(nested: NestedAppChrome | null) {
  const chrome = useOptionalAppChrome();
  const setNested = chrome?.setNested;
  const nestedRef = useRef(nested);
  const title = nested?.title ?? null;
  const backLabel = nested?.backLabel ?? null;

  useLayoutEffect(() => {
    nestedRef.current = nested;
  });

  useLayoutEffect(() => {
    if (!setNested) return;
    setNested(
      title && backLabel
        ? {
            title,
            backLabel,
            onBack: () => nestedRef.current?.onBack(),
          }
        : null,
    );
    return () => setNested(null);
  }, [backLabel, setNested, title]);

  return chrome;
}
