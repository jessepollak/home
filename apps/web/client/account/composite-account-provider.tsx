"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AccountWalletSessionOwner,
} from "./cdp-session-lifecycle";
import type { AccountWalletSdkBoundary } from "./cdp-client";
import { boundedCdpSignOut, composeSdkBoundaries } from "./composite-sdk-boundary";
import { useNativeBaseIdentity } from "./native-base-bridge";
import { createSdkActivationGate } from "./sdk-activation";
import {
  clearCdpRenderHint,
  readHomeAuthRestoreHint,
  writeCdpRestoreMarker,
} from "./cdp-wallet-provider-capabilities";
import {
  createLazyCdpSdkIsland,
  LazyCdpErrorBoundary,
  LazyCdpFailure,
} from "./lazy-cdp-sdk-island";
import {
  markHomeAuthRestore,
  startHomeAuthRestore,
} from "@/client/observability/auth-performance";

type CdpBoundary = AccountWalletSdkBoundary & { isInitialized: boolean };

function CdpSdkIslandAttempt({
  projectId,
  onBoundary,
  onError,
}: {
  projectId: string;
  onBoundary: (boundary: CdpBoundary) => void;
  onError: () => void;
}) {
  const [LazyCdpSdkIsland] = useState(
    () => createLazyCdpSdkIsland(() => import("./cdp-sdk-provider")),
  );
  return (
    <LazyCdpSdkIsland
      projectId={projectId}
      onBoundary={onBoundary}
      onError={onError}
    />
  );
}

function createCdpCleanupObligation(initiallyRequired: boolean) {
  let required = initiallyRequired;
  return {
    clear: () => { required = false; },
    isRequired: () => required,
    require: () => { required = true; },
  };
}

function sameCdpIdentityState(current: CdpBoundary | null, next: CdpBoundary): boolean {
  return current !== null &&
    current.isInitialized === next.isInitialized &&
    current.isSignedIn === next.isSignedIn &&
    current.ownerKey === next.ownerKey &&
    current.initializationError === next.initializationError &&
    current.provisionalSession?.smartAccount?.address === next.provisionalSession?.smartAccount?.address;
}

