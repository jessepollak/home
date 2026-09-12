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
import { BASE_CHAIN_ID } from "@/shared/account/session-types";

export default function NativeBaseAccountBridge({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<VerifiedAccountSession | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [initializationError, setInitializationError] = useState<
    "provider-unavailable" | undefined
  >();
  const restoreSequence = useRef(0);
  const challenges = useRef(new Map<string, { message: string; address: `0x${string}` }>());

  const restore = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++restoreSequence.current;
    await Promise.resolve();
    if (signal?.aborted || sequence !== restoreSequence.current) return;
    setIsInitialized(false);
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
        setIsInitialized(true);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => void restore(controller.signal));
    return () => controller.abort();
  }, [restore]);

  const sdk = useMemo<AccountWalletSdkBoundary>(() => ({
    authentication: "native-base",
    initializationError,
    retryInitialization: restore,
    isInitialized,
    isSignedIn: identity !== null,
    ownerKey: identity ? nativeOwnerKey(identity) : null,
    signInWithEmail: async () => { throw new Error("Email authentication requires a CDP project."); },
    verifyEmailOTP: async () => { throw new Error("Email authentication requires a CDP project."); },
    signInWithSiwe: async (options) => {
      const current = new URL(window.location.href);
      if (options.chainId !== BASE_CHAIN_ID || options.domain !== current.host || options.uri !== current.origin) {
        throw new Error("Native Base authentication request was invalid.");
      }
      const challenge = await requestNativeBaseChallenge(options.address);
      challenges.current.set(challenge.flowId, { message: challenge.message, address: options.address });
      return challenge;
    },
    verifySiweSignature: async (flowId, signature) => {
      const challenge = challenges.current.get(flowId);
      challenges.current.delete(flowId);
      if (!challenge) throw new Error("Native Base authentication request expired.");
      setIdentity(await verifyNativeBaseChallenge(challenge.message, signature, challenge.address));
    },
    getAccessToken: async () => null,
    signOut: async () => {
      await clearNativeBaseSession();
      challenges.current.clear();
      setIdentity(null);
    },
  }), [identity, initializationError, isInitialized, restore]);

  return (
    <AccountWalletSessionOwner sdk={sdk} baseAccountEnabled projectConfigured={false}>
      {children}
    </AccountWalletSessionOwner>
  );
}
