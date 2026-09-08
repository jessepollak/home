import "./dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { useState } from "react";
import type { AccountWalletSdkBoundary } from "./cdp-client";
import type {
  BaseAccountConnector,
  BaseAccountRestorer,
  ConnectedBaseAccount,
} from "./base-account-connector";
import type { SessionFetch, VerifiedAccountSession } from "./session-client";
import { ACCOUNT_PROVIDER_HEADER } from "./session-types";
import type { PreparedMoneyAction } from "@/features/money-actions/types";

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
const ADDRESS_A = "0x1111111111111111111111111111111111111111";
const ADDRESS_B = "0x2222222222222222222222222222222222222222";

function sessionFor(
  subject: string,
  address: typeof ADDRESS_A | typeof ADDRESS_B,
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

function portfolioResponse(address: typeof ADDRESS_A | typeof ADDRESS_B): Response {
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
      ) : null}
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
}: {
  sdk: AccountWalletSdkBoundary;
  sessionFetch: SessionFetch;
  baseAccountEnabled?: boolean;
  baseAccountConnector?: BaseAccountConnector;
  baseAccountRestorer?: BaseAccountRestorer;
  moneyAction?: PreparedMoneyAction;
}) {
  return (
    <AccountWalletSessionOwner
      sdk={sdk}
      sessionFetch={sessionFetch}
      baseAccountEnabled={baseAccountEnabled}
      baseAccountConnector={baseAccountConnector}
      baseAccountRestorer={baseAccountRestorer}
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
      await waitFor(() => expect(embeddedClaims).toBe(1));
      now = Date.parse("2026-09-08T05:10:01.000Z");
      await act(async () => {
        pendingPortfolio.resolve(portfolioResponse(ADDRESS_A));
        await pendingPortfolio.promise;
      });
      await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("expired"));
      expect(embeddedDispatches).toBe(0);
      expect(embeddedExpirations).toBe(1);
      fireEvent.click(page().getByRole("button", { name: "Probe money action" }));
      await waitFor(() => expect(embeddedClaims).toBe(2));
      expect(embeddedDispatches).toBe(0);

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
