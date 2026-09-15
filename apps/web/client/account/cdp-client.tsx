"use client";

import type {
  GetUserOperationOptions,
  GetUserOperationResult,
  SendUserOperationOptions,
  SendUserOperationResult,
} from "@coinbase/cdp-core";
import {
  createContext,
  lazy,
  Suspense,
  useContext,
  type ReactNode,
} from "react";
import { signInProviderUnavailableCopy, type SignInAvailability } from "./sign-in-copy";
import { BaseAccountConnectorError } from "./base-account-connector";
import type { VerifiedAccountSession } from "./session-client";
import type { NativeBaseChallenge } from "@/shared/account/contracts/base-nonce";
import type { OperationResult, PreparedMoneyAction } from "@/shared/money-actions/types";
import { TransferExecutionError } from "@/shared/transfers/types";
import { BaseAccountLoginError } from "./cdp-wallet-provider-capabilities";
export {
  BaseAccountLoginError,
  type BaseAccountLoginFailure,
} from "./cdp-wallet-provider-capabilities";

export type AccountSessionStatus =
  | "restoring"
  | "signed-out"
  | "validating"
  | "verified"
  | "unavailable"
  | "signing-out"
  | "signout-error";

export type BaseAccountLoginPhase = "connecting" | "signing" | "verifying";

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
  verification: "provisional" | "server" | null;
  session: VerifiedAccountSession | null;
  message: string | null;
  requestEmailCode: (email: string) => Promise<{ flowId: string }>;
  verifyEmailCode: (flowId: string, otp: string) => Promise<void>;
  signInWithBaseAccount: (onPhase: (phase: BaseAccountLoginPhase) => void) => Promise<void>;
  cancelSignInAttempt: () => void;
  fetchBalances: (
    region: import("@/config/regions").RegionId,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  fetchActivity: (query: string, signal?: AbortSignal) => Promise<unknown>;
  fetchAccountResource: (path: string, options?: AccountResourceOptions) => Promise<unknown>;
  prepareMoneyAction: (kind: string, params: unknown) => Promise<PreparedMoneyAction>;
  resumeMoneyAction: (id: string) => Promise<PreparedMoneyAction>;
  executeMoneyAction: (action: PreparedMoneyAction) => Promise<OperationResult>;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
  retrySessionValidation: () => Promise<void>;
  signTypedData: (
    typedData: unknown,
    options?: { evmAccount: `0x${string}`; idempotencyKey: string },
  ) => Promise<`0x${string}`>;
  signOut: (options?: { onNavigationSafe?: () => void }) => Promise<void>;
};

export const AccountWalletContext = createContext<AccountWalletClient | null>(null);

export function createBlockedAccountWalletClient(
  reason: Exclude<SignInAvailability, "ready">,
): AccountWalletClient {
  const projectConfigured = reason !== "unconfigured";
  const blockedMessage = projectConfigured ? signInProviderUnavailableCopy.body : null;
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
    verification: null,
    session: null,
    message: blockedMessage,
    requestEmailCode: async () => { throw new Error(blockedError); },
    verifyEmailCode: async () => { throw new Error(blockedError); },
    signInWithBaseAccount: async () => { throw new BaseAccountLoginError("disabled"); },
    cancelSignInAttempt: () => {},
    fetchBalances: async () => { throw new Error("Balances are unavailable."); },
    fetchActivity: async () => { throw new Error("Activity is unavailable."); },
    fetchAccountResource: async () => { throw new Error("Authenticated resource is unavailable."); },
    prepareMoneyAction: async () => { throw new TransferExecutionError("unavailable"); },
    resumeMoneyAction: async () => { throw new TransferExecutionError("unavailable"); },
    executeMoneyAction: async () => { throw new TransferExecutionError("unavailable"); },
    fetchOperations: async () => { throw new Error("Operations are unavailable."); },
    retrySessionValidation: async () => {},
    signTypedData: async () => { throw new BaseAccountConnectorError("invalid-provider-response"); },
    signOut: async () => {},
  };
}

