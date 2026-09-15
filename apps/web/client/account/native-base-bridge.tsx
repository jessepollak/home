"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AccountSignOutPhase, AccountWalletSdkBoundary } from "./cdp-client";
import { AccountWalletSessionOwner } from "./cdp-session-lifecycle";
import type { VerifiedAccountSession } from "./session-client";
import { markHomeAuthRestore, startHomeAuthRestore } from "@/client/observability/auth-performance";
import { readHomeAuthRestoreHint } from "./cdp-wallet-provider-capabilities";
import {
  clearNativeBaseSession,
  nativeOwnerKey,
  requestNativeBaseChallenge,
  restoreNativeBaseSession,
  verifyNativeBaseChallenge,
} from "./native-base-session-client";

export type NativeBaseIdentity = {
  identity: VerifiedAccountSession | null;
  isSettled: boolean;
  hasSettled: boolean;
  initializationError?: "provider-unavailable";
  restore: (signal?: AbortSignal) => Promise<void>;
  boundary: AccountWalletSdkBoundary;
};

export function useNativeBaseIdentity(enabled = true): NativeBaseIdentity {
  const [identity, setIdentity] = useState<VerifiedAccountSession | null>(null);
  const [isSettled, setIsSettled] = useState(!enabled);
  const [hasSettled, setHasSettled] = useState(!enabled);
  const [initializationError, setInitializationError] = useState<
    "provider-unavailable" | undefined
  >();
  const restoreSequence = useRef(0);

  const restore = useCallback(async (signal?: AbortSignal) => {
    if (!enabled) return;
    const sequence = ++restoreSequence.current;
    await Promise.resolve();
    if (signal?.aborted || sequence !== restoreSequence.current) return;
    setIsSettled(false);
    setInitializationError(undefined);
    try {
      const session = await restoreNativeBaseSession(fetch, signal);
      if (signal?.aborted || sequence !== restoreSequence.current) return;
      setIdentity(session);
    } catch {
      if (signal?.aborted || sequence !== restoreSequence.current) return;
      setIdentity(null);
      setInitializationError("provider-unavailable");
    } finally {
      if (!signal?.aborted && sequence === restoreSequence.current) {
        markHomeAuthRestore("native-settled");
        setIsSettled(true);
        setHasSettled(true);
      }
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    queueMicrotask(() => void restore(controller.signal));
    return () => controller.abort();
  }, [enabled, restore]);

  const availableIdentity = enabled ? identity : null;
  const availableInitializationError = enabled ? initializationError : undefined;
  const boundary = useMemo<AccountWalletSdkBoundary>(() => ({
    authentication: "native-base",
    initializationError: availableInitializationError,
    retryInitialization: enabled ? restore : undefined,
    isInitialized: isSettled,
    isSignedIn: availableIdentity !== null,
    ownerKey: availableIdentity ? nativeOwnerKey(availableIdentity) : null,
    provisionalSession: availableIdentity,
    signInWithEmail: async () => { throw new Error("Email authentication requires a CDP project."); },
    verifyEmailOTP: async () => { throw new Error("Email authentication requires a CDP project."); },
    requestBaseAccountChallenge: () => requestNativeBaseChallenge(),
    verifyBaseAccountProof: async ({ address, message, signature }) => {
      setIdentity(await verifyNativeBaseChallenge(address, message, signature));
    },
    getAccessToken: async () => null,
    signOut: async (onPhase?: (phase: AccountSignOutPhase) => void) => {
      const startedAt = performance.now();
      try {
        await clearNativeBaseSession();
        setIdentity(null);
        onPhase?.({
          phase: "native-logout",
          outcome: "success",
          durationMs: performance.now() - startedAt,
        });
      } catch (error) {
        onPhase?.({
          phase: "native-logout",
          outcome: "error",
          durationMs: performance.now() - startedAt,
        });
        throw error;
      }
    },
  }), [availableIdentity, availableInitializationError, enabled, isSettled, restore]);

  return useMemo(
    () => ({
      identity: availableIdentity,
      isSettled,
      hasSettled,
      initializationError: availableInitializationError,
      restore,
      boundary,
    }),
    [availableIdentity, availableInitializationError, boundary, hasSettled, isSettled, restore],
  );
}

export default function NativeBaseAccountBridge({ children }: { children: ReactNode }) {
  const { boundary } = useNativeBaseIdentity(true);
  useEffect(() => {
    startHomeAuthRestore(readHomeAuthRestoreHint());
  }, []);

  return (
    <AccountWalletSessionOwner sdk={boundary} baseAccountEnabled projectConfigured={false}>
      {children}
    </AccountWalletSessionOwner>
  );
}
