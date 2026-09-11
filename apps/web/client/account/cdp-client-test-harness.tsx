import "./dom-test-harness";

import type { GetUserOperationResult } from "@coinbase/cdp-core";
import { StrictMode, useEffect, useState } from "react";
import type { AccountWalletClient, AccountWalletSdkBoundary } from "./cdp-client";
import type {
  BaseAccountConnector,
  BaseAccountRestorer,
  ConnectedBaseAccount,
} from "./base-account-connector";
import type { SessionFetch, VerifiedAccountSession } from "./session-client";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import type {
  ProviderHandleJournalLock,
  ProviderHandleJournalStorage,
} from "@/client/money-actions/provider-handle-journal";

export const { act, cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);
export const {
  AccountWalletSessionOwner,
  CdpAccountProvider,
  createBlockedAccountWalletClient,
  useAccountWallet,
} = await import("./cdp-client");
export const { BASE_CHAIN_ID } = await import("./session-client");

export function page() {
  return within(document.body);
}

export const OWNER_A = "sdk-user-a";
export const OWNER_B = "sdk-user-b";
export const OWNER_C = "sdk-user-c";
export const ADDRESS_A = "0x1111111111111111111111111111111111111111";
export const ADDRESS_B = "0x2222222222222222222222222222222222222222";
export const ADDRESS_C = "0x3333333333333333333333333333333333333333";

export function sessionFor(
  subject: string,
  address: typeof ADDRESS_A | typeof ADDRESS_B | typeof ADDRESS_C,
  accountProvider: VerifiedAccountSession["accountProvider"] = "cdp-embedded",
): VerifiedAccountSession {
  return {
    user: { subject },
    smartAccount: { address, chainId: BASE_CHAIN_ID },
    accountProvider,
  };
}

export function sessionResponse(session: VerifiedAccountSession): Response {
  return Response.json(session);
}

export function preparedMoneyAction(
  accountProvider: VerifiedAccountSession["accountProvider"],
  expiresAt: string,
): PreparedMoneyAction {
  return {
    id: "123e4567-e89b-42d3-a456-426614174001",
    reviewHash: "a".repeat(64),
    owner: {
      subject: "subject-a",
      address: ADDRESS_A,
      chainId: 8453,
      accountProvider,
    },
    kind: "send",
    title: "Send USDC",
    calls: [{
      to: ADDRESS_B,
      value: "0",
      data: "0x1234",
    }],
    amounts: [{
      assetId: "usdc",
      symbol: "USDC",
      decimals: 6,
      amountBaseUnits: "1000000",
      direction: "spend",
    }],
    warnings: [],
    createdAt: "2026-09-08T05:00:00.000Z",
    expiresAt,
  };
}

export function storedMoneyAction(
  action: PreparedMoneyAction,
  status: "prepared" | "submitting" | "submitted" | "included" | "confirmed" | "rejected" | "expired" | "failed" | "unknown",
  references: {
    submissionId?: string;
    transactionHash?: `0x${string}`;
    userOperationHash?: `0x${string}`;
  } = {},
) {
  return {
    action,
    status,
    attemptCount: status === "prepared" ? 0 : 1,
    ...(status === "prepared" ? {} : { claimedAt: "2026-09-08T05:02:00.000Z" }),
    ...references,
    createdAt: action.createdAt,
    updatedAt: "2026-09-08T05:02:00.000Z",
  };
}

export function embeddedObservation(
  action: PreparedMoneyAction,
  userOperationHash: `0x${string}`,
  transactionHash: `0x${string}`,
  overrides: Partial<GetUserOperationResult> = {},
): GetUserOperationResult {
  return {
    network: "base",
    userOpHash: userOperationHash,
    status: "complete",
    transactionHash,
    calls: action.calls.map((call) => ({
      to: call.to,
      data: call.data,
      value: call.value,
    })),
    ...overrides,
  };
}

export function sdkObservation(
  userOperationHash: `0x${string}`,
  overrides: Partial<GetUserOperationResult> = {},
): GetUserOperationResult {
  return {
    network: "base",
    userOpHash: userOperationHash,
    calls: [],
    status: "pending",
    ...overrides,
  };
}

