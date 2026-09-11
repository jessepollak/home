"use client";

import { createContext, useContext, type ReactNode } from "react";

const MoneyDataRefreshContext = createContext<() => void>(() => {});

export function MoneyDataRefreshProvider({
  children,
  onConfirmed,
}: {
  children: ReactNode;
  onConfirmed: () => void;
}) {
  return (
    <MoneyDataRefreshContext.Provider value={onConfirmed}>
      {children}
    </MoneyDataRefreshContext.Provider>
  );
}

export function useMoneyDataRefresh(): () => void {
  return useContext(MoneyDataRefreshContext);
}
