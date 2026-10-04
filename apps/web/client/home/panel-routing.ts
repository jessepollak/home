"use client";

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import type { ActivityLedgerItem } from "@/client/activity/activity-ledger";
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

export type ActivityDetailReturn = {
  ownerKey: string;
  panel: ShellPanelId;
  path: string;
  item: ActivityLedgerItem;
  opening: boolean;
  suspended: boolean;
};

export type HomeShellRouting = {
  activityReturn?: ActivityDetailReturn | null;
  getActivityReturn?: () => ActivityDetailReturn | null;
  setActivityReturn?: (value: ActivityDetailReturn | null) => void;
  getSearchDetailOrigin?: () => { assetId: string; query: string } | null;
  state: HomeInboundPanelState;
  flowOpener?: HTMLElement | null;
  popRevision: number;
  rootRequest: { panel: ShellPanelId; revision: number } | null;
  openPanel: (panel: ShellPanelId) => void;
  pushRoute: (href: string) => void;
  leaveRoute: (href: string) => void;
  canOpenAssetDetail: (assetKey: string) => boolean;
  openAssetDetail: (assetKey: string) => boolean;
  setFlow: (
    flow: ShellFlow,
    options?: { actionId?: string | null; mode?: "push" | "replace"; opener?: HTMLElement | null },
  ) => boolean;
  clearFlow: (options?: {
    mode?: "push" | "replace";
    fundingReturn?: boolean;
    normalizeInbound?: boolean;
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

export function useActivityReturnOwnerBoundary(
  ownerKey: string | null,
  routing: Pick<HomeShellRouting, "getActivityReturn" | "setActivityReturn">,
): void {
  const previousOwnerRef = useRef<string | null>(null);
  useEffect(() => {
    if (ownerKey === null || ownerKey === previousOwnerRef.current) return;
    previousOwnerRef.current = ownerKey;
    if (routing.getActivityReturn?.()?.ownerKey === ownerKey) return;
    routing.setActivityReturn?.(null);
  }, [ownerKey, routing]);
}

export function openPanelAfterClose(
  routing: Pick<HomeShellRouting, "openPanel"> | null,
  panel: ShellPanelId,
  close: () => void,
  schedule: (open: () => void) => void = (open) => { window.setTimeout(open, 500); },
): void {
  if (!routing) {
    close();
    return;
  }
  const before = window.location.href;
  let opened = false;
  const open = () => {
    if (opened) return;
    opened = true;
    window.removeEventListener("popstate", open);
    routing.openPanel(panel);
  };
  window.addEventListener("popstate", open);
  close();
  if (window.location.href !== before) open();
  else schedule(open);
}

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
