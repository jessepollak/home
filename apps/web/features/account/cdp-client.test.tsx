import "./dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { StrictMode, useState } from "react";
import type { AccountWalletSdkBoundary } from "./cdp-client";
import {
  BaseAccountConnectorError,
  type BaseAccountConnector,
  type BaseAccountRestorer,
  type ConnectedBaseAccount,
} from "./base-account-connector";
import type { SessionFetch, VerifiedAccountSession } from "./session-client";
import { ACCOUNT_PROVIDER_HEADER } from "./session-types";
import type { PreparedMoneyAction } from "@/features/money-actions/types";
import {
  ProviderHandleJournal,
  type ProviderHandleJournalLock,
  type ProviderHandleJournalStorage,
} from "@/features/money-actions/provider-handle-journal";

const { act, cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);
const {
  AccountWalletSessionOwner,
  CdpAccountProvider,
  createBlockedAccountWalletClient,
  useAccountWallet,
} = await import("./cdp-client");
const { BASE_CHAIN_ID } = await import("./session-client");

function page() {
  return within(document.body);
}

const OWNER_A = "sdk-user-a";
const OWNER_B = "sdk-user-b";
const OWNER_C = "sdk-user-c";
const ADDRESS_A = "0x1111111111111111111111111111111111111111";
const ADDRESS_B = "0x2222222222222222222222222222222222222222";
const ADDRESS_C = "0x3333333333333333333333333333333333333333";

