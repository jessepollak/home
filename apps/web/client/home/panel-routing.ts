"use client";

import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
} from "react";
import type { ShellPanelId } from "@/config/navigation";
import type { ShellFlow, ShellLocation } from "@/config/shell-location";
import { parseShellOverlayIntent } from "@/config/shell-location";

export type HomeInboundPanelState = {
  panel: ShellPanelId;
  account: "signin" | "settings" | null;
  location: ShellLocation;
  addMoney: boolean;
  returnedFromProvider: boolean;
  flow: ShellFlow | null;
  sendFlow: boolean;
  actionId: string | null;
};

export type HomeShellRouting = {
  state: HomeInboundPanelState;
  popRevision: number;
  setFlow: (
    flow: ShellFlow,
    options?: { actionId?: string | null; mode?: "push" | "replace" },
  ) => void;
  clearFlow: (options?: {
    mode?: "push" | "replace";
    fundingReturn?: boolean;
  }) => void;
};

const HomeShellRoutingContext = createContext<HomeShellRouting | null>(null);

export function HomeShellRoutingProvider({
  value,
  children,
}: {
  value: HomeShellRouting;
  children: ReactNode;
}) {
  return createElement(HomeShellRoutingContext.Provider, { value }, children);
}

export function useOptionalHomeShellRouting(): HomeShellRouting | null {
  return useContext(HomeShellRoutingContext);
}

/**
 * Combines the explicit page location (parsed from the authoritative canonical
 * pathname by the server page or by reparsing `window.location` on popstate)
 * with the allowlisted ephemeral overlay query state.
 */
export function readHomeInboundPanelState(
  location: ShellLocation,
  search: URLSearchParams,
): HomeInboundPanelState {
  const overlay = parseShellOverlayIntent(search);
  return {
    panel: location.panel,
    account: overlay.account,
    location,
    addMoney: overlay.addMoney || overlay.returnedFromFunding ||
      overlay.flow === "add-money" || overlay.flow === "receive",
    returnedFromProvider: overlay.returnedFromFunding,
    flow: overlay.flow,
    sendFlow: overlay.flow === "send",
    actionId: overlay.actionId,
  };
}
