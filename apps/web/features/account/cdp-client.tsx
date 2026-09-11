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
import { Component, useContext, useMemo, type ReactNode } from "react";
import {
  signInProviderUnavailableCopy,
  type SignInAvailability,
} from "./sign-in-copy";
import { BaseAccountConnectorError } from "./base-account-connector";
import type { VerifiedAccountSession } from "./session-client";
import { BASE_CHAIN_ID } from "./session-types";
import type {
  OperationResult,
  PreparedMoneyAction,
} from "@/features/money-actions/types";
import {
  TransferExecutionError,
  type ConfirmedTransfer,
  type PendingTransfer,
  type TransferRequest,
} from "@/features/transfers/types";
import {
  AccountWalletContext,
  AccountWalletSessionOwner,
} from "./cdp-session-lifecycle";
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

export type BaseAccountLoginPhase =
  | "connecting"
  | "signing"
  | "verifying";

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

export { AccountWalletSessionOwner } from "./cdp-session-lifecycle";

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
