"use client";

import { CDPHooksProvider } from "@coinbase/cdp-hooks";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { AccountWalletSessionOwner } from "./cdp-session-lifecycle";
import {
  CdpHooksErrorBoundary,
  cdpHooksConfig,
  useCdpSdkBoundary,
} from "./cdp-sdk-provider";
import { composeSdkBoundaries } from "./composite-sdk-boundary";
import NativeBaseAccountBridge, { useNativeBaseIdentity } from "./native-base-bridge";

function CompositeAccountBridge({
  waitForCdpRestore,
  children,
}: {
  waitForCdpRestore: boolean;
  children: ReactNode;
}) {
  const cdp = useCdpSdkBoundary();
  const native = useNativeBaseIdentity();
  const cdpSignOutInFlight = useRef(false);
  const emailSwitchInFlight = useRef(false);
  const sdk = useMemo(() => {
    const composed = composeSdkBoundaries({
      waitForCdpRestore,
      cdp,
      native,
      clearNative: native.boundary.signOut,
      cdpSignOut: cdp.signOut,
    });
    return {
      ...composed,
      verifyEmailOTP: async (...args: Parameters<typeof composed.verifyEmailOTP>) => {
        emailSwitchInFlight.current = true;
        try {
          await composed.verifyEmailOTP(...args);
        } finally {
          emailSwitchInFlight.current = false;
        }
      },
    };
  }, [cdp, native, waitForCdpRestore]);

  useEffect(() => {
    if (
      native.identity === null ||
      !cdp.isSignedIn ||
      cdpSignOutInFlight.current ||
      emailSwitchInFlight.current
    ) return;
    cdpSignOutInFlight.current = true;
    void cdp.signOut()
      .catch(() => {})
      .finally(() => { cdpSignOutInFlight.current = false; });
  }, [cdp, native.identity]);

  return (
    <AccountWalletSessionOwner sdk={sdk} baseAccountEnabled projectConfigured>
      {children}
    </AccountWalletSessionOwner>
  );
}

export default function CompositeAccountProvider({
  projectId,
  waitForCdpRestore,
  children,
}: {
  projectId: string;
  waitForCdpRestore: boolean;
  children: ReactNode;
}) {
  const config = useMemo(() => cdpHooksConfig(projectId), [projectId]);

  return (
    <CdpHooksErrorBoundary fallback={<NativeBaseAccountBridge>{children}</NativeBaseAccountBridge>}>
      <CDPHooksProvider config={config}>
        <CompositeAccountBridge waitForCdpRestore={waitForCdpRestore}>
          {children}
        </CompositeAccountBridge>
      </CDPHooksProvider>
    </CdpHooksErrorBoundary>
  );
}
