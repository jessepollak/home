"use client";

import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
} from "react";
import type { ShellPanelId } from "@/config/navigation";
import {
  parseInboundUrlIntent,
  parseShellLocation,
  shellHref,
  type ShellFlow,
  type ShellLocation,
} from "@/config/shell-location";

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

export function readHomeInboundPanelState(
  search: URLSearchParams,
): HomeInboundPanelState {
  const intent = parseInboundUrlIntent(search);
  return {
    panel: intent.location.panel,
    account: intent.location.account,
    location: intent.location,
    addMoney: intent.addMoney || intent.returnedFromFunding ||
      intent.flow === "add-money" || intent.flow === "receive",
    returnedFromProvider: intent.returnedFromFunding,
    flow: intent.flow,
    sendFlow: intent.flow === "send",
    actionId: intent.actionId,
  };
}

export function readHomePanel(search: URLSearchParams): ShellPanelId {
  return parseShellLocation(search).panel;
}

export function homePanelHref(
  shellPath: "/" | "/dashboard",
  panel: ShellPanelId,
): string {
  return shellHref(shellPath, { panel });
}
