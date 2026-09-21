"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { MoneyAssetOption } from "@/client/money-modal";

export type SavingsDialogMotion = "system" | "reduced";

export type SavingsDialogFixture = {
  motion?: SavingsDialogMotion;
  assetId?: string;
  assetLabel?: string;
  assetDecimals?: number;
  assetOptions?: ReadonlyArray<MoneyAssetOption>;
  onAssetChange?: (assetId: string) => void;
};

const SavingsDialogFixtureContext = createContext<SavingsDialogFixture>({});

export function SavingsDialogFixtureProvider({
  value,
  children,
}: {
  value: SavingsDialogFixture;
  children: ReactNode;
}) {
  return (
    <SavingsDialogFixtureContext.Provider value={value}>
      {children}
    </SavingsDialogFixtureContext.Provider>
  );
}

export function useSavingsDialogFixture(): SavingsDialogFixture {
  return useContext(SavingsDialogFixtureContext);
}