function sessionFor(
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

function sessionResponse(session: VerifiedAccountSession): Response {
  return Response.json(session);
}

function preparedMoneyAction(
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

function storedMoneyAction(
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

function portfolioResponse(address: typeof ADDRESS_A | typeof ADDRESS_B | typeof ADDRESS_C): Response {
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

class TestJournalStorage implements ProviderHandleJournalStorage {
  readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

class TestJournalLock implements ProviderHandleJournalLock {
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function AccountProbe({ moneyAction }: { moneyAction?: PreparedMoneyAction }) {
  const client = useAccountWallet();
  const [emailFlowId, setEmailFlowId] = useState<string | null>(null);
  const [moneyActionStatus, setMoneyActionStatus] = useState("idle");

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

function SessionHarness({
  sdk,
  sessionFetch,
  baseAccountEnabled = false,
  baseAccountConnector,
  baseAccountRestorer,
  moneyAction,
  providerHandleJournalStorage,
  providerHandleJournalLock,
}: {
  sdk: AccountWalletSdkBoundary;
  sessionFetch: SessionFetch;
  baseAccountEnabled?: boolean;
  baseAccountConnector?: BaseAccountConnector;
  baseAccountRestorer?: BaseAccountRestorer;
  moneyAction?: PreparedMoneyAction;
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
      <AccountProbe moneyAction={moneyAction} />
    </AccountWalletSessionOwner>
  );
}

function connectedBaseAccount(
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

function baseSdk(
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

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("production account session owner", () => {
  test("hides a late verification after failed logout, avoids automatic loops, and permits manual retry", async () => {
    const pendingValidation = deferred<Response>();
    let validationCalls = 0;
    let signOutCalls = 0;
    const sessionFetch: SessionFetch = async () => {
      validationCalls += 1;
      return pendingValidation.promise;
    };
    const sdk = baseSdk({
      signOut: async () => {
        signOutCalls += 1;
        if (signOutCalls === 1) {
          throw new Error("fixture sign-out failure");
        }
      },
    });

    render(
      <SessionHarness
        sdk={sdk}
        sessionFetch={sessionFetch}
      />,
    );

    await waitFor(() => expect(validationCalls).toBe(1));
    expect(page().getByTestId("status").textContent).toBe("validating");

    fireEvent.click(page().getByRole("button", { name: "Probe sign out" }));
    await waitFor(() =>
      expect(page().getByTestId("status").textContent).toBe("signout-error"),
    );

    expect(signOutCalls).toBe(1);
    expect(page().getByTestId("status").textContent).toBe("signout-error");
    expect(page().getByTestId("address").textContent).toBe(
      "private-details-hidden",
    );

    await act(async () => {
      pendingValidation.resolve(
        sessionResponse(sessionFor("subject-a", ADDRESS_A)),
      );
      await pendingValidation.promise;
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(validationCalls).toBe(1);
    expect(page().getByTestId("address").textContent).toBe(
      "private-details-hidden",
    );

    fireEvent.click(page().getByRole("button", { name: "Probe sign out" }));
    await waitFor(() => expect(signOutCalls).toBe(2));
    expect(page().getByTestId("status").textContent).toBe("signed-out");
    expect(page().getByTestId("address").textContent).toBe(
      "private-details-hidden",
    );
  });

  test("switches owner A to B without exposing A's late response", async () => {
    const pendingA = deferred<Response>();
    const seenSignals: AbortSignal[] = [];
    const validationTokens: string[] = [];
    const sessionFetch: SessionFetch = async (_input, init) => {
      const token = new Headers(init?.headers).get("Authorization") ?? "";
      validationTokens.push(token);
      if (init?.signal) {
        seenSignals.push(init.signal);
      }
      if (token === "Bearer token-a") {
        return pendingA.promise;
      }
      return sessionResponse(sessionFor("subject-b", ADDRESS_B));
    };
    let accessToken = "token-a";
    const stableSdkFunctions = baseSdk({
      getAccessToken: async () => accessToken,
    });
    const sdkA = { ...stableSdkFunctions, ownerKey: OWNER_A };
    const sdkB = { ...stableSdkFunctions, ownerKey: OWNER_B };
    const view = render(
      <SessionHarness
        sdk={sdkA}
        sessionFetch={sessionFetch}
      />,
    );

    await waitFor(() =>
      expect(validationTokens).toEqual(["Bearer token-a"]),
    );
    accessToken = "token-b";
    view.rerender(
      <SessionHarness
        sdk={sdkB}
        sessionFetch={sessionFetch}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("address").textContent).toBe(ADDRESS_B),
    );
    expect(validationTokens).toEqual([
      "Bearer token-a",
      "Bearer token-b",
    ]);
    expect(seenSignals[0]?.aborted).toBe(true);

    await act(async () => {
      pendingA.resolve(sessionResponse(sessionFor("subject-a", ADDRESS_A)));
      await pendingA.promise;
    });

    expect(page().getByTestId("address").textContent).toBe(ADDRESS_B);
  });

  test("keeps a 401-invalid session private and bounds automatic sign-out work", async () => {
    let validationCalls = 0;
    let signOutCalls = 0;
    const sdk = baseSdk({
      signOut: async () => {
        signOutCalls += 1;
        throw new Error("fixture sign-out failure");
      },
    });

    render(
      <SessionHarness
        sdk={sdk}
        sessionFetch={async () => {
          validationCalls += 1;
          return new Response(null, { status: 401 });
        }}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("status").textContent).toBe("signout-error"),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(validationCalls).toBe(1);
    expect(signOutCalls).toBe(1);
    expect(page().getByTestId("address").textContent).toBe(
      "private-details-hidden",
    );
  });

  test("retries the same email flow after an incorrect OTP and admits an early owner only after success", async () => {
    const successfulVerification = deferred<void>();
    const verifiedCodes: string[] = [];
    let sessionCalls = 0;
    let signOutCalls = 0;
    const sdk = baseSdk({
      isSignedIn: false,
      ownerKey: null,
      signInWithEmail: async () => ({ flowId: "email-flow" }),
      verifyEmailOTP: async (_flowId, otp) => {
        verifiedCodes.push(otp);
        if (verifiedCodes.length === 1) {
          throw new Error("incorrect otp fixture");
        }
        await successfulVerification.promise;
      },
      signOut: async () => {
        signOutCalls += 1;
      },
    });
    const sessionFetch: SessionFetch = async () => {
      sessionCalls += 1;
      return sessionResponse(sessionFor("subject-a", ADDRESS_A));
    };

    const view = render(
      <SessionHarness sdk={sdk} sessionFetch={sessionFetch} />,
    );

    fireEvent.click(page().getByRole("button", { name: "Probe email code" }));
    await waitFor(() =>
      expect(window.sessionStorage.getItem("home:account-provider")).toBe(
        "pending:cdp-embedded",
      ),
    );

    fireEvent.click(
      page().getByRole("button", {
        name: "Probe incorrect email verification",
      }),
    );
    await waitFor(() => expect(verifiedCodes).toEqual(["111111"]));
    fireEvent.click(
      page().getByRole("button", { name: "Probe correct email verification" }),
    );
    await waitFor(() =>
      expect(verifiedCodes).toEqual(["111111", "222222"]),
    );

    view.rerender(
      <SessionHarness
        sdk={{ ...sdk, isSignedIn: true, ownerKey: OWNER_A }}
        sessionFetch={sessionFetch}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(sessionCalls).toBe(0);
    expect(signOutCalls).toBe(0);
    expect(page().getByTestId("status").textContent).toBe("signed-out");
    expect(page().getByTestId("address").textContent).toBe(
      "private-details-hidden",
    );

    await act(async () => {
      successfulVerification.resolve();
      await successfulVerification.promise;
    });
    await waitFor(() =>
      expect(page().getByTestId("address").textContent).toBe(ADDRESS_A),
    );
    expect(sessionCalls).toBe(1);
    expect(signOutCalls).toBe(0);
    expect(window.sessionStorage.getItem("home:account-provider")).toBe(
      "cdp-embedded",
    );

    fireEvent.click(
      page().getByRole("button", { name: "Probe correct email verification" }),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(verifiedCodes).toEqual(["111111", "222222"]);
  });

  test("validates a reload-restored SDK session before revealing its address", async () => {
    let validationCalls = 0;
    let selectedProvider: string | null = null;

    render(
      <SessionHarness
        sdk={baseSdk()}
        sessionFetch={async (_input, init) => {
          validationCalls += 1;
          selectedProvider = new Headers(init?.headers).get(
            ACCOUNT_PROVIDER_HEADER,
          );
          return sessionResponse(sessionFor("subject-a", ADDRESS_A));
        }}
      />,
    );

    expect(page().getByTestId("address").textContent).toBe(
      "private-details-hidden",
    );
    await waitFor(() =>
      expect(page().getByTestId("address").textContent).toBe(ADDRESS_A),
    );
    expect(validationCalls).toBe(1);
    expect(selectedProvider as unknown).toBe("restore");
  });

  test("restores an exact server-verified Base identity without signing out", async () => {
    window.sessionStorage.setItem("home:account-provider", "base-account");
    let sessionCalls = 0;
    let signOutCalls = 0;
    let restoreCalls = 0;
    render(
      <SessionHarness
        sdk={baseSdk({
          signOut: async () => {
            signOutCalls += 1;
          },
        })}
        sessionFetch={async (_input, init) => {
          sessionCalls += 1;
          expect(
            new Headers(init?.headers).get(ACCOUNT_PROVIDER_HEADER),
          ).toBe("base-account");
          return sessionResponse(
            sessionFor("siwe-subject", ADDRESS_A, "base-account"),
          );
        }}
        baseAccountEnabled
        baseAccountRestorer={async () => {
          restoreCalls += 1;
          return connectedBaseAccount();
        }}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("address").textContent).toBe(ADDRESS_A),
    );
    expect(page().getByTestId("provider").textContent).toBe("base-account");
    expect(sessionCalls).toBe(1);
    expect(restoreCalls).toBe(1);
    expect(signOutCalls).toBe(0);
  });

  test("signs out a valid Base identity only when restoration positively reports zero accounts", async () => {
    window.sessionStorage.setItem("home:account-provider", "base-account");
    let sessionCalls = 0;
    let restoreCalls = 0;
    let signOutCalls = 0;
    render(
      <SessionHarness
        sdk={baseSdk({
          signOut: async () => {
            signOutCalls += 1;
          },
        })}
        sessionFetch={async () => {
          sessionCalls += 1;
          return sessionResponse(
            sessionFor("siwe-subject", ADDRESS_A, "base-account"),
          );
        }}
        baseAccountEnabled
        baseAccountRestorer={async () => {
          restoreCalls += 1;
          throw new BaseAccountConnectorError("missing-connection");
        }}
      />,
    );

    await waitFor(() => expect(signOutCalls).toBe(1));
    expect(sessionCalls).toBe(1);
    expect(restoreCalls).toBe(1);
    expect(page().getByTestId("status").textContent).toBe("signed-out");
    expect(page().getByTestId("address").textContent).toBe(
      "private-details-hidden",
    );
    expect(page().getByTestId("message").textContent).toBe(
      "Base Account was disconnected. Sign in again to continue.",
    );
    expect(window.sessionStorage.getItem("home:account-provider")).toBeNull();
  });

  test("keeps transient Base restoration failure retryable and verifies after recovery", async () => {
    window.sessionStorage.setItem("home:account-provider", "base-account");
    let restoreCalls = 0;
    let signOutCalls = 0;
    render(
      <SessionHarness
        sdk={baseSdk({
          signOut: async () => {
            signOutCalls += 1;
          },
        })}
        sessionFetch={async () =>
          sessionResponse(
            sessionFor("siwe-subject", ADDRESS_A, "base-account"),
          )
        }
        baseAccountEnabled
        baseAccountRestorer={async () => {
          restoreCalls += 1;
          if (restoreCalls === 1) {
            throw new Error("fixture module or transport failure");
          }
          return connectedBaseAccount();
        }}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("status").textContent).toBe("unavailable"),
    );
    expect(signOutCalls).toBe(0);
    expect(window.sessionStorage.getItem("home:account-provider")).toBe(
      "base-account",
    );

    fireEvent.click(
      page().getByRole("button", { name: "Probe retry validation" }),
    );
    await waitFor(() =>
      expect(page().getByTestId("status").textContent).toBe("verified"),
    );
    expect(restoreCalls).toBe(2);
    expect(signOutCalls).toBe(0);
    expect(page().getByTestId("address").textContent).toBe(ADDRESS_A);
  });

  test("keeps missing-connection cleanup private after failure and retries sign-out only on demand", async () => {
    window.sessionStorage.setItem("home:account-provider", "base-account");
    let signOutCalls = 0;
    render(
      <SessionHarness
        sdk={baseSdk({
          signOut: async () => {
            signOutCalls += 1;
            if (signOutCalls === 1) {
              throw new Error("fixture sign-out failure");
            }
          },
        })}
        sessionFetch={async () =>
          sessionResponse(
            sessionFor("siwe-subject", ADDRESS_A, "base-account"),
          )
        }
        baseAccountEnabled
        baseAccountRestorer={async () => {
          throw new BaseAccountConnectorError("missing-connection");
        }}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("status").textContent).toBe("signout-error"),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(signOutCalls).toBe(1);
    expect(page().getByTestId("address").textContent).toBe(
      "private-details-hidden",
    );
    expect(page().getByTestId("message").textContent).toContain(
      "Retry sign out",
    );
    expect(window.sessionStorage.getItem("home:account-provider")).toBe(
      "pending:base-account",
    );

    fireEvent.click(page().getByRole("button", { name: "Probe sign out" }));
    await waitFor(() => expect(signOutCalls).toBe(2));
    expect(page().getByTestId("status").textContent).toBe("signed-out");
    expect(window.sessionStorage.getItem("home:account-provider")).toBeNull();
  });

  test("blocks email and Base client authentication while cleanup is pending", async () => {
    window.sessionStorage.setItem("home:account-provider", "base-account");
    const pendingSignOut = deferred<void>();
    let emailSignInCalls = 0;
    let baseConnectorCalls = 0;
    let signOutCalls = 0;

    render(
      <SessionHarness
        sdk={baseSdk({
          signInWithEmail: async () => {
            emailSignInCalls += 1;
            return { flowId: "must-not-start" };
          },
          signOut: () => {
            signOutCalls += 1;
            return pendingSignOut.promise;
          },
        })}
        sessionFetch={async () =>
          sessionResponse(
            sessionFor("siwe-subject", ADDRESS_A, "base-account"),
          )
        }
        baseAccountEnabled
        baseAccountConnector={async () => {
          baseConnectorCalls += 1;
          return connectedBaseAccount();
        }}
        baseAccountRestorer={async () => {
          throw new BaseAccountConnectorError("missing-connection");
        }}
      />,
    );

    await waitFor(() => expect(signOutCalls).toBe(1));
    fireEvent.click(page().getByRole("button", { name: "Probe email code" }));
    fireEvent.click(page().getByRole("button", { name: "Probe Base sign in" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(emailSignInCalls).toBe(0);
    expect(baseConnectorCalls).toBe(0);
    expect(signOutCalls).toBe(1);
    expect(window.sessionStorage.getItem("home:account-provider")).toBe(
      "pending:base-account",
    );

    await act(async () => {
      pendingSignOut.resolve();
      await pendingSignOut.promise;
    });
  });

  test("retries the preserved cleanup owner after the SDK owner becomes null", async () => {
    window.sessionStorage.setItem("home:account-provider", "base-account");
    let signOutCalls = 0;
    const sdk = baseSdk({
      signOut: async () => {
        signOutCalls += 1;
        if (signOutCalls === 1) {
          throw new Error("first cleanup failed");
        }
      },
    });
    const view = render(
      <SessionHarness
        sdk={sdk}
        sessionFetch={async () =>
          sessionResponse(
            sessionFor("siwe-subject", ADDRESS_A, "base-account"),
          )
        }
        baseAccountEnabled
        baseAccountRestorer={async () => {
          throw new BaseAccountConnectorError("missing-connection");
        }}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("status").textContent).toBe("signout-error"),
    );
    view.rerender(
      <SessionHarness
        sdk={{ ...sdk, isSignedIn: false, ownerKey: null }}
        sessionFetch={async () =>
          sessionResponse(
            sessionFor("siwe-subject", ADDRESS_A, "base-account"),
          )
        }
        baseAccountEnabled
        baseAccountRestorer={async () => {
          throw new BaseAccountConnectorError("missing-connection");
        }}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(page().getByTestId("status").textContent).toBe("signout-error");

    fireEvent.click(page().getByRole("button", { name: "Probe sign out" }));
    await waitFor(() => expect(signOutCalls).toBe(2));
    expect(page().getByTestId("status").textContent).toBe("signed-out");
    expect(window.sessionStorage.getItem("home:account-provider")).toBeNull();
  });

  test("validates fresh A to B to A authentication while stale cleanup stays fenced", async () => {
    window.sessionStorage.setItem("home:account-provider", "base-account");
    const pendingSignOut = deferred<void>();
    const stableSdk = baseSdk({ signOut: () => pendingSignOut.promise });
    const view = render(
      <SessionHarness
        sdk={stableSdk}
        sessionFetch={async () =>
          sessionResponse(
            sessionFor("siwe-subject", ADDRESS_A, "base-account"),
          )
        }
        baseAccountEnabled
        baseAccountRestorer={async () => {
          throw new BaseAccountConnectorError("missing-connection");
        }}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("status").textContent).toBe("signing-out"),
    );
    view.rerender(
      <SessionHarness
        sdk={{ ...stableSdk, ownerKey: OWNER_B }}
        sessionFetch={async () =>
          sessionResponse(sessionFor("subject-b", ADDRESS_B))
        }
        baseAccountEnabled
        baseAccountRestorer={async () => connectedBaseAccount({ address: ADDRESS_B })}
      />,
    );
    await waitFor(() =>
      expect(page().getByTestId("address").textContent).toBe(ADDRESS_B),
    );

    view.rerender(
      <SessionHarness
        sdk={{ ...stableSdk, ownerKey: OWNER_A }}
        sessionFetch={async () =>
          sessionResponse(sessionFor("subject-a", ADDRESS_A))
        }
        baseAccountEnabled
        baseAccountRestorer={async () => connectedBaseAccount()}
      />,
    );
    await waitFor(() =>
      expect(page().getByTestId("address").textContent).toBe(ADDRESS_A),
    );
    expect(window.sessionStorage.getItem("home:account-provider")).toBe(
      "cdp-embedded",
    );

    await act(async () => {
      pendingSignOut.resolve();
      await pendingSignOut.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(page().getByTestId("address").textContent).toBe(ADDRESS_A);
    expect(window.sessionStorage.getItem("home:account-provider")).toBe(
      "cdp-embedded",
    );
  });

  test("rejects a late missing-connection sign-out failure after the owner changes", async () => {
    window.sessionStorage.setItem("home:account-provider", "base-account");
    const pendingSignOut = deferred<void>();
    let accessToken = "token-a";
    const sdk = baseSdk({
      getAccessToken: async () => accessToken,
      signOut: () => pendingSignOut.promise,
    });
    const view = render(
      <SessionHarness
        sdk={sdk}
        sessionFetch={async (_input, init) => {
          const authorization = new Headers(init?.headers).get("Authorization");
          return authorization === "Bearer token-b"
            ? sessionResponse(sessionFor("subject-b", ADDRESS_B))
            : sessionResponse(
                sessionFor("siwe-subject", ADDRESS_A, "base-account"),
              );
        }}
        baseAccountEnabled
        baseAccountRestorer={async () => {
          throw new BaseAccountConnectorError("missing-connection");
        }}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("status").textContent).toBe("signing-out"),
    );
    accessToken = "token-b";
    view.rerender(
      <SessionHarness
        sdk={{ ...sdk, ownerKey: OWNER_B }}
        sessionFetch={async () =>
          sessionResponse(sessionFor("subject-b", ADDRESS_B))
        }
        baseAccountEnabled
        baseAccountRestorer={async () => connectedBaseAccount({ address: ADDRESS_B })}
      />,
    );

    await act(async () => {
      pendingSignOut.reject(new Error("late owner-a cleanup failure"));
      await pendingSignOut.promise.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(page().getByTestId("status").textContent).not.toBe("signout-error");
    expect(page().getByTestId("message").textContent).not.toContain(
      "late owner-a",
    );
    expect(page().getByTestId("address").textContent).toBe(ADDRESS_B);
  });

  for (const bFailureReason of ["401", "missing-connection"] as const) {
    for (const ownerACleanupOutcome of ["success", "failure"] as const) {
      for (const postJoinState of [
        "fresh-a",
        "fresh-c",
        "owner-null-success",
        "owner-null-failure",
      ] as const) {
        test(`fences ${bFailureReason} owner B cleanup after owner A ${ownerACleanupOutcome} when ${postJoinState}`, async () => {
          window.sessionStorage.setItem("home:account-provider", "base-account");
          const ownerACleanup = deferred<void>();
          const ownerBCleanup = deferred<void>();
          let activeSdkOwner: string | null = OWNER_A;
          let signOutCalls = 0;
          let ownerBSessionCalls = 0;
          let restoreCalls = 0;
          let emailSignInCalls = 0;
          let baseConnectorCalls = 0;
          const signOutOwners: Array<string | null> = [];
          const sdk = baseSdk({
            getAccessToken: async () => `token-${activeSdkOwner ?? "none"}`,
            signInWithEmail: async () => {
              emailSignInCalls += 1;
              return { flowId: "must-not-start" };
            },
            signOut: () => {
              signOutOwners.push(activeSdkOwner);
              signOutCalls += 1;
              if (signOutCalls === 1) return ownerACleanup.promise;
              if (signOutCalls === 2) return ownerBCleanup.promise;
              return Promise.resolve();
            },
          });
          const baseAccountRestorer: BaseAccountRestorer = async () => {
            restoreCalls += 1;
            throw new BaseAccountConnectorError("missing-connection");
          };
          const baseAccountConnector: BaseAccountConnector = async () => {
            baseConnectorCalls += 1;
            return connectedBaseAccount({ address: ADDRESS_B });
          };
          const view = render(
            <SessionHarness
              sdk={sdk}
              sessionFetch={async () =>
                sessionResponse(
                  sessionFor("siwe-subject-a", ADDRESS_A, "base-account"),
                )
              }
              baseAccountEnabled
              baseAccountConnector={baseAccountConnector}
              baseAccountRestorer={baseAccountRestorer}
            />,
          );

          await waitFor(() => expect(signOutCalls).toBe(1));
          expect(signOutOwners).toEqual([OWNER_A]);
          activeSdkOwner = OWNER_B;
          view.rerender(
            <SessionHarness
              sdk={{ ...sdk, ownerKey: OWNER_B }}
              sessionFetch={async () => {
                ownerBSessionCalls += 1;
                return bFailureReason === "401"
                  ? new Response(null, { status: 401 })
                  : sessionResponse(
                      sessionFor("siwe-subject-b", ADDRESS_B, "base-account"),
                    );
              }}
              baseAccountEnabled
              baseAccountConnector={baseAccountConnector}
              baseAccountRestorer={baseAccountRestorer}
            />,
          );

          await waitFor(() => expect(ownerBSessionCalls).toBe(1));
          if (bFailureReason === "missing-connection") {
            await waitFor(() => expect(restoreCalls).toBe(2));
          } else {
            expect(restoreCalls).toBe(1);
          }
          expect(signOutCalls).toBe(1);
          expect(page().getByTestId("status").textContent).toBe("signing-out");
          expect(page().getByTestId("address").textContent).toBe(
            "private-details-hidden",
          );

          const freshOwner =
            postJoinState === "fresh-a"
              ? {
                  ownerKey: OWNER_A,
                  address: ADDRESS_A,
                  subject: "fresh-subject-a",
                } as const
              : postJoinState === "fresh-c"
                ? {
                    ownerKey: OWNER_C,
                    address: ADDRESS_C,
                    subject: "fresh-subject-c",
                  } as const
                : null;
          if (freshOwner) {
            activeSdkOwner = freshOwner.ownerKey;
            view.rerender(
              <SessionHarness
                sdk={{ ...sdk, ownerKey: freshOwner.ownerKey }}
                sessionFetch={async () =>
                  sessionResponse(
                    sessionFor(freshOwner.subject, freshOwner.address),
                  )
                }
                baseAccountEnabled
                baseAccountConnector={baseAccountConnector}
                baseAccountRestorer={baseAccountRestorer}
              />,
            );
            await waitFor(() =>
              expect(page().getByTestId("address").textContent).toBe(
                freshOwner.address,
              ),
            );
            expect(page().getByTestId("status").textContent).toBe("verified");
          } else {
            activeSdkOwner = null;
            view.rerender(
              <SessionHarness
                sdk={{ ...sdk, isSignedIn: false, ownerKey: null }}
                sessionFetch={async () => new Response(null, { status: 401 })}
                baseAccountEnabled
                baseAccountConnector={baseAccountConnector}
                baseAccountRestorer={baseAccountRestorer}
              />,
            );
            await waitFor(() =>
              expect(page().getByTestId("status").textContent).toBe(
                "signing-out",
              ),
            );
          }

          fireEvent.click(
            page().getByRole("button", { name: "Probe email code" }),
          );
          fireEvent.click(
            page().getByRole("button", { name: "Probe Base sign in" }),
          );
          await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
          });
          expect(emailSignInCalls).toBe(0);
          expect(baseConnectorCalls).toBe(0);
          expect(signOutCalls).toBe(1);

          await act(async () => {
            if (ownerACleanupOutcome === "success") {
              ownerACleanup.resolve();
              await ownerACleanup.promise;
            } else {
              ownerACleanup.reject(new Error("stale owner-a cleanup failure"));
              await ownerACleanup.promise.catch(() => {});
            }
          });

          if (freshOwner) {
            await act(async () => {
              await new Promise((resolve) => setTimeout(resolve, 20));
            });
            expect(signOutCalls).toBe(1);
            expect(signOutOwners).toEqual([OWNER_A]);
            expect(page().getByTestId("status").textContent).toBe("verified");
            expect(page().getByTestId("address").textContent).toBe(
              freshOwner.address,
            );
            expect(page().getByTestId("provider").textContent).toBe(
              "cdp-embedded",
            );
            return;
          }

          await waitFor(() => expect(signOutCalls).toBe(2));
          expect(signOutOwners).toEqual([OWNER_A, null]);
          expect(page().getByTestId("status").textContent).toBe("signing-out");
          fireEvent.click(
            page().getByRole("button", { name: "Probe email code" }),
          );
          fireEvent.click(
            page().getByRole("button", { name: "Probe Base sign in" }),
          );
          await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
          });
          expect(emailSignInCalls).toBe(0);
          expect(baseConnectorCalls).toBe(0);
          expect(signOutCalls).toBe(2);

          await act(async () => {
            if (postJoinState === "owner-null-success") {
              ownerBCleanup.resolve();
              await ownerBCleanup.promise;
            } else {
              ownerBCleanup.reject(new Error("owner-b cleanup failure"));
              await ownerBCleanup.promise.catch(() => {});
            }
          });

          if (postJoinState === "owner-null-success") {
            await waitFor(() =>
              expect(page().getByTestId("status").textContent).toBe(
                "signed-out",
              ),
            );
            expect(signOutCalls).toBe(2);
            expect(page().getByTestId("address").textContent).toBe(
              "private-details-hidden",
            );
            if (bFailureReason === "missing-connection") {
              expect(
                window.sessionStorage.getItem("home:account-provider"),
              ).toBeNull();
            }
            return;
          }

          await waitFor(() =>
            expect(page().getByTestId("status").textContent).toBe(
              "signout-error",
            ),
          );
          fireEvent.click(
            page().getByRole("button", { name: "Probe email code" }),
          );
          fireEvent.click(
            page().getByRole("button", { name: "Probe Base sign in" }),
          );
          await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
          });
          expect(emailSignInCalls).toBe(0);
          expect(baseConnectorCalls).toBe(0);
          expect(signOutCalls).toBe(2);

          fireEvent.click(page().getByRole("button", { name: "Probe sign out" }));
          await waitFor(() => expect(signOutCalls).toBe(3));
          expect(signOutOwners).toEqual([OWNER_A, null, null]);
          await waitFor(() =>
            expect(page().getByTestId("status").textContent).toBe("signed-out"),
          );
          expect(window.sessionStorage.getItem("home:account-provider")).toBeNull();
        });
      }
    }
  }

  for (const persistedHint of [
    "pending:base-account",
    "pending:cdp-embedded",
  ] as const) {
    for (const freshOwner of [
      { label: "A", ownerKey: OWNER_A, address: ADDRESS_A },
      { label: "C", ownerKey: OWNER_C, address: ADDRESS_C },
    ] as const) {
      for (const freshArrival of [
        "before-b-settlement",
        "after-b-settlement",
      ] as const) {
        for (const ownerBCleanupOutcome of ["success", "failure"] as const) {
          test(`scopes ${persistedHint} to owner B so fresh ${freshOwner.label} validates ${freshArrival} after B cleanup ${ownerBCleanupOutcome}`, async () => {
            window.sessionStorage.setItem("home:account-provider", persistedHint);
            const ownerBCleanup = deferred<void>();
            let activeSdkOwner: string | null = OWNER_B;
            let sessionCalls = 0;
            let signOutCalls = 0;
            const signOutOwners: Array<string | null> = [];
            const sdk = baseSdk({
              ownerKey: OWNER_B,
              getAccessToken: async () => `token-${activeSdkOwner ?? "none"}`,
              signOut: () => {
                signOutCalls += 1;
                signOutOwners.push(activeSdkOwner);
                return ownerBCleanup.promise;
              },
            });
            const view = render(
              <SessionHarness
                sdk={sdk}
                sessionFetch={async () => {
                  sessionCalls += 1;
                  return sessionResponse(
                    sessionFor("unexpected-owner-b", ADDRESS_B),
                  );
                }}
              />,
            );

            await waitFor(() => expect(signOutCalls).toBe(1));
            expect(signOutOwners).toEqual([OWNER_B]);
            expect(sessionCalls).toBe(0);
            expect(page().getByTestId("status").textContent).toBe("signing-out");
            expect(page().getByTestId("address").textContent).toBe(
              "private-details-hidden",
            );

            activeSdkOwner = null;
            view.rerender(
              <SessionHarness
                sdk={{ ...sdk, isSignedIn: false, ownerKey: null }}
                sessionFetch={async () => new Response(null, { status: 401 })}
              />,
            );

            const settleOwnerBCleanup = async () => {
              await act(async () => {
                if (ownerBCleanupOutcome === "success") {
                  ownerBCleanup.resolve();
                  await ownerBCleanup.promise;
                } else {
                  ownerBCleanup.reject(new Error("owner-b cleanup failure"));
                  await ownerBCleanup.promise.catch(() => {});
                }
              });
            };
            const renderFreshOwner = () => {
              activeSdkOwner = freshOwner.ownerKey;
              view.rerender(
                <SessionHarness
                  sdk={{ ...sdk, ownerKey: freshOwner.ownerKey }}
                  sessionFetch={async () => {
                    sessionCalls += 1;
                    return sessionResponse(
                      sessionFor(
                        `fresh-subject-${freshOwner.label.toLowerCase()}`,
                        freshOwner.address,
                      ),
                    );
                  }}
                />,
              );
            };

            if (freshArrival === "after-b-settlement") {
              await settleOwnerBCleanup();
              await waitFor(() =>
                expect(page().getByTestId("status").textContent).toBe(
                  ownerBCleanupOutcome === "success"
                    ? "signed-out"
                    : "signout-error",
                ),
              );
              renderFreshOwner();
            } else {
              renderFreshOwner();
            }

            await waitFor(() =>
              expect(page().getByTestId("address").textContent).toBe(
                freshOwner.address,
              ),
            );
            expect(page().getByTestId("status").textContent).toBe("verified");
            expect(page().getByTestId("provider").textContent).toBe(
              "cdp-embedded",
            );
            expect(sessionCalls).toBe(1);
            expect(signOutCalls).toBe(1);
            expect(signOutOwners).toEqual([OWNER_B]);
            expect(window.sessionStorage.getItem("home:account-provider")).toBe(
              "cdp-embedded",
            );

            if (freshArrival === "before-b-settlement") {
              await settleOwnerBCleanup();
              await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, 0));
              });
              expect(page().getByTestId("status").textContent).toBe("verified");
              expect(page().getByTestId("address").textContent).toBe(
                freshOwner.address,
              );
              expect(sessionCalls).toBe(1);
              expect(signOutCalls).toBe(1);
              expect(signOutOwners).toEqual([OWNER_B]);
            }
          });
        }
      }
    }
  }

  for (const ownerACleanupOutcome of ["success", "failure"] as const) {
    for (const freshOwner of [
      { label: "A", ownerKey: OWNER_A, address: ADDRESS_A },
      { label: "C", ownerKey: OWNER_C, address: ADDRESS_C },
    ] as const) {
      for (const freshArrival of [
        "before-b-settlement",
        "after-b-failure",
      ] as const) {
        test(`replaces owner B blocked selection across null with fresh ${freshOwner.label} after owner A ${ownerACleanupOutcome} ${freshArrival}`, async () => {
          window.sessionStorage.setItem("home:account-provider", "base-account");
          const ownerACleanup = deferred<void>();
          const ownerBCleanup = deferred<void>();
          let activeSdkOwner: string | null = OWNER_A;
          let signOutCalls = 0;
          let ownerBSessionCalls = 0;
          let restoreCalls = 0;
          const sdk = baseSdk({
            getAccessToken: async () => `token-${activeSdkOwner ?? "none"}`,
            signOut: () => {
              signOutCalls += 1;
              return signOutCalls === 1
                ? ownerACleanup.promise
                : ownerBCleanup.promise;
            },
          });
          const baseAccountRestorer: BaseAccountRestorer = async () => {
            restoreCalls += 1;
            throw new BaseAccountConnectorError("missing-connection");
          };
          const view = render(
            <SessionHarness
              sdk={sdk}
              sessionFetch={async () =>
                sessionResponse(
                  sessionFor("siwe-subject-a", ADDRESS_A, "base-account"),
                )
              }
              baseAccountEnabled
              baseAccountRestorer={baseAccountRestorer}
            />,
          );

          await waitFor(() => expect(signOutCalls).toBe(1));
          activeSdkOwner = OWNER_B;
          view.rerender(
            <SessionHarness
              sdk={{ ...sdk, ownerKey: OWNER_B }}
              sessionFetch={async () => {
                ownerBSessionCalls += 1;
                return sessionResponse(
                  sessionFor("siwe-subject-b", ADDRESS_B, "base-account"),
                );
              }}
              baseAccountEnabled
              baseAccountRestorer={baseAccountRestorer}
            />,
          );
          await waitFor(() => expect(ownerBSessionCalls).toBe(1));
          await waitFor(() => expect(restoreCalls).toBe(2));
          expect(page().getByTestId("status").textContent).toBe("signing-out");

          activeSdkOwner = null;
          view.rerender(
            <SessionHarness
              sdk={{ ...sdk, isSignedIn: false, ownerKey: null }}
              sessionFetch={async () => new Response(null, { status: 401 })}
              baseAccountEnabled
              baseAccountRestorer={baseAccountRestorer}
            />,
          );

          await act(async () => {
            if (ownerACleanupOutcome === "success") {
              ownerACleanup.resolve();
              await ownerACleanup.promise;
            } else {
              ownerACleanup.reject(new Error("owner-a cleanup failure"));
              await ownerACleanup.promise.catch(() => {});
            }
          });
          await waitFor(() => expect(signOutCalls).toBe(2));

          const renderFreshOwner = () => {
            activeSdkOwner = freshOwner.ownerKey;
            view.rerender(
              <SessionHarness
                sdk={{ ...sdk, ownerKey: freshOwner.ownerKey }}
                sessionFetch={async () =>
                  sessionResponse(
                    sessionFor(
                      `fresh-subject-${freshOwner.label.toLowerCase()}`,
                      freshOwner.address,
                    ),
                  )
                }
                baseAccountEnabled
                baseAccountRestorer={baseAccountRestorer}
              />,
            );
          };

          if (freshArrival === "before-b-settlement") {
            renderFreshOwner();
            await waitFor(() =>
              expect(page().getByTestId("address").textContent).toBe(
                freshOwner.address,
              ),
            );
          } else {
            await act(async () => {
              ownerBCleanup.reject(new Error("owner-b cleanup failure"));
              await ownerBCleanup.promise.catch(() => {});
            });
            await waitFor(() =>
              expect(page().getByTestId("status").textContent).toBe(
                "signout-error",
              ),
            );
            renderFreshOwner();
          }

          await waitFor(() =>
            expect(page().getByTestId("address").textContent).toBe(
              freshOwner.address,
            ),
          );
          expect(page().getByTestId("status").textContent).toBe("verified");
          expect(page().getByTestId("provider").textContent).toBe(
            "cdp-embedded",
          );
          expect(signOutCalls).toBe(2);

          if (freshArrival === "before-b-settlement") {
            await act(async () => {
              ownerBCleanup.reject(new Error("late owner-b cleanup failure"));
              await ownerBCleanup.promise.catch(() => {});
              await new Promise((resolve) => setTimeout(resolve, 0));
            });
            expect(page().getByTestId("status").textContent).toBe("verified");
            expect(page().getByTestId("address").textContent).toBe(
              freshOwner.address,
            );
            expect(signOutCalls).toBe(2);
          }
        });
      }
    }
  }

  test("lets owner B explicitly sign out after a late owner A cleanup failure", async () => {
    window.sessionStorage.setItem("home:account-provider", "base-account");
    const ownerACleanup = deferred<void>();
    const ownerBSignOut = deferred<void>();
    let activeSdkOwner = OWNER_A;
    const signOutOwners: string[] = [];
    let signOutCalls = 0;
    const sdk = baseSdk({
      getAccessToken: async () =>
        activeSdkOwner === OWNER_A ? "token-a" : "token-b",
      signOut: () => {
        signOutOwners.push(activeSdkOwner);
        signOutCalls += 1;
        return signOutCalls === 1
          ? ownerACleanup.promise
          : ownerBSignOut.promise;
      },
    });
    const view = render(
      <SessionHarness
        sdk={sdk}
        sessionFetch={async () =>
          sessionResponse(
            sessionFor("siwe-subject", ADDRESS_A, "base-account"),
          )
        }
        baseAccountEnabled
        baseAccountRestorer={async () => {
          throw new BaseAccountConnectorError("missing-connection");
        }}
      />,
    );

    await waitFor(() => expect(signOutCalls).toBe(1));
    activeSdkOwner = OWNER_B;
    view.rerender(
      <SessionHarness
        sdk={{ ...sdk, ownerKey: OWNER_B }}
        sessionFetch={async () =>
          sessionResponse(sessionFor("subject-b", ADDRESS_B))
        }
        baseAccountEnabled
        baseAccountRestorer={async () =>
          connectedBaseAccount({ address: ADDRESS_B })
        }
      />,
    );
    await waitFor(() =>
      expect(page().getByTestId("address").textContent).toBe(ADDRESS_B),
    );
    expect(window.sessionStorage.getItem("home:account-provider")).toBe(
      "cdp-embedded",
    );

    fireEvent.click(page().getByRole("button", { name: "Probe sign out" }));
    await act(async () => {
      ownerACleanup.reject(new Error("late owner-a cleanup failure"));
      await ownerACleanup.promise.catch(() => {});
    });
    await waitFor(() => expect(signOutCalls).toBe(2));
    expect(signOutOwners).toEqual([OWNER_A, OWNER_B]);
    expect(page().getByTestId("status").textContent).toBe("signing-out");
    expect(window.sessionStorage.getItem("home:account-provider")).toBe(
      "cdp-embedded",
    );

    await act(async () => {
      ownerBSignOut.resolve();
      await ownerBSignOut.promise;
    });
    await waitFor(() =>
      expect(page().getByTestId("status").textContent).toBe("signed-out"),
    );
    expect(window.sessionStorage.getItem("home:account-provider")).toBeNull();
    expect(page().getByTestId("message").textContent).toBe("You are signed out.");
  });

  test("keeps owner B retryable when its explicit sign-out fails after a stale owner A failure", async () => {
    window.sessionStorage.setItem("home:account-provider", "base-account");
    const ownerACleanup = deferred<void>();
    const ownerBSignOut = deferred<void>();
    let activeSdkOwner = OWNER_A;
    const signOutOwners: string[] = [];
    let signOutCalls = 0;
    const sdk = baseSdk({
      getAccessToken: async () =>
        activeSdkOwner === OWNER_A ? "token-a" : "token-b",
      signOut: () => {
        signOutOwners.push(activeSdkOwner);
        signOutCalls += 1;
        if (signOutCalls === 1) return ownerACleanup.promise;
        if (signOutCalls === 2) return ownerBSignOut.promise;
        return Promise.resolve();
      },
    });
    const view = render(
      <SessionHarness
        sdk={sdk}
        sessionFetch={async () =>
          sessionResponse(
            sessionFor("siwe-subject", ADDRESS_A, "base-account"),
          )
        }
        baseAccountEnabled
        baseAccountRestorer={async () => {
          throw new BaseAccountConnectorError("missing-connection");
        }}
      />,
    );

    await waitFor(() => expect(signOutCalls).toBe(1));
    activeSdkOwner = OWNER_B;
    view.rerender(
      <SessionHarness
        sdk={{ ...sdk, ownerKey: OWNER_B }}
        sessionFetch={async () =>
          sessionResponse(sessionFor("subject-b", ADDRESS_B))
        }
        baseAccountEnabled
        baseAccountRestorer={async () =>
          connectedBaseAccount({ address: ADDRESS_B })
        }
      />,
    );
    await waitFor(() =>
      expect(page().getByTestId("address").textContent).toBe(ADDRESS_B),
    );

    fireEvent.click(page().getByRole("button", { name: "Probe sign out" }));
    await act(async () => {
      ownerACleanup.reject(new Error("late owner-a cleanup failure"));
      await ownerACleanup.promise.catch(() => {});
    });
    await waitFor(() => expect(signOutCalls).toBe(2));
    await act(async () => {
      ownerBSignOut.reject(new Error("owner-b sign-out failure"));
      await ownerBSignOut.promise.catch(() => {});
    });
    await waitFor(() =>
      expect(page().getByTestId("status").textContent).toBe("signout-error"),
    );
    expect(signOutOwners).toEqual([OWNER_A, OWNER_B]);
    expect(page().getByTestId("message").textContent).toContain(
      "Retry sign out",
    );
    expect(window.sessionStorage.getItem("home:account-provider")).toBe(
      "cdp-embedded",
    );

    fireEvent.click(page().getByRole("button", { name: "Probe sign out" }));
    await waitFor(() => expect(signOutCalls).toBe(3));
    expect(signOutOwners).toEqual([OWNER_A, OWNER_B, OWNER_B]);
    await waitFor(() =>
      expect(page().getByTestId("status").textContent).toBe("signed-out"),
    );
    expect(window.sessionStorage.getItem("home:account-provider")).toBeNull();
  });

  test("coalesces owner-null explicit sign-out with pending cleanup before clearing selection", async () => {
    window.sessionStorage.setItem("home:account-provider", "base-account");
    const pendingCleanup = deferred<void>();
    let signOutCalls = 0;
    const sdk = baseSdk({
      signOut: () => {
        signOutCalls += 1;
        return pendingCleanup.promise;
      },
    });
    const view = render(
      <SessionHarness
        sdk={sdk}
        sessionFetch={async () =>
          sessionResponse(
            sessionFor("siwe-subject", ADDRESS_A, "base-account"),
          )
        }
        baseAccountEnabled
        baseAccountRestorer={async () => {
          throw new BaseAccountConnectorError("missing-connection");
        }}
      />,
    );

    await waitFor(() => expect(signOutCalls).toBe(1));
    view.rerender(
      <SessionHarness
        sdk={{ ...sdk, isSignedIn: false, ownerKey: null }}
        sessionFetch={async () =>
          sessionResponse(
            sessionFor("siwe-subject", ADDRESS_A, "base-account"),
          )
        }
        baseAccountEnabled
        baseAccountRestorer={async () => {
          throw new BaseAccountConnectorError("missing-connection");
        }}
      />,
    );

    fireEvent.click(page().getByRole("button", { name: "Probe sign out" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(signOutCalls).toBe(1);
    expect(page().getByTestId("status").textContent).toBe("signing-out");
    expect(window.sessionStorage.getItem("home:account-provider")).toBe(
      "pending:base-account",
    );

    await act(async () => {
      pendingCleanup.resolve();
      await pendingCleanup.promise;
    });
    await waitFor(() =>
      expect(page().getByTestId("status").textContent).toBe("signed-out"),
    );
    expect(window.sessionStorage.getItem("home:account-provider")).toBeNull();
  });

  test("coalesces repeated cleanup and permits a new SDK attempt only after failure", async () => {
    window.sessionStorage.setItem("home:account-provider", "base-account");
    const firstSignOut = deferred<void>();
    const secondSignOut = deferred<void>();
    let signOutCalls = 0;
    render(
      <StrictMode>
        <SessionHarness
          sdk={baseSdk({
            signOut: () => {
              signOutCalls += 1;
              return signOutCalls === 1
                ? firstSignOut.promise
                : secondSignOut.promise;
            },
          })}
          sessionFetch={async () =>
            sessionResponse(
              sessionFor("siwe-subject", ADDRESS_A, "base-account"),
            )
          }
          baseAccountEnabled
          baseAccountRestorer={async () => {
            throw new BaseAccountConnectorError("missing-connection");
          }}
        />
      </StrictMode>,
    );

    await waitFor(() => expect(signOutCalls).toBe(1));
    fireEvent.click(page().getByRole("button", { name: "Probe sign out" }));
    fireEvent.click(page().getByRole("button", { name: "Probe sign out" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(signOutCalls).toBe(1);

    await act(async () => {
      firstSignOut.reject(new Error("first cleanup failed"));
      await firstSignOut.promise.catch(() => {});
    });
    await waitFor(() =>
      expect(page().getByTestId("status").textContent).toBe("signout-error"),
    );

    fireEvent.click(page().getByRole("button", { name: "Probe sign out" }));
    await waitFor(() => expect(signOutCalls).toBe(2));
    await act(async () => {
      secondSignOut.resolve();
      await secondSignOut.promise;
    });
    expect(window.sessionStorage.getItem("home:account-provider")).toBeNull();
    expect(page().getByTestId("status").textContent).toBe("signed-out");
  });

  test("rejects late missing-connection sign-out success after unmount", async () => {
    window.sessionStorage.setItem("home:account-provider", "base-account");
    const pendingSignOut = deferred<void>();
    const view = render(
      <SessionHarness
        sdk={baseSdk({ signOut: () => pendingSignOut.promise })}
        sessionFetch={async () =>
          sessionResponse(
            sessionFor("siwe-subject", ADDRESS_A, "base-account"),
          )
        }
        baseAccountEnabled
        baseAccountRestorer={async () => {
          throw new BaseAccountConnectorError("missing-connection");
        }}
      />,
    );

    await waitFor(() =>
      expect(window.sessionStorage.getItem("home:account-provider")).toBe(
        "pending:base-account",
      ),
    );
    view.unmount();
    await act(async () => {
      pendingSignOut.resolve();
      await pendingSignOut.promise;
    });
    expect(window.sessionStorage.getItem("home:account-provider")).toBe(
      "pending:base-account",
    );
  });

  test("keeps owner-bound provider evidence through missing-connection logout and same-owner Base re-login", async () => {
    window.sessionStorage.setItem("home:account-provider", "base-account");
    const action = preparedMoneyAction(
      "base-account",
      "2026-12-08T05:20:00.000Z",
    );
    const storage = new TestJournalStorage();
    const lock = new TestJournalLock();
    const journal = new ProviderHandleJournal({ storage, lock });
    const capture = journal.retain(action, {
      kind: "submission-id",
      provider: "base-account",
      value: "same-owner-submission",
    });
    expect((await journal.persist(capture.entry!)).persisted).toBe(true);
    const exactJournalBytes = [...storage.values.entries()];

    const signedInSdk = baseSdk();
    const view = render(
      <SessionHarness
        sdk={signedInSdk}
        sessionFetch={async () =>
          sessionResponse(
            sessionFor("subject-a", ADDRESS_A, "base-account"),
          )
        }
        baseAccountEnabled
        baseAccountConnector={async () => connectedBaseAccount()}
        baseAccountRestorer={async () => {
          throw new BaseAccountConnectorError("missing-connection");
        }}
        providerHandleJournalStorage={storage}
        providerHandleJournalLock={lock}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("status").textContent).toBe("signed-out"),
    );
    expect(storage.length).toBe(1);

    const signedOutSdk = baseSdk({ isSignedIn: false, ownerKey: null });
    view.rerender(
      <SessionHarness
        sdk={signedOutSdk}
        sessionFetch={async () =>
          sessionResponse(
            sessionFor("subject-a", ADDRESS_A, "base-account"),
          )
        }
        baseAccountEnabled
        baseAccountConnector={async () => connectedBaseAccount()}
        providerHandleJournalStorage={storage}
        providerHandleJournalLock={lock}
      />,
    );
    fireEvent.click(page().getByRole("button", { name: "Probe Base sign in" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    view.rerender(
      <SessionHarness
        sdk={signedInSdk}
        sessionFetch={async () =>
          sessionResponse(
            sessionFor("subject-a", ADDRESS_A, "base-account"),
          )
        }
        baseAccountEnabled
        baseAccountConnector={async () => connectedBaseAccount()}
        providerHandleJournalStorage={storage}
        providerHandleJournalLock={lock}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("status").textContent).toBe("verified"),
    );
    expect(storage.length).toBe(1);
    expect([...storage.values.entries()]).toEqual(exactJournalBytes);
    expect(new ProviderHandleJournal({ storage, lock }).entriesForAction(action)).toHaveLength(1);
  });

  test("keeps a missing ambiguous provider hint private without signing out valid SDK auth", async () => {
    let selectedProvider: string | null = null;
    let signOutCalls = 0;
    let restoreCalls = 0;
    render(
      <SessionHarness
        sdk={baseSdk({
          signOut: async () => {
            signOutCalls += 1;
          },
        })}
        sessionFetch={async (_input, init) => {
          selectedProvider = new Headers(init?.headers).get(
            ACCOUNT_PROVIDER_HEADER,
          );
          return Response.json(
            { error: { code: "AMBIGUOUS_ACCOUNT_PROVIDER" } },
            { status: 503 },
          );
        }}
        baseAccountEnabled
        baseAccountRestorer={async () => {
          restoreCalls += 1;
          return connectedBaseAccount();
        }}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("status").textContent).toBe("unavailable"),
    );
    expect(selectedProvider as unknown).toBe("restore");
    expect(page().getByTestId("address").textContent).toBe(
      "private-details-hidden",
    );
    expect(restoreCalls).toBe(0);
    expect(signOutCalls).toBe(0);
  });

  test("signs the exact CDP challenge with Base Account and selects only the verified SIWE session", async () => {
    let siweOptions: Parameters<AccountWalletSdkBoundary["signInWithSiwe"]>[0] | null = null;
    let signedMessage: string | null = null;
    let verified: { flowId: string; signature: string } | null = null;
    let selectedProvider: string | null = null;
    const connection = connectedBaseAccount({
      signMessage: async (message) => {
        signedMessage = message;
        return "0xabcd";
      },
    });
    const connector: BaseAccountConnector = async () => connection;
    const signedOutSdk = baseSdk({
      isSignedIn: false,
      ownerKey: null,
      signInWithSiwe: async (options) => {
        siweOptions = options;
        return { flowId: "siwe-flow", message: "exact CDP SIWE message" };
      },
      verifySiweSignature: async (flowId, signature) => {
        verified = { flowId, signature };
      },
    });
    const sessionFetch: SessionFetch = async (input, init) => {
      expect(input).toBe("/api/session");
      selectedProvider = new Headers(init?.headers).get(
        ACCOUNT_PROVIDER_HEADER,
      );
      return sessionResponse(
        sessionFor("siwe-subject", ADDRESS_A, "base-account"),
      );
    };
    const view = render(
      <SessionHarness
        sdk={signedOutSdk}
        sessionFetch={sessionFetch}
        baseAccountEnabled
        baseAccountConnector={connector}
      />,
    );

    fireEvent.click(page().getByRole("button", { name: "Probe Base sign in" }));
    await waitFor(() => expect(verified).not.toBeNull());
    expect(siweOptions as unknown).toEqual({
      address: ADDRESS_A,
      chainId: 8453,
      domain: "localhost:3111",
      uri: "http://localhost:3111",
    });
    expect(signedMessage as unknown).toBe("exact CDP SIWE message");
    expect(verified as unknown).toEqual({
      flowId: "siwe-flow",
      signature: "0xabcd",
    });

    view.rerender(
      <SessionHarness
        sdk={{ ...signedOutSdk, isSignedIn: true, ownerKey: OWNER_A }}
        sessionFetch={sessionFetch}
        baseAccountEnabled
        baseAccountConnector={connector}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("address").textContent).toBe(ADDRESS_A),
    );
    expect(page().getByTestId("provider").textContent).toBe("base-account");
    expect(selectedProvider as unknown).toBe("base-account");
  });

  test("keeps a canceled unabortable Base connection and later SDK success private", async () => {
    const pendingConnection = deferred<ConnectedBaseAccount>();
    let disconnectCalls = 0;
    let sessionCalls = 0;
    let signOutCalls = 0;
    const signedOutSdk = baseSdk({
      isSignedIn: false,
      ownerKey: null,
      signOut: async () => {
        signOutCalls += 1;
      },
    });
    const view = render(
      <SessionHarness
        sdk={signedOutSdk}
        sessionFetch={async () => {
          sessionCalls += 1;
          return sessionResponse(sessionFor("late-subject", ADDRESS_A, "base-account"));
        }}
        baseAccountEnabled
        baseAccountConnector={() => pendingConnection.promise}
      />,
    );

    fireEvent.click(page().getByRole("button", { name: "Probe Base sign in" }));
    fireEvent.click(page().getByRole("button", { name: "Cancel sign in" }));
    await act(async () => {
      pendingConnection.resolve(connectedBaseAccount({
        disconnect: async () => { disconnectCalls += 1; },
      }));
      await pendingConnection.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(disconnectCalls).toBeGreaterThanOrEqual(1);
    expect(sessionCalls).toBe(0);

    view.rerender(
      <SessionHarness
        sdk={{ ...signedOutSdk, isSignedIn: true, ownerKey: OWNER_A }}
        sessionFetch={async () => {
          sessionCalls += 1;
          return sessionResponse(sessionFor("late-subject", ADDRESS_A, "base-account"));
        }}
        baseAccountEnabled
        baseAccountConnector={() => pendingConnection.promise}
      />,
    );

    await waitFor(() => expect(signOutCalls).toBe(1));
    expect(sessionCalls).toBe(0);
    expect(page().getByTestId("address").textContent).toBe("private-details-hidden");
  });

  test("does not initialize the Base SDK while the deployment flag is off", async () => {
    let connectorCalls = 0;
    render(
      <SessionHarness
        sdk={baseSdk({ isSignedIn: false, ownerKey: null })}
        sessionFetch={async () =>
          sessionResponse(sessionFor("unexpected", ADDRESS_A))
        }
        baseAccountConnector={async () => {
          connectorCalls += 1;
          return connectedBaseAccount();
        }}
      />,
    );

    fireEvent.click(page().getByRole("button", { name: "Probe Base sign in" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(connectorCalls).toBe(0);
    expect(page().getByTestId("address").textContent).toBe(
      "private-details-hidden",
    );
  });

  test("fails closed when hosted SIWE verification rejects the smart-account signature", async () => {
    let disconnectCalls = 0;
    let sessionCalls = 0;
    const sdk = baseSdk({
      isSignedIn: false,
      ownerKey: null,
      verifySiweSignature: async () => {
        throw new Error("fixture hosted verifier rejection");
      },
    });

    render(
      <SessionHarness
        sdk={sdk}
        sessionFetch={async () => {
          sessionCalls += 1;
          return sessionResponse(sessionFor("unexpected", ADDRESS_A));
        }}
        baseAccountEnabled
        baseAccountConnector={async () =>
          connectedBaseAccount({
            disconnect: async () => {
              disconnectCalls += 1;
            },
          })
        }
      />,
    );

    fireEvent.click(page().getByRole("button", { name: "Probe Base sign in" }));
    await waitFor(() => expect(disconnectCalls).toBe(1));
    expect(sessionCalls).toBe(0);
    expect(page().getByTestId("address").textContent).toBe(
      "private-details-hidden",
    );
    expect(page().getByTestId("provider").textContent).toBe("no-provider");
  });

  test("blocks and signs out when a restored Base account differs from the server SIWE address", async () => {
    window.sessionStorage.setItem("home:account-provider", "base-account");
    let signOutCalls = 0;
    let disconnectCalls = 0;
    render(
      <SessionHarness
        sdk={baseSdk({
          signOut: async () => {
            signOutCalls += 1;
          },
        })}
        sessionFetch={async () =>
          sessionResponse(
            sessionFor("siwe-subject", ADDRESS_B, "base-account"),
          )
        }
        baseAccountEnabled
        baseAccountRestorer={async () =>
          connectedBaseAccount({
            disconnect: async () => {
              disconnectCalls += 1;
            },
          })
        }
      />,
    );

    await waitFor(() => expect(signOutCalls).toBe(1));
    expect(disconnectCalls).toBe(1);
    expect(page().getByTestId("status").textContent).toBe("signed-out");
    expect(page().getByTestId("address").textContent).toBe(
      "private-details-hidden",
    );
    expect(page().getByTestId("message").textContent).toContain(
      "did not match",
    );
  });

  test("keeps Base mode on the fixed same-origin portfolio request", async () => {
    const requests: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    const sessionFetch: SessionFetch = async (input, init) => {
      requests.push({ input, init });
      if (input === "/api/session") {
        return sessionResponse(
          sessionFor("siwe-subject", ADDRESS_A, "base-account"),
        );
      }
      return Response.json({ wallet: ADDRESS_A });
    };
    const signedOutSdk = baseSdk({ isSignedIn: false, ownerKey: null });
    const view = render(
      <SessionHarness
        sdk={signedOutSdk}
        sessionFetch={sessionFetch}
        baseAccountEnabled
        baseAccountConnector={async () => connectedBaseAccount()}
      />,
    );
    fireEvent.click(page().getByRole("button", { name: "Probe Base sign in" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    view.rerender(
      <SessionHarness
        sdk={{ ...signedOutSdk, isSignedIn: true, ownerKey: OWNER_A }}
        sessionFetch={sessionFetch}
        baseAccountEnabled
        baseAccountConnector={async () => connectedBaseAccount()}
      />,
    );
    await waitFor(() =>
      expect(page().getByTestId("address").textContent).toBe(ADDRESS_A),
    );

    fireEvent.click(page().getByRole("button", { name: "Probe portfolio" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    const portfolioRequest = requests[1];
    expect(portfolioRequest?.input).toBe("/api/portfolio");
    expect(portfolioRequest?.init?.method).toBe("GET");
    expect(portfolioRequest?.init?.cache).toBe("no-store");
    expect(portfolioRequest?.init?.credentials).toBe("same-origin");
    expect(
      new Headers(portfolioRequest?.init?.headers).get(ACCOUNT_PROVIDER_HEADER),
    ).toBe("base-account");

    fireEvent.click(
      page().getByRole("button", { name: "Probe portfolio valuation" }),
    );
    await waitFor(() => expect(requests).toHaveLength(3));
    const valuationRequest = requests[2];
    expect(valuationRequest?.input).toBe("/api/portfolio/valuation?region=DE");
    expect(valuationRequest?.init?.method).toBe("GET");
    expect(valuationRequest?.init?.cache).toBe("no-store");
    expect(
      new Headers(valuationRequest?.init?.headers).get(ACCOUNT_PROVIDER_HEADER),
    ).toBe("base-account");
  });

  test("keeps exactly one activity query separator on the fixed authenticated same-origin GET contract", async () => {
    const requests: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    const sessionFetch: SessionFetch = async (input, init) => {
      requests.push({ input, init });
      return input === "/api/session"
        ? sessionResponse(sessionFor("subject-a", ADDRESS_A))
        : Response.json({ items: [] });
    };
    render(<SessionHarness sdk={baseSdk()} sessionFetch={sessionFetch} />);
    await waitFor(() =>
      expect(page().getByTestId("address").textContent).toBe(ADDRESS_A),
    );

    fireEvent.click(page().getByRole("button", { name: "Probe activity" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    const activity = requests[1];
    expect(activity?.input).toBe("/api/activity?limit=10&cursor=next");
    expect(String(activity?.input).match(/\?/g)).toHaveLength(1);
    expect(activity?.init?.method).toBe("GET");
    expect(activity?.init?.cache).toBe("no-store");
    expect(activity?.init?.credentials).toBe("same-origin");
    expect(new Headers(activity?.init?.headers).get("Authorization")).toBe(
      "Bearer token-a",
    );
    expect(
      new Headers(activity?.init?.headers).get(ACCOUNT_PROVIDER_HEADER),
    ).toBe("cdp-embedded");
  });

  test("shares one strict same-origin authenticated POST seam for feature action adapters", async () => {
    const requests: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    const sessionFetch: SessionFetch = async (input, init) => {
      requests.push({ input, init });
      return input === "/api/session"
        ? sessionResponse(sessionFor("subject-a", ADDRESS_A))
        : Response.json({ ok: true });
    };
    render(<SessionHarness sdk={baseSdk()} sessionFetch={sessionFetch} />);
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));

    fireEvent.click(page().getByRole("button", { name: "Probe account action" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    const action = requests[1];
    expect(action?.input).toBe("/api/savings/actions/prepare");
    expect(action?.init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ amountBaseUnits: "1000000" }),
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
    });
    expect(new Headers(action?.init?.headers).get("Authorization")).toBe("Bearer token-a");
    expect(new Headers(action?.init?.headers).get(ACCOUNT_PROVIDER_HEADER)).toBe("cdp-embedded");

    fireEvent.click(page().getByRole("button", { name: "Probe rejected account path" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toHaveLength(2);
  });

  test("checks a prepared money action without claiming or invoking a wallet submission API", async () => {
    const action = preparedMoneyAction("cdp-embedded", "2026-12-08T05:20:00.000Z");
    let claims = 0;
    let sends = 0;
    const sessionFetch: SessionFetch = async (input) => {
      if (input === "/api/session") return sessionResponse(sessionFor("subject-a", ADDRESS_A));
      if (input === `/api/actions/${action.id}`) {
        return Response.json({ operation: storedMoneyAction(action, "prepared") });
      }
      if (input === `/api/actions/${action.id}/claim`) claims += 1;
      throw new Error(`unexpected prepared check request: ${String(input)}`);
    };
    render(
      <SessionHarness
        sdk={baseSdk({
          sendUserOperation: async () => {
            sends += 1;
            return { userOperationHash: `0x${"ab".repeat(32)}` };
          },
        })}
        sessionFetch={sessionFetch}
        moneyAction={action}
      />,
    );
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));
    fireEvent.click(page().getByRole("button", { name: "Check money action" }));
    await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("prepared"));
    expect(claims).toBe(0);
    expect(sends).toBe(0);
  });

  test("returns reference-free submitting and unknown rows without claiming, status mutation, or wallet submission", async () => {
    for (const durableStatus of ["submitting", "unknown"] as const) {
      const action = {
        ...preparedMoneyAction("cdp-embedded", "2026-12-08T05:20:00.000Z"),
        id: durableStatus === "submitting"
          ? "123e4567-e89b-42d3-a456-426614174011"
          : "123e4567-e89b-42d3-a456-426614174012",
      };
      let walletSubmissions = 0;
      const requests: string[] = [];
      const sessionFetch: SessionFetch = async (input) => {
        requests.push(String(input));
        if (input === "/api/session") return sessionResponse(sessionFor("subject-a", ADDRESS_A));
        if (input === `/api/actions/${action.id}`) {
          return Response.json({ operation: storedMoneyAction(action, durableStatus) });
        }
        throw new Error(`unexpected reference-free check request: ${String(input)}`);
      };
      render(
        <SessionHarness
          sdk={baseSdk({
            sendUserOperation: async () => {
              walletSubmissions += 1;
              return { userOperationHash: `0x${"ab".repeat(32)}` };
            },
          })}
          sessionFetch={sessionFetch}
          moneyAction={action}
        />,
      );
      await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));
      fireEvent.click(page().getByRole("button", { name: "Check money action" }));
      await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe(durableStatus));
      expect(requests).toEqual(["/api/session", `/api/actions/${action.id}`]);
      expect(walletSubmissions).toBe(0);
      cleanup();
      window.sessionStorage.clear();
    }
  });

  test("reconciles an already-recorded embedded user-operation handle through checkMoneyAction", async () => {
    const action = preparedMoneyAction("cdp-embedded", "2026-12-08T05:20:00.000Z");
    const userOperationHash = `0x${"cd".repeat(32)}` as `0x${string}`;
    const transactionHash = `0x${"ef".repeat(32)}` as `0x${string}`;
    let claims = 0;
    let submissions = 0;
    let walletSubmissions = 0;
    const sessionFetch: SessionFetch = async (input) => {
      if (input === "/api/session") return sessionResponse(sessionFor("subject-a", ADDRESS_A));
      if (input === `/api/actions/${action.id}`) {
        return Response.json({
          operation: storedMoneyAction(action, "submitted", { userOperationHash }),
        });
      }
      if (input === `/api/actions/${action.id}/submission`) {
        submissions += 1;
        return Response.json({
          operation: storedMoneyAction(action, "confirmed", {
            userOperationHash,
            transactionHash,
          }),
        });
      }
      if (String(input).startsWith("/api/transfer-receipt?")) {
        return Response.json({
          status: "confirmed",
          transactionHash,
          blockNumber: "17",
          success: true,
        });
      }
      if (input === `/api/actions/${action.id}/claim`) claims += 1;
      throw new Error(`unexpected embedded check request: ${String(input)}`);
    };
    render(
      <SessionHarness
        sdk={baseSdk({
          sendUserOperation: async () => {
            walletSubmissions += 1;
            return { userOperationHash };
          },
          getUserOperation: async () => ({
            status: "complete",
            transactionHash,
            calls: action.calls.map((call) => ({
              to: call.to,
              data: call.data,
              value: BigInt(call.value),
            })),
          }) as never,
        })}
        sessionFetch={sessionFetch}
        moneyAction={action}
      />,
    );
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));
    fireEvent.click(page().getByRole("button", { name: "Check money action" }));
    await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("confirmed"));
    expect(claims).toBe(0);
    expect(walletSubmissions).toBe(0);
    expect(submissions).toBe(1);
  });

  test("reconciles an already-recorded Base submission ID through checkMoneyAction without wallet_sendCalls", async () => {
    window.sessionStorage.setItem("home:account-provider", "base-account");
    const action = preparedMoneyAction("base-account", "2026-12-08T05:20:00.000Z");
    const transactionHash = `0x${"ef".repeat(32)}` as `0x${string}`;
    let walletSubmissions = 0;
    let claims = 0;
    const connection = connectedBaseAccount({
      sendCalls: async () => {
        walletSubmissions += 1;
        return "base-submission";
      },
      getCallsStatus: async () => ({ status: "complete", transactionHash }),
    });
    const sessionFetch: SessionFetch = async (input) => {
      if (input === "/api/session") {
        return sessionResponse(sessionFor("subject-a", ADDRESS_A, "base-account"));
      }
      if (input === `/api/actions/${action.id}`) {
        return Response.json({
          operation: storedMoneyAction(action, "submitted", { submissionId: "base-submission" }),
        });
      }
      if (String(input).startsWith("/api/transfer-receipt?")) {
        return Response.json({
          status: "confirmed",
          transactionHash,
          blockNumber: "18",
          success: true,
        });
      }
      if (input === `/api/actions/${action.id}/submission`) {
        return Response.json({
          operation: storedMoneyAction(action, "confirmed", {
            submissionId: "base-submission",
            transactionHash,
          }),
        });
      }
      if (input === `/api/actions/${action.id}/claim`) claims += 1;
      throw new Error(`unexpected Base check request: ${String(input)}`);
    };
    render(
      <SessionHarness
        sdk={baseSdk()}
        sessionFetch={sessionFetch}
        baseAccountEnabled
        baseAccountRestorer={async () => connection}
        moneyAction={action}
      />,
    );
    await waitFor(() => expect(page().getByTestId("provider").textContent).toBe("base-account"));
    fireEvent.click(page().getByRole("button", { name: "Check money action" }));
    await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("confirmed"));
    expect(claims).toBe(0);
    expect(walletSubmissions).toBe(0);
  });

  test("fails send balance preflight before the atomic claim", async () => {
    const action = {
      ...preparedMoneyAction("cdp-embedded", "2026-12-08T05:20:00.000Z"),
      amounts: [{
        assetId: "usdc",
        symbol: "USDC",
        decimals: 6,
        amountBaseUnits: "10000000",
        direction: "spend" as const,
      }],
    };
    let claims = 0;
    let walletSubmissions = 0;
    const sessionFetch: SessionFetch = async (input) => {
      if (input === "/api/session") return sessionResponse(sessionFor("subject-a", ADDRESS_A));
      if (input === `/api/actions/${action.id}`) {
        return Response.json({ operation: storedMoneyAction(action, "prepared") });
      }
      if (input === "/api/portfolio") return portfolioResponse(ADDRESS_A);
      if (input === `/api/actions/${action.id}/claim`) claims += 1;
      throw new Error(`unexpected preflight request: ${String(input)}`);
    };
    render(
      <SessionHarness
        sdk={baseSdk({
          sendUserOperation: async () => {
            walletSubmissions += 1;
            return { userOperationHash: `0x${"ab".repeat(32)}` };
          },
          getUserOperation: async () => ({ status: "pending" }) as never,
        })}
        sessionFetch={sessionFetch}
        moneyAction={action}
      />,
    );
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));
    fireEvent.click(page().getByRole("button", { name: "Probe money action" }));
    await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("error:insufficient-balance"));
    expect(claims).toBe(0);
    expect(walletSubmissions).toBe(0);
  });

  test("fails provider capability preflight before claim or balance I/O", async () => {
    const action = preparedMoneyAction("cdp-embedded", "2026-12-08T05:20:00.000Z");
    let claims = 0;
    let portfolioReads = 0;
    const sessionFetch: SessionFetch = async (input) => {
      if (input === "/api/session") return sessionResponse(sessionFor("subject-a", ADDRESS_A));
      if (input === `/api/actions/${action.id}`) {
        return Response.json({ operation: storedMoneyAction(action, "prepared") });
      }
      if (input === "/api/portfolio") portfolioReads += 1;
      if (input === `/api/actions/${action.id}/claim`) claims += 1;
      throw new Error(`unexpected capability preflight request: ${String(input)}`);
    };
    render(
      <SessionHarness sdk={baseSdk()} sessionFetch={sessionFetch} moneyAction={action} />,
    );
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));
    fireEvent.click(page().getByRole("button", { name: "Probe money action" }));
    await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("error:unavailable"));
    expect(claims).toBe(0);
    expect(portfolioReads).toBe(0);
  });

  test("fences pure money-action recovery when the verified account switches during the durable read", async () => {
    const action = preparedMoneyAction("cdp-embedded", "2026-12-08T05:20:00.000Z");
    const userOperationHash = `0x${"cd".repeat(32)}` as `0x${string}`;
    const pendingRead = deferred<Response>();
    let providerChecks = 0;
    let accessToken = "token-a";
    const sdk = baseSdk({
      getAccessToken: async () => accessToken,
      getUserOperation: async () => {
        providerChecks += 1;
        return { status: "pending" } as never;
      },
    });
    const sessionFetch: SessionFetch = async (input, init) => {
      if (input === "/api/session") {
        return new Headers(init?.headers).get("Authorization") === "Bearer token-b"
          ? sessionResponse(sessionFor("subject-b", ADDRESS_B))
          : sessionResponse(sessionFor("subject-a", ADDRESS_A));
      }
      if (input === `/api/actions/${action.id}`) return pendingRead.promise;
      throw new Error(`unexpected switched recovery request: ${String(input)}`);
    };
    const view = render(
      <SessionHarness sdk={sdk} sessionFetch={sessionFetch} moneyAction={action} />,
    );
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));
    fireEvent.click(page().getByRole("button", { name: "Check money action" }));

    accessToken = "token-b";
    view.rerender(
      <SessionHarness
        sdk={{ ...sdk, ownerKey: OWNER_B }}
        sessionFetch={sessionFetch}
        moneyAction={action}
      />,
    );
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_B));
    await act(async () => {
      pendingRead.resolve(Response.json({
        operation: storedMoneyAction(action, "submitted", { userOperationHash }),
      }));
      await pendingRead.promise;
    });
    await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("error:stale-session"));
    expect(providerChecks).toBe(0);
  });

  test("fences money-action execution before claim when the account switches during send preflight", async () => {
    const action = preparedMoneyAction("cdp-embedded", "2026-12-08T05:20:00.000Z");
    const pendingPortfolio = deferred<Response>();
    let claims = 0;
    let walletSubmissions = 0;
    let accessToken = "token-a";
    const sdk = baseSdk({
      getAccessToken: async () => accessToken,
      sendUserOperation: async () => {
        walletSubmissions += 1;
        return { userOperationHash: `0x${"ab".repeat(32)}` };
      },
      getUserOperation: async () => ({ status: "pending" }) as never,
    });
    const sessionFetch: SessionFetch = async (input, init) => {
      if (input === "/api/session") {
        return new Headers(init?.headers).get("Authorization") === "Bearer token-b"
          ? sessionResponse(sessionFor("subject-b", ADDRESS_B))
          : sessionResponse(sessionFor("subject-a", ADDRESS_A));
      }
      if (input === `/api/actions/${action.id}`) {
        return Response.json({ operation: storedMoneyAction(action, "prepared") });
      }
      if (input === "/api/portfolio") return pendingPortfolio.promise;
      if (input === `/api/actions/${action.id}/claim`) claims += 1;
      throw new Error(`unexpected switched execution request: ${String(input)}`);
    };
    const view = render(
      <SessionHarness sdk={sdk} sessionFetch={sessionFetch} moneyAction={action} />,
    );
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));
    fireEvent.click(page().getByRole("button", { name: "Probe money action" }));

    accessToken = "token-b";
    view.rerender(
      <SessionHarness
        sdk={{ ...sdk, ownerKey: OWNER_B }}
        sessionFetch={sessionFetch}
        moneyAction={action}
      />,
    );
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_B));
    await act(async () => {
      pendingPortfolio.resolve(portfolioResponse(ADDRESS_A));
      await pendingPortfolio.promise;
    });
    await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("error:stale-session"));
    expect(claims).toBe(0);
    expect(walletSubmissions).toBe(0);
  });

  test("prevents embedded and Base money-action dispatch after delayed preflight crosses canonical expiry", async () => {
    const originalNow = Date.now;
    let now = Date.parse("2026-09-08T05:09:59.000Z");
    Date.now = () => now;
    try {
      const expiresAt = "2026-09-08T05:10:00.000Z";
      const embeddedAction = preparedMoneyAction("cdp-embedded", expiresAt);
      const pendingPortfolio = deferred<Response>();
      let embeddedDispatches = 0;
      let embeddedClaims = 0;
      let embeddedExpirations = 0;
      const embeddedFetch: SessionFetch = async (input, init) => {
        if (input === "/api/session") return sessionResponse(sessionFor("subject-a", ADDRESS_A));
        if (input === `/api/actions/${embeddedAction.id}`) {
          return Response.json({
            operation: {
              action: embeddedAction,
              status: "prepared",
              attemptCount: 0,
              createdAt: embeddedAction.createdAt,
              updatedAt: embeddedAction.createdAt,
            },
          });
        }
        if (input === "/api/portfolio") return pendingPortfolio.promise;
        if (input === `/api/actions/${embeddedAction.id}/claim`) {
          embeddedClaims += 1;
          const status = embeddedClaims === 1 ? "submitting" : "expired";
          return Response.json({
            action: embeddedAction,
            disposition: embeddedClaims === 1 ? "dispatch" : "recover",
            operation: {
              action: embeddedAction,
              status,
              attemptCount: 1,
              claimedAt: "2026-09-08T05:09:59.000Z",
              createdAt: embeddedAction.createdAt,
              updatedAt: "2026-09-08T05:10:01.000Z",
            },
          });
        }
        if (input === `/api/actions/${embeddedAction.id}/status`) {
          expect(JSON.parse(String(init?.body))).toEqual({ status: "expired" });
          embeddedExpirations += 1;
          return Response.json({
            operation: {
              action: embeddedAction,
              status: "expired",
              attemptCount: 1,
              claimedAt: "2026-09-08T05:09:59.000Z",
              createdAt: embeddedAction.createdAt,
              updatedAt: "2026-09-08T05:10:01.000Z",
            },
          });
        }
        throw new Error(`unexpected embedded request: ${String(input)}`);
      };
      render(
        <SessionHarness
          sdk={baseSdk({
            sendUserOperation: async () => {
              embeddedDispatches += 1;
              return { userOperationHash: `0x${"ab".repeat(32)}` };
            },
            getUserOperation: async () => ({ status: "pending" }) as never,
          })}
          sessionFetch={embeddedFetch}
          moneyAction={embeddedAction}
        />,
      );
      await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));
      fireEvent.click(page().getByRole("button", { name: "Probe money action" }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(embeddedClaims).toBe(0);
      now = Date.parse("2026-09-08T05:10:01.000Z");
      await act(async () => {
        pendingPortfolio.resolve(portfolioResponse(ADDRESS_A));
        await pendingPortfolio.promise;
      });
      await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("expired"));
      expect(embeddedDispatches).toBe(0);
      expect(embeddedExpirations).toBe(1);

      cleanup();
      window.sessionStorage.clear();
      window.sessionStorage.setItem("home:account-provider", "base-account");
      now = Date.parse("2026-09-08T05:09:59.000Z");
      const baseAction = preparedMoneyAction("base-account", expiresAt);
      const connectorBarrier = deferred<void>();
      let baseDispatches = 0;
      let baseExpirations = 0;
      const connection = connectedBaseAccount({
        sendCalls: async (_calls, _requestId, beforeDispatch) => {
          await connectorBarrier.promise;
          await beforeDispatch?.();
          baseDispatches += 1;
          return "base-submission";
        },
        getCallsStatus: async () => ({ status: "pending" }),
      });
      const baseFetch: SessionFetch = async (input, init) => {
        if (input === "/api/session") {
          return sessionResponse(sessionFor("subject-a", ADDRESS_A, "base-account"));
        }
        if (input === `/api/actions/${baseAction.id}`) {
          return Response.json({
            operation: {
              action: baseAction,
              status: "prepared",
              attemptCount: 0,
              createdAt: baseAction.createdAt,
              updatedAt: baseAction.createdAt,
            },
          });
        }
        if (input === "/api/portfolio") return portfolioResponse(ADDRESS_A);
        if (input === `/api/actions/${baseAction.id}/claim`) {
          return Response.json({
            action: baseAction,
            disposition: "dispatch",
            operation: {
              action: baseAction,
              status: "submitting",
              attemptCount: 1,
              claimedAt: "2026-09-08T05:09:59.000Z",
              createdAt: baseAction.createdAt,
              updatedAt: "2026-09-08T05:09:59.000Z",
            },
          });
        }
        if (input === `/api/actions/${baseAction.id}/status`) {
          expect(JSON.parse(String(init?.body))).toEqual({ status: "expired" });
          baseExpirations += 1;
          return Response.json({
            operation: {
              action: baseAction,
              status: "expired",
              attemptCount: 1,
              claimedAt: "2026-09-08T05:09:59.000Z",
              createdAt: baseAction.createdAt,
              updatedAt: "2026-09-08T05:10:01.000Z",
            },
          });
        }
        throw new Error(`unexpected Base request: ${String(input)}`);
      };
      render(
        <SessionHarness
          sdk={baseSdk()}
          sessionFetch={baseFetch}
          baseAccountEnabled
          baseAccountRestorer={async () => connection}
          moneyAction={baseAction}
        />,
      );
      await waitFor(() => expect(page().getByTestId("provider").textContent).toBe("base-account"));
      fireEvent.click(page().getByRole("button", { name: "Probe money action" }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      now = Date.parse("2026-09-08T05:10:01.000Z");
      await act(async () => {
        connectorBarrier.resolve();
        await connectorBarrier.promise;
      });
      await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("expired"));
      expect(baseDispatches).toBe(0);
      expect(baseExpirations).toBe(1);
    } finally {
      Date.now = originalNow;
    }
  });

  test("recovers a claimed send with no submission refs without calling sendUserOperation", async () => {
    const action = preparedMoneyAction("cdp-embedded", "2026-12-08T05:20:00.000Z");
    let claims = 0;
    let sends = 0;
    let statusWrites = 0;
    const sessionFetch: SessionFetch = async (input, init) => {
      if (input === "/api/session") return sessionResponse(sessionFor("subject-a", ADDRESS_A));
      if (input === `/api/actions/${action.id}`) {
        return Response.json({
          operation: {
            action,
            status: "submitting",
            attemptCount: 1,
            claimedAt: "2026-09-08T05:02:00.000Z",
            createdAt: action.createdAt,
            updatedAt: "2026-09-08T05:02:00.000Z",
          },
        });
      }
      if (input === `/api/actions/${action.id}/claim`) {
        claims += 1;
        return Response.json({
          action,
          disposition: "recover",
          operation: {
            action,
            status: "submitting",
            attemptCount: 1,
            claimedAt: "2026-09-08T05:02:00.000Z",
            createdAt: action.createdAt,
            updatedAt: "2026-09-08T05:02:00.000Z",
          },
        });
      }
      if (input === `/api/actions/${action.id}/status`) {
        statusWrites += 1;
        expect(JSON.parse(String(init?.body))).toEqual({ status: "unknown" });
        return Response.json({
          operation: {
            action,
            status: "unknown",
            attemptCount: 1,
            claimedAt: "2026-09-08T05:02:00.000Z",
            createdAt: action.createdAt,
            updatedAt: "2026-09-08T05:02:01.000Z",
          },
        });
      }
      throw new Error(`unexpected recover request: ${String(input)}`);
    };
    render(
      <SessionHarness
        sdk={baseSdk({
          sendUserOperation: async () => {
            sends += 1;
            return { userOperationHash: `0x${"ab".repeat(32)}` };
          },
        })}
        sessionFetch={sessionFetch}
        moneyAction={action}
      />,
    );
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));
    fireEvent.click(page().getByRole("button", { name: "Probe money action" }));
    await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("unknown"));
    expect(claims).toBe(1);
    expect(statusWrites).toBe(1);
    expect(sends).toBe(0);
  });

  test("journals an embedded provider handle before a failed upload and recovers it after a true remount without redispatch", async () => {
    const action = preparedMoneyAction("cdp-embedded", "2026-12-08T05:20:00.000Z");
    const userOperationHash = `0x${"Cd".repeat(32)}` as `0x${string}`;
    const normalizedHash = userOperationHash.toLowerCase() as `0x${string}`;
    const storage = new TestJournalStorage();
    const lock = new TestJournalLock();
    let walletDispatches = 0;
    let claims = 0;
    let submissionPosts = 0;
    let providerLookups = 0;
    const sessionFetch: SessionFetch = async (input, init) => {
      if (input === "/api/session") return sessionResponse(sessionFor("subject-a", ADDRESS_A));
      if (input === "/api/portfolio") return portfolioResponse(ADDRESS_A);
      if (input === `/api/actions/${action.id}`) {
        return Response.json({ operation: storedMoneyAction(action, claims === 0 ? "prepared" : "submitting") });
      }
      if (input === `/api/actions/${action.id}/claim`) {
        claims += 1;
        return Response.json({
          action,
          operation: storedMoneyAction(action, "submitting"),
          disposition: "dispatch",
        });
      }
      if (input === `/api/actions/${action.id}/submission`) {
        submissionPosts += 1;
        const persisted = [...storage.values.values()].map((raw) => JSON.parse(raw));
        expect(persisted).toHaveLength(1);
        expect(persisted[0]).toMatchObject({
          actionId: action.id,
          reviewHash: action.reviewHash,
          provider: "cdp-embedded",
          handle: { kind: "user-operation-hash", value: normalizedHash },
        });
        if (submissionPosts === 1) {
          return Response.json({ error: { code: "TEMPORARY", message: "try later" } }, { status: 503 });
        }
        expect(JSON.parse(String(init?.body))).toEqual({ userOperationHash: normalizedHash });
        return Response.json({
          operation: storedMoneyAction(action, "failed", { userOperationHash: normalizedHash }),
        });
      }
      throw new Error(`unexpected journal recovery request: ${String(input)}`);
    };
    const sdk = baseSdk({
      sendUserOperation: async () => {
        walletDispatches += 1;
        return { userOperationHash };
      },
      getUserOperation: async () => {
        providerLookups += 1;
        throw new Error("terminal journal recovery must not look up the provider");
      },
    });

    const first = render(
      <SessionHarness
        sdk={sdk}
        sessionFetch={sessionFetch}
        moneyAction={action}
        providerHandleJournalStorage={storage}
        providerHandleJournalLock={lock}
      />,
    );
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));
    fireEvent.click(page().getByRole("button", { name: "Probe money action" }));
    await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("error:submission-unknown"));
    expect(walletDispatches).toBe(1);
    expect(storage.length).toBe(1);
    first.unmount();

    render(
      <SessionHarness
        sdk={sdk}
        sessionFetch={sessionFetch}
        moneyAction={action}
        providerHandleJournalStorage={storage}
        providerHandleJournalLock={lock}
      />,
    );
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));
    fireEvent.click(page().getByRole("button", { name: "Check money action" }));
    await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("failed"));
    expect(walletDispatches).toBe(1);
    expect(claims).toBe(1);
    expect(submissionPosts).toBe(2);
    expect(providerLookups).toBe(0);
    expect(storage.length).toBe(0);
  });

  test("uploads an already-returned handle from memory when another instance wins the final persistent slot", async () => {
    const action = preparedMoneyAction("cdp-embedded", "2026-12-08T05:20:00.000Z");
    const userOperationHash = `0x${"f".repeat(64)}` as const;
    const storage = new TestJournalStorage();
    const lock = new TestJournalLock();
    const filler = new ProviderHandleJournal({ storage, lock });
    for (let index = 0; index < 31; index += 1) {
      const fillerAction = {
        ...action,
        id: `223e4567-e89b-42d3-a456-${String(index).padStart(12, "0")}`,
      };
      const captured = filler.retain(fillerAction, {
        kind: "user-operation-hash",
        provider: "cdp-embedded",
        value: `0x${index.toString(16).padStart(64, "0")}`,
      });
      expect((await filler.persist(captured.entry!)).persisted).toBe(true);
    }
    const providerReturn = deferred<{ userOperationHash: `0x${string}` }>();
    const sendEntered = deferred<void>();
    let walletDispatches = 0;
    let claims = 0;
    let submissionPosts = 0;
    let providerLookups = 0;
    const sessionFetch: SessionFetch = async (input, init) => {
      if (input === "/api/session") return sessionResponse(sessionFor("subject-a", ADDRESS_A));
      if (input === "/api/portfolio") return portfolioResponse(ADDRESS_A);
      if (input === `/api/actions/${action.id}`) {
        return Response.json({ operation: storedMoneyAction(action, claims === 0 ? "prepared" : "submitting") });
      }
      if (input === `/api/actions/${action.id}/claim`) {
        claims += 1;
        return Response.json({
          action,
          operation: storedMoneyAction(action, "submitting"),
          disposition: "dispatch",
        });
      }
      if (input === `/api/actions/${action.id}/submission`) {
        submissionPosts += 1;
        expect(JSON.parse(String(init?.body))).toEqual({ userOperationHash });
        return Response.json({
          operation: storedMoneyAction(action, "failed", { userOperationHash }),
        });
      }
      throw new Error(`unexpected capacity-race request: ${String(input)}`);
    };
    render(
      <SessionHarness
        sdk={baseSdk({
          sendUserOperation: async () => {
            walletDispatches += 1;
            sendEntered.resolve();
            return providerReturn.promise;
          },
          getUserOperation: async () => {
            providerLookups += 1;
            throw new Error("terminal capacity recovery must not query the provider");
          },
        })}
        sessionFetch={sessionFetch}
        moneyAction={action}
        providerHandleJournalStorage={storage}
        providerHandleJournalLock={lock}
      />,
    );
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));
    fireEvent.click(page().getByRole("button", { name: "Probe money action" }));
    await sendEntered.promise;

    const winner = new ProviderHandleJournal({ storage, lock });
    const winnerCapture = winner.retain({ ...action, id: "323e4567-e89b-42d3-a456-426614174001" }, {
      kind: "user-operation-hash",
      provider: "cdp-embedded",
      value: `0x${"a".repeat(64)}`,
    });
    expect(await winner.persist(winnerCapture.entry!)).toMatchObject({ retained: true, persisted: true });
    expect(storage.length).toBe(32);
    providerReturn.resolve({ userOperationHash });

    await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("failed"));
    expect(walletDispatches).toBe(1);
    expect(claims).toBe(1);
    expect(submissionPosts).toBe(1);
    expect(providerLookups).toBe(0);
    expect(storage.length).toBe(32);
  });

  test("fails closed after a true reset when the same owner/action journal binding changed", async () => {
    const action = preparedMoneyAction("cdp-embedded", "2026-12-08T05:20:00.000Z");
    const storage = new TestJournalStorage();
    const lock = new TestJournalLock();
    const stale = new ProviderHandleJournal({ storage, lock });
    const staleCapture = stale.retain({ ...action, reviewHash: "d".repeat(64) }, {
      kind: "user-operation-hash",
      provider: "cdp-embedded",
      value: `0x${"d".repeat(64)}`,
    });
    expect((await stale.persist(staleCapture.entry!)).persisted).toBe(true);

    let claims = 0;
    let walletDispatches = 0;
    let portfolioReads = 0;
    const sessionFetch: SessionFetch = async (input) => {
      if (input === "/api/session") return sessionResponse(sessionFor("subject-a", ADDRESS_A));
      if (input === `/api/actions/${action.id}`) {
        return Response.json({ operation: storedMoneyAction(action, "prepared") });
      }
      if (input === `/api/actions/${action.id}/claim`) claims += 1;
      if (input === "/api/portfolio") portfolioReads += 1;
      throw new Error(`binding conflict must stop before request: ${String(input)}`);
    };
    render(
      <SessionHarness
        sdk={baseSdk({
          sendUserOperation: async () => {
            walletDispatches += 1;
            return { userOperationHash: `0x${"e".repeat(64)}` };
          },
        })}
        sessionFetch={sessionFetch}
        moneyAction={action}
        providerHandleJournalStorage={storage}
        providerHandleJournalLock={lock}
      />,
    );
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));
    fireEvent.click(page().getByRole("button", { name: "Probe money action" }));
    await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("prepared"));
    expect(claims).toBe(0);
    expect(walletDispatches).toBe(0);
    expect(portfolioReads).toBe(0);
    expect(storage.length).toBe(1);
  });

  test("retains the original owner binding across an account switch and uploads only after switching back", async () => {
    const action = preparedMoneyAction("cdp-embedded", "2026-12-08T05:20:00.000Z");
    const userOperationHash = `0x${"e".repeat(64)}` as const;
    const storage = new TestJournalStorage();
    const lock = new TestJournalLock();
    const providerReturn = deferred<{ userOperationHash: `0x${string}` }>();
    const sendEntered = deferred<void>();
    let accessToken = "token-a";
    let claims = 0;
    let walletDispatches = 0;
    let submissionPosts = 0;
    let providerLookups = 0;
    const sdk = baseSdk({
      getAccessToken: async () => accessToken,
      sendUserOperation: async () => {
        walletDispatches += 1;
        sendEntered.resolve();
        return providerReturn.promise;
      },
      getUserOperation: async () => {
        providerLookups += 1;
        throw new Error("terminal switch-back recovery must not query the provider");
      },
    });
    const sessionFetch: SessionFetch = async (input, init) => {
      if (input === "/api/session") {
        const token = new Headers(init?.headers).get("Authorization");
        return token === "Bearer token-b"
          ? sessionResponse(sessionFor("subject-b", ADDRESS_B))
          : sessionResponse(sessionFor("subject-a", ADDRESS_A));
      }
      if (input === "/api/portfolio") return portfolioResponse(ADDRESS_A);
      if (input === `/api/actions/${action.id}`) {
        return Response.json({ operation: storedMoneyAction(action, claims === 0 ? "prepared" : "submitting") });
      }
      if (input === `/api/actions/${action.id}/claim`) {
        claims += 1;
        return Response.json({
          action,
          operation: storedMoneyAction(action, "submitting"),
          disposition: "dispatch",
        });
      }
      if (input === `/api/actions/${action.id}/submission`) {
        submissionPosts += 1;
        expect(JSON.parse(String(init?.body))).toEqual({ userOperationHash });
        return Response.json({
          operation: storedMoneyAction(action, "failed", { userOperationHash }),
        });
      }
      throw new Error(`unexpected switch-back journal request: ${String(input)}`);
    };

    const view = render(
      <SessionHarness
        sdk={sdk}
        sessionFetch={sessionFetch}
        moneyAction={action}
        providerHandleJournalStorage={storage}
        providerHandleJournalLock={lock}
      />,
    );
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));
    fireEvent.click(page().getByRole("button", { name: "Probe money action" }));
    await sendEntered.promise;

    accessToken = "token-b";
    view.rerender(
      <SessionHarness
        sdk={{ ...sdk, ownerKey: OWNER_B }}
        sessionFetch={sessionFetch}
        moneyAction={action}
        providerHandleJournalStorage={storage}
        providerHandleJournalLock={lock}
      />,
    );
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_B));
    providerReturn.resolve({ userOperationHash });
    await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("error:stale-session"));
    expect(storage.length).toBe(1);
    expect(submissionPosts).toBe(0);

    accessToken = "token-a";
    view.rerender(
      <SessionHarness
        sdk={sdk}
        sessionFetch={sessionFetch}
        moneyAction={action}
        providerHandleJournalStorage={storage}
        providerHandleJournalLock={lock}
      />,
    );
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));
    fireEvent.click(page().getByRole("button", { name: "Check money action" }));
    await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("failed"));
    expect(walletDispatches).toBe(1);
    expect(claims).toBe(1);
    expect(submissionPosts).toBe(1);
    expect(providerLookups).toBe(0);
    expect(storage.length).toBe(0);
  });

  test("journals a mixed-case Base handle before upload and recovers the exact bytes without wallet_sendCalls replay", async () => {
    window.sessionStorage.setItem("home:account-provider", "base-account");
    const action = preparedMoneyAction("base-account", "2026-12-08T05:20:00.000Z");
    const submissionId = "0xAbCdEf-MiXeD-Provider-ID";
    const storage = new TestJournalStorage();
    const lock = new TestJournalLock();
    let walletDispatches = 0;
    let claims = 0;
    let submissionPosts = 0;
    let providerLookups = 0;
    const connection = connectedBaseAccount({
      sendCalls: async () => {
        walletDispatches += 1;
        return submissionId;
      },
      getCallsStatus: async () => {
        providerLookups += 1;
        return { status: "pending" };
      },
    });
    const sessionFetch: SessionFetch = async (input, init) => {
      if (input === "/api/session") return sessionResponse(sessionFor("subject-a", ADDRESS_A, "base-account"));
      if (input === "/api/portfolio") return portfolioResponse(ADDRESS_A);
      if (input === `/api/actions/${action.id}`) {
        return Response.json({ operation: storedMoneyAction(action, claims === 0 ? "prepared" : "submitting") });
      }
      if (input === `/api/actions/${action.id}/claim`) {
        claims += 1;
        return Response.json({
          action,
          operation: storedMoneyAction(action, "submitting"),
          disposition: "dispatch",
        });
      }
      if (input === `/api/actions/${action.id}/submission`) {
        submissionPosts += 1;
        const persisted = [...storage.values.values()].map((raw) => JSON.parse(raw));
        expect(persisted[0]?.handle).toEqual({
          kind: "submission-id",
          provider: "base-account",
          value: submissionId,
        });
        expect(JSON.parse(String(init?.body))).toEqual({ submissionId });
        if (submissionPosts === 1) {
          return Response.json({ error: { code: "TEMPORARY", message: "try later" } }, { status: 503 });
        }
        return Response.json({
          operation: storedMoneyAction(action, "failed", { submissionId }),
        });
      }
      throw new Error(`unexpected Base journal request: ${String(input)}`);
    };
    const sdk = baseSdk();
    const first = render(
      <SessionHarness
        sdk={sdk}
        sessionFetch={sessionFetch}
        baseAccountEnabled
        baseAccountRestorer={async () => connection}
        moneyAction={action}
        providerHandleJournalStorage={storage}
        providerHandleJournalLock={lock}
      />,
    );
    await waitFor(() => expect(page().getByTestId("provider").textContent).toBe("base-account"));
    fireEvent.click(page().getByRole("button", { name: "Probe money action" }));
    await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("error:submission-unknown"));
    expect(walletDispatches).toBe(1);
    expect(storage.length).toBe(1);
    first.unmount();

    render(
      <SessionHarness
        sdk={sdk}
        sessionFetch={sessionFetch}
        baseAccountEnabled
        baseAccountRestorer={async () => connection}
        moneyAction={action}
        providerHandleJournalStorage={storage}
        providerHandleJournalLock={lock}
      />,
    );
    await waitFor(() => expect(page().getByTestId("provider").textContent).toBe("base-account"));
    fireEvent.click(page().getByRole("button", { name: "Check money action" }));
    await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("failed"));
    expect(walletDispatches).toBe(1);
    expect(claims).toBe(1);
    expect(submissionPosts).toBe(2);
    expect(providerLookups).toBe(0);
    expect(storage.length).toBe(0);
  });

  test("uses the verified embedded smart account, fresh integer balance, and a complete user-operation receipt", async () => {
    const hash = `0x${"ab".repeat(32)}` as `0x${string}`;
    const userOperationHash = `0x${"cd".repeat(32)}` as `0x${string}`;
    const sent: unknown[] = [];
    let receiptChecks = 0;
    const sdk = baseSdk({
      sendUserOperation: async (options) => {
        sent.push(options);
        return { userOperationHash };
      },
      getUserOperation: async (options) => {
        receiptChecks += 1;
        expect(options).toEqual({
          userOperationHash,
          evmSmartAccount: ADDRESS_A,
          network: "base",
        });
        return { status: "complete", transactionHash: hash } as never;
      },
    });
    const sessionFetch: SessionFetch = async (input) => {
      if (input === "/api/session") {
        return sessionResponse(sessionFor("subject-a", ADDRESS_A));
      }
      if (input === "/api/portfolio") {
        return portfolioResponse(ADDRESS_A);
      }
      return Response.json({
        status: "confirmed",
        transactionHash: hash,
        blockNumber: "16",
        success: true,
      });
    };
    render(<SessionHarness sdk={sdk} sessionFetch={sessionFetch} />);
    await waitFor(() =>
      expect(page().getByTestId("address").textContent).toBe(ADDRESS_A),
    );

    fireEvent.click(page().getByRole("button", { name: "Probe transfer" }));
    await waitFor(() => expect(receiptChecks).toBe(1));
    expect(sent).toEqual([
      {
        evmSmartAccount: ADDRESS_A,
        network: "base",
        idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
        calls: [
          {
            to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            value: BigInt(0),
            data: `0xa9059cbb${ADDRESS_B.slice(2).padStart(64, "0")}${BigInt(1000001)
              .toString(16)
              .padStart(64, "0")}`,
          },
        ],
      },
    ]);
  });

  test("retains an ambiguous submission at the account boundary and never dispatches it again", async () => {
    let sends = 0;
    const sessionFetch: SessionFetch = async (input) =>
      input === "/api/session"
        ? sessionResponse(sessionFor("subject-a", ADDRESS_A))
        : portfolioResponse(ADDRESS_A);
    render(
      <SessionHarness
        sdk={baseSdk({
          sendUserOperation: async () => {
            sends += 1;
            throw new Error("ambiguous transport failure");
          },
          getUserOperation: async () => {
            throw new Error("must not poll without a handle");
          },
        })}
        sessionFetch={sessionFetch}
      />,
    );
    await waitFor(() =>
      expect(page().getByTestId("address").textContent).toBe(ADDRESS_A),
    );

    fireEvent.click(page().getByRole("button", { name: "Probe transfer" }));
    await waitFor(() =>
      expect(page().getByTestId("pending-transfer").textContent).toBe("unknown"),
    );
    fireEvent.click(page().getByRole("button", { name: "Probe transfer" }));
    fireEvent.click(page().getByRole("button", { name: "Check transfer" }));
    await act(async () => Promise.resolve());
    expect(sends).toBe(1);
    expect(page().getByTestId("pending-transfer").textContent).toBe("unknown");
  });

  test("retries transient polling and a complete result without a transaction hash without resubmitting", async () => {
    const transactionHash = `0x${"ef".repeat(32)}` as `0x${string}`;
    const userOperationHash = `0x${"cd".repeat(32)}` as `0x${string}`;
    let sends = 0;
    let polls = 0;
    const sessionFetch: SessionFetch = async (input) => {
      if (input === "/api/session") {
        return sessionResponse(sessionFor("subject-a", ADDRESS_A));
      }
      if (input === "/api/portfolio") return portfolioResponse(ADDRESS_A);
      return Response.json({
        status: "confirmed",
        transactionHash,
        blockNumber: "17",
        success: true,
      });
    };
    render(
      <SessionHarness
        sdk={baseSdk({
          sendUserOperation: async () => {
            sends += 1;
            return { userOperationHash };
          },
          getUserOperation: async () => {
            polls += 1;
            if (polls === 1) throw new Error("temporary poll failure");
            if (polls === 2) return { status: "complete" } as never;
            return { status: "complete", transactionHash } as never;
          },
        })}
        sessionFetch={sessionFetch}
      />,
    );
    await waitFor(() =>
      expect(page().getByTestId("address").textContent).toBe(ADDRESS_A),
    );
    fireEvent.click(page().getByRole("button", { name: "Probe transfer" }));
    await waitFor(() => expect(polls).toBe(3), { timeout: 6_000 });
    await waitFor(() =>
      expect(page().getByTestId("pending-transfer").textContent).toBe("none"),
    );
    expect(sends).toBe(1);
  });

  test("keeps a dropped user operation unresolved instead of implying that resend is safe", async () => {
    const userOperationHash = `0x${"cd".repeat(32)}` as `0x${string}`;
    let sends = 0;
    const sessionFetch: SessionFetch = async (input) =>
      input === "/api/session"
        ? sessionResponse(sessionFor("subject-a", ADDRESS_A))
        : portfolioResponse(ADDRESS_A);
    render(
      <SessionHarness
        sdk={baseSdk({
          sendUserOperation: async () => {
            sends += 1;
            return { userOperationHash };
          },
          getUserOperation: async () => ({ status: "dropped" }) as never,
        })}
        sessionFetch={sessionFetch}
      />,
    );
    await waitFor(() =>
      expect(page().getByTestId("address").textContent).toBe(ADDRESS_A),
    );
    fireEvent.click(page().getByRole("button", { name: "Probe transfer" }));
    await waitFor(() =>
      expect(page().getByTestId("pending-transfer").textContent).toBe("unknown"),
    );
    expect(sends).toBe(1);
  });

  test("executes a Base Account transfer only through the verified connection and waits for the authenticated receipt", async () => {
    const transactionHash = `0x${"ef".repeat(32)}` as `0x${string}`;
    const sentCalls: unknown[] = [];
    const receiptRequests: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    const connection = connectedBaseAccount({
      sendTransaction: async (call) => {
        sentCalls.push(call);
        return transactionHash;
      },
    });
    const signedOutSdk = baseSdk({ isSignedIn: false, ownerKey: null });
    const sessionFetch: SessionFetch = async (input, init) => {
      if (input === "/api/session") {
        return sessionResponse(
          sessionFor("siwe-subject", ADDRESS_A, "base-account"),
        );
      }
      if (input === "/api/portfolio") {
        return portfolioResponse(ADDRESS_A);
      }
      receiptRequests.push({ input, init });
      if (receiptRequests.length === 1) {
        return Response.json(
          { error: { code: "RECEIPT_UNAVAILABLE" } },
          { status: 502 },
        );
      }
      return Response.json({
        status: "confirmed",
        transactionHash,
        blockNumber: "17",
        success: true,
      });
    };
    const view = render(
      <SessionHarness
        sdk={signedOutSdk}
        sessionFetch={sessionFetch}
        baseAccountEnabled
        baseAccountConnector={async () => connection}
      />,
    );
    fireEvent.click(page().getByRole("button", { name: "Probe Base sign in" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    view.rerender(
      <SessionHarness
        sdk={{ ...signedOutSdk, isSignedIn: true, ownerKey: OWNER_A }}
        sessionFetch={sessionFetch}
        baseAccountEnabled
        baseAccountConnector={async () => connection}
      />,
    );
    await waitFor(() =>
      expect(page().getByTestId("address").textContent).toBe(ADDRESS_A),
    );

    fireEvent.click(page().getByRole("button", { name: "Probe transfer" }));
    await waitFor(() => expect(receiptRequests).toHaveLength(2), { timeout: 4_000 });
    expect(sentCalls).toEqual([
      {
        to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        value: BigInt(0),
        data: `0xa9059cbb${ADDRESS_B.slice(2).padStart(64, "0")}${BigInt(1000001)
          .toString(16)
          .padStart(64, "0")}`,
      },
    ]);
    expect(receiptRequests[0]?.input).toBe(
      `/api/transfer-receipt?hash=${transactionHash}`,
    );
    expect(
      new Headers(receiptRequests[0]?.init?.headers).get(
        ACCOUNT_PROVIDER_HEADER,
      ),
    ).toBe("base-account");
  });

  test("retains an ambiguous Base Account submission without a hash and never reopens eth_sendTransaction", async () => {
    let sendCalls = 0;
    const connection = connectedBaseAccount({
      sendTransaction: async () => {
        sendCalls += 1;
        throw new Error("provider disconnected after dispatch");
      },
    });
    const signedOutSdk = baseSdk({ isSignedIn: false, ownerKey: null });
    const sessionFetch: SessionFetch = async (input) =>
      input === "/api/session"
        ? sessionResponse(sessionFor("siwe-subject", ADDRESS_A, "base-account"))
        : portfolioResponse(ADDRESS_A);
    const view = render(
      <SessionHarness
        sdk={signedOutSdk}
        sessionFetch={sessionFetch}
        baseAccountEnabled
        baseAccountConnector={async () => connection}
      />,
    );
    fireEvent.click(page().getByRole("button", { name: "Probe Base sign in" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    view.rerender(
      <SessionHarness
        sdk={{ ...signedOutSdk, isSignedIn: true, ownerKey: OWNER_A }}
        sessionFetch={sessionFetch}
        baseAccountEnabled
        baseAccountConnector={async () => connection}
      />,
    );
    await waitFor(() =>
      expect(page().getByTestId("address").textContent).toBe(ADDRESS_A),
    );
    fireEvent.click(page().getByRole("button", { name: "Probe transfer" }));
    await waitFor(() =>
      expect(page().getByTestId("pending-transfer").textContent).toBe("unknown"),
    );
    fireEvent.click(page().getByRole("button", { name: "Probe transfer" }));
    fireEvent.click(page().getByRole("button", { name: "Check transfer" }));
    await act(async () => Promise.resolve());
    expect(sendCalls).toBe(1);
  });

  test("invalidates the transfer boundary before signing when the owner changes during the fresh balance read", async () => {
    const pendingPortfolio = deferred<Response>();
    let sendCalls = 0;
    const stableSdk = baseSdk({
      sendUserOperation: async () => {
        sendCalls += 1;
        return { userOperationHash: `0x${"ab".repeat(32)}` };
      },
      getUserOperation: async () =>
        ({ status: "complete", transactionHash: `0x${"cd".repeat(32)}` }) as never,
    });
    const sessionFetch: SessionFetch = async (input, init) => {
      if (input === "/api/session") {
        const token = new Headers(init?.headers).get("Authorization");
        return token === "Bearer token-b"
          ? sessionResponse(sessionFor("subject-b", ADDRESS_B))
          : sessionResponse(sessionFor("subject-a", ADDRESS_A));
      }
      return pendingPortfolio.promise;
    };
    let accessToken = "token-a";
    const sdkA = { ...stableSdk, getAccessToken: async () => accessToken };
    const view = render(<SessionHarness sdk={sdkA} sessionFetch={sessionFetch} />);
    await waitFor(() =>
      expect(page().getByTestId("address").textContent).toBe(ADDRESS_A),
    );
    fireEvent.click(page().getByRole("button", { name: "Probe transfer" }));

    accessToken = "token-b";
    view.rerender(
      <SessionHarness
        sdk={{ ...sdkA, ownerKey: OWNER_B }}
        sessionFetch={sessionFetch}
      />,
    );
    await waitFor(() =>
      expect(page().getByTestId("address").textContent).toBe(ADDRESS_B),
    );
    await act(async () => {
      pendingPortfolio.resolve(portfolioResponse(ADDRESS_A));
      await pendingPortfolio.promise;
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(sendCalls).toBe(0);
  });

  test("is inert when the public project configuration is missing", async () => {
    render(
      <CdpAccountProvider projectId={null}>
        <AccountProbe />
      </CdpAccountProvider>,
    );

    expect(page().getByTestId("status").textContent).toBe("signed-out");
    expect(page().getByTestId("availability").textContent).toBe("unconfigured");
    expect(page().getByTestId("configured").textContent).toBe("false");
    expect(page().getByTestId("address").textContent).toBe(
      "private-details-hidden",
    );
    fireEvent.click(page().getByRole("button", { name: "Probe sign out" }));
    expect(page().getByTestId("status").textContent).toBe("signed-out");
  });

  test("wipes presentation balance cache but preserves unacknowledged provider evidence on sign-out", async () => {
    window.localStorage.setItem("home.balances.v1:subject-a:0x1111:US", "{}");
    window.localStorage.setItem("home.balances.v1:other", "{}");
    window.localStorage.setItem("home.country.v1", "US");
    const journalAction = preparedMoneyAction("cdp-embedded", "2026-12-08T05:20:00.000Z");
    const journal = new ProviderHandleJournal({
      storage: window.localStorage,
      lock: new TestJournalLock(),
    });
    const captured = journal.retain(journalAction, {
      kind: "user-operation-hash",
      provider: "cdp-embedded",
      value: `0x${"9".repeat(64)}`,
    });
    expect((await journal.persist(captured.entry!)).persisted).toBe(true);
    const journalKey = Object.keys(window.localStorage).find((key) =>
      key.startsWith("home:money-action-provider-handle:v1:"),
    );
    expect(journalKey).toBeDefined();

    render(
      <SessionHarness
        sdk={baseSdk()}
        sessionFetch={async () => sessionResponse(sessionFor("subject-a", ADDRESS_A))}
      />,
    );
    await waitFor(() =>
      expect(page().getByTestId("address").textContent).toBe(ADDRESS_A),
    );

    fireEvent.click(page().getByRole("button", { name: "Probe sign out" }));
    await waitFor(() =>
      expect(page().getByTestId("status").textContent).toBe("signed-out"),
    );
    expect(
      Object.keys(window.localStorage).filter((key) =>
        key.startsWith("home.balances.v1:"),
      ),
    ).toEqual([]);
    expect(window.localStorage.getItem("home.country.v1")).toBe("US");
    expect(window.localStorage.getItem(journalKey!)).not.toBeNull();
  });

  test("keeps a configured-but-down provider distinct from missing project ID", () => {
    const unconfigured = createBlockedAccountWalletClient("unconfigured");
    const providerDown = createBlockedAccountWalletClient(
      "provider-unavailable",
    );

    expect(unconfigured.projectConfigured).toBe(false);
    expect(unconfigured.signInAvailability).toBe("unconfigured");
    expect(unconfigured.message).toBeNull();
    expect(providerDown.projectConfigured).toBe(true);
    expect(providerDown.signInAvailability).toBe("provider-unavailable");
    expect(providerDown.message).toContain("Try again later");
    expect(providerDown.message).not.toContain("NEXT_PUBLIC_CDP_PROJECT_ID");
  });
});
