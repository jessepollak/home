import type { AccountWalletSdkBoundary } from "./cdp-client";
import type { VerifiedAccountSession } from "./session-client";

export type CompositeSdkBoundaryInput = {
  waitForCdpRestore: boolean;
  cdp: AccountWalletSdkBoundary & { isInitialized: boolean };
  native: {
    boundary: AccountWalletSdkBoundary;
    identity: VerifiedAccountSession | null;
    isSettled: boolean;
    hasSettled: boolean;
    initializationError?: "provider-unavailable";
    restore: () => Promise<void>;
  };
  clearNative: () => Promise<void>;
  cdpSignOut: () => Promise<void>;
};

export function composeSdkBoundaries({
  waitForCdpRestore,
  cdp,
  native,
  clearNative,
  cdpSignOut,
}: CompositeSdkBoundaryInput): AccountWalletSdkBoundary {
  const nativeSignedIn = native.hasSettled && native.identity !== null;
  const cdpSignedIn = cdp.isInitialized && !nativeSignedIn && cdp.isSignedIn;
  const cdpRestorePending = waitForCdpRestore && !nativeSignedIn &&
    !cdp.isInitialized && !cdp.initializationError;
  const isInitialized = native.hasSettled && !cdpRestorePending;
  const providersUnavailable = native.initializationError &&
    (cdp.initializationError || (cdp.isInitialized && !cdp.isSignedIn))
    ? "provider-unavailable" as const
    : undefined;

  return {
    authentication: nativeSignedIn ? "native-base" : "cdp",
    ...(providersUnavailable ? { initializationError: providersUnavailable } : {}),
    retryInitialization: providersUnavailable ? native.restore : undefined,
    isInitialized,
    isSignedIn: nativeSignedIn || cdpSignedIn,
    ownerKey: nativeSignedIn ? native.boundary.ownerKey : cdpSignedIn ? cdp.ownerKey : null,
    provisionalSession: nativeSignedIn
      ? native.identity
      : cdpSignedIn
        ? cdp.provisionalSession ?? null
        : null,
    signInWithEmail: cdp.signInWithEmail,
    verifyEmailOTP: async (flowId, otp) => {
      await cdp.verifyEmailOTP(flowId, otp);
      if (native.identity !== null) await clearNative();
    },
    requestBaseAccountChallenge: native.boundary.requestBaseAccountChallenge,
    verifyBaseAccountProof: native.boundary.verifyBaseAccountProof,
    getAccessToken: nativeSignedIn ? async () => null : cdp.getAccessToken,
    sendUserOperation: cdp.sendUserOperation,
    getUserOperation: cdp.getUserOperation,
    signOut: async () => {
      let failure: unknown;
      try {
        await clearNative();
      } catch (error) {
        failure = error;
      }
      try {
        await cdpSignOut();
      } catch (error) {
        failure ??= error;
      }
      if (failure) throw failure;
    },
  };
}
