"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { selectVaultPositions } from "@/shared/balances/select";
import type { BalancesSnapshot } from "@/shared/balances/types";

type SharedPositions = {
  holdings: BalancesSnapshot["holdings"];
  address: string;
  region: BalancesSnapshot["region"];
  positions: ReturnType<typeof selectVaultPositions>;
};

const VaultPositionsContext = createContext<SharedPositions | null>(null);

export function VaultPositionsProvider({ snapshot, children }: {
  snapshot: BalancesSnapshot | null;
  children: ReactNode;
}) {
  const holdings = snapshot?.holdings;
  const address = snapshot?.owner.address;
  const region = snapshot?.region;
  const value = useMemo(() => holdings && address && region
    ? { holdings, address, region, positions: selectVaultPositions({ holdings }) }
    : null, [holdings, address, region]);
  return <VaultPositionsContext.Provider value={value}>{children}</VaultPositionsContext.Provider>;
}

export function useVaultPositions(snapshot: BalancesSnapshot | null) {
  const shared = useContext(VaultPositionsContext);
  return useMemo(() => {
    if (!snapshot) return null;
    if (shared && shared.holdings === snapshot.holdings && shared.address === snapshot.owner.address &&
        shared.region === snapshot.region) return shared.positions;
    return selectVaultPositions(snapshot);
  }, [shared, snapshot]);
}
