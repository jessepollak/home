"use client";

import {
  getUserOperation,
  sendUserOperation,
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
import { Component, useMemo, type ReactNode } from "react";
import {
  AccountWalletClientProvider,
  createBlockedAccountWalletClient,
  type AccountWalletSdkBoundary,
} from "./cdp-client";
import { AccountWalletSessionOwner } from "./cdp-session-lifecycle";
import { BASE_CHAIN_ID } from "@/shared/account/session-types";

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
    return this.state.failed ? this.props.fallback : this.props.children;
  }
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
  const currentUserId = currentUser?.userId ?? null;
  const sdkSmartAccountAddress = currentUser?.evmSmartAccountObjects?.[0]?.address ??
    currentUser?.evmSmartAccounts?.[0] ?? null;
  const smartAccountAddress = typeof sdkSmartAccountAddress === "string" &&
    /^0x[0-9a-fA-F]{40}$/.test(sdkSmartAccountAddress)
    ? sdkSmartAccountAddress as `0x${string}`
    : null;
  const sdk = useMemo<AccountWalletSdkBoundary>(
    () => ({
      isInitialized,
      isSignedIn,
      ownerKey: currentUserId,
      provisionalSession: currentUserId && smartAccountAddress
        ? {
            user: { subject: currentUserId },
            smartAccount: { address: smartAccountAddress, chainId: BASE_CHAIN_ID },
            accountProvider: "cdp-embedded",
          }
        : null,
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
      currentUserId,
      smartAccountAddress,
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
    <AccountWalletSessionOwner sdk={sdk} baseAccountEnabled={baseAccountEnabled}>
      {children}
    </AccountWalletSessionOwner>
  );
}

export default function CdpSdkProvider({
  projectId,
  baseAccountEnabled,
  children,
}: {
  projectId: string;
  baseAccountEnabled: boolean;
  children: ReactNode;
}) {
  const config = useMemo(() => ({
    projectId,
    ethereum: { createOnLogin: "smart" as const },
    disableAnalytics: true,
  }), [projectId]);

  return (
    <CdpHooksErrorBoundary
      fallback={(
        <AccountWalletClientProvider client={providerUnavailableClient}>
          {children}
        </AccountWalletClientProvider>
      )}
    >
      <CDPHooksProvider config={config}>
        <AccountWalletBridge baseAccountEnabled={baseAccountEnabled}>
          {children}
        </AccountWalletBridge>
      </CDPHooksProvider>
    </CdpHooksErrorBoundary>
  );
}
