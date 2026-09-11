"use client";
/* eslint-disable react-hooks/exhaustive-deps -- refs moved behind capability hooks retain the original stable identities. */

import { createContext, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import type { AccountSessionStatus, AccountWalletClient, AccountWalletSdkBoundary, BaseAccountLoginPhase } from "./cdp-client";
import { BaseAccountConnectorError, type BaseAccountConnector, type BaseAccountInvalidation, type BaseAccountRestorer, type ConnectedBaseAccount } from "./base-account-connector";
import { connectBaseAccount, restoreBaseAccount } from "./base-account-connector";
import { classifyAuthDiagnosticError, recordAuthDiagnostic } from "./auth-diagnostics";
import { getVisibleVerifiedSession, SessionValidationError, validateAccountSession, type SessionFetch, type VerifiedSessionOwner } from "./session-client";
import { BASE_CHAIN_ID, type AccountProvider, type AccountProviderRequest } from "@/shared/account/session-types";
import { clearHomeBalancesPresentationCache } from "@/client/portfolio/presentation-cache";
import { isSessionSuppressedForOwner, signOutWithSessionSuppressed, type SessionSuppression } from "./session-sign-out";
import type { ProviderHandleJournalLock, ProviderHandleJournalStorage } from "@/client/money-actions/provider-handle-journal";
import {
  accountAuthorizationBoundary,
  useAuthenticatedTransport,
} from "./cdp-authenticated-transport";
import { useMoneyActionExecution } from "./cdp-money-action-execution";
import {
  BaseAccountLoginError,
  baseLoginFailureFromConnector,
  embeddedSelection,
  invalidationMessage,
  releaseBaseAccountConnection,
  useWalletProviderCapabilities,
  writeAccountProviderHint,
  type AuthenticationIdentity,
} from "./cdp-wallet-provider-capabilities";

export const AccountWalletContext = createContext<AccountWalletClient | null>(null);

export type OwnerGenerationIdentity = {
  ownerKey: string | null;
  generation: number;
  authorizationRevision: number;
  authorizationBoundary: string | null;
};

export type OwnerGenerationFence = {
  currentOwnerKeyRef: MutableRefObject<string | null>;
  generationRef: MutableRefObject<number>;
  revision: number;
  advance: () => number;
  invalidateAuthorization: () => void;
  updateAuthorizationBoundary: (boundary: string | null) => void;
  updateOwnerKey: (ownerKey: string | null) => void;
  capture: (
    ownerKey: string | null,
    authorizationBoundary: string | null,
  ) => OwnerGenerationIdentity;
  isCurrent: (identity: OwnerGenerationIdentity) => boolean;
  isCurrentCleanupIdentity: (identity: { ownerKey: string; generation: number }) => boolean;
};

function useOwnerGenerationFence(ownerKey: string | null): OwnerGenerationFence {
  const currentOwnerKeyRef = useRef(ownerKey);
  const generationRef = useRef(0);
  const authorizationRevisionRef = useRef(0);
  const authorizationBoundaryRef = useRef<string | null>(null);
  const [revision, setRevision] = useState(0);
  const advance = useCallback(() => {
    generationRef.current += 1;
    setRevision((value) => value + 1);
    return generationRef.current;
  }, []);
  const invalidateAuthorization = useCallback(() => {
    authorizationRevisionRef.current += 1;
  }, []);
  const updateAuthorizationBoundary = useCallback((boundary: string | null) => {
    if (authorizationBoundaryRef.current !== boundary) {
      authorizationBoundaryRef.current = boundary;
      authorizationRevisionRef.current += 1;
    }
  }, []);
  const updateOwnerKey = useCallback((nextOwnerKey: string | null) => {
    currentOwnerKeyRef.current = nextOwnerKey;
  }, []);
  const capture = useCallback((
    boundOwnerKey: string | null,
    authorizationBoundary: string | null,
  ) => ({
    ownerKey: boundOwnerKey,
    generation: generationRef.current,
    authorizationRevision: authorizationRevisionRef.current,
    authorizationBoundary,
  }), []);
  const isCurrent = useCallback((identity: OwnerGenerationIdentity) =>
    identity.ownerKey === currentOwnerKeyRef.current &&
    identity.generation === generationRef.current &&
    identity.authorizationRevision === authorizationRevisionRef.current &&
    identity.authorizationBoundary === authorizationBoundaryRef.current, []);
  const isCurrentCleanupIdentity = useCallback(
    (identity: { ownerKey: string; generation: number }) => {
      const activeOwnerKey = currentOwnerKeyRef.current;
      return identity.generation === generationRef.current &&
        (activeOwnerKey === null || activeOwnerKey === identity.ownerKey);
    },
    [],
  );
  return useMemo(() => ({
    currentOwnerKeyRef, generationRef, revision, advance, invalidateAuthorization, updateAuthorizationBoundary, updateOwnerKey, capture, isCurrent, isCurrentCleanupIdentity,
  }), [advance, capture, invalidateAuthorization, isCurrent, isCurrentCleanupIdentity, revision, updateAuthorizationBoundary, updateOwnerKey]);
}

type SdkCleanupIdentity = {
  id: number;
  ownerKey: string;
  generation: number;
};

type SdkCleanupResult = SdkCleanupIdentity & {
  succeeded: boolean;
};

type SdkCleanupFlight = SdkCleanupIdentity & {
  promise: Promise<SdkCleanupResult>;
};

export function AccountWalletSessionOwner({
  children,
  sdk,
  sessionFetch,
  baseAccountEnabled = false,
  baseAccountConnector = connectBaseAccount,
  baseAccountRestorer = restoreBaseAccount,
  providerHandleJournalStorage,
  providerHandleJournalLock,
}: {
  children: ReactNode;
  sdk: AccountWalletSdkBoundary;
  sessionFetch?: SessionFetch;
  baseAccountEnabled?: boolean;
  baseAccountConnector?: BaseAccountConnector;
  baseAccountRestorer?: BaseAccountRestorer;
  providerHandleJournalStorage?: ProviderHandleJournalStorage | null;
  providerHandleJournalLock?: ProviderHandleJournalLock | null;
}) {
  const {
    isInitialized,
    isSignedIn: sdkIsSignedIn,
    ownerKey,
    signInWithEmail,
    verifyEmailOTP,
    signInWithSiwe,
    verifySiweSignature,
    getAccessToken,
    sendUserOperation: sdkSendUserOperation,
    getUserOperation: sdkGetUserOperation,
    signOut: sdkSignOut,
  } = sdk;
  const ownerFence = useOwnerGenerationFence(ownerKey);
  const { invalidateAuthorization } = ownerFence;
  const walletProvider = useWalletProviderCapabilities({
    ownerFence,
    providerHandleJournalStorage,
    providerHandleJournalLock,
  });
  const {
    accountSelectionRef,
    baseConnectionRef,
    baseLoginInProgressRef,
    providerHandleJournal,
    clearBaseConnection,
    signTypedData: signProviderTypedData,
  } = walletProvider;
  const [verifiedOwner, setVerifiedOwner] =
    useState<VerifiedSessionOwner | null>(null);
  const [status, setStatus] = useState<AccountSessionStatus>("restoring");
  const [message, setMessage] = useState<string | null>(null);
  const [sessionSuppression, setSessionSuppression] =
    useState<SessionSuppression | null>(null);
  const validationRequest = useRef<AbortController | null>(null);
  const validationSequence = useRef(0);
  const mounted = useRef(true);
  const preserveSignedOutMessage = useRef(false);
  const previousOwnerKey = useRef(ownerKey);
  const signInAttemptSequence = useRef(0);
  const activeSignInProvider = useRef<"cdp-embedded" | "base-account" | null>(null);
  const emailFlowAttempts = useRef(new Map<string, number>());
  const unabortableAuthAttempts = useRef(new Set<number>());
  const revokedAuthAttempts = useRef(new Set<number>());
  const quarantineCleanupOwners = useRef(new Set<string>());
  const [authQuarantineRevision, setAuthQuarantineRevision] = useState(0);
  const cleanupSequence = useRef(0);
  const sdkCleanupFlight = useRef<SdkCleanupFlight | null>(null);
  const automaticCleanupRequests = useRef(
    new Set<Pick<SdkCleanupIdentity, "ownerKey" | "generation">>(),
  );
  const failedSdkCleanup = useRef<SdkCleanupIdentity | null>(null);
  const isSessionSuppressed = isSessionSuppressedForOwner(
    sessionSuppression,
    ownerKey,
    ownerFence.revision,
  );

  const session = getVisibleVerifiedSession(
    verifiedOwner,
    ownerKey,
    isSessionSuppressed || status !== "verified",
  );
  const authorizationBoundary =
    session && ownerKey ? accountAuthorizationBoundary(ownerKey, session) : null;
  useLayoutEffect(() => {
    ownerFence.updateAuthorizationBoundary(authorizationBoundary);
  }, [authorizationBoundary, ownerFence]);
  const transport = useAuthenticatedTransport({
    session,
    status,
    ownerKey,
    ownerFence,
    getAccessToken,
    sessionFetch,
  });
  const moneyActions = useMoneyActionExecution({
    session,
    status,
    ownerKey,
    ownerFence,
    sdkSendUserOperation,
    sdkGetUserOperation,
    getAccessToken,
    sessionFetch,
    baseConnection: baseConnectionRef,
    providerHandleJournal,
    transport,
  });
  const {
    fetchOperations,
    prepareMoneyAction,
    checkMoneyAction,
    executeMoneyAction,
    pendingTransfer,
    sendTransfer,
    checkPendingTransfer,
    startNewTransfer,
    reset: resetMoneyActions,
  } = moneyActions;
  const {
    fetchPortfolio,
    fetchPortfolioValuation,
    fetchActivity,
    fetchSavingsPositions,
    fetchAccountResource,
  } = transport;

  const advanceAuthenticationGeneration = ownerFence.advance;
  const isCurrentCleanupIdentity = ownerFence.isCurrentCleanupIdentity;

  const getCurrentFailedCleanup = useCallback(() => {
    const failedCleanup = failedSdkCleanup.current;
    if (failedCleanup && !isCurrentCleanupIdentity(failedCleanup)) {
      failedSdkCleanup.current = null;
      return null;
    }
    return failedCleanup;
  }, [isCurrentCleanupIdentity]);

  useLayoutEffect(() => {
    const previousOwner = previousOwnerKey.current;
    ownerFence.updateOwnerKey(ownerKey);
    if (previousOwner !== ownerKey && ownerKey !== null) {
      const previousGeneration = ownerFence.generationRef.current;
      const selection = accountSelectionRef.current;
      const scopedAuthentication =
        selection.provider === "pending-authentication" ||
        selection.provider === "blocked-authentication"
          ? selection.authentication
          : null;
      const ownerlessAuthenticationArrived = Boolean(
        previousOwner === null &&
          scopedAuthentication?.ownerKey === null &&
          scopedAuthentication.generation === previousGeneration,
      );
      const previousOwnerCleanupRequested =
        previousOwner !== null &&
        [...automaticCleanupRequests.current].some(
          (request) =>
            request.ownerKey === previousOwner &&
            request.generation === previousGeneration,
        );
      const nextGeneration = advanceAuthenticationGeneration();

      if (
        ownerlessAuthenticationArrived &&
        (selection.provider === "pending-authentication" ||
          selection.provider === "blocked-authentication")
      ) {
        accountSelectionRef.current = {
          ...selection,
          authentication: { ownerKey, generation: nextGeneration },
        };
      } else if (
        scopedAuthentication &&
        (scopedAuthentication.ownerKey !== ownerKey ||
          scopedAuthentication.generation !== nextGeneration)
      ) {
        accountSelectionRef.current = { provider: "restoring", hint: null };
      } else if (
        previousOwner !== null &&
        ((sessionSuppression?.ownerKey === previousOwner &&
          sessionSuppression.ownerKey !== ownerKey) ||
          previousOwnerCleanupRequested)
      ) {
        accountSelectionRef.current = { provider: "restoring", hint: null };
      }
    }
    previousOwnerKey.current = ownerKey;
  }, [advanceAuthenticationGeneration, ownerKey, sessionSuppression]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    recordAuthDiagnostic({
      kind: "auth-state",
      initialized: isInitialized,
      signedIn: sdkIsSignedIn,
      ownerPresent: Boolean(ownerKey),
      status,
      providerSelection: accountSelectionRef.current.provider,
      suppressed: isSessionSuppressed,
    });
  }, [
    isInitialized,
    isSessionSuppressed,
    ownerKey,
    sdkIsSignedIn,
    status,
  ]);

  const runFencedSignOut = useCallback(async ({
    cleanupOwnerKey,
    cleanupGeneration = ownerFence.generationRef.current,
    explicitRetry = false,
    onFailure,
    onSuccess,
  }: {
    cleanupOwnerKey: string;
    cleanupGeneration?: number;
    explicitRetry?: boolean;
    onFailure: () => void;
    onSuccess?: () => void;
  }): Promise<"succeeded" | "failed" | "stale"> => {
    let flight = sdkCleanupFlight.current;

    if (!flight) {
      const failedCleanup = getCurrentFailedCleanup();
      if (failedCleanup && !explicitRetry) {
        if (mounted.current) {
          onFailure();
        }
        return "failed";
      }

      const identity: SdkCleanupIdentity = {
        id: ++cleanupSequence.current,
        ownerKey:
          explicitRetry && failedCleanup
            ? failedCleanup.ownerKey
            : cleanupOwnerKey,
        generation:
          explicitRetry && failedCleanup
            ? failedCleanup.generation
            : cleanupGeneration,
      };
      const promise = (async (): Promise<SdkCleanupResult> => {
        const succeeded = await signOutWithSessionSuppressed({
          ownerKey: identity.ownerKey,
          generation: identity.generation,
          signOut: sdkSignOut,
          suppress: setSessionSuppression,
          onFailure: () => {},
        });
        const result = { ...identity, succeeded };
        if (sdkCleanupFlight.current?.id === identity.id) {
          sdkCleanupFlight.current = null;
          if (isCurrentCleanupIdentity(identity)) {
            failedSdkCleanup.current = succeeded ? null : identity;
          }
        }
        return result;
      })();
      flight = { ...identity, promise };
      sdkCleanupFlight.current = flight;
    }

    const result = await flight.promise;
    if (
      result.ownerKey !== cleanupOwnerKey ||
      result.generation !== cleanupGeneration ||
      !mounted.current ||
      !isCurrentCleanupIdentity(result)
    ) {
      return "stale";
    }
    if (!result.succeeded) {
      onFailure();
      return "failed";
    }
    onSuccess?.();
    return "succeeded";
  }, [getCurrentFailedCleanup, isCurrentCleanupIdentity, sdkSignOut]);

  const runAutomaticFencedSignOut = useCallback(async ({
    cleanupOwnerKey,
    cleanupGeneration = ownerFence.generationRef.current,
    onFailure,
    onSuccess,
  }: {
    cleanupOwnerKey: string;
    cleanupGeneration?: number;
    onFailure: () => void;
    onSuccess?: () => void;
  }): Promise<"succeeded" | "failed" | "stale"> => {
    const requestedCleanup = {
      ownerKey: cleanupOwnerKey,
      generation: cleanupGeneration,
    };
    automaticCleanupRequests.current.add(requestedCleanup);
    try {
      const pendingCleanup = sdkCleanupFlight.current;
      const joinedForeignCleanup = Boolean(
        pendingCleanup &&
        (pendingCleanup.ownerKey !== cleanupOwnerKey ||
          pendingCleanup.generation !== cleanupGeneration),
      );
      const result = await runFencedSignOut({
        cleanupOwnerKey,
        cleanupGeneration,
        onFailure,
        onSuccess,
      });
      if (result !== "stale" || !joinedForeignCleanup || !mounted.current) {
        return result;
      }
      if (!isCurrentCleanupIdentity(requestedCleanup)) {
        return "stale";
      }
      return runFencedSignOut({
        cleanupOwnerKey,
        cleanupGeneration,
        onFailure,
        onSuccess,
      });
    } finally {
      automaticCleanupRequests.current.delete(requestedCleanup);
    }
  }, [isCurrentCleanupIdentity, runFencedSignOut]);

  const assertAuthenticationCleanupComplete = useCallback(() => {
    if (sdkCleanupFlight.current || getCurrentFailedCleanup()) {
      throw new Error("A previous sign-in is still being cleaned up.");
    }
  }, [getCurrentFailedCleanup]);

  const revokeAuthAttempt = useCallback((attempt: number) => {
    if (
      unabortableAuthAttempts.current.has(attempt) &&
      !revokedAuthAttempts.current.has(attempt)
    ) {
      revokedAuthAttempts.current.add(attempt);
      setAuthQuarantineRevision((revision) => revision + 1);
    }
  }, []);

  const settleAuthAttempt = useCallback(
    async (attempt: number) => {
      unabortableAuthAttempts.current.delete(attempt);
      if (!revokedAuthAttempts.current.has(attempt)) return;
      const cleanupOwnerKey =
        ownerFence.currentOwnerKeyRef.current ?? `pending-authentication:${attempt}`;
      setStatus("signing-out");
      setMessage("A canceled sign-in completed late. Its private details remain hidden.");
      recordAuthDiagnostic({ kind: "signout", reason: "quarantine" });
      await runFencedSignOut({
        cleanupOwnerKey,
        onFailure: () => {
          setStatus("signout-error");
          setMessage(
            "A canceled sign-in is quarantined and private, but provider cleanup did not finish. Retry sign out.",
          );
        },
        onSuccess: () => {
          revokedAuthAttempts.current.delete(attempt);
          quarantineCleanupOwners.current.clear();
          setAuthQuarantineRevision((revision) => revision + 1);
          setStatus("signed-out");
        },
      });
    },
    [runFencedSignOut],
  );

  useEffect(() => {
    if (
      revokedAuthAttempts.current.size === 0 ||
      !sdkIsSignedIn ||
      !ownerKey ||
      quarantineCleanupOwners.current.has(ownerKey)
    ) {
      return;
    }

    quarantineCleanupOwners.current.add(ownerKey);
    setVerifiedOwner(null);
    setStatus("signing-out");
    setMessage("A canceled sign-in completed late. Its private details remain hidden.");
    recordAuthDiagnostic({ kind: "signout", reason: "quarantine" });
    void runFencedSignOut({
      cleanupOwnerKey: ownerKey,
      onFailure: () => {
        setStatus("signout-error");
        setMessage(
          "A canceled sign-in is quarantined and private, but provider cleanup did not finish. Retry sign out.",
        );
      },
      onSuccess: () => {
        revokedAuthAttempts.current.clear();
        quarantineCleanupOwners.current.clear();
        setAuthQuarantineRevision((revision) => revision + 1);
        setStatus("signed-out");
      },
    });
  }, [authQuarantineRevision, ownerKey, runFencedSignOut, sdkIsSignedIn]);

  const clearPrivateState = useCallback(() => {
    validationRequest.current?.abort();
    validationSequence.current += 1;
    invalidateAuthorization();
    resetMoneyActions();
    setVerifiedOwner(null);
    clearHomeBalancesPresentationCache(() => window.localStorage);
  }, [invalidateAuthorization, resetMoneyActions]);

  const rejectBaseSession = useCallback(
    async (
      failureMessage: string,
      options: {
        clearProviderSelectionOnSuccess?: boolean;
      } = {},
    ) => {
      preserveSignedOutMessage.current = false;
      accountSelectionRef.current = {
        provider: "blocked-authentication",
        authentication: {
          ownerKey,
          generation: ownerFence.generationRef.current,
        },
      };
      writeAccountProviderHint("pending:base-account");
      clearPrivateState();
      clearBaseConnection();
      setStatus(ownerKey ? "signing-out" : "signed-out");
      setMessage(failureMessage);
      if (!ownerKey) {
        return;
      }
      recordAuthDiagnostic({ kind: "signout", reason: "invalidated-base" });
      const cleanup = options.clearProviderSelectionOnSuccess
        ? runAutomaticFencedSignOut
        : runFencedSignOut;
      await cleanup({
        cleanupOwnerKey: ownerKey,
        onFailure: () => {
          preserveSignedOutMessage.current = true;
          setStatus("signout-error");
          setMessage(
            `${failureMessage} Private details remain hidden, but sign-out did not finish. Retry sign out.`,
          );
        },
        onSuccess: () => {
          preserveSignedOutMessage.current = true;
          if (options.clearProviderSelectionOnSuccess) {
            accountSelectionRef.current = { provider: "restoring", hint: null };
            writeAccountProviderHint(null);
          }
          setStatus("signed-out");
          setMessage(failureMessage);
        },
      });
    }, [
      clearBaseConnection,
      clearPrivateState,
      ownerKey,
      runAutomaticFencedSignOut,
      runFencedSignOut,
    ]);

  const validateSession = useCallback(async () => {
    if (
      !isInitialized ||
      !sdkIsSignedIn ||
      !ownerKey ||
      isSessionSuppressed ||
      revokedAuthAttempts.current.size > 0
    ) {
      return;
    }

    let selection = accountSelectionRef.current;
    if (
      selection.provider === "blocked-authentication" &&
      selection.authentication === null &&
      selection.restoredPendingHint === true
    ) {
      selection = {
        ...selection,
        authentication: {
          ownerKey,
          generation: ownerFence.generationRef.current,
        },
      };
      accountSelectionRef.current = selection;
    }
    const activeAttempt = signInAttemptSequence.current;
    const isCurrentEmailAuthenticationPending =
      selection.provider === "pending-authentication" &&
      selection.attemptedProvider === "cdp-embedded" &&
      activeSignInProvider.current === "cdp-embedded" &&
      unabortableAuthAttempts.current.has(activeAttempt) &&
      !revokedAuthAttempts.current.has(activeAttempt);
    if (isCurrentEmailAuthenticationPending) {
      return;
    }
    if (
      selection.provider === "pending-authentication" ||
      selection.provider === "blocked-authentication" ||
      (selection.provider === "base-account" &&
        (!baseAccountEnabled ||
          (selection.ownerKey !== null && selection.ownerKey !== ownerKey)))
    ) {
      accountSelectionRef.current = {
        provider: "blocked-authentication",
        authentication:
          selection.provider === "pending-authentication" ||
          selection.provider === "blocked-authentication"
            ? selection.authentication
            : {
                ownerKey,
                generation: ownerFence.generationRef.current,
              },
      };
      clearPrivateState();
      setStatus("signing-out");
      setMessage(
        "For safety, this unfinished sign-in must be started again. No wallet was substituted.",
      );
      recordAuthDiagnostic({
        kind: "signout",
        reason: "blocked-or-pending",
      });
      await runFencedSignOut({
        cleanupOwnerKey: ownerKey,
        onFailure: () => {
          setStatus("signout-error");
          setMessage(
            "Sign-in cleanup is required. Private details remain hidden, but provider sign-out did not finish.",
          );
        },
        onSuccess: () => {
          setStatus("signed-out");
        },
      });
      return;
    }

    const restoringSelection = selection.provider === "restoring";
    const requestedProvider: AccountProviderRequest =
      selection.provider === "restoring"
        ? selection.hint ?? "restore"
        : selection.provider;

    if (selection.provider === "base-account" && !selection.admissionReady) {
      return;
    }
    if (selection.provider === "base-account" && selection.ownerKey === null) {
      selection = { ...selection, ownerKey };
      accountSelectionRef.current = selection;
      baseLoginInProgressRef.current = false;
    }

    validationRequest.current?.abort();
    const controller = new AbortController();
    const sequence = ++validationSequence.current;
    const validationGeneration = ownerFence.generationRef.current;
    validationRequest.current = controller;
    preserveSignedOutMessage.current = false;
    setVerifiedOwner(null);
    setStatus("validating");
    setMessage(null);

    const isCurrentValidation = () =>
      !controller.signal.aborted &&
      sequence === validationSequence.current &&
      validationGeneration === ownerFence.generationRef.current &&
      ownerFence.currentOwnerKeyRef.current === ownerKey &&
      revokedAuthAttempts.current.size === 0;
    let restoredConnection: ConnectedBaseAccount | null = null;
    let validatedProvider: AccountProvider | null = null;

    try {
      let accessToken: string | null;
      try {
        accessToken = await getAccessToken();
        recordAuthDiagnostic({
          kind: "token",
          outcome: accessToken ? "present" : "missing",
        });
      } catch (error) {
        recordAuthDiagnostic({
          kind: "token",
          outcome: "error",
          errorClass: classifyAuthDiagnosticError(error),
        });
        throw error;
      }
      if (!accessToken) {
        throw new SessionValidationError("unauthenticated");
      }

      const session = await validateAccountSession(
        accessToken,
        controller.signal,
        sessionFetch,
        {
          accountProvider: requestedProvider,
          expectedAddress:
            selection.provider === "base-account"
              ? selection.expectedAddress
              : undefined,
        },
      );
      validatedProvider = session.accountProvider;
      if (!isCurrentValidation()) {
        return;
      }

      if (restoringSelection && session.accountProvider === "base-account") {
        if (!session.smartAccount) {
          throw new SessionValidationError("invalid-response");
        }
        let invalidation: BaseAccountInvalidation | null = null;
        restoredConnection = await baseAccountRestorer((reason) => {
          invalidation ??= reason;
          if (restoredConnection && baseConnectionRef.current === restoredConnection) {
            accountSelectionRef.current = {
              provider: "blocked-authentication",
              authentication: {
                ownerKey,
                generation: ownerFence.generationRef.current,
              },
            };
            writeAccountProviderHint("pending:base-account");
            void rejectBaseSession(invalidationMessage(reason));
          }
        });
        if (!isCurrentValidation()) {
          await releaseBaseAccountConnection(restoredConnection);
          return;
        }
        if (invalidation) {
          await restoredConnection.disconnect();
          throw new BaseAccountConnectorError(invalidation);
        }
        if (
          restoredConnection.address.toLowerCase() !==
          session.smartAccount.address.toLowerCase()
        ) {
          await restoredConnection.disconnect();
          restoredConnection = null;
          await rejectBaseSession(
            "The server-verified SIWE address did not match the restored Base Account. Sign-in was blocked.",
          );
          return;
        }
        await restoredConnection.assertUnchanged();
        if (!isCurrentValidation()) {
          await releaseBaseAccountConnection(restoredConnection);
          return;
        }
        baseConnectionRef.current = restoredConnection;
        accountSelectionRef.current = {
          provider: "base-account",
          expectedAddress: session.smartAccount.address,
          ownerKey,
          admissionReady: true,
        };
        writeAccountProviderHint("base-account");
      } else if (restoringSelection) {
        accountSelectionRef.current = embeddedSelection();
        writeAccountProviderHint("cdp-embedded");
      }

      activeSignInProvider.current = null;
      setVerifiedOwner({ ownerKey, session });
      setStatus("verified");
    } catch (error) {
      if (!isCurrentValidation()) {
        if (restoredConnection) {
          await releaseBaseAccountConnection(restoredConnection);
        }
        return;
      }

      setVerifiedOwner(null);
      if (
        restoringSelection &&
        validatedProvider === "base-account" &&
        error instanceof BaseAccountConnectorError &&
        error.reason === "missing-connection"
      ) {
        await rejectBaseSession(
          "Base Account was disconnected. Sign in again to continue.",
          { clearProviderSelectionOnSuccess: true },
        );
        return;
      }
      if (
        (selection.provider === "base-account" ||
          validatedProvider === "base-account") &&
        error instanceof BaseAccountConnectorError &&
        (error.reason === "account-changed" || error.reason === "chain-changed")
      ) {
        await restoredConnection?.disconnect();
        await rejectBaseSession(invalidationMessage(error.reason));
        return;
      }
      if (
        (selection.provider === "base-account" ||
          requestedProvider === "base-account") &&
        error instanceof SessionValidationError &&
        (error.reason === "address-mismatch" || error.reason === "invalid-response")
      ) {
        await restoredConnection?.disconnect();
        await rejectBaseSession(
          error.reason === "address-mismatch"
            ? "The server-verified SIWE address did not match the connected Base Account. Sign-in was blocked."
            : "CDP did not return one verified SIWE address for this Base Account. Sign-in was blocked.",
        );
        return;
      }
      if (
        error instanceof SessionValidationError &&
        error.reason === "unauthenticated"
      ) {
        setStatus("signing-out");
        setMessage("Your session expired. Sign in again to continue.");
        clearBaseConnection();
        recordAuthDiagnostic({ kind: "signout", reason: "no-token-or-401" });
        await runAutomaticFencedSignOut({
          cleanupOwnerKey: ownerKey,
          cleanupGeneration: validationGeneration,
          onFailure: () => {
            setStatus("signout-error");
            setMessage(
              "Your private details are hidden, but sign-out did not finish. Retry sign out.",
            );
          },
          onSuccess: () => {
            setStatus("signed-out");
          },
        });
        return;
      }

      if (restoredConnection) {
        await releaseBaseAccountConnection(restoredConnection);
      }
      setStatus("unavailable");
      setMessage(
        selection.provider === "base-account" ||
          requestedProvider === "base-account" ||
          validatedProvider === "base-account"
          ? "Base Account verification is unavailable. Your private details remain hidden."
          : "Account verification is unavailable. Your private details remain hidden.",
      );
    }
  }, [
    baseAccountEnabled,
    baseAccountRestorer,
    clearBaseConnection,
    clearPrivateState,
    getAccessToken,
    isInitialized,
    isSessionSuppressed,
    ownerKey,
    rejectBaseSession,
    runAutomaticFencedSignOut,
    runFencedSignOut,
    sdkIsSignedIn,
    sessionFetch,
  ]);

  useEffect(() => {
    if (!isInitialized) {
      validationRequest.current?.abort();
      return;
    }

    if (!sdkIsSignedIn || !ownerKey) {
      const timer = window.setTimeout(() => {
        clearPrivateState();
        if (sdkCleanupFlight.current) {
          setStatus("signing-out");
          return;
        }
        if (getCurrentFailedCleanup()) {
          setStatus("signout-error");
          return;
        }
        setStatus("signed-out");
        if (!isSessionSuppressed) {
          if (!preserveSignedOutMessage.current) {
            setMessage(null);
          }
          if (!baseLoginInProgressRef.current) {
            clearBaseConnection();
          }
        }
      }, 0);
      return () => window.clearTimeout(timer);
    }

    if (isSessionSuppressed) {
      validationRequest.current?.abort();
      return;
    }

    const timer = window.setTimeout(() => void validateSession(), 0);
    return () => {
      window.clearTimeout(timer);
      validationRequest.current?.abort();
    };
  }, [
    authQuarantineRevision,
    ownerFence.revision,
    clearBaseConnection,
    clearPrivateState,
    getCurrentFailedCleanup,
    isInitialized,
    isSessionSuppressed,
    ownerKey,
    sdkIsSignedIn,
    validateSession,
  ]);

  const beginSignInAttempt = useCallback(
    (provider: "cdp-embedded" | "base-account") => {
      assertAuthenticationCleanupComplete();
      const generation = advanceAuthenticationGeneration();
      const previousAttempt = signInAttemptSequence.current;
      const sequence = ++signInAttemptSequence.current;
      revokeAuthAttempt(previousAttempt);
      for (const [flowId, attempt] of emailFlowAttempts.current) {
        if (attempt === previousAttempt) {
          emailFlowAttempts.current.delete(flowId);
        }
      }
      activeSignInProvider.current = provider;
      preserveSignedOutMessage.current = false;
      clearPrivateState();
      clearBaseConnection();
      accountSelectionRef.current = {
        provider: "pending-authentication",
        attemptedProvider: provider,
        authentication: {
          ownerKey: ownerFence.currentOwnerKeyRef.current,
          generation,
        },
      };
      writeAccountProviderHint(`pending:${provider}`);
      setStatus("signed-out");
      if (
        revokedAuthAttempts.current.size === 0 &&
        ownerFence.currentOwnerKeyRef.current === null
      ) {
        setSessionSuppression(null);
      }
      setMessage(null);
      return sequence;
    },
    [
      advanceAuthenticationGeneration,
      assertAuthenticationCleanupComplete,
      clearBaseConnection,
      clearPrivateState,
      revokeAuthAttempt,
    ],
  );

  const cancelSignInAttempt = useCallback(() => {
    const canceledAttempt = signInAttemptSequence.current;
    signInAttemptSequence.current += 1;
    revokeAuthAttempt(canceledAttempt);
    for (const [flowId, attempt] of emailFlowAttempts.current) {
      if (attempt === canceledAttempt) {
        emailFlowAttempts.current.delete(flowId);
      }
    }
    const canceledProvider = activeSignInProvider.current;
    const canceledSelection = accountSelectionRef.current;
    const canceledAuthentication =
      canceledSelection.provider === "pending-authentication" ||
      canceledSelection.provider === "blocked-authentication"
        ? canceledSelection.authentication
        : {
            ownerKey: ownerFence.currentOwnerKeyRef.current,
            generation: ownerFence.generationRef.current,
          };
    activeSignInProvider.current = null;
    clearPrivateState();
    clearBaseConnection();
    if (canceledProvider) {
      accountSelectionRef.current = {
        provider: "blocked-authentication",
        authentication: canceledAuthentication,
      };
      writeAccountProviderHint(`pending:${canceledProvider}`);
    }
    setStatus("signed-out");
    setMessage("Sign-in was canceled. Your private details remain hidden.");

    const activeOwner = ownerFence.currentOwnerKeyRef.current;
    if (activeOwner) {
      setStatus("signing-out");
      recordAuthDiagnostic({ kind: "signout", reason: "explicit-cancel" });
      void runFencedSignOut({
        cleanupOwnerKey: activeOwner,
        onFailure: () => {
          setStatus("signout-error");
          setMessage(
            "Sign-in was canceled. Private details remain hidden, but provider cleanup did not finish. Retry sign out.",
          );
        },
        onSuccess: () => {
          setStatus("signed-out");
        },
      });
    }
  }, [clearBaseConnection, clearPrivateState, revokeAuthAttempt, runFencedSignOut]);

  const requestEmailCode = useCallback(
    async (email: string) => {
      const attempt = beginSignInAttempt("cdp-embedded");
      const { flowId } = await signInWithEmail(email);
      emailFlowAttempts.current.set(flowId, attempt);
      return { flowId };
    }, [beginSignInAttempt, signInWithEmail],
  );

  const verifyEmailCode = useCallback(
    async (flowId: string, otp: string) => {
      const attempt = emailFlowAttempts.current.get(flowId);
      if (
        attempt === undefined ||
        attempt !== signInAttemptSequence.current ||
        revokedAuthAttempts.current.size > 0 ||
        sdkCleanupFlight.current !== null ||
        getCurrentFailedCleanup() !== null
      ) {
        throw new Error("A previous sign-in is still being cleaned up.");
      }
      setMessage(null);
      unabortableAuthAttempts.current.add(attempt);
      let sdkCompleted = false;
      try {
        await verifyEmailOTP(flowId, otp);
        sdkCompleted = true;
        if (
          attempt === signInAttemptSequence.current &&
          !revokedAuthAttempts.current.has(attempt)
        ) {
          accountSelectionRef.current = embeddedSelection();
          writeAccountProviderHint("cdp-embedded");
          setAuthQuarantineRevision((revision) => revision + 1);
        }
      } finally {
        if (
          sdkCompleted ||
          attempt !== signInAttemptSequence.current ||
          revokedAuthAttempts.current.has(attempt)
        ) {
          emailFlowAttempts.current.delete(flowId);
        }
        await settleAuthAttempt(attempt);
      }
    }, [getCurrentFailedCleanup, settleAuthAttempt, verifyEmailOTP],
  );

  const signInWithBaseAccount = useCallback(
    async (onPhase: (phase: BaseAccountLoginPhase) => void) => {
      if (!baseAccountEnabled) {
        throw new BaseAccountLoginError("disabled");
      }

      const attemptSequence = beginSignInAttempt("base-account");
      const attemptAuthentication: AuthenticationIdentity = {
        ownerKey: ownerFence.currentOwnerKeyRef.current,
        generation: ownerFence.generationRef.current,
      };
      baseLoginInProgressRef.current = true;
      onPhase("connecting");

      const assertCurrentAttempt = () => {
        if (attemptSequence !== signInAttemptSequence.current) {
          throw new BaseAccountConnectorError("cancelled");
        }
      };

      let connection: ConnectedBaseAccount | null = null;
      let stage: "connecting" | "challenge" | "signing" | "verifying" =
        "connecting";
      const handleInvalidation = (reason: BaseAccountInvalidation) => {
        if (attemptSequence !== signInAttemptSequence.current) {
          if (connection) void connection.disconnect();
          return;
        }
        signInAttemptSequence.current += 1;
        revokeAuthAttempt(attemptSequence);
        baseLoginInProgressRef.current = false;
        accountSelectionRef.current = {
          provider: "blocked-authentication",
          authentication: attemptAuthentication,
        };
        writeAccountProviderHint("pending:base-account");
        if (baseConnectionRef.current === connection) baseConnectionRef.current = null;
        if (connection) void connection.disconnect();
        clearPrivateState();
        setStatus("signed-out");
        setMessage(invalidationMessage(reason));
        const activeOwner = ownerFence.currentOwnerKeyRef.current;
        if (activeOwner) {
          setStatus("signing-out");
          recordAuthDiagnostic({
            kind: "signout",
            reason: "invalidated-base",
          });
          void runFencedSignOut({
            cleanupOwnerKey: activeOwner,
            onFailure: () => {
              setStatus("signout-error");
              setMessage(
                `${invalidationMessage(reason)} Private details remain hidden, but sign-out did not finish.`,
              );
            },
            onSuccess: () => {
              setStatus("signed-out");
            },
          });
        }
      };

      try {
        connection = await baseAccountConnector(handleInvalidation);
        assertCurrentAttempt();
        baseConnectionRef.current = connection;
        accountSelectionRef.current = {
          provider: "base-account",
          expectedAddress: connection.address,
          ownerKey: null,
          admissionReady: false,
        };

        await connection.assertUnchanged();
        stage = "challenge";
        const url = new URL(window.location.href);
        const challenge = await signInWithSiwe({
          address: connection.address,
          chainId: BASE_CHAIN_ID,
          domain: url.host,
          uri: url.origin,
        });
        assertCurrentAttempt();

        await connection.assertUnchanged();
        stage = "signing";
        onPhase("signing");
        const signature = await connection.signMessage(challenge.message);
        assertCurrentAttempt();

        await connection.assertUnchanged();
        stage = "verifying";
        onPhase("verifying");
        unabortableAuthAttempts.current.add(attemptSequence);
        try {
          await verifySiweSignature(challenge.flowId, signature);
          assertCurrentAttempt();
          await connection.assertUnchanged();
          assertCurrentAttempt();
          accountSelectionRef.current = {
            provider: "base-account",
            expectedAddress: connection.address,
            ownerKey: null,
            admissionReady: true,
          };
          writeAccountProviderHint("base-account");
          setAuthQuarantineRevision((revision) => revision + 1);
        } finally {
          await settleAuthAttempt(attemptSequence);
        }
      } catch (error) {
        if (baseConnectionRef.current === connection) {
          baseConnectionRef.current = null;
          await connection?.disconnect();
        } else if (connection) {
          await connection.disconnect();
        }
        accountSelectionRef.current = {
          provider: "blocked-authentication",
          authentication: attemptAuthentication,
        };
        writeAccountProviderHint("pending:base-account");
        if (error instanceof BaseAccountConnectorError) {
          throw new BaseAccountLoginError(
            baseLoginFailureFromConnector(error),
            error,
          );
        }
        if (stage === "verifying") {
          recordAuthDiagnostic({
            kind: "signout",
            reason: "invalidated-base",
          });
          await runFencedSignOut({
            cleanupOwnerKey:
              ownerFence.currentOwnerKeyRef.current ?? `pending-authentication:${attemptSequence}`,
            onFailure: () => {
              setStatus("signout-error");
              setMessage(
                "Base Account verification failed and provider cleanup did not finish. Retry sign out.",
              );
            },
          });
          throw new BaseAccountLoginError("verification-unsupported", error);
        }
        throw new BaseAccountLoginError("provider-unavailable", error);
      }
    }, [
      baseAccountConnector,
      baseAccountEnabled,
      beginSignInAttempt,
      clearPrivateState,
      revokeAuthAttempt,
      runFencedSignOut,
      settleAuthAttempt,
      signInWithSiwe,
      verifySiweSignature,
    ],
  );
  const signOut = useCallback(async () => {
    const requestedOwnerKey = ownerKey;
    const requestedGeneration = ownerFence.generationRef.current;
    let failedCleanup = getCurrentFailedCleanup();
    const pendingCleanup = sdkCleanupFlight.current;
    let cleanupOwnerKey =
      failedCleanup?.ownerKey ?? pendingCleanup?.ownerKey ?? requestedOwnerKey;
    let cleanupGeneration =
      failedCleanup?.generation ?? pendingCleanup?.generation ?? requestedGeneration;
    if (!cleanupOwnerKey) {
      clearBaseConnection();
      accountSelectionRef.current = { provider: "restoring", hint: null };
      writeAccountProviderHint(null);
      preserveSignedOutMessage.current = true;
      setStatus("signed-out");
      setMessage("You are signed out.");
      return;
    }

    preserveSignedOutMessage.current = false;
    setStatus("signing-out");
    setMessage(null);
    activeSignInProvider.current = null;
    clearPrivateState();
    clearBaseConnection();
    recordAuthDiagnostic({ kind: "signout", reason: "explicit-logout" });

    const onFailure = () => {
      preserveSignedOutMessage.current = true;
      setStatus("signout-error");
      setMessage(
        "Your private details are hidden, but sign-out did not finish. Retry sign out.",
      );
    };
    const onSuccess = () => {
      revokedAuthAttempts.current.clear();
      unabortableAuthAttempts.current.clear();
      quarantineCleanupOwners.current.clear();
      accountSelectionRef.current = { provider: "restoring", hint: null };
      writeAccountProviderHint(null);
      preserveSignedOutMessage.current = true;
      setAuthQuarantineRevision((revision) => revision + 1);
      setStatus("signed-out");
      setMessage("You are signed out.");
    };

    let result = await runFencedSignOut({
      cleanupOwnerKey,
      cleanupGeneration,
      explicitRetry: Boolean(failedCleanup),
      onFailure,
      onSuccess,
    });

    if (
      result === "stale" &&
      requestedOwnerKey !== null &&
      ownerFence.currentOwnerKeyRef.current === requestedOwnerKey &&
      ownerFence.generationRef.current === requestedGeneration
    ) {
      failedCleanup = getCurrentFailedCleanup();
      cleanupOwnerKey = failedCleanup?.ownerKey ?? requestedOwnerKey;
      cleanupGeneration = failedCleanup?.generation ?? requestedGeneration;
      result = await runFencedSignOut({
        cleanupOwnerKey,
        cleanupGeneration,
        explicitRetry: Boolean(failedCleanup),
        onFailure,
        onSuccess,
      });
    }

    if (result !== "succeeded") {
      throw new Error("CDP sign-out did not finish.");
    }
  }, [
    clearBaseConnection,
    clearPrivateState,
    getCurrentFailedCleanup,
    ownerKey,
    runFencedSignOut,
  ]);

  const signTypedData = useCallback(
    (typedData: unknown) =>
      signProviderTypedData(
        typedData,
        session,
        status,
        ownerKey,
        authorizationBoundary,
      ),
    [authorizationBoundary, ownerKey, session, signProviderTypedData, status],
  );

  const client = useMemo<AccountWalletClient>(
    () => ({
      projectConfigured: true,
      signInAvailability: "ready",
      baseAccountEnabled,
      isInitialized,
      isSignedIn: sdkIsSignedIn && !isSessionSuppressed,
      ownerKey,
      status,
      session,
      message,
      requestEmailCode,
      verifyEmailCode,
      signInWithBaseAccount,
      cancelSignInAttempt,
      fetchPortfolio,
      fetchPortfolioValuation,
      fetchActivity,
      fetchSavingsPositions,
      fetchAccountResource,
      prepareMoneyAction,
      checkMoneyAction,
      executeMoneyAction,
      fetchOperations,
      pendingTransfer,
      sendTransfer,
      checkPendingTransfer,
      startNewTransfer,
      retrySessionValidation: validateSession,
      signTypedData,
      signOut,
    }),
    [
      baseAccountEnabled,
      cancelSignInAttempt,
      checkMoneyAction,
      checkPendingTransfer,
      executeMoneyAction,
      fetchAccountResource,
      fetchActivity,
      fetchOperations,
      fetchPortfolio,
      fetchPortfolioValuation,
      fetchSavingsPositions,
      isInitialized,
      isSessionSuppressed,
      message,
      ownerKey,
      pendingTransfer,
      prepareMoneyAction,
      requestEmailCode,
      sdkIsSignedIn,
      session,
      sendTransfer,
      signInWithBaseAccount,
      signTypedData,
      startNewTransfer,
      signOut,
      status,
      validateSession,
      verifyEmailCode,
    ],
  );

  return (
    <AccountWalletContext.Provider value={client}>
      {children}
    </AccountWalletContext.Provider>
  );
}
