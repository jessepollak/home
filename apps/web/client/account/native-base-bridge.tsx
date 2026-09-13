"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AccountWalletSdkBoundary } from "./cdp-client";
import { AccountWalletSessionOwner } from "./cdp-session-lifecycle";
import type { VerifiedAccountSession } from "./session-client";
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

export function useNativeBaseIdentity(): NativeBaseIdentity {
  const [identity, setIdentity] = useState<VerifiedAccountSession | null>(null);
  const [isSettled, setIsSettled] = useState(false);
  const [hasSettled, setHasSettled] = useState(false);
  const [initializationError, setInitializationError] = useState<
    "provider-unavailable" | undefined
  >();
  const restoreSequence = useRef(0);

  const restore = useCallback(async (signal?: AbortSignal) => {
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
        setIsSettled(true);
        setHasSettled(true);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => void restore(controller.signal));
    return () => controller.abort();
  }, [restore]);

  const boundary = useMemo<AccountWalletSdkBoundary>(() => ({
    authentication: "native-base",
    initializationError,
    retryInitialization: restore,
    isInitialized: isSettled,
    isSignedIn: identity !== null,
    ownerKey: identity ? nativeOwnerKey(identity) : null,
    provisionalSession: identity,
    signInWithEmail: async () => { throw new Error("Email authentication requires a CDP project."); },
    verifyEmailOTP: async () => { throw new Error("Email authentication requires a CDP project."); },
    requestBaseAccountChallenge: () => requestNativeBaseChallenge(),
    verifyBaseAccountProof: async ({ address, message, signature }) => {
      setIdentity(await verifyNativeBaseChallenge(address, message, signature));
    },
    getAccessToken: async () => null,
    signOut: async () => {
      await clearNativeBaseSession();
      setIdentity(null);
    },
  }), [identity, initializationError, isSettled, restore]);

  return useMemo(
    () => ({ identity, isSettled, hasSettled, initializationError, restore, boundary }),
    [boundary, hasSettled, identity, initializationError, isSettled, restore],
  );
}

export default function NativeBaseAccountBridge({ children }: { children: ReactNode }) {
  const { boundary } = useNativeBaseIdentity();

  return (
    <AccountWalletSessionOwner sdk={boundary} baseAccountEnabled projectConfigured={false}>
      {children}
    </AccountWalletSessionOwner>
  );
}
