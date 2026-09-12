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
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { signInProviderUnavailableCopy, type SignInAvailability } from "./sign-in-copy";
import { BaseAccountConnectorError } from "./base-account-connector";
import type { VerifiedAccountSession } from "./session-client";
import { BASE_CHAIN_ID } from "@/shared/account/session-types";
import type { OperationResult, PreparedMoneyAction } from "@/shared/money-actions/types";
import { TransferExecutionError } from "@/shared/transfers/types";
import {
  BaseAccountLoginError,
  hasAccountProviderHint,
} from "./cdp-wallet-provider-capabilities";
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
  session: VerifiedAccountSession | null;
  message: string | null;
  requestEmailCode: (email: string) => Promise<{ flowId: string }>;
  verifyEmailCode: (flowId: string, otp: string) => Promise<void>;
  signInWithBaseAccount: (onPhase: (phase: BaseAccountLoginPhase) => void) => Promise<void>;
  cancelSignInAttempt: () => void;
  fetchPortfolioValuation: (
    region: import("@/config/regions").RegionId,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  fetchActivity: (query: string, signal?: AbortSignal) => Promise<unknown>;
  fetchSavingsPositions: (signal?: AbortSignal) => Promise<unknown>;
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
  signOut: () => Promise<void>;
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
    session: null,
    message: blockedMessage,
    requestEmailCode: async () => { throw new Error(blockedError); },
    verifyEmailCode: async () => { throw new Error(blockedError); },
    signInWithBaseAccount: async () => { throw new BaseAccountLoginError("disabled"); },
    cancelSignInAttempt: () => {},
    fetchPortfolioValuation: async () => { throw new Error("Portfolio valuation is unavailable."); },
    fetchActivity: async () => { throw new Error("Activity is unavailable."); },
    fetchSavingsPositions: async () => { throw new Error("Savings positions are unavailable."); },
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
  signInWithEmail: (email: string) => Promise<{ flowId: string }>;
  verifyEmailOTP: (flowId: string, otp: string) => Promise<void>;
  signInWithSiwe: (options: {
    address: `0x${string}`;
    chainId: typeof BASE_CHAIN_ID;
    domain: string;
    uri: string;
  }) => Promise<{ flowId: string; message: string }>;
  verifySiweSignature: (flowId: string, signature: `0x${string}`) => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  sendUserOperation?: (options: SendUserOperationOptions) => Promise<SendUserOperationResult>;
  getUserOperation?: (options: GetUserOperationOptions) => Promise<GetUserOperationResult>;
  signOut: () => Promise<void>;
};

const unconfiguredClient = createBlockedAccountWalletClient("unconfigured");
const LazyCdpSdkProvider = lazy(() => import("./cdp-sdk-provider"));
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

function AccountClientCapture({ onClient }: { onClient: (client: AccountWalletClient) => void }) {
  const client = useAccountWallet();
  useLayoutEffect(() => onClient(client), [client, onClient]);
  return null;
}

/**
 * When to mount the deferred SDK chunk. Always eventually: a provider hint (this
 * tab signed in before) mounts on the next microtask so restore is not delayed;
 * without one it mounts after first paint settles — never gated on the hint alone,
 * or a returning user in a new tab would sit in "restoring" forever.
 */
export function scheduleSdkActivation(
  activate: () => void,
  options: {
    hasHint: boolean;
    requestIdle: ((callback: () => void) => () => void) | null;
    fallbackDelayMs?: number;
  },
): () => void {
  let cancelled = false;
  const start = () => { if (!cancelled) activate(); };
  let cancelScheduled: (() => void) | undefined;
  if (options.hasHint) {
    queueMicrotask(start);
  } else if (options.requestIdle) {
    cancelScheduled = options.requestIdle(start);
  } else {
    const timer = setTimeout(start, options.fallbackDelayMs ?? 250);
    cancelScheduled = () => clearTimeout(timer);
  }
  return () => {
    cancelled = true;
    cancelScheduled?.();
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
  const [active, setActive] = useState(false);
  const activeClientRef = useRef<AccountWalletClient | null>(null);
  const readyResolversRef = useRef<Array<(client: AccountWalletClient) => void>>([]);

  const activate = useMemo(() => () => {
    if (activeClientRef.current) return Promise.resolve(activeClientRef.current);
    setActive(true);
    return new Promise<AccountWalletClient>((resolve) => {
      readyResolversRef.current.push(resolve);
    });
  }, []);

  // The SDK chunk is deferred, never omitted: with a provider hint (this tab
  // signed in before) it mounts immediately so session restore is not delayed;
  // otherwise it mounts once the first paint has settled, so a returning user in
  // a new tab is still restored and an anonymous visitor gets a live Sign in.
  useEffect(() => scheduleSdkActivation(() => setActive(true), {
    hasHint: hasAccountProviderHint(),
    requestIdle: typeof window.requestIdleCallback === "function"
      ? (callback) => {
          const id = window.requestIdleCallback(callback, { timeout: 1_500 });
          return () => window.cancelIdleCallback?.(id);
        }
      : null,
  }), []);

  const onClient = useMemo(() => (client: AccountWalletClient) => {
    activeClientRef.current = client;
    for (const resolve of readyResolversRef.current.splice(0)) resolve(client);
  }, []);

  const bootstrapClient = useMemo<AccountWalletClient>(() => ({
    ...createBlockedAccountWalletClient("provider-unavailable"),
    projectConfigured: true,
    signInAvailability: "ready",
    baseAccountEnabled,
    isInitialized: false,
    status: "restoring",
    message: null,
    requestEmailCode: async (email) => (await activate()).requestEmailCode(email),
    verifyEmailCode: async (flowId, otp) => (await activate()).verifyEmailCode(flowId, otp),
    signInWithBaseAccount: async (onPhase) => (await activate()).signInWithBaseAccount(onPhase),
    retrySessionValidation: async () => {
      const current = activeClientRef.current;
      if (current) await current.retrySessionValidation();
      else await activate();
    },
  }), [activate, baseAccountEnabled]);

  if (!active) {
    return <AccountWalletClientProvider client={bootstrapClient}>{children}</AccountWalletClientProvider>;
  }

  return (
    <Suspense fallback={(
      <AccountWalletClientProvider client={bootstrapClient}>{children}</AccountWalletClientProvider>
    )}>
      <LazyCdpSdkProvider projectId={projectId} baseAccountEnabled={baseAccountEnabled}>
        <AccountClientCapture onClient={onClient} />
        {children}
      </LazyCdpSdkProvider>
    </Suspense>
  );
}

export function CdpAccountProvider({
  projectId,
  baseAccountEnabled = false,
  nativeBaseAccountEnabled = false,
  smokeFixture = false,
  children,
}: {
  projectId: string | null;
  baseAccountEnabled?: boolean;
  nativeBaseAccountEnabled?: boolean;
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
  if (projectId) {
    return (
      <LazyConfiguredAccountProvider projectId={projectId} baseAccountEnabled={baseAccountEnabled}>
        {children}
      </LazyConfiguredAccountProvider>
    );
  }
  if (nativeBaseAccountEnabled) {
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
