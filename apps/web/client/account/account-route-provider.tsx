"use client";

import { usePathname } from "next/navigation";
import {
  AccountWalletClientProvider,
  CdpAccountProvider,
  createBlockedAccountWalletClient,
} from "./cdp-client";
import type { AccountRenderSeed } from "@/shared/account/session-types";
import type { ReactNode } from "react";

const accessRouteClient = createBlockedAccountWalletClient("unconfigured");

export function isAccessRoute(pathname: string): boolean {
  return pathname === "/access" || pathname.startsWith("/access/");
}

export function AccountProviderForRoute({
  pathname,
  children,
  ...provider
}: {
  pathname: string;
  projectId: string | null;
  baseAccountEnabled?: boolean;
  smokeFixture?: boolean;
  renderSeed?: AccountRenderSeed | null;
  children: ReactNode;
}) {
  if (isAccessRoute(pathname)) {
    return (
      <AccountWalletClientProvider client={accessRouteClient}>
        {children}
      </AccountWalletClientProvider>
    );
  }
  return <CdpAccountProvider {...provider}>{children}</CdpAccountProvider>;
}

export function AccountRouteProvider({
  children,
  ...provider
}: {
  projectId: string | null;
  baseAccountEnabled?: boolean;
  smokeFixture?: boolean;
  renderSeed?: AccountRenderSeed | null;
  children: ReactNode;
}) {
  return (
    <AccountProviderForRoute pathname={usePathname()} {...provider}>
      {children}
    </AccountProviderForRoute>
  );
}
