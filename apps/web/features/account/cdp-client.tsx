"use client";

import {
  getUserOperation,
  sendUserOperation,
  type GetUserOperationOptions,
  type GetUserOperationResult,
  type SendUserOperationOptions,
  type SendUserOperationResult,
} from "@coinbase/cdp-core";
import {
  CDPHooksProvider,
  useCurrentUser,
  useGetAccessToken,
  useIsInitialized,
  useIsSignedIn,
  useSignInWithEmail,
  useSignInWithSiwe,
  useSignOut,
  useVerifyEmailOTP,
  useVerifySiweSignature,
} from "@coinbase/cdp-hooks";
import {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  signInProviderUnavailableCopy,
  type SignInAvailability,
} from "./sign-in-copy";
import {
  BaseAccountConnectorError,
  connectBaseAccount,
  restoreBaseAccount,
  type BaseAccountConnector,
  type BaseAccountInvalidation,
  type BaseAccountRestorer,
  type ConnectedBaseAccount,
} from "./base-account-connector";
import {
  classifyAuthDiagnosticError,
  recordAuthDiagnostic,
} from "./auth-diagnostics";
import {
  getVisibleVerifiedSession,
  SessionValidationError,
  validateAccountSession,
  type SessionFetch,
  type VerifiedAccountSession,
  type VerifiedSessionOwner,
} from "./session-client";
import {
  ACCOUNT_PROVIDER_HEADER,
  BASE_CHAIN_ID,
  type AccountProvider,
  type AccountProviderRequest,
} from "./session-types";
import { parsePortfolioSnapshot } from "@/features/portfolio/parse";
import {
  claimMoneyAction,
  readMoneyAction,
  recordMoneyActionStatus,
  recordMoneyActionSubmission,
  type MoneyActionApiFetch,
} from "@/features/money-actions/client";
import type {
  OperationResult,
  PreparedMoneyAction,
} from "@/features/money-actions/types";
import {
  ProviderHandleJournal,
  type ProviderHandleJournalLock,
  type ProviderHandleJournalStorage,
} from "@/features/money-actions/provider-handle-journal";
import { recoverJournaledProviderHandle } from "@/features/money-actions/provider-handle-recovery";
import type { StoredMoneyActionOperation } from "@/server/money-actions/store";
import {
  assertTransferRequest,
  buildTransferCall,
  findTransferBalance,
} from "@/features/transfers/transfer-helpers";
import {
  TransferExecutionError,
  type ConfirmedTransfer,
  type PendingTransfer,
  type TransferRequest,
} from "@/features/transfers/types";
import { clearHomeBalancesPresentationCache } from "@/features/portfolio-valuation/presentation-cache";
import {
  isSessionSuppressedForOwner,
  signOutWithSessionSuppressed,
  type SessionSuppression,
} from "./session-sign-out";

export type AccountSessionStatus =
  | "restoring"
  | "signed-out"
  | "validating"
  | "verified"
  | "unavailable"
  | "signing-out"
  | "signout-error";

export type BaseAccountLoginPhase =
  | "connecting"
  | "signing"
  | "verifying";

export type BaseAccountLoginFailure =
  | "disabled"
  | "cancelled"
  | "account-changed"
  | "chain-changed"
  | "provider-unavailable"
  | "verification-unsupported";

export class BaseAccountLoginError extends Error {
  readonly reason: BaseAccountLoginFailure;

  constructor(reason: BaseAccountLoginFailure, cause?: unknown) {
    super(reason, { cause });
    this.name = "BaseAccountLoginError";
    this.reason = reason;
  }
}

export type AccountResourceOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
};