export type AccountWalletSdkBoundary = {
  authentication?: "cdp" | "native-base";
  initializationError?: "provider-unavailable";
  retryInitialization?: () => Promise<void>;
  isInitialized: boolean;
  isSignedIn: boolean;
  ownerKey: string | null;
  provisionalSession?: VerifiedAccountSession | null;
  signInWithEmail: (email: string) => Promise<{ flowId: string }>;
  verifyEmailOTP: (flowId: string, otp: string) => Promise<void>;
  requestBaseAccountChallenge: () => Promise<NativeBaseChallenge>;
  verifyBaseAccountProof: (proof: {
    address: `0x${string}`;
    message: string;
    signature: `0x${string}`;
  }) => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  sendUserOperation?: (options: SendUserOperationOptions) => Promise<SendUserOperationResult>;
  getUserOperation?: (options: GetUserOperationOptions) => Promise<GetUserOperationResult>;
  signOut: (onPhase?: (phase: AccountSignOutPhase) => void) => Promise<void>;
};

export type AccountSignOutPhase = {
  phase: "native-logout" | "cdp-signout";
  outcome: "success" | "error" | "timeout";
  durationMs: number;
};

const unconfiguredClient = createBlockedAccountWalletClient("unconfigured");
const LazyCompositeAccountProvider = lazy(() => import("./composite-account-provider"));
const LazyNativeBaseAccountBridge = lazy(() => import("./native-base-bridge"));
const LazySmokeFixtureAccountProvider = lazy(() =>
  import("./smoke-fixture-provider").then((module) => ({
    default: module.SmokeFixtureAccountProvider,
  })),
);

export function AccountWalletClientProvider({
  client,
  children,
}: {
  client: AccountWalletClient;
  children: ReactNode;
}) {
  return <AccountWalletContext.Provider value={client}>{children}</AccountWalletContext.Provider>;
}

function createLoadingAccountWalletClient(baseAccountEnabled: boolean): AccountWalletClient {
  return {
    ...createBlockedAccountWalletClient("provider-unavailable"),
    projectConfigured: true,
    signInAvailability: "ready",
    baseAccountEnabled,
    isInitialized: false,
    status: "restoring",
    message: null,
  };
}

function LazyConfiguredAccountProvider({
  projectId,
  baseAccountEnabled,
  children,
}: {
  projectId: string;
  baseAccountEnabled: boolean;
  children: ReactNode;
}) {
  return (
    <Suspense fallback={(
      <AccountWalletClientProvider client={createLoadingAccountWalletClient(baseAccountEnabled)}>
        {children}
      </AccountWalletClientProvider>
    )}>
      <LazyCompositeAccountProvider
        projectId={projectId}
        baseAccountEnabled={baseAccountEnabled}
      >
        {children}
      </LazyCompositeAccountProvider>
    </Suspense>
  );
}

export function CdpAccountProvider({
  projectId,
  baseAccountEnabled = false,
  smokeFixture = false,
  children,
}: {
  projectId: string | null;
  baseAccountEnabled?: boolean;
  smokeFixture?: boolean;
  children: ReactNode;
}) {
  if (smokeFixture) {
    return (
      <Suspense fallback={(
        <AccountWalletClientProvider client={unconfiguredClient}>{children}</AccountWalletClientProvider>
      )}>
        <LazySmokeFixtureAccountProvider>{children}</LazySmokeFixtureAccountProvider>
      </Suspense>
    );
  }
  if (projectId && baseAccountEnabled) {
    return (
      <LazyConfiguredAccountProvider
        projectId={projectId}
        baseAccountEnabled
      >
        {children}
      </LazyConfiguredAccountProvider>
    );
  }
  if (projectId) {
    return (
      <LazyConfiguredAccountProvider
        projectId={projectId}
        baseAccountEnabled={false}
      >
        {children}
      </LazyConfiguredAccountProvider>
    );
  }
  if (baseAccountEnabled) {
    return (
      <Suspense fallback={(
        <AccountWalletClientProvider client={unconfiguredClient}>{children}</AccountWalletClientProvider>
      )}>
        <LazyNativeBaseAccountBridge>{children}</LazyNativeBaseAccountBridge>
      </Suspense>
    );
  }
  return <AccountWalletClientProvider client={unconfiguredClient}>{children}</AccountWalletClientProvider>;
}

export function useAccountWallet(): AccountWalletClient {
  const client = useContext(AccountWalletContext);
  if (!client) throw new Error("Account wallet client is unavailable outside its provider.");
  return client;
}