export function portfolioResponse(address: typeof ADDRESS_A | typeof ADDRESS_B | typeof ADDRESS_C): Response {
  return Response.json({
    walletAddress: address,
    chainId: 8453,
    blockNumber: "16",
    blockHash: `0x${"cd".repeat(32)}`,
    blockTimestamp: "100",
    fetchedAt: "2026-09-07T20:30:00.000Z",
    assets: [
      {
        id: "usdc",
        symbol: "USDC",
        decimals: 6,
        kind: "erc20",
        tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        balanceBaseUnits: "9000000",
      },
      {
        id: "eth",
        symbol: "ETH",
        decimals: 18,
        kind: "native",
        balanceBaseUnits: "1000000000000000000",
      },
    ],
  });
}

export class TestJournalStorage implements ProviderHandleJournalStorage {
  readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

export class TestJournalLock implements ProviderHandleJournalLock {
  private tail = Promise.resolve();

  async withLock<T>(task: () => T | Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export function AccountProbe({
  moneyAction,
  onClient,
}: {
  moneyAction?: PreparedMoneyAction;
  onClient?: (client: AccountWalletClient) => void;
}) {
  const client = useAccountWallet();
  const [emailFlowId, setEmailFlowId] = useState<string | null>(null);
  const [moneyActionStatus, setMoneyActionStatus] = useState("idle");

  useEffect(() => onClient?.(client), [client, onClient]);

  return (
    <div>
      <output data-testid="status">{client.status}</output>
      <output data-testid="availability">{client.signInAvailability}</output>
      <output data-testid="configured">{String(client.projectConfigured)}</output>
      <output data-testid="address">
        {client.session?.smartAccount?.address ?? "private-details-hidden"}
      </output>
      <output data-testid="message">{client.message ?? ""}</output>
      <output data-testid="provider">
        {client.session?.accountProvider ?? "no-provider"}
      </output>
      <output data-testid="pending-transfer">
        {client.pendingTransfer?.state ?? "none"}
      </output>
      <output data-testid="money-action-status">{moneyActionStatus}</output>
      <button
        type="button"
        onClick={() =>
          void client
            .requestEmailCode("fixture@example.test")
            .then(({ flowId }) => setEmailFlowId(flowId))
            .catch(() => {})
        }
      >
        Probe email code
      </button>
      <button
        type="button"
        onClick={() =>
          void (emailFlowId
            ? client.verifyEmailCode(emailFlowId, "111111")
            : Promise.reject(new Error("missing flow"))
          ).catch(() => {})
        }
      >
        Probe incorrect email verification
      </button>
      <button
        type="button"
        onClick={() =>
          void (emailFlowId
            ? client.verifyEmailCode(emailFlowId, "222222")
            : Promise.reject(new Error("missing flow"))
          ).catch(() => {})
        }
      >
        Probe correct email verification
      </button>
      <button
        type="button"
        onClick={() => void client.signInWithBaseAccount(() => {}).catch(() => {})}
      >
        Probe Base sign in
      </button>
      <button type="button" onClick={client.cancelSignInAttempt}>
        Cancel sign in
      </button>
      <button
        type="button"
        onClick={() => void client.fetchPortfolio().catch(() => {})}
      >
        Probe portfolio
      </button>
      <button
        type="button"
        onClick={() => void client.fetchPortfolioValuation("DE").catch(() => {})}
      >
        Probe portfolio valuation
      </button>
      <button
        type="button"
        onClick={() => void client.fetchActivity("limit=10&cursor=next").catch(() => {})}
      >
        Probe activity
      </button>
      <button
        type="button"
        onClick={() =>
          void client.fetchAccountResource("/api/savings/actions/prepare", {
            method: "POST",
            body: { amountBaseUnits: "1000000" },
          }).catch(() => {})
        }
      >
        Probe account action
      </button>
      <button
        type="button"
        onClick={() =>
          void client.fetchAccountResource("https://evil.example/api/borrow", {
            method: "POST",
            body: {},
          }).catch(() => {})
        }
      >
        Probe rejected account path
      </button>
      <button
        type="button"
        onClick={() =>
          void client
            .sendTransfer(
              {
                assetId: "usdc",
                recipient: ADDRESS_B,
                amountBaseUnits: "1000001",
              },
              "123e4567-e89b-42d3-a456-426614174000",
            )
            .catch(() => {})
        }
      >
        Probe transfer
      </button>
      <button
        type="button"
        onClick={() => void client.checkPendingTransfer().catch(() => {})}
      >
        Check transfer
      </button>
      {moneyAction ? (
        <>
          <button
            type="button"
            onClick={() =>
              void client.checkMoneyAction(moneyAction)
                .then((result) => setMoneyActionStatus(result.status))
                .catch((error) => setMoneyActionStatus(`error:${String(error?.reason ?? "unknown")}`))
            }
          >
            Check money action
          </button>
          <button
            type="button"
            onClick={() =>
              void client.executeMoneyAction(moneyAction)
                .then((result) => setMoneyActionStatus(result.status))
                .catch((error) => setMoneyActionStatus(`error:${String(error?.reason ?? "unknown")}`))
            }
          >
            Probe money action
          </button>
        </>
      ) : null}
      <button
        type="button"
        onClick={() => void client.retrySessionValidation().catch(() => {})}
      >
        Probe retry validation
      </button>
      <button
        type="button"
        onClick={() => void client.signOut().catch(() => {})}
      >
        Probe sign out
      </button>
    </div>
  );
}

export function SessionHarness({
  sdk,
  sessionFetch,
  baseAccountEnabled = false,
  baseAccountConnector,
  baseAccountRestorer,
  moneyAction,
  onClient,
  providerHandleJournalStorage,
  providerHandleJournalLock,
}: {
  sdk: AccountWalletSdkBoundary;
  sessionFetch: SessionFetch;
  baseAccountEnabled?: boolean;
  baseAccountConnector?: BaseAccountConnector;
  baseAccountRestorer?: BaseAccountRestorer;
  moneyAction?: PreparedMoneyAction;
  onClient?: (client: AccountWalletClient) => void;
  providerHandleJournalStorage?: ProviderHandleJournalStorage | null;
  providerHandleJournalLock?: ProviderHandleJournalLock | null;
}) {
  return (
    <AccountWalletSessionOwner
      sdk={sdk}
      sessionFetch={sessionFetch}
      baseAccountEnabled={baseAccountEnabled}
      baseAccountConnector={baseAccountConnector}
      baseAccountRestorer={baseAccountRestorer}
      providerHandleJournalStorage={providerHandleJournalStorage}
      providerHandleJournalLock={providerHandleJournalLock}
    >
      <AccountProbe moneyAction={moneyAction} onClient={onClient} />
    </AccountWalletSessionOwner>
  );
}

export function connectedBaseAccount(
  overrides: Partial<ConnectedBaseAccount> = {},
): ConnectedBaseAccount {
  return {
    address: ADDRESS_A,
    assertUnchanged: async () => {},
    signMessage: async () => "0x1234",
    signTypedData: async () => `0x${"cd".repeat(65)}`,
    sendTransaction: async () => `0x${"ab".repeat(32)}`,
    disconnect: async () => {},
    ...overrides,
  };
}

export function baseSdk(
  overrides: Partial<AccountWalletSdkBoundary> = {},
): AccountWalletSdkBoundary {
  return {
    isInitialized: true,
    isSignedIn: true,
    ownerKey: OWNER_A,
    signInWithEmail: async () => ({ flowId: "unused-flow" }),
    verifyEmailOTP: async () => {},
    signInWithSiwe: async () => ({
      flowId: "unused-siwe-flow",
      message: "unused SIWE message",
    }),
    verifySiweSignature: async () => {},
    getAccessToken: async () => "token-a",
    signOut: async () => {},
    ...overrides,
  };
}


export { StrictMode };
export type { AccountWalletClient, AccountWalletSdkBoundary, SessionFetch, VerifiedAccountSession, PreparedMoneyAction };