export type AccountWalletClient = {
  projectConfigured: boolean;
  signInAvailability: SignInAvailability;
  baseAccountEnabled: boolean;
  isInitialized: boolean;
  isSignedIn: boolean;
  ownerKey: string | null;
  status: AccountSessionStatus;
  session: VerifiedAccountSession | null;
  message: string | null;
  requestEmailCode: (email: string) => Promise<{ flowId: string }>;
  verifyEmailCode: (flowId: string, otp: string) => Promise<void>;
  signInWithBaseAccount: (
    onPhase: (phase: BaseAccountLoginPhase) => void,
  ) => Promise<void>;
  cancelSignInAttempt: () => void;
  fetchPortfolio: (signal?: AbortSignal) => Promise<unknown>;
  fetchPortfolioValuation: (
    region: import("@/config/regions").RegionId,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  fetchActivity: (query: string, signal?: AbortSignal) => Promise<unknown>;
  fetchSavingsPositions: (signal?: AbortSignal) => Promise<unknown>;
  fetchAccountResource: (path: string, options?: AccountResourceOptions) => Promise<unknown>;
  prepareMoneyAction: (endpoint: string, input: unknown) => Promise<PreparedMoneyAction>;
  checkMoneyAction: (action: PreparedMoneyAction) => Promise<OperationResult>;
  executeMoneyAction: (action: PreparedMoneyAction) => Promise<OperationResult>;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
  pendingTransfer: PendingTransfer | null;
  sendTransfer: (request: TransferRequest, intentId: string) => Promise<ConfirmedTransfer>;
  checkPendingTransfer: () => Promise<ConfirmedTransfer>;
  startNewTransfer: () => void;
  retrySessionValidation: () => Promise<void>;
  signTypedData: (typedData: unknown) => Promise<`0x${string}`>;
  signOut: () => Promise<void>;
};

const AccountWalletContext = createContext<AccountWalletClient | null>(null);

export function createBlockedAccountWalletClient(
  reason: Exclude<SignInAvailability, "ready">,
): AccountWalletClient {
  const projectConfigured = reason !== "unconfigured";
  const blockedMessage = projectConfigured
    ? signInProviderUnavailableCopy.body
    : null;
  const blockedError = projectConfigured
    ? "Sign-in is unavailable."
    : "CDP project is not configured.";

  return {
    projectConfigured,
    signInAvailability: reason,
    baseAccountEnabled: false,
    isInitialized: true,
    isSignedIn: false,
    ownerKey: null,
    status: "signed-out",
    session: null,
    message: blockedMessage,
    requestEmailCode: async () => {
      throw new Error(blockedError);
    },
    verifyEmailCode: async () => {
      throw new Error(blockedError);
    },
    signInWithBaseAccount: async () => {
      throw new BaseAccountLoginError("disabled");
    },
    cancelSignInAttempt: () => {},
    fetchPortfolio: async () => {
      throw new Error("Portfolio is unavailable.");
    },
    fetchPortfolioValuation: async () => {
      throw new Error("Portfolio valuation is unavailable.");
    },
    fetchActivity: async () => {
      throw new Error("Activity is unavailable.");
    },
    fetchSavingsPositions: async () => {
      throw new Error("Savings positions are unavailable.");
    },
    fetchAccountResource: async () => {
      throw new Error("Authenticated resource is unavailable.");
    },
    prepareMoneyAction: async () => {
      throw new TransferExecutionError("unavailable");
    },
    checkMoneyAction: async () => {
      throw new TransferExecutionError("unavailable");
    },
    executeMoneyAction: async () => {
      throw new TransferExecutionError("unavailable");
    },
    fetchOperations: async () => {
      throw new Error("Operations are unavailable.");
    },
    pendingTransfer: null,
    sendTransfer: async () => {
      throw new TransferExecutionError("unavailable");
    },
    checkPendingTransfer: async () => {
      throw new TransferExecutionError("unavailable");
    },
    startNewTransfer: () => {},
    retrySessionValidation: async () => {},
    signTypedData: async () => {
      throw new BaseAccountConnectorError("invalid-provider-response");
    },
    signOut: async () => {},
  };
}

const unconfiguredClient = createBlockedAccountWalletClient("unconfigured");
const providerUnavailableClient = createBlockedAccountWalletClient(
  "provider-unavailable",
);

class CdpHooksErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

export type AccountWalletSdkBoundary = {
  isInitialized: boolean;
  isSignedIn: boolean;
  ownerKey: string | null;
  signInWithEmail: (email: string) => Promise<{ flowId: string }>;
  verifyEmailOTP: (flowId: string, otp: string) => Promise<void>;
  signInWithSiwe: (options: {
    address: `0x${string}`;
    chainId: typeof BASE_CHAIN_ID;
    domain: string;
    uri: string;
  }) => Promise<{ flowId: string; message: string }>;
  verifySiweSignature: (
    flowId: string,
    signature: `0x${string}`,
  ) => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  sendUserOperation?: (
    options: SendUserOperationOptions,
  ) => Promise<SendUserOperationResult>;
  getUserOperation?: (
    options: GetUserOperationOptions,
  ) => Promise<GetUserOperationResult>;
  signOut: () => Promise<void>;
};

type AuthenticationIdentity = {
  ownerKey: string | null;
  generation: number;
};

type AccountSelection =
  | { provider: "restoring"; hint: AccountProvider | null }
  | {
      provider: "pending-authentication";
      attemptedProvider: AccountProvider;
      authentication: AuthenticationIdentity;
    }
  | {
      provider: "blocked-authentication";
      authentication: AuthenticationIdentity | null;
      restoredPendingHint?: true;
    }
  | { provider: "cdp-embedded" }
  | {
      provider: "base-account";
      expectedAddress: `0x${string}`;
      ownerKey: string | null;
      admissionReady: boolean;
    };

type AccountProviderHint = AccountProvider | `pending:${AccountProvider}`;

const ACCOUNT_PROVIDER_HINT_KEY = "home:account-provider";

function embeddedSelection(): AccountSelection {
  return { provider: "cdp-embedded" };
}

function initialAccountSelection(): AccountSelection {
  try {
    const hint = window.sessionStorage.getItem(ACCOUNT_PROVIDER_HINT_KEY);
    if (hint === "cdp-embedded" || hint === "base-account") {
      return { provider: "restoring", hint };
    }
    if (hint === "pending:cdp-embedded" || hint === "pending:base-account") {
      return {
        provider: "blocked-authentication",
        authentication: null,
        restoredPendingHint: true,
      };
    }
    if (hint !== null) {
      return { provider: "blocked-authentication", authentication: null };
    }
  } catch {
    // The restored SDK identity can still select one unambiguous provider.
  }
  return { provider: "restoring", hint: null };
}

function writeAccountProviderHint(provider: AccountProviderHint | null) {
  try {
    if (provider) {
      window.sessionStorage.setItem(ACCOUNT_PROVIDER_HINT_KEY, provider);
    } else {
      window.sessionStorage.removeItem(ACCOUNT_PROVIDER_HINT_KEY);
    }
  } catch {
    // This hint may only restrict restoration; storage is not an auth boundary.
  }
}

function baseLoginFailureFromConnector(
  error: BaseAccountConnectorError,
): BaseAccountLoginFailure {
  switch (error.reason) {
    case "cancelled":
      return "cancelled";
    case "account-changed":
      return "account-changed";
    case "chain-changed":
      return "chain-changed";
    default:
      return "provider-unavailable";
  }
}

async function releaseBaseAccountConnection(
  connection: ConnectedBaseAccount,
): Promise<void> {
  if (connection.release) {
    connection.release();
    return;
  }
  await connection.disconnect();
}

function invalidationMessage(reason: BaseAccountInvalidation): string {
  switch (reason) {
    case "account-changed":
      return "The connected Base Account changed. Sign in again to continue.";
    case "chain-changed":
      return "The Base Account network changed. Switch to Base and sign in again.";
    default:
      return "The Base Account disconnected. Sign in again to continue.";
  }
}

const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/;
const TRANSFER_CONFIRMATION_TIMEOUT_MS = 120_000;
const TRANSFER_CONFIRMATION_POLL_MS = 1_500;

function transferBoundaryKey(
  ownerKey: string,
  session: VerifiedAccountSession,
): string | null {
  return session.smartAccount
    ? `${ownerKey}\u0000${session.user.subject}\u0000${session.smartAccount.address}\u0000${session.accountProvider}`
    : null;
}

function normalizeTransactionHash(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !transactionHashPattern.test(value)) {
    throw new TransferExecutionError("failed");
  }
  return value.toLowerCase() as `0x${string}`;
}

const accountResourcePrefixes = [
  "/api/actions",
  "/api/savings/actions",
  "/api/trades",
  "/api/borrow",
  "/api/funding",
] as const;

function normalizeAccountResourcePath(path: string): string {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    path.includes("#") ||
    /(?:^|\/)\.\.?($|\/)|%2e|%2f|%5c/i.test(path)
  ) {
    throw new TransferExecutionError("invalid-request");
  }
  let url: URL;
  try {
    url = new URL(path, "https://home.invalid");
  } catch {
    throw new TransferExecutionError("invalid-request");
  }
  if (
    url.origin !== "https://home.invalid" ||
    !accountResourcePrefixes.some(
      (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
    )
  ) {
    throw new TransferExecutionError("invalid-request");
  }
  return `${url.pathname}${url.search}`;
}

function operationResult(operation: StoredMoneyActionOperation): OperationResult {
  return {
    id: operation.action.id,
    status: operation.status,
    ...(operation.transactionHash ? { transactionHash: operation.transactionHash } : {}),
    ...(operation.userOperationHash ? { userOperationHash: operation.userOperationHash } : {}),
  };
}

function isMoneyActionOwnedBySession(
  action: PreparedMoneyAction,
  session: VerifiedAccountSession,
): boolean {
  return Boolean(
    session.smartAccount &&
    action.owner.subject === session.user.subject &&
    action.owner.address.toLowerCase() === session.smartAccount.address.toLowerCase() &&
    action.owner.chainId === BASE_CHAIN_ID &&
    action.owner.accountProvider === session.accountProvider
  );
}

async function sameProviderCalls(
  actual: GetUserOperationResult["calls"],
  expected: PreparedMoneyAction["calls"],
): Promise<boolean> {
  if (actual.length !== expected.length) return false;
  for (const [index, call] of actual.entries()) {
    const wanted = expected[index];
    const data = (call.data ?? "0x").toLowerCase();
    let dataMatches = data === wanted.data.toLowerCase();
    if (wanted.dataHash) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
      const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      dataMatches = hex === wanted.dataHash;
    }
    if (
      call.to.toLowerCase() !== wanted.to.toLowerCase() ||
      !dataMatches ||
      BigInt(call.value ?? BigInt(0)).toString(10) !== wanted.value
    ) return false;
  }
  return true;
}

function transferError(error: unknown): TransferExecutionError {
  if (error instanceof TransferExecutionError) {
    return error;
  }
  if (
    error instanceof BaseAccountConnectorError &&
    error.reason === "cancelled"
  ) {
    return new TransferExecutionError("rejected", error);
  }
  return new TransferExecutionError("failed", error);
}

class MoneyActionExpiredBeforeDispatchError extends Error {
  constructor() {
    super("money-action-expired-before-dispatch");
    this.name = "MoneyActionExpiredBeforeDispatchError";
  }
}

function assertMoneyActionDispatchable(
  action: PreparedMoneyAction,
  assertActive: () => void,
): void {
  assertActive();
  const expiresAt = Date.parse(action.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new MoneyActionExpiredBeforeDispatchError();
  }
}

