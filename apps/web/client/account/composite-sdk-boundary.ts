import type {
  AccountSignOutPhase,
  AccountWalletSdkBoundary,
} from "./cdp-client";
import type { VerifiedAccountSession } from "./session-client";

export const CDP_SIGN_OUT_TIMEOUT_MS = 2_500;

export type CompositeSdkBoundaryInput = {
  restorePlanCaptured: boolean;
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
  clearNative: (onPhase?: (phase: AccountSignOutPhase) => void) => Promise<void>;
  cdpSignOut: (onPhase?: (phase: AccountSignOutPhase) => void) => Promise<void>;
  retryCdp: () => Promise<unknown>;
  shouldSignOutCdp: () => boolean;
};

export function composeSdkBoundaries({
  restorePlanCaptured,
  waitForCdpRestore,
  cdp,
  native,
  clearNative,
  cdpSignOut,
  retryCdp,
  shouldSignOutCdp,
}: CompositeSdkBoundaryInput): AccountWalletSdkBoundary {
  const nativeSignedIn = native.hasSettled && native.identity !== null;
  const cdpSignedIn = cdp.isInitialized && !nativeSignedIn && cdp.isSignedIn;
  const cdpRestorePending = waitForCdpRestore && !nativeSignedIn &&
    !cdp.isInitialized && !cdp.initializationError;
  const cdpRestoreUnavailable = waitForCdpRestore && !nativeSignedIn &&
    cdp.initializationError === "provider-unavailable";
  const isInitialized = restorePlanCaptured && native.isSettled && !cdpRestorePending;
  const providersUnavailable = restorePlanCaptured && (
    cdpRestoreUnavailable ||
    (native.initializationError && (cdp.initializationError || (cdp.isInitialized && !cdp.isSignedIn)))
  )
    ? "provider-unavailable" as const
    : undefined;

  return {
    authentication: nativeSignedIn ? "native-base" : "cdp",
    ...(providersUnavailable ? { initializationError: providersUnavailable } : {}),
    retryInitialization: providersUnavailable
      ? async () => {
          const retries: Promise<unknown>[] = [];
          if (native.initializationError) retries.push(native.restore());
          if (cdp.initializationError) retries.push(retryCdp());
          await Promise.all(retries);
        }
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
    signOut: async (onPhase) => {
      const nativeCleanup = clearNative(onPhase);
      let cdpTimedOut = false;
      const cdpCleanup = shouldSignOutCdp()
        ? withTimeout(cdpSignOut((phase) => {
            if (!cdpTimedOut) onPhase?.(phase);
          }), CDP_SIGN_OUT_TIMEOUT_MS, () => {
            cdpTimedOut = true;
            onPhase?.({
              phase: "cdp-signout",
              outcome: "timeout",
              durationMs: CDP_SIGN_OUT_TIMEOUT_MS,
            });
          })
        : Promise.resolve();
      const results = await Promise.allSettled([nativeCleanup, cdpCleanup]);
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failure) throw failure.reason;
    },
  };
}

function withTimeout(
  promise: Promise<void>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    promise,
    new Promise<void>((_, reject) => {
      timer = setTimeout(() => {
        onTimeout();
        reject(new Error("CDP sign-out timed out."));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}