export default function CompositeAccountProvider({
  projectId,
  baseAccountEnabled,
  children,
}: {
  projectId: string;
  baseAccountEnabled: boolean;
  children: ReactNode;
}) {
  const [restorePlan, setRestorePlan] = useState({
    captured: false,
    cdpHint: false,
    baseHint: false,
  });
  const [cdpCleanup] = useState(() => createCdpCleanupObligation(false));
  const [isCdpActive, setIsCdpActive] = useState(false);
  const [activationFailed, setActivationFailed] = useState(false);
  const [islandAttempt, setIslandAttempt] = useState(0);
  const [cdpBoundary, setCdpBoundary] = useState<CdpBoundary | null>(null);
  const [activationGate] = useState(() => createSdkActivationGate<CdpBoundary>(
    () => {
      setActivationFailed(false);
      setIsCdpActive(true);
      markHomeAuthRestore("sdk-activate");
    },
    {
      onTimeout: () => {
        setCdpBoundary(null);
        setActivationFailed(true);
        setIsCdpActive(false);
        setIslandAttempt((attempt) => attempt + 1);
      },
    },
  ));
  const cdpCleanupInFlightRef = useRef(false);
  const emailSwitchInFlightRef = useRef(false);
  const native = useNativeBaseIdentity(baseAccountEnabled);

  const activate = useCallback((): Promise<CdpBoundary> => {
    cdpCleanup.require();
    return activationGate.activate();
  }, [activationGate, cdpCleanup]);

  const onCdpBoundary = useCallback((boundary: CdpBoundary) => {
    if (boundary.isInitialized && boundary.isSignedIn) cdpCleanup.require();
    setCdpBoundary((current) => sameCdpIdentityState(current, boundary) ? current : boundary);
    activationGate.publish(boundary, boundary.isInitialized);
  }, [activationGate, cdpCleanup]);

  const onCdpError = useCallback(() => {
    const error = new Error("CDP initialization failed.");
    activationGate.fail(error);
    setCdpBoundary(null);
    setActivationFailed(true);
    setIsCdpActive(false);
    setIslandAttempt((attempt) => attempt + 1);
  }, [activationGate]);

  useLayoutEffect(() => {
    let current = true;
    // Defer the browser read out of the first client render. This microtask is
    // queued from layout, ahead of the native restore queued by its effect.
    queueMicrotask(() => {
      if (!current) return;
      const hint = readHomeAuthRestoreHint();
      const cdpHint = hint === "cdp";
      startHomeAuthRestore(hint);
      setRestorePlan({ captured: true, cdpHint, baseHint: hint === "base" });
      if (cdpHint) void activate().catch(() => {});
    });
    return () => { current = false; };
  }, [activate]);

  const cdp = useMemo<CdpBoundary>(() => {
    const published: Omit<
      CdpBoundary,
      | "signInWithEmail"
      | "verifyEmailOTP"
      | "requestBaseAccountChallenge"
      | "verifyBaseAccountProof"
      | "getAccessToken"
      | "signOut"
    > = cdpBoundary ?? {
      authentication: "cdp" as const,
      isInitialized: false,
      isSignedIn: false,
      ownerKey: null,
      provisionalSession: null,
      ...(activationFailed ? { initializationError: "provider-unavailable" as const } : {}),
    };
    return {
      ...published,
      signInWithEmail: async (email) => (await activate()).signInWithEmail(email),
      verifyEmailOTP: async (flowId, otp) => (await activate()).verifyEmailOTP(flowId, otp),
      requestBaseAccountChallenge: async () => {
        throw new Error("Base Account uses the Home-native flow.");
      },
      verifyBaseAccountProof: async () => {
        throw new Error("Base Account uses the Home-native flow.");
      },
      getAccessToken: async () => (await activate()).getAccessToken(),
      sendUserOperation: published.sendUserOperation
        ? async (options) => {
            const boundary = await activate();
            if (!boundary.sendUserOperation) throw new Error("CDP operations are unavailable.");
            return boundary.sendUserOperation(options);
          }
        : undefined,
      getUserOperation: published.getUserOperation
        ? async (options) => {
            const boundary = await activate();
            if (!boundary.getUserOperation) throw new Error("CDP operations are unavailable.");
            return boundary.getUserOperation(options);
          }
        : undefined,
      signOut: async (onPhase) => (await activate()).signOut(onPhase),
    };
  }, [activate, activationFailed, cdpBoundary]);

  const cdpSignOut = useCallback(async (onPhase?: Parameters<CdpBoundary["signOut"]>[0]) => {
    const startedAt = performance.now();
    let reported = false;
    try {
      const boundary = cdpBoundary?.isInitialized ? cdpBoundary : await activate();
      if (!boundary.isSignedIn) {
        cdpCleanup.clear();
        return;
      }
      await boundary.signOut((phase) => {
        reported = true;
        onPhase?.(phase);
      });
      cdpCleanup.clear();
      // A timed-out caller may have restored this durable cleanup marker while
      // the SDK request was still running. Late success removes that obligation.
      clearCdpRenderHint();
    } catch (error) {
      if (!reported) {
        onPhase?.({
          phase: "cdp-signout",
          outcome: "error",
          durationMs: performance.now() - startedAt,
        });
      }
      throw error;
    }
  }, [activate, cdpBoundary, cdpCleanup]);

  const sdk = useMemo(() => {
    const composed = composeSdkBoundaries({
      restorePlanCaptured: restorePlan.captured,
      waitForCdpRestore: restorePlan.cdpHint,
      waitForBaseRestore: restorePlan.baseHint,
      cdp,
      native,
      clearNative: native.boundary.signOut,
      cdpSignOut,
      retryCdp: activate,
      shouldSignOutCdp: () => cdpCleanup.isRequired() || Boolean(
        cdpBoundary?.isInitialized && cdpBoundary.isSignedIn,
      ),
    });
    return {
      ...composed,
      verifyEmailOTP: async (...args: Parameters<typeof composed.verifyEmailOTP>) => {
        emailSwitchInFlightRef.current = true;
        try {
          await composed.verifyEmailOTP(...args);
        } finally {
          if (native.identity === null) emailSwitchInFlightRef.current = false;
        }
      },
    };
  }, [activate, cdp, cdpBoundary, cdpCleanup, cdpSignOut, native, restorePlan]);

  useEffect(() => {
    if (native.identity === null) emailSwitchInFlightRef.current = false;
    if (
      native.identity === null ||
      !cdpBoundary?.isSignedIn ||
      cdpCleanupInFlightRef.current ||
      emailSwitchInFlightRef.current
    ) return;
    cdpCleanupInFlightRef.current = true;
    void boundedCdpSignOut(cdpSignOut)
      .catch(() => { writeCdpRestoreMarker(); })
      .finally(() => { cdpCleanupInFlightRef.current = false; });
  }, [cdpBoundary?.isSignedIn, cdpSignOut, native.identity]);

  return (
    <AccountWalletSessionOwner
      sdk={sdk}
      baseAccountEnabled={baseAccountEnabled}
      projectConfigured
    >
      {isCdpActive ? (
        <LazyCdpErrorBoundary
          key={islandAttempt}
          fallback={<LazyCdpFailure onError={onCdpError} />}
        >
          <Suspense fallback={null}>
            {/* Callers await activationGate while this island is suspended; the
                restoring status also hides sign-in forms on initial load. */}
            <CdpSdkIslandAttempt
              projectId={projectId}
              onBoundary={onCdpBoundary}
              onError={onCdpError}
            />
          </Suspense>
        </LazyCdpErrorBoundary>
      ) : null}
      {children}
    </AccountWalletSessionOwner>
  );
}