function waitForPoll(): Promise<void> {
  return new Promise((resolve) =>
    window.setTimeout(resolve, TRANSFER_CONFIRMATION_POLL_MS),
  );
}

async function waitForEmbeddedReceipt(
  userOperationHash: `0x${string}`,
  smartAccount: `0x${string}`,
  getOperation: NonNullable<AccountWalletSdkBoundary["getUserOperation"]>,
  accountProvider: VerifiedAccountSession["accountProvider"],
  getAccessToken: () => Promise<string | null>,
  sessionFetch: SessionFetch | undefined,
  assertActive: () => void,
  expectedCalls?: PreparedMoneyAction["calls"],
): Promise<`0x${string}`> {
  const normalizedUserOperationHash = normalizeTransactionHash(userOperationHash);
  const deadline = Date.now() + TRANSFER_CONFIRMATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    assertActive();
    let result: GetUserOperationResult;
    try {
      result = await getOperation({
        userOperationHash: normalizedUserOperationHash,
        evmSmartAccount: smartAccount,
        network: "base",
      });
    } catch {
      await waitForPoll();
      continue;
    }
    assertActive();
    if (expectedCalls && !(await sameProviderCalls(result.calls, expectedCalls))) {
      throw new TransferExecutionError("submission-unknown");
    }
    if (
      result.status === "failed" ||
      result.receipts?.some((receipt) => receipt.revert !== undefined)
    ) {
      throw new TransferExecutionError("failed");
    }
    if (result.status === "dropped") {
      throw new TransferExecutionError("submission-unknown");
    }
    if (result.status === "complete") {
      let transactionHash: `0x${string}`;
      try {
        transactionHash = normalizeTransactionHash(result.transactionHash);
      } catch {
        await waitForPoll();
        continue;
      }
      return waitForBaseReceipt(
        transactionHash,
        accountProvider,
        getAccessToken,
        sessionFetch,
        assertActive,
        deadline,
        {
          userOperationHash: normalizedUserOperationHash,
          sender: smartAccount,
        },
      );
    }
    await waitForPoll();
  }
  throw new TransferExecutionError("confirmation-timeout");
}

