import type { AccountWalletSdkBoundary } from "./cdp-client";
import type { VerifiedAccountSession } from "./session-client";

export type CompositeSdkBoundaryInput = {
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
  cdp,
  native,
  clearNative,
  cdpSignOut,
}: CompositeSdkBoundaryInput): AccountWalletSdkBoundary {
  const isInitialized = cdp.isInitialized && native.hasSettled;
  const nativeSignedIn = isInitialized && native.identity !== null;
  const cdpSignedIn = isInitialized && !nativeSignedIn && cdp.isSignedIn;

  return {
    authentication: nativeSignedIn ? "native-base" : "cdp",
    ...(isInitialized && native.initializationError && !cdp.isSignedIn
      ? { initializationError: native.initializationError }
      : {}),
    retryInitialization: isInitialized && native.initializationError && !cdp.isSignedIn
      ? native.restore
      : undefined,
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
