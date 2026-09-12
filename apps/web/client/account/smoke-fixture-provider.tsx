"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import type { AccountWalletSdkBoundary } from "./cdp-client";
import { AccountWalletSessionOwner } from "./cdp-session-lifecycle";

const SIGNED_IN_KEY = "home:playwright-smoke:signed-in";
const DISPATCH_COUNT_KEY = "home:playwright-smoke:dispatch-count";
const USER_OPERATION_HASH = `0x${"ab".repeat(32)}` as const;
const TRANSACTION_HASH = `0x${"cd".repeat(32)}` as const;
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const CALL_DATA = `0xa9059cbb${RECIPIENT.slice(2).padStart(64, "0")}${BigInt(1_000_000).toString(16).padStart(64, "0")}` as const;

export function SmokeFixtureAccountProvider({ children }: { children: ReactNode }) {
  const resolutionReads = useRef(0);
  const [ownerKey, setOwnerKey] = useState<string | null>(() =>
    typeof window !== "undefined" && window.sessionStorage.getItem(SIGNED_IN_KEY) === "1"
      ? "playwright-smoke-owner"
      : null,
  );

  const sdk = useMemo<AccountWalletSdkBoundary>(() => ({
    isInitialized: true,
    isSignedIn: ownerKey !== null,
    ownerKey,
    signInWithEmail: async () => ({ flowId: "playwright-smoke-flow" }),
    verifyEmailOTP: async () => {
      window.sessionStorage.setItem(SIGNED_IN_KEY, "1");
      setOwnerKey("playwright-smoke-owner");
    },
    signInWithSiwe: async () => ({
      flowId: "playwright-smoke-siwe",
      message: "Playwright smoke fixture",
    }),
    verifySiweSignature: async () => {},
    getAccessToken: async () => ownerKey ? "playwright-smoke-token" : null,
    sendUserOperation: () => {
      const count = Number(window.sessionStorage.getItem(DISPATCH_COUNT_KEY) ?? "0") + 1;
      window.sessionStorage.setItem(DISPATCH_COUNT_KEY, String(count));
      if (count === 1) {
        return {
          then(resolve: (value: { userOperationHash: typeof USER_OPERATION_HASH }) => void) {
            resolve({ userOperationHash: USER_OPERATION_HASH });
            throw new Error("fixture transport threw after resolving");
          },
        } as unknown as Promise<{ userOperationHash: typeof USER_OPERATION_HASH }>;
      }
      return Promise.resolve({ userOperationHash: USER_OPERATION_HASH });
    },
    getUserOperation: async () => {
      resolutionReads.current += 1;
      return {
        network: "base",
        userOpHash: USER_OPERATION_HASH,
        status: resolutionReads.current === 1 ? "pending" : "complete",
        calls: [{ to: USDC, data: CALL_DATA, value: "0" }],
        ...(resolutionReads.current === 1 ? {} : { transactionHash: TRANSACTION_HASH }),
      };
    },
    signOut: async () => {
      window.sessionStorage.removeItem(SIGNED_IN_KEY);
      setOwnerKey(null);
    },
  }), [ownerKey]);

  return (
    <AccountWalletSessionOwner sdk={sdk} baseAccountEnabled>
      {children}
    </AccountWalletSessionOwner>
  );
}