async function waitForBaseReceipt(
  transactionHash: `0x${string}`,
  accountProvider: VerifiedAccountSession["accountProvider"],
  getAccessToken: () => Promise<string | null>,
  sessionFetch: SessionFetch | undefined,
  assertActive: () => void,
  deadline = Date.now() + TRANSFER_CONFIRMATION_TIMEOUT_MS,
  operation?: { userOperationHash: `0x${string}`; sender: `0x${string}` },
): Promise<`0x${string}`> {
  const normalizedHash = normalizeTransactionHash(transactionHash);
  const parameters = new URLSearchParams({ hash: normalizedHash });
  if (operation) {
    parameters.set("userOpHash", operation.userOperationHash);
    parameters.set("sender", operation.sender);
  }
  while (Date.now() < deadline) {
    assertActive();
    const accessToken = await getAccessToken();
    assertActive();
    if (!accessToken) {
      throw new TransferExecutionError("stale-session");
    }

    let response: Response;
    try {
      response = await (sessionFetch ?? fetch)(
        `/api/transfer-receipt?${parameters.toString()}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
            [ACCOUNT_PROVIDER_HEADER]: accountProvider,
          },
          cache: "no-store",
          credentials: "same-origin",
        },
      );
    } catch {
      await waitForPoll();
      continue;
    }
    assertActive();
    if (!response.ok) {
      await waitForPoll();
      continue;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      await waitForPoll();
      continue;
    }
    assertActive();
    if (!isRecord(payload) || payload.transactionHash !== normalizedHash) {
      await waitForPoll();
      continue;
    }
    if (payload.status === "confirmed") {
      if (payload.success !== true) {
        throw new TransferExecutionError("failed");
      }
      return normalizedHash;
    }
    if (payload.status !== "pending" && payload.status !== "unresolved") {
      await waitForPoll();
      continue;
    }
    await waitForPoll();
  }
  throw new TransferExecutionError("confirmation-timeout");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const [verifiedOwner, setVerifiedOwner] =
    useState<VerifiedSessionOwner | null>(null);
  const [status, setStatus] = useState<AccountSessionStatus>("restoring");
  const [message, setMessage] = useState<string | null>(null);
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransfer | null>(null);
  const pendingTransferRef = useRef<PendingTransfer | null>(null);
  const [sessionSuppression, setSessionSuppression] =
    useState<SessionSuppression | null>(null);
  const authenticationGeneration = useRef(0);
  const [authenticationGenerationRevision, setAuthenticationGenerationRevision] =
    useState(0);
  const validationRequest = useRef<AbortController | null>(null);
  const validationSequence = useRef(0);
  const mounted = useRef(true);
  const preserveSignedOutMessage = useRef(false);
  const previousOwnerKey = useRef(ownerKey);
  const transferSequence = useRef(0);
  const transferInProgress = useRef(false);
  const [providerHandleJournal] = useState(
    () => new ProviderHandleJournal({
      storage: providerHandleJournalStorage,
      lock: providerHandleJournalLock,
    }),
  );
  const accountSelection = useRef<AccountSelection>(initialAccountSelection());
  const baseConnection = useRef<ConnectedBaseAccount | null>(null);
  const baseLoginInProgress = useRef(false);
  const signInAttemptSequence = useRef(0);
  const activeSignInProvider = useRef<"cdp-embedded" | "base-account" | null>(null);
  const emailFlowAttempts = useRef(new Map<string, number>());
  const unabortableAuthAttempts = useRef(new Set<number>());
  const revokedAuthAttempts = useRef(new Set<number>());
  const quarantineCleanupOwners = useRef(new Set<string>());
  const [authQuarantineRevision, setAuthQuarantineRevision] = useState(0);
  const currentOwnerKey = useRef(ownerKey);
  const cleanupSequence = useRef(0);
  const sdkCleanupFlight = useRef<SdkCleanupFlight | null>(null);
  const automaticCleanupRequests = useRef(
    new Set<Pick<SdkCleanupIdentity, "ownerKey" | "generation">>(),
  );
  const failedSdkCleanup = useRef<SdkCleanupIdentity | null>(null);
  const isSessionSuppressed = isSessionSuppressedForOwner(
    sessionSuppression,
    ownerKey,
    authenticationGenerationRevision,
  );

  const advanceAuthenticationGeneration = useCallback(() => {
    authenticationGeneration.current += 1;
    setAuthenticationGenerationRevision((revision) => revision + 1);
    return authenticationGeneration.current;
  }, []);

  const isCurrentCleanupIdentity = useCallback(
    (identity: Pick<SdkCleanupIdentity, "ownerKey" | "generation">) => {
      const activeOwnerKey = currentOwnerKey.current;
      return (
        identity.generation === authenticationGeneration.current &&
        (activeOwnerKey === null || activeOwnerKey === identity.ownerKey)
      );
    },
    [],
  );

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
    currentOwnerKey.current = ownerKey;
    if (previousOwner !== ownerKey && ownerKey !== null) {
      const previousGeneration = authenticationGeneration.current;
      const selection = accountSelection.current;
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
        accountSelection.current = {
          ...selection,
          authentication: { ownerKey, generation: nextGeneration },
        };
      } else if (
        scopedAuthentication &&
        (scopedAuthentication.ownerKey !== ownerKey ||
          scopedAuthentication.generation !== nextGeneration)
      ) {
        accountSelection.current = { provider: "restoring", hint: null };
      } else if (
        previousOwner !== null &&
        ((sessionSuppression?.ownerKey === previousOwner &&
          sessionSuppression.ownerKey !== ownerKey) ||
          previousOwnerCleanupRequested)
      ) {
        accountSelection.current = { provider: "restoring", hint: null };
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
      providerSelection: accountSelection.current.provider,
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
    cleanupGeneration = authenticationGeneration.current,
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
    cleanupGeneration = authenticationGeneration.current,
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
        currentOwnerKey.current ?? `pending-authentication:${attempt}`;
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

  const updatePendingTransfer = useCallback((value: PendingTransfer | null) => {
    pendingTransferRef.current = value;
    setPendingTransfer(value);
  }, []);

  const clearPrivateState = useCallback(() => {
    validationRequest.current?.abort();
    validationSequence.current += 1;
    transferSequence.current += 1;
    transferInProgress.current = false;
    updatePendingTransfer(null);
    setVerifiedOwner(null);
    clearHomeBalancesPresentationCache(() => window.localStorage);
  }, [updatePendingTransfer]);

  const clearBaseConnection = useCallback(() => {
    baseLoginInProgress.current = false;
    const connection = baseConnection.current;
    baseConnection.current = null;
    if (connection) {
      void connection.disconnect();
    }
  }, []);

  const rejectBaseSession = useCallback(
    async (
      failureMessage: string,
      options: {
        clearProviderSelectionOnSuccess?: boolean;
      } = {},
    ) => {
      preserveSignedOutMessage.current = false;
      accountSelection.current = {
        provider: "blocked-authentication",
        authentication: {
          ownerKey,
          generation: authenticationGeneration.current,
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
            accountSelection.current = { provider: "restoring", hint: null };
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

    let selection = accountSelection.current;
    if (
      selection.provider === "blocked-authentication" &&
      selection.authentication === null &&
      selection.restoredPendingHint === true
    ) {
      selection = {
        ...selection,
        authentication: {
          ownerKey,
          generation: authenticationGeneration.current,
        },
      };
      accountSelection.current = selection;
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
      accountSelection.current = {
        provider: "blocked-authentication",
        authentication:
          selection.provider === "pending-authentication" ||
          selection.provider === "blocked-authentication"
            ? selection.authentication
            : {
                ownerKey,
                generation: authenticationGeneration.current,
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
      accountSelection.current = selection;
      baseLoginInProgress.current = false;
    }

    validationRequest.current?.abort();
    const controller = new AbortController();
    const sequence = ++validationSequence.current;
    const validationGeneration = authenticationGeneration.current;
    validationRequest.current = controller;
    preserveSignedOutMessage.current = false;
    setVerifiedOwner(null);
    setStatus("validating");
    setMessage(null);

    const isCurrentValidation = () =>
      !controller.signal.aborted &&
      sequence === validationSequence.current &&
      validationGeneration === authenticationGeneration.current &&
      currentOwnerKey.current === ownerKey &&
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
          if (restoredConnection && baseConnection.current === restoredConnection) {
            accountSelection.current = {
              provider: "blocked-authentication",
              authentication: {
                ownerKey,
                generation: authenticationGeneration.current,
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
        baseConnection.current = restoredConnection;
        accountSelection.current = {
          provider: "base-account",
          expectedAddress: session.smartAccount.address,
          ownerKey,
          admissionReady: true,
        };
        writeAccountProviderHint("base-account");
      } else if (restoringSelection) {
        accountSelection.current = embeddedSelection();
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
          if (!baseLoginInProgress.current) {
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
    authenticationGenerationRevision,
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
      accountSelection.current = {
        provider: "pending-authentication",
        attemptedProvider: provider,
        authentication: {
          ownerKey: currentOwnerKey.current,
          generation,
        },
      };
      writeAccountProviderHint(`pending:${provider}`);
      setStatus("signed-out");
      if (
        revokedAuthAttempts.current.size === 0 &&
        currentOwnerKey.current === null
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
    const canceledSelection = accountSelection.current;
    const canceledAuthentication =
      canceledSelection.provider === "pending-authentication" ||
      canceledSelection.provider === "blocked-authentication"
        ? canceledSelection.authentication
        : {
            ownerKey: currentOwnerKey.current,
            generation: authenticationGeneration.current,
          };
    activeSignInProvider.current = null;
    clearPrivateState();
    clearBaseConnection();
    if (canceledProvider) {
      accountSelection.current = {
        provider: "blocked-authentication",
        authentication: canceledAuthentication,
      };
      writeAccountProviderHint(`pending:${canceledProvider}`);
    }
    setStatus("signed-out");
    setMessage("Sign-in was canceled. Your private details remain hidden.");

    const activeOwner = currentOwnerKey.current;
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
          accountSelection.current = embeddedSelection();
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
        ownerKey: currentOwnerKey.current,
        generation: authenticationGeneration.current,
      };
      baseLoginInProgress.current = true;
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
        baseLoginInProgress.current = false;
        accountSelection.current = {
          provider: "blocked-authentication",
          authentication: attemptAuthentication,
        };
        writeAccountProviderHint("pending:base-account");
        if (baseConnection.current === connection) baseConnection.current = null;
        if (connection) void connection.disconnect();
        clearPrivateState();
        setStatus("signed-out");
        setMessage(invalidationMessage(reason));
        const activeOwner = currentOwnerKey.current;
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
        baseConnection.current = connection;
        accountSelection.current = {
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
          accountSelection.current = {
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
        if (baseConnection.current === connection) {
          baseConnection.current = null;
          await connection?.disconnect();
        } else if (connection) {
          await connection.disconnect();
        }
        accountSelection.current = {
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
              currentOwnerKey.current ?? `pending-authentication:${attemptSequence}`,
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
    const requestedGeneration = authenticationGeneration.current;
    let failedCleanup = getCurrentFailedCleanup();
    const pendingCleanup = sdkCleanupFlight.current;
    let cleanupOwnerKey =
      failedCleanup?.ownerKey ?? pendingCleanup?.ownerKey ?? requestedOwnerKey;
    let cleanupGeneration =
      failedCleanup?.generation ?? pendingCleanup?.generation ?? requestedGeneration;
    if (!cleanupOwnerKey) {
      clearBaseConnection();
      accountSelection.current = { provider: "restoring", hint: null };
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
      accountSelection.current = { provider: "restoring", hint: null };
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
      currentOwnerKey.current === requestedOwnerKey &&
      authenticationGeneration.current === requestedGeneration
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

  const session = getVisibleVerifiedSession(
    verifiedOwner,
    ownerKey,
    isSessionSuppressed || status !== "verified",
  );
  const visibleTransferBoundary =
    session && ownerKey ? transferBoundaryKey(ownerKey, session) : null;
  const currentTransferBoundary = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (currentTransferBoundary.current !== visibleTransferBoundary) {
      transferSequence.current += 1;
      transferInProgress.current = false;
      updatePendingTransfer(null);
      currentTransferBoundary.current = visibleTransferBoundary;
    }
  }, [updatePendingTransfer, visibleTransferBoundary]);

  const fetchVerifiedResource = useCallback(
    async (
      endpoint:
        | "/api/portfolio"
        | "/api/portfolio/valuation"
        | "/api/activity"
        | "/api/savings/positions",
      signal?: AbortSignal,
      query?: string,
    ): Promise<unknown> => {
      if (!session || status !== "verified" || !ownerKey) {
        throw new Error("Authenticated resource is unavailable.");
      }
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error("Authenticated resource is unavailable.");
      }

      let response: Response;
      try {
        response = await (sessionFetch ?? fetch)(
          query ? `${endpoint}?${query}` : endpoint,
          {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
            [ACCOUNT_PROVIDER_HEADER]: session.accountProvider,
          },
          cache: "no-store",
          credentials: "same-origin",
          signal,
          },
        );
      } catch (error) {
        if (signal?.aborted) {
          throw error;
        }
        throw new Error("Authenticated resource is unavailable.");
      }
      if (!response.ok) {
        let code: string | null = null;
        let serverMessage: string | null = null;
        try {
          const payload: unknown = await response.json();
          if (
            payload &&
            typeof payload === "object" &&
            "error" in payload &&
            payload.error &&
            typeof payload.error === "object"
          ) {
            const error = payload.error;
            if ("code" in error && typeof error.code === "string") {
              code = error.code;
            }
            if ("message" in error && typeof error.message === "string") {
              serverMessage = error.message;
            }
          }
        } catch {
          // The fixed-endpoint caller only needs the bounded status/code seam.
        }
        const unavailable = new Error("Authenticated resource is unavailable.");
        Object.assign(unavailable, { status: response.status, code, serverMessage });
        throw unavailable;
      }
      try {
        return await response.json();
      } catch {
        throw new Error("Authenticated resource is unavailable.");
      }
    }, [getAccessToken, ownerKey, session, sessionFetch, status],
  );

  const fetchAccountResource = useCallback(
    async (path: string, options: AccountResourceOptions = {}): Promise<unknown> => {
      const safePath = normalizeAccountResourcePath(path);
      if (!session?.smartAccount || status !== "verified" || !ownerKey) {
        throw new TransferExecutionError("stale-session");
      }
      const boundary = transferBoundaryKey(ownerKey, session);
      const sequence = transferSequence.current;
      const assertActive = () => {
        if (!boundary || transferSequence.current !== sequence || currentTransferBoundary.current !== boundary) {
          throw new TransferExecutionError("stale-session");
        }
      };
      assertActive();
      const accessToken = await getAccessToken();
      assertActive();
      if (!accessToken) throw new TransferExecutionError("stale-session");
      const method = options.method ?? "GET";
      if (method === "GET" && options.body !== undefined) {
        throw new TransferExecutionError("invalid-request");
      }
      let response: Response;
      try {
        response = await (sessionFetch ?? fetch)(safePath, {
          method,
          headers: {
            Accept: "application/json",
            ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
            Authorization: `Bearer ${accessToken}`,
            [ACCOUNT_PROVIDER_HEADER]: session.accountProvider,
          },
          ...(method === "POST" ? { body: JSON.stringify(options.body ?? {}) } : {}),
          cache: "no-store",
          credentials: "same-origin",
          redirect: "error",
          signal: options.signal,
        });
      } catch (error) {
        if (options.signal?.aborted) throw error;
        if (error instanceof TransferExecutionError) throw error;
        throw new TransferExecutionError("unavailable", error);
      }
      assertActive();
      if (!response.ok) {
        let code: string | null = null;
        let serverMessage: string | null = null;
        try {
          const payload: unknown = await response.json();
          if (
            payload &&
            typeof payload === "object" &&
            "error" in payload &&
            payload.error &&
            typeof payload.error === "object"
          ) {
            const error = payload.error;
            if ("code" in error && typeof error.code === "string") {
              code = error.code;
            }
            if ("message" in error && typeof error.message === "string") {
              serverMessage = error.message;
            }
          }
        } catch {
          // Money-action callers only need the bounded status/code seam.
        }
        const failure = new TransferExecutionError(
          response.status === 409 ? "submission-pending" : "unavailable",
        );
        Object.assign(failure, { status: response.status, code, serverMessage });
        throw failure;
      }
      try {
        const value = await response.json();
        assertActive();
        return value;
      } catch (error) {
        if (error instanceof TransferExecutionError) throw error;
        throw new TransferExecutionError("unavailable", error);
      }
    },
    [getAccessToken, ownerKey, session, sessionFetch, status],
  );

  const fetchMoneyActionApi = useCallback<MoneyActionApiFetch>(
    (path, init = {}) => fetchAccountResource(path, {
      method: init.method === "POST" ? "POST" : "GET",
      ...(init.body === undefined ? {} : { body: JSON.parse(String(init.body)) }),
      ...(init.signal ? { signal: init.signal } : {}),
    }),
    [fetchAccountResource],
  );

  const fetchPortfolio = useCallback(
    (signal?: AbortSignal) => fetchVerifiedResource("/api/portfolio", signal),
    [fetchVerifiedResource],
  );
  const fetchPortfolioValuation = useCallback(
    (region: import("@/config/regions").RegionId, signal?: AbortSignal) =>
      fetchVerifiedResource(
        "/api/portfolio/valuation",
        signal,
        new URLSearchParams({ region }).toString(),
      ),
    [fetchVerifiedResource],
  );
  const fetchActivity = useCallback(
    (query: string, signal?: AbortSignal) =>
      fetchVerifiedResource("/api/activity", signal, query),
    [fetchVerifiedResource],
  );
  const fetchSavingsPositions = useCallback(
    (signal?: AbortSignal) =>
      fetchVerifiedResource("/api/savings/positions", signal),
    [fetchVerifiedResource],
  );
  const fetchOperations = useCallback(
    (signal?: AbortSignal) => fetchMoneyActionApi("/api/actions/operations", { method: "GET", signal }),
    [fetchMoneyActionApi],
  );
  const prepareMoneyAction = useCallback(
    async (endpoint: string, input: unknown): Promise<PreparedMoneyAction> => {
      const value = await fetchMoneyActionApi(endpoint, {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (
        !isRecord(value) ||
        typeof value.id !== "string" ||
        typeof value.reviewHash !== "string" ||
        !isRecord(value.owner) ||
        !session?.smartAccount ||
        value.owner.subject !== session.user.subject ||
        typeof value.owner.address !== "string" ||
        value.owner.address.toLowerCase() !== session.smartAccount.address.toLowerCase() ||
        value.owner.chainId !== BASE_CHAIN_ID ||
        value.owner.accountProvider !== session.accountProvider ||
        !Array.isArray(value.calls) ||
        !Array.isArray(value.amounts) ||
        !Array.isArray(value.warnings)
      ) {
        throw new TransferExecutionError("unavailable");
      }
      return value as unknown as PreparedMoneyAction;
    },
    [fetchMoneyActionApi, session],
  );

  const recoverBaseMoneyAction = useCallback(
    async (
      id: string,
      submissionId: string,
      connection: ConnectedBaseAccount,
      assertStillActive: () => void,
    ): Promise<OperationResult> => {
      if (!connection.getCallsStatus) {
        throw new TransferExecutionError("submission-unknown");
      }
      const deadline = Date.now() + TRANSFER_CONFIRMATION_TIMEOUT_MS;
      while (Date.now() < deadline) {
        assertStillActive();
        try {
          const result = await connection.getCallsStatus(submissionId);
          if (result.status === "failed") {
            return operationResult(
              await recordMoneyActionStatus(fetchMoneyActionApi, id, "unknown"),
            );
          }
          if (result.status === "complete") {
            await waitForBaseReceipt(
              result.transactionHash,
              "base-account",
              getAccessToken,
              sessionFetch,
              assertStillActive,
              deadline,
            );
            return operationResult(
              await recordMoneyActionSubmission(fetchMoneyActionApi, id, {
                submissionId,
                transactionHash: result.transactionHash,
              }),
            );
          }
        } catch (error) {
          if (error instanceof TransferExecutionError) throw error;
        }
        await waitForPoll();
      }
      throw new TransferExecutionError("confirmation-timeout");
    },
    [fetchMoneyActionApi, getAccessToken, sessionFetch],
  );

  const reconcileRecordedMoneyAction = useCallback(
    async (
      operation: StoredMoneyActionOperation,
      prepared: PreparedMoneyAction,
      assertStillActive: () => void,
      markReferenceFreeSubmittingUnknown: boolean,
    ): Promise<OperationResult> => {
      if (["prepared", "confirmed", "failed", "rejected", "expired"].includes(operation.status)) {
        return operationResult(operation);
      }
      if (operation.transactionHash) {
        await waitForBaseReceipt(
          operation.transactionHash,
          prepared.owner.accountProvider,
          getAccessToken,
          sessionFetch,
          assertStillActive,
          undefined,
          operation.userOperationHash
            ? { userOperationHash: operation.userOperationHash, sender: prepared.owner.address }
            : undefined,
        );
        return operationResult(await readMoneyAction(fetchMoneyActionApi, prepared.id, prepared));
      }
      if (operation.userOperationHash && sdkGetUserOperation) {
        const transactionHash = await waitForEmbeddedReceipt(
          operation.userOperationHash,
          prepared.owner.address,
          sdkGetUserOperation,
          prepared.owner.accountProvider,
          getAccessToken,
          sessionFetch,
          assertStillActive,
          prepared.calls,
        );
        return operationResult(
          await recordMoneyActionSubmission(fetchMoneyActionApi, prepared.id, {
            userOperationHash: operation.userOperationHash,
            transactionHash,
          }),
        );
      }
      if (operation.submissionId && baseConnection.current?.getCallsStatus) {
        return recoverBaseMoneyAction(
          prepared.id,
          operation.submissionId,
          baseConnection.current,
          assertStillActive,
        );
      }
      if (markReferenceFreeSubmittingUnknown && operation.status === "submitting") {
        return operationResult(
          await recordMoneyActionStatus(fetchMoneyActionApi, prepared.id, "unknown"),
        );
      }
      return operationResult(operation);
    },
    [
      fetchMoneyActionApi,
      getAccessToken,
      recoverBaseMoneyAction,
      sdkGetUserOperation,
      sessionFetch,
    ],
  );

  const checkMoneyAction = useCallback(
    async (action: PreparedMoneyAction): Promise<OperationResult> => {
      if (
        transferInProgress.current ||
        !session?.smartAccount ||
        !ownerKey ||
        status !== "verified" ||
        !isMoneyActionOwnedBySession(action, session)
      ) {
        throw new TransferExecutionError("stale-session");
      }
      const boundary = transferBoundaryKey(ownerKey, session);
      if (!boundary || currentTransferBoundary.current !== boundary) {
        throw new TransferExecutionError("stale-session");
      }
      const sequence = transferSequence.current;
      const assertActive = () => {
        if (transferSequence.current !== sequence || currentTransferBoundary.current !== boundary) {
          throw new TransferExecutionError("stale-session");
        }
      };
      transferInProgress.current = true;
      try {
        let operation = await readMoneyAction(fetchMoneyActionApi, action.id, action);
        assertActive();
        if (!isMoneyActionOwnedBySession(operation.action, session)) {
          throw new TransferExecutionError("stale-session");
        }
        const journalRecovery = await recoverJournaledProviderHandle({
          fetchApi: fetchMoneyActionApi,
          journal: providerHandleJournal,
          action: operation.action,
          operation,
          assertActive,
        });
        operation = journalRecovery.operation;
        if (["retained", "conflict", "inconsistent"].includes(journalRecovery.kind)) {
          return operationResult(operation);
        }
        return await reconcileRecordedMoneyAction(
          operation,
          operation.action,
          assertActive,
          false,
        );
      } finally {
        if (transferSequence.current === sequence) transferInProgress.current = false;
      }
    },
    [fetchMoneyActionApi, ownerKey, providerHandleJournal, reconcileRecordedMoneyAction, session, status],
  );

  const executeMoneyAction = useCallback(
    async (action: PreparedMoneyAction): Promise<OperationResult> => {
      if (
        transferInProgress.current ||
        !session?.smartAccount ||
        !ownerKey ||
        status !== "verified" ||
        !isMoneyActionOwnedBySession(action, session)
      ) {
        throw new TransferExecutionError("stale-session");
      }
      const boundary = transferBoundaryKey(ownerKey, session);
      if (!boundary || currentTransferBoundary.current !== boundary) {
        throw new TransferExecutionError("stale-session");
      }
      const sequence = transferSequence.current;
      const assertActive = () => {
        if (transferSequence.current !== sequence || currentTransferBoundary.current !== boundary) {
          throw new TransferExecutionError("stale-session");
        }
      };
      transferInProgress.current = true;
      try {
        let durable = await readMoneyAction(fetchMoneyActionApi, action.id, action);
        assertActive();
        if (!isMoneyActionOwnedBySession(durable.action, session)) {
          throw new TransferExecutionError("stale-session");
        }
        const journalRecovery = await recoverJournaledProviderHandle({
          fetchApi: fetchMoneyActionApi,
          journal: providerHandleJournal,
          action: durable.action,
          operation: durable,
          assertActive,
        });
        durable = journalRecovery.operation;
        if (["retained", "conflict", "inconsistent"].includes(journalRecovery.kind)) {
          return operationResult(durable);
        }
        if (["confirmed", "failed", "rejected", "expired"].includes(durable.status)) {
          return operationResult(durable);
        }
        if (durable.status === "prepared" && journalRecovery.issues.includes("storage-corrupt")) {
          throw new TransferExecutionError("unavailable");
        }
        if (durable.status === "prepared" && !providerHandleJournal.canRetain()) {
          throw new TransferExecutionError("unavailable");
        }

        if (durable.status === "prepared" && action.kind === "send") {
          const spend = action.amounts.find((amount) => amount.direction === "spend");
          if (!spend || (spend.assetId !== "usdc" && spend.assetId !== "eth")) {
            throw new TransferExecutionError("invalid-request");
          }
          if (session.accountProvider === "base-account") {
            const connection = baseConnection.current;
            if (
              !connection ||
              !connection.sendCalls ||
              !connection.getCallsStatus ||
              connection.address.toLowerCase() !== session.smartAccount.address.toLowerCase()
            ) {
              throw new TransferExecutionError("stale-session");
            }
          } else if (!sdkSendUserOperation || !sdkGetUserOperation) {
            throw new TransferExecutionError("unavailable");
          }
          const portfolio = parsePortfolioSnapshot(await fetchPortfolio(), {
            subject: session.user.subject,
            smartAccountAddress: session.smartAccount.address,
            chainId: BASE_CHAIN_ID,
          });
          assertActive();
          if (BigInt(spend.amountBaseUnits) > findTransferBalance(portfolio.assets, spend.assetId)) {
            throw new TransferExecutionError("insufficient-balance");
          }
        }

        const claim = await claimMoneyAction(fetchMoneyActionApi, action);
        assertActive();
        const canonicalAction = claim.action;
        if (claim.disposition === "recover") {
          return await reconcileRecordedMoneyAction(
            claim.operation,
            canonicalAction,
            assertActive,
            true,
          );
        }

        const calls = canonicalAction.calls.map((call) => ({
          to: call.to,
          data: call.data,
          value: BigInt(call.value),
        }));
        assertActive();
        // Freeze the reviewed owner/action/provider binding before crossing the wallet boundary.
        const providerHandleBinding = structuredClone(canonicalAction);

        if (session.accountProvider === "base-account") {
          const connection = baseConnection.current;
          if (
            !connection ||
            !connection.sendCalls ||
            !connection.getCallsStatus ||
            connection.address.toLowerCase() !== session.smartAccount.address.toLowerCase()
          ) {
            await recordMoneyActionStatus(fetchMoneyActionApi, canonicalAction.id, "failed");
            throw new TransferExecutionError("stale-session");
          }
          let submissionId: string;
          try {
            submissionId = await connection.sendCalls(
              calls,
              canonicalAction.id,
              async () => assertMoneyActionDispatchable(canonicalAction, assertActive),
            );
          } catch (error) {
            if (error instanceof MoneyActionExpiredBeforeDispatchError) {
              return operationResult(
                await recordMoneyActionStatus(fetchMoneyActionApi, canonicalAction.id, "expired"),
              );
            }
            if (error instanceof TransferExecutionError) {
              throw error;
            }
            if (error instanceof BaseAccountConnectorError && error.reason === "cancelled") {
              await recordMoneyActionStatus(fetchMoneyActionApi, canonicalAction.id, "rejected");
              throw new TransferExecutionError("rejected", error);
            }
            await recordMoneyActionStatus(fetchMoneyActionApi, canonicalAction.id, "unknown");
            throw new TransferExecutionError("submission-unknown", error);
          }
          const retained = providerHandleJournal.retain(providerHandleBinding, {
            kind: "submission-id",
            provider: "base-account",
            value: submissionId,
          });
          if (!retained.retained) {
            throw new TransferExecutionError("submission-unknown");
          }
          await providerHandleJournal.persist(retained.entry!);
          assertActive();
          const journaled = await recoverJournaledProviderHandle({
            fetchApi: fetchMoneyActionApi,
            journal: providerHandleJournal,
            action: providerHandleBinding,
            operation: claim.operation,
            assertActive,
          });
          if (journaled.kind !== "acknowledged") {
            throw new TransferExecutionError("submission-unknown");
          }
          if (["confirmed", "failed", "rejected", "expired"].includes(journaled.operation.status)) {
            return operationResult(journaled.operation);
          }
          return await recoverBaseMoneyAction(
            canonicalAction.id,
            submissionId,
            connection,
            assertActive,
          );
        }

        if (!sdkSendUserOperation || !sdkGetUserOperation) {
          await recordMoneyActionStatus(fetchMoneyActionApi, canonicalAction.id, "failed");
          throw new TransferExecutionError("unavailable");
        }
        try {
          assertMoneyActionDispatchable(canonicalAction, assertActive);
        } catch (error) {
          if (error instanceof MoneyActionExpiredBeforeDispatchError) {
            return operationResult(
              await recordMoneyActionStatus(fetchMoneyActionApi, canonicalAction.id, "expired"),
            );
          }
          throw error;
        }
        let userOperationHash: `0x${string}`;
        try {
          const submission = await sdkSendUserOperation({
            evmSmartAccount: session.smartAccount.address,
            network: "base",
            calls,
            idempotencyKey: canonicalAction.id,
          });
          userOperationHash = normalizeTransactionHash(submission.userOperationHash);
        } catch (error) {
          await recordMoneyActionStatus(fetchMoneyActionApi, canonicalAction.id, "unknown");
          throw new TransferExecutionError("submission-unknown", error);
        }
        const retained = providerHandleJournal.retain(providerHandleBinding, {
          kind: "user-operation-hash",
          provider: "cdp-embedded",
          value: userOperationHash,
        });
        if (!retained.retained) {
          throw new TransferExecutionError("submission-unknown");
        }
        await providerHandleJournal.persist(retained.entry!);
        assertActive();
        const journaled = await recoverJournaledProviderHandle({
          fetchApi: fetchMoneyActionApi,
          journal: providerHandleJournal,
          action: providerHandleBinding,
          operation: claim.operation,
          assertActive,
        });
        if (journaled.kind !== "acknowledged") {
          throw new TransferExecutionError("submission-unknown");
        }
        if (["confirmed", "failed", "rejected", "expired"].includes(journaled.operation.status)) {
          return operationResult(journaled.operation);
        }
        const transactionHash = await waitForEmbeddedReceipt(
          userOperationHash,
          session.smartAccount.address,
          sdkGetUserOperation,
          session.accountProvider,
          getAccessToken,
          sessionFetch,
          assertActive,
          canonicalAction.calls,
        );
        const operation = await recordMoneyActionSubmission(fetchMoneyActionApi, canonicalAction.id, {
          userOperationHash,
          transactionHash,
        }, canonicalAction);
        return operationResult(operation);
      } finally {
        if (transferSequence.current === sequence) transferInProgress.current = false;
      }
    },
    [
      fetchMoneyActionApi,
      fetchPortfolio,
      getAccessToken,
      ownerKey,
      providerHandleJournal,
      reconcileRecordedMoneyAction,
      recoverBaseMoneyAction,
      sdkGetUserOperation,
      sdkSendUserOperation,
      session,
      sessionFetch,
      status,
    ],
  );

  const confirmPendingTransfer = useCallback(
    async (
      handle: PendingTransfer,
      assertActive: () => void,
    ): Promise<ConfirmedTransfer> => {
      try {
        let transactionHash: `0x${string}`;
        if (handle.userOperationHash) {
          if (!sdkGetUserOperation || !session?.smartAccount) {
            throw new TransferExecutionError("unavailable");
          }
          transactionHash = await waitForEmbeddedReceipt(
            handle.userOperationHash,
            session.smartAccount.address,
            sdkGetUserOperation,
            handle.provider,
            getAccessToken,
            sessionFetch,
            assertActive,
          );
        } else if (handle.transactionHash) {
          transactionHash = await waitForBaseReceipt(
            handle.transactionHash,
            handle.provider,
            getAccessToken,
            sessionFetch,
            assertActive,
          );
        } else {
          throw new TransferExecutionError("submission-unknown");
        }
        updatePendingTransfer(null);
        return {
          assetId: handle.assetId,
          recipient: handle.recipient,
          amountBaseUnits: handle.amountBaseUnits,
          transactionHash,
        };
      } catch (error) {
        const normalized = transferError(error);
        if (normalized.reason === "failed") {
          updatePendingTransfer(null);
        } else if (normalized.reason === "submission-unknown") {
          updatePendingTransfer({ ...handle, state: "unknown" });
        }
        throw normalized;
      }
    },
    [getAccessToken, sdkGetUserOperation, session, sessionFetch, updatePendingTransfer],
  );

  const sendTransfer = useCallback(
    async (request: TransferRequest, intentId: string): Promise<ConfirmedTransfer> => {
      assertTransferRequest(request);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(intentId)) {
        throw new TransferExecutionError("invalid-request");
      }
      if (
        transferInProgress.current ||
        pendingTransferRef.current ||
        !session?.smartAccount ||
        !ownerKey ||
        status !== "verified" ||
        session.smartAccount.chainId !== BASE_CHAIN_ID
      ) {
        throw new TransferExecutionError(
          pendingTransferRef.current ? "submission-pending" : "unavailable",
        );
      }

      const boundary = transferBoundaryKey(ownerKey, session);
      if (!boundary || currentTransferBoundary.current !== boundary) {
        throw new TransferExecutionError("stale-session");
      }
      const sequence = transferSequence.current;
      const assertActive = () => {
        if (
          transferSequence.current !== sequence ||
          currentTransferBoundary.current !== boundary
        ) {
          throw new TransferExecutionError("stale-session");
        }
      };

      transferInProgress.current = true;
      let dispatched = false;
      let handle: PendingTransfer | null = null;
      try {
        assertActive();
        const portfolioPayload = await fetchPortfolio();
        assertActive();
        const portfolio = parsePortfolioSnapshot(portfolioPayload, {
          subject: session.user.subject,
          smartAccountAddress: session.smartAccount.address,
          chainId: BASE_CHAIN_ID,
        });
        const balance = findTransferBalance(portfolio.assets, request.assetId);
        if (BigInt(request.amountBaseUnits) > balance) {
          throw new TransferExecutionError("insufficient-balance");
        }

        const call = buildTransferCall(request);

        if (session.accountProvider === "base-account") {
          const connection = baseConnection.current;
          if (
            !connection ||
            connection.address.toLowerCase() !== session.smartAccount.address.toLowerCase() ||
            !connection.sendTransaction
          ) {
            throw new TransferExecutionError("stale-session");
          }
          await connection.assertUnchanged();
          assertActive();
          handle = {
            ...request,
            intentId,
            provider: session.accountProvider,
            state: "unknown",
          };
          updatePendingTransfer(handle);
          dispatched = true;
          const transactionHash = normalizeTransactionHash(
            await connection.sendTransaction(call),
          );
          handle = { ...handle, state: "submitted", transactionHash };
          updatePendingTransfer(handle);
          await connection.assertUnchanged();
          assertActive();
        } else {
          if (!sdkSendUserOperation || !sdkGetUserOperation) {
            throw new TransferExecutionError("unavailable");
          }
          handle = {
            ...request,
            intentId,
            provider: session.accountProvider,
            state: "unknown",
          };
          updatePendingTransfer(handle);
          dispatched = true;
          const submission = await sdkSendUserOperation({
            evmSmartAccount: session.smartAccount.address,
            network: "base",
            calls: [call],
            idempotencyKey: intentId,
          });
          const userOperationHash = normalizeTransactionHash(
            submission.userOperationHash,
          );
          handle = { ...handle, state: "submitted", userOperationHash };
          updatePendingTransfer(handle);
          assertActive();
        }

        return await confirmPendingTransfer(handle, assertActive);
      } catch (error) {
        const normalized = transferError(error);
        if (!dispatched) {
          updatePendingTransfer(null);
          throw normalized;
        }
        if (handle && !handle.transactionHash && !handle.userOperationHash) {
          updatePendingTransfer({ ...handle, state: "unknown" });
          throw new TransferExecutionError("submission-unknown", normalized);
        }
        if (normalized.reason === "failed") {
          updatePendingTransfer(null);
          throw normalized;
        }
        throw normalized;
      } finally {
        if (transferSequence.current === sequence) {
          transferInProgress.current = false;
        }
      }
    },
    [
      confirmPendingTransfer,
      fetchPortfolio,
      ownerKey,
      sdkGetUserOperation,
      sdkSendUserOperation,
      session,
      status,
      updatePendingTransfer,
    ],
  );

  const checkPendingTransfer = useCallback(async (): Promise<ConfirmedTransfer> => {
    const handle = pendingTransferRef.current;
    if (
      transferInProgress.current ||
      !handle ||
      !session?.smartAccount ||
      !ownerKey ||
      status !== "verified"
    ) {
      throw new TransferExecutionError("unavailable");
    }
    const boundary = transferBoundaryKey(ownerKey, session);
    if (!boundary || currentTransferBoundary.current !== boundary) {
      throw new TransferExecutionError("stale-session");
    }
    const sequence = transferSequence.current;
    const assertActive = () => {
      if (
        transferSequence.current !== sequence ||
        currentTransferBoundary.current !== boundary
      ) {
        throw new TransferExecutionError("stale-session");
      }
    };
    transferInProgress.current = true;
    try {
      return await confirmPendingTransfer(handle, assertActive);
    } finally {
      if (transferSequence.current === sequence) {
        transferInProgress.current = false;
      }
    }
  }, [confirmPendingTransfer, ownerKey, session, status]);

  const startNewTransfer = useCallback(() => {
    if (!transferInProgress.current) {
      updatePendingTransfer(null);
    }
  }, [updatePendingTransfer]);

  const signTypedData = useCallback(
    async (typedData: unknown) => {
      if (
        status !== "verified" ||
        !session?.smartAccount ||
        session.accountProvider !== "base-account"
      ) {
        throw new BaseAccountConnectorError("invalid-provider-response");
      }
      const connection = baseConnection.current;
      if (
        !connection ||
        connection.address.toLowerCase() !== session.smartAccount.address.toLowerCase()
      ) {
        throw new BaseAccountConnectorError("invalid-provider-response");
      }
      return connection.signTypedData(typedData);
    },
    [session, status],
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

function AccountWalletBridge({
  children,
  baseAccountEnabled,
}: {
  children: ReactNode;
  baseAccountEnabled: boolean;
}) {
  const { isInitialized } = useIsInitialized();
  const { isSignedIn } = useIsSignedIn();
  const { currentUser } = useCurrentUser();
  const { signInWithEmail } = useSignInWithEmail();
  const { verifyEmailOTP } = useVerifyEmailOTP();
  const { signInWithSiwe } = useSignInWithSiwe();
  const { verifySiweSignature } = useVerifySiweSignature();
  const { getAccessToken } = useGetAccessToken();
  const { signOut } = useSignOut();
  const sdk = useMemo<AccountWalletSdkBoundary>(
    () => ({
      isInitialized,
      isSignedIn,
      ownerKey: currentUser?.userId ?? null,
      signInWithEmail: async (email) => signInWithEmail({ email }),
      verifyEmailOTP: async (flowId, otp) => {
        await verifyEmailOTP({ flowId, otp });
      },
      signInWithSiwe: async (options) => signInWithSiwe(options),
      verifySiweSignature: async (flowId, signature) => {
        await verifySiweSignature({ flowId, signature });
      },
      getAccessToken,
      sendUserOperation,
      getUserOperation,
      signOut,
    }),
    [
      currentUser?.userId,
      getAccessToken,
      isInitialized,
      isSignedIn,
      signInWithEmail,
      signInWithSiwe,
      signOut,
      verifyEmailOTP,
      verifySiweSignature,
    ],
  );

  return (
    <AccountWalletSessionOwner
      sdk={sdk}
      baseAccountEnabled={baseAccountEnabled}
    >
      {children}
    </AccountWalletSessionOwner>
  );
}

export function AccountWalletClientProvider({
  client,
  children,
}: {
  client: AccountWalletClient;
  children: ReactNode;
}) {
  return (
    <AccountWalletContext.Provider value={client}>
      {children}
    </AccountWalletContext.Provider>
  );
}

export function CdpAccountProvider({
  projectId,
  baseAccountEnabled = false,
  children,
}: {
  projectId: string | null;
  baseAccountEnabled?: boolean;
  children: ReactNode;
}) {
  const config = useMemo(
    () =>
      projectId
        ? {
            projectId,
            ethereum: { createOnLogin: "smart" as const },
            disableAnalytics: true,
          }
        : null,
    [projectId],
  );

  if (!config) {
    return (
      <AccountWalletClientProvider client={unconfiguredClient}>
        {children}
      </AccountWalletClientProvider>
    );
  }

  return (
    <CdpHooksErrorBoundary
      fallback={
        <AccountWalletClientProvider client={providerUnavailableClient}>
          {children}
        </AccountWalletClientProvider>
      }
    >
      <CDPHooksProvider config={config}>
        <AccountWalletBridge baseAccountEnabled={baseAccountEnabled}>
          {children}
        </AccountWalletBridge>
      </CDPHooksProvider>
    </CdpHooksErrorBoundary>
  );
}

export function useAccountWallet(): AccountWalletClient {
  const client = useContext(AccountWalletContext);
  if (!client) {
    throw new Error("Account wallet client is unavailable outside its provider.");
  }
  return client;
}
