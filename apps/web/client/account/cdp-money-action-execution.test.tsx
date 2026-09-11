/* eslint-disable @typescript-eslint/no-unused-vars -- split suites share the centralized account harness imports. */
import { afterEach, describe, expect, test } from "bun:test";
import type { GetUserOperationResult } from "@coinbase/cdp-core";
import {
  ADDRESS_A, ADDRESS_B, ADDRESS_C, OWNER_A, OWNER_B, OWNER_C,
  AccountWalletSessionOwner, CdpAccountProvider, StrictMode, TestJournalLock, TestJournalStorage,
  act, baseSdk, cleanup, connectedBaseAccount, createBlockedAccountWalletClient, deferred,
  embeddedObservation, fireEvent, page, portfolioResponse, preparedMoneyAction, render,
  sdkObservation, sessionFor, sessionResponse, storedMoneyAction, waitFor, SessionHarness,
  BASE_CHAIN_ID,
  type AccountWalletClient, type AccountWalletSdkBoundary, type PreparedMoneyAction, type SessionFetch, type VerifiedAccountSession,
} from "./cdp-client-test-harness";
import { BaseAccountConnectorError, type BaseAccountConnector, type BaseAccountRestorer } from "./base-account-connector";
import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";
import { ProviderHandleJournal } from "@/client/money-actions/provider-handle-journal";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("money-action execution and authenticated transport", () => {
  test("rejects a paused authenticated request after failed logout without sending HTTP", async () => {
    const pausedToken = deferred<string | null>();
    let tokenCalls = 0;
    let resourceHttpCalls = 0;
    let latestClient: AccountWalletClient | null = null;
    let retainedClient: AccountWalletClient | null = null;
    const sdk = baseSdk({
      getAccessToken: async () => {
        tokenCalls += 1;
        return tokenCalls === 1 ? "token-a" : pausedToken.promise;
      },
      signOut: async () => {
        throw new Error("fixture logout failed");
      },
    });
    const sessionFetch: SessionFetch = async (input) => {
      if (input === "/api/session") {
        return sessionResponse(sessionFor("subject-a", ADDRESS_A));
      }
      resourceHttpCalls += 1;
      return Response.json({ private: true });
    };

    render(
      <SessionHarness
        sdk={sdk}
        sessionFetch={sessionFetch}
        onClient={(client) => {
          latestClient = client;
          if (client.session && !retainedClient) retainedClient = client;
        }}
      />,
    );
    await waitFor(() =>
      expect(retainedClient?.session?.user.subject).toBe("subject-a"),
    );

    const request = retainedClient!.fetchAccountResource(
      "/api/savings/actions/prepare",
      { method: "POST", body: { amountBaseUnits: "1000000" } },
    );
    await waitFor(() => expect(tokenCalls).toBe(2));
    await act(async () => {
      await latestClient!.signOut().catch(() => {});
    });
    pausedToken.resolve("token-a");

    await expect(request).rejects.toMatchObject({ reason: "stale-session" });
    expect(resourceHttpCalls).toBe(0);
  });

  test("rejects owner A's retained authenticated callback after owner B verifies without sending HTTP", async () => {
    let activeToken = "token-a";
    let resourceHttpCalls = 0;
    let retainedOwnerAClient: AccountWalletClient | null = null;
    const sdk = baseSdk({ getAccessToken: async () => activeToken });
    const sessionFetch: SessionFetch = async (input, init) => {
      if (input === "/api/session") {
        const authorization = new Headers(init?.headers).get("Authorization");
        return authorization === "Bearer token-b"
          ? sessionResponse(sessionFor("subject-b", ADDRESS_B))
          : sessionResponse(sessionFor("subject-a", ADDRESS_A));
      }
      resourceHttpCalls += 1;
      return Response.json({ owner: activeToken });
    };
    const view = render(
      <SessionHarness
        sdk={sdk}
        sessionFetch={sessionFetch}
        onClient={(client) => {
          if (client.session?.user.subject === "subject-a" && !retainedOwnerAClient) {
            retainedOwnerAClient = client;
          }
        }}
      />,
    );
    await waitFor(() =>
      expect(retainedOwnerAClient?.session?.user.subject).toBe("subject-a"),
    );

    activeToken = "token-b";
    view.rerender(
      <SessionHarness
        sdk={{ ...sdk, ownerKey: OWNER_B }}
        sessionFetch={sessionFetch}
      />,
    );
    await waitFor(() =>
      expect(page().getByTestId("address").textContent).toBe(ADDRESS_B),
    );

    await expect(
      retainedOwnerAClient!.fetchAccountResource("/api/actions/operations"),
    ).rejects.toMatchObject({ reason: "stale-session" });
    expect(resourceHttpCalls).toBe(0);
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
          getUserOperation: async () =>
            embeddedObservation(action, userOperationHash, transactionHash),
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

  test("rejects malformed or mismatched CDP recovery observations before candidate upload or receipt polling", async () => {
    const userOperationHash = `0x${"cd".repeat(32)}` as `0x${string}`;
    const transactionHash = `0x${"ef".repeat(32)}` as `0x${string}`;
    const otherUserOperationHash = `0x${"ab".repeat(32)}` as `0x${string}`;
    const mutations: Array<(action: PreparedMoneyAction) => unknown> = [
      (action) => embeddedObservation(action, userOperationHash, transactionHash, { userOpHash: otherUserOperationHash }),
      (action) => embeddedObservation(action, userOperationHash, transactionHash, { network: "base-sepolia" }),
      (action) => embeddedObservation(action, userOperationHash, transactionHash, { status: "confirmed" as never }),
      (action) => embeddedObservation(action, userOperationHash, transactionHash, { calls: [{ to: ADDRESS_A, data: "0x1234", value: "0" }] }),
      (action) => embeddedObservation(action, userOperationHash, transactionHash, { transactionHash: "not-a-hash" }),
      (action) => embeddedObservation(action, userOperationHash, transactionHash, { receipts: [{ revert: { data: "bad", message: "reverted" } }] }),
      (action) => embeddedObservation(action, userOperationHash, transactionHash, { calls: [{ to: ADDRESS_B, data: "0x5678", value: "0" }] }),
    ];

    for (const [index, mutate] of mutations.entries()) {
      const action: PreparedMoneyAction = index === mutations.length - 1
        ? {
          ...preparedMoneyAction("cdp-embedded", "2026-12-08T05:20:00.000Z"),
          sensitivePayload: true,
          calls: [{
            to: ADDRESS_B as `0x${string}`,
            value: "0",
            data: "0x1234",
            dataHash: "5a0737e8cbcfa24dcc118b0ab1e6d98bee17c57daa8a1686024159aae707ed6f",
          }],
        }
        : preparedMoneyAction("cdp-embedded", "2026-12-08T05:20:00.000Z");
      let submissionPosts = 0;
      let receiptReads = 0;
      let claims = 0;
      let walletSubmissions = 0;
      const sessionFetch: SessionFetch = async (input) => {
        if (input === "/api/session") return sessionResponse(sessionFor("subject-a", ADDRESS_A));
        if (input === `/api/actions/${action.id}`) {
          return Response.json({ operation: storedMoneyAction(action, "submitted", { userOperationHash }) });
        }
        if (input === `/api/actions/${action.id}/submission`) submissionPosts += 1;
        if (String(input).startsWith("/api/transfer-receipt?")) receiptReads += 1;
        if (input === `/api/actions/${action.id}/claim`) claims += 1;
        throw new Error(`unexpected invalid observation request: ${String(input)}`);
      };
      render(
        <SessionHarness
          sdk={baseSdk({
            sendUserOperation: async () => {
              walletSubmissions += 1;
              return { userOperationHash };
            },
            getUserOperation: async () => mutate(action) as never,
          })}
          sessionFetch={sessionFetch}
          moneyAction={action}
        />,
      );
      await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));
      fireEvent.click(page().getByRole("button", { name: "Check money action" }));
      await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("error:submission-unknown"));
      expect({ submissionPosts, receiptReads, claims, walletSubmissions }).toEqual({
        submissionPosts: 0,
        receiptReads: 0,
        claims: 0,
        walletSubmissions: 0,
      });
      cleanup();
      window.sessionStorage.clear();
    }
  });

  test("accepts only exact SDK decimal call-value strings during CDP recovery", async () => {
    const action: PreparedMoneyAction = {
      ...preparedMoneyAction("cdp-embedded", "2026-12-08T05:20:00.000Z"),
      calls: [{ to: ADDRESS_B, data: "0x1234", value: "9007199254740993" }],
    };
    const userOperationHash = `0x${"cd".repeat(32)}` as `0x${string}`;
    const transactionHash = `0x${"ef".repeat(32)}` as `0x${string}`;

    async function checkObservation(
      observation: GetUserOperationResult,
      expectedStatus: "confirmed" | "error:submission-unknown",
      expectedSubmissionPosts: number,
    ) {
      let submissionPosts = 0;
      let receiptReads = 0;
      let walletSubmissions = 0;
      const sessionFetch: SessionFetch = async (input) => {
        if (input === "/api/session") return sessionResponse(sessionFor("subject-a", ADDRESS_A));
        if (input === `/api/actions/${action.id}`) {
          return Response.json({ operation: storedMoneyAction(action, "submitted", { userOperationHash }) });
        }
        if (input === `/api/actions/${action.id}/submission`) {
          submissionPosts += 1;
          return Response.json({
            operation: storedMoneyAction(action, "confirmed", { userOperationHash, transactionHash }),
          });
        }
        if (String(input).startsWith("/api/transfer-receipt?")) receiptReads += 1;
        throw new Error(`unexpected call-value observation request: ${String(input)}`);
      };
      render(
        <SessionHarness
          sdk={baseSdk({
            sendUserOperation: async () => {
              walletSubmissions += 1;
              return { userOperationHash };
            },
            getUserOperation: async () => observation,
          })}
          sessionFetch={sessionFetch}
          moneyAction={action}
        />,
      );
      await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));
      fireEvent.click(page().getByRole("button", { name: "Check money action" }));
      await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe(expectedStatus));
      expect({ submissionPosts, receiptReads, walletSubmissions }).toEqual({
        submissionPosts: expectedSubmissionPosts,
        receiptReads: 0,
        walletSubmissions: 0,
      });
      cleanup();
      window.sessionStorage.clear();
    }

    await checkObservation(
      embeddedObservation(action, userOperationHash, transactionHash),
      "confirmed",
      1,
    );

    for (const value of [
      "",
      "-1",
      "1.0",
      "1e3",
      "09007199254740993",
      "+9007199254740993",
      "0x20000000000001",
      "9007199254740994",
    ]) {
      await checkObservation(
        embeddedObservation(action, userOperationHash, transactionHash, {
          calls: [{ to: ADDRESS_B, data: "0x1234", value }],
        }),
        "error:submission-unknown",
        0,
      );
    }

    for (const value of [undefined, 0, Number.MAX_SAFE_INTEGER + 1, BigInt("9007199254740993")]) {
      await checkObservation(
        embeddedObservation(action, userOperationHash, transactionHash, {
          calls: [{ to: ADDRESS_B, data: "0x1234", value: value as never }],
        }),
        "error:submission-unknown",
        0,
      );
    }
  });

  test("records a validated CDP transaction candidate before receipt success and then reads terminal durable state", async () => {
    const action = preparedMoneyAction("cdp-embedded", "2026-12-08T05:20:00.000Z");
    const userOperationHash = `0x${"cd".repeat(32)}` as `0x${string}`;
    const transactionHash = `0x${"ef".repeat(32)}` as `0x${string}`;
    const events: string[] = [];
    let actionReads = 0;
    let claims = 0;
    let walletSubmissions = 0;
    const sessionFetch: SessionFetch = async (input, init) => {
      if (input === "/api/session") return sessionResponse(sessionFor("subject-a", ADDRESS_A));
      if (input === `/api/actions/${action.id}`) {
        actionReads += 1;
        events.push(`read-${actionReads}`);
        return Response.json({
          operation: storedMoneyAction(
            action,
            actionReads === 1 ? "submitted" : "confirmed",
            { userOperationHash, transactionHash: actionReads === 1 ? undefined : transactionHash },
          ),
        });
      }
      if (input === `/api/actions/${action.id}/submission`) {
        events.push("candidate-upload");
        expect(JSON.parse(String(init?.body))).toEqual({ userOperationHash, transactionHash });
        return Response.json({
          operation: storedMoneyAction(action, "submitted", { userOperationHash, transactionHash }),
        });
      }
      if (String(input).startsWith("/api/transfer-receipt?")) {
        events.push("receipt");
        expect(events).toContain("candidate-upload");
        return Response.json({ status: "confirmed", transactionHash, blockNumber: "18", success: true });
      }
      if (input === `/api/actions/${action.id}/claim`) claims += 1;
      throw new Error(`unexpected candidate recovery request: ${String(input)}`);
    };
    render(
      <SessionHarness
        sdk={baseSdk({
          sendUserOperation: async () => {
            walletSubmissions += 1;
            return { userOperationHash };
          },
          getUserOperation: async () => embeddedObservation(action, userOperationHash, transactionHash),
        })}
        sessionFetch={sessionFetch}
        moneyAction={action}
      />,
    );
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));
    fireEvent.click(page().getByRole("button", { name: "Check money action" }));
    await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("confirmed"));
    expect(events).toEqual(["read-1", "candidate-upload", "receipt", "read-2"]);
    expect(claims).toBe(0);
    expect(walletSubmissions).toBe(0);
  });

  test("treats a broadcast CDP empty transaction hash as pending before a later valid candidate", async () => {
    const action = preparedMoneyAction("cdp-embedded", "2026-12-08T05:20:00.000Z");
    const userOperationHash = `0x${"cd".repeat(32)}` as `0x${string}`;
    const transactionHash = `0x${"ef".repeat(32)}` as `0x${string}`;
    const events: string[] = [];
    let actionReads = 0;
    let providerReads = 0;
    let walletSubmissions = 0;
    const sessionFetch: SessionFetch = async (input, init) => {
      if (input === "/api/session") return sessionResponse(sessionFor("subject-a", ADDRESS_A));
      if (input === `/api/actions/${action.id}`) {
        actionReads += 1;
        events.push(`read-${actionReads}`);
        return Response.json({
          operation: storedMoneyAction(
            action,
            actionReads === 1 ? "submitted" : "confirmed",
            actionReads === 1 ? { userOperationHash } : { userOperationHash, transactionHash },
          ),
        });
      }
      if (input === `/api/actions/${action.id}/submission`) {
        events.push("candidate-upload");
        expect(JSON.parse(String(init?.body))).toEqual({ userOperationHash, transactionHash });
        return Response.json({
          operation: storedMoneyAction(action, "submitted", { userOperationHash, transactionHash }),
        });
      }
      if (String(input).startsWith("/api/transfer-receipt?")) {
        events.push("receipt");
        expect(events).toContain("candidate-upload");
        return Response.json({ status: "confirmed", transactionHash, blockNumber: "18", success: true });
      }
      throw new Error(`unexpected empty-hash recovery request: ${String(input)}`);
    };
    render(
      <SessionHarness
        sdk={baseSdk({
          sendUserOperation: async () => {
            walletSubmissions += 1;
            return { userOperationHash };
          },
          getUserOperation: async () => {
            providerReads += 1;
            events.push(providerReads === 1 ? "provider-broadcast" : "provider-complete");
            return providerReads === 1
              ? embeddedObservation(action, userOperationHash, transactionHash, {
                status: "broadcast",
                transactionHash: "",
              })
              : embeddedObservation(action, userOperationHash, transactionHash);
          },
        })}
        sessionFetch={sessionFetch}
        moneyAction={action}
      />,
    );
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));
    fireEvent.click(page().getByRole("button", { name: "Check money action" }));
    await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("confirmed"), {
      timeout: 3_000,
    });
    expect(events).toEqual([
      "read-1",
      "provider-broadcast",
      "provider-complete",
      "candidate-upload",
      "receipt",
      "read-2",
    ]);
    expect(providerReads).toBe(2);
    expect(walletSubmissions).toBe(0);
  });

  test("accepts one bounded 409 candidate race only after an exact canonical reread", async () => {
    const action = preparedMoneyAction("cdp-embedded", "2026-12-08T05:20:00.000Z");
    const userOperationHash = `0x${"cd".repeat(32)}` as `0x${string}`;
    const transactionHash = `0x${"ef".repeat(32)}` as `0x${string}`;
    let reads = 0;
    let posts = 0;
    let receiptReads = 0;
    const sessionFetch: SessionFetch = async (input) => {
      if (input === "/api/session") return sessionResponse(sessionFor("subject-a", ADDRESS_A));
      if (input === `/api/actions/${action.id}`) {
        reads += 1;
        const status = reads === 3 ? "confirmed" : "submitted";
        const references = reads === 1 ? { userOperationHash } : { userOperationHash, transactionHash };
        return Response.json({ operation: storedMoneyAction(action, status, references) });
      }
      if (input === `/api/actions/${action.id}/submission`) {
        posts += 1;
        return Response.json({ error: { code: "ACTION_NOT_CLAIMED", message: "race" } }, { status: 409 });
      }
      if (String(input).startsWith("/api/transfer-receipt?")) {
        receiptReads += 1;
        return Response.json({ status: "confirmed", transactionHash, blockNumber: "19", success: true });
      }
      throw new Error(`unexpected 409 recovery request: ${String(input)}`);
    };
    render(
      <SessionHarness
        sdk={baseSdk({
          getUserOperation: async () => embeddedObservation(action, userOperationHash, transactionHash),
        })}
        sessionFetch={sessionFetch}
        moneyAction={action}
      />,
    );
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));
    fireEvent.click(page().getByRole("button", { name: "Check money action" }));
    await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("confirmed"));
    expect({ reads, posts, receiptReads }).toEqual({ reads: 3, posts: 1, receiptReads: 1 });
  });

  test("returns failed durable execution from candidate acknowledgment without receipt polling or redispatch", async () => {
    const action = preparedMoneyAction("cdp-embedded", "2026-12-08T05:20:00.000Z");
    const userOperationHash = `0x${"cd".repeat(32)}` as `0x${string}`;
    const transactionHash = `0x${"ef".repeat(32)}` as `0x${string}`;
    let receiptReads = 0;
    let walletSubmissions = 0;
    const sessionFetch: SessionFetch = async (input) => {
      if (input === "/api/session") return sessionResponse(sessionFor("subject-a", ADDRESS_A));
      if (input === `/api/actions/${action.id}`) {
        return Response.json({ operation: storedMoneyAction(action, "submitted", { userOperationHash }) });
      }
      if (input === `/api/actions/${action.id}/submission`) {
        return Response.json({
          operation: storedMoneyAction(action, "failed", { userOperationHash, transactionHash }),
        });
      }
      if (String(input).startsWith("/api/transfer-receipt?")) receiptReads += 1;
      throw new Error(`unexpected failed recovery request: ${String(input)}`);
    };
    render(
      <SessionHarness
        sdk={baseSdk({
          sendUserOperation: async () => {
            walletSubmissions += 1;
            return { userOperationHash };
          },
          getUserOperation: async () => embeddedObservation(action, userOperationHash, transactionHash),
        })}
        sessionFetch={sessionFetch}
        moneyAction={action}
      />,
    );
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));
    fireEvent.click(page().getByRole("button", { name: "Check money action" }));
    await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("failed"));
    expect(receiptReads).toBe(0);
    expect(walletSubmissions).toBe(0);
  });

  test("reconciles an already-recorded Base submission ID through checkMoneyAction without wallet_sendCalls", async () => {
    window.sessionStorage.setItem("home:account-provider", "base-account");
    const action = preparedMoneyAction("base-account", "2026-12-08T05:20:00.000Z");
    const transactionHash = `0x${"ef".repeat(32)}` as `0x${string}`;
    let walletSubmissions = 0;
    let claims = 0;
    let actionReads = 0;
    const events: string[] = [];
    const connection = connectedBaseAccount({
      sendCalls: async () => {
        walletSubmissions += 1;
        return "base-submission";
      },
      getCallsStatus: async () => ({ status: "complete", transactionHash }),
    });
    const sessionFetch: SessionFetch = async (input, init) => {
      if (input === "/api/session") {
        return sessionResponse(sessionFor("subject-a", ADDRESS_A, "base-account"));
      }
      if (input === `/api/actions/${action.id}`) {
        actionReads += 1;
        events.push(`read-${actionReads}`);
        return Response.json({
          operation: storedMoneyAction(
            action,
            actionReads === 1 ? "submitted" : "confirmed",
            actionReads === 1
              ? { submissionId: "base-submission" }
              : { submissionId: "base-submission", transactionHash },
          ),
        });
      }
      if (String(input).startsWith("/api/transfer-receipt?")) {
        events.push("receipt");
        expect(events).toContain("candidate-upload");
        return Response.json({
          status: "confirmed",
          transactionHash,
          blockNumber: "18",
          success: true,
        });
      }
      if (input === `/api/actions/${action.id}/submission`) {
        events.push("candidate-upload");
        expect(JSON.parse(String(init?.body))).toEqual({
          submissionId: "base-submission",
          transactionHash,
        });
        return Response.json({
          operation: storedMoneyAction(action, "submitted", {
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
    expect(events).toEqual(["read-1", "candidate-upload", "receipt", "read-2"]);
  });

  test("preserves included and terminal durable progress across failed or unavailable provider observations", async () => {
    const userOperationHash = `0x${"cd".repeat(32)}` as `0x${string}`;
    const cases = [
      { provider: "cdp-embedded" as const, status: "included" as const, observation: "failed" as const },
      { provider: "cdp-embedded" as const, status: "included" as const, observation: "unavailable" as const },
      { provider: "base-account" as const, status: "included" as const, observation: "failed" as const },
      { provider: "base-account" as const, status: "included" as const, observation: "unavailable" as const },
      { provider: "cdp-embedded" as const, status: "confirmed" as const, observation: "failed" as const },
      { provider: "base-account" as const, status: "failed" as const, observation: "unavailable" as const },
    ];

    for (const testCase of cases) {
      window.sessionStorage.setItem("home:account-provider", testCase.provider);
      const action = preparedMoneyAction(testCase.provider, "2026-12-08T05:20:00.000Z");
      let providerLookups = 0;
      let statusWrites = 0;
      let claims = 0;
      let walletSubmissions = 0;
      const connection = connectedBaseAccount({
        sendCalls: async () => {
          walletSubmissions += 1;
          return "base-submission";
        },
        getCallsStatus: async () => {
          providerLookups += 1;
          if (testCase.observation === "unavailable") throw new Error("provider unavailable");
          return { status: "failed" };
        },
      });
      const sessionFetch: SessionFetch = async (input) => {
        if (input === "/api/session") {
          return sessionResponse(sessionFor("subject-a", ADDRESS_A, testCase.provider));
        }
        if (input === `/api/actions/${action.id}`) {
          return Response.json({
            operation: storedMoneyAction(
              action,
              testCase.status,
              testCase.provider === "cdp-embedded" ? { userOperationHash } : { submissionId: "base-submission" },
            ),
          });
        }
        if (input === `/api/actions/${action.id}/status`) statusWrites += 1;
        if (input === `/api/actions/${action.id}/claim`) claims += 1;
        throw new Error(`unexpected monotonic recovery request: ${String(input)}`);
      };
      render(
        <SessionHarness
          sdk={baseSdk({
            sendUserOperation: async () => {
              walletSubmissions += 1;
              return { userOperationHash };
            },
            getUserOperation: async () => {
              providerLookups += 1;
              if (testCase.observation === "unavailable") throw new Error("provider unavailable");
              return embeddedObservation(
                action,
                userOperationHash,
                `0x${"ef".repeat(32)}`,
                { status: "failed", transactionHash: undefined },
              );
            },
          })}
          sessionFetch={sessionFetch}
          baseAccountEnabled={testCase.provider === "base-account"}
          baseAccountRestorer={async () => connection}
          moneyAction={action}
        />,
      );
      await waitFor(() => expect(page().getByTestId("provider").textContent).toBe(testCase.provider));
      fireEvent.click(page().getByRole("button", { name: "Check money action" }));
      await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe(testCase.status));
      expect(statusWrites).toBe(0);
      expect(claims).toBe(0);
      expect(walletSubmissions).toBe(0);
      expect(providerLookups).toBe(testCase.status === "included" ? 1 : 0);
      cleanup();
      window.sessionStorage.clear();
    }
  });

  test("fences a delayed CDP provider-error preserved-progress fallback after the verified owner switches", async () => {
    const action = preparedMoneyAction("cdp-embedded", "2026-12-08T05:20:00.000Z");
    const userOperationHash = `0x${"cd".repeat(32)}` as `0x${string}`;
    const pendingObservation = deferred<never>();
    const observationEntered = deferred<void>();
    let accessToken = "token-a";
    let providerLookups = 0;
    let statusWrites = 0;
    let claims = 0;
    let walletSubmissions = 0;
    const sdk = baseSdk({
      getAccessToken: async () => accessToken,
      sendUserOperation: async () => {
        walletSubmissions += 1;
        return { userOperationHash };
      },
      getUserOperation: async () => {
        providerLookups += 1;
        observationEntered.resolve();
        return pendingObservation.promise;
      },
    });
    const sessionFetch: SessionFetch = async (input, init) => {
      if (input === "/api/session") {
        return new Headers(init?.headers).get("Authorization") === `Bearer token-b`
          ? sessionResponse(sessionFor("subject-b", ADDRESS_B))
          : sessionResponse(sessionFor("subject-a", ADDRESS_A));
      }
      if (input === `/api/actions/${action.id}`) {
        return Response.json({
          operation: storedMoneyAction(action, "included", { userOperationHash }),
        });
      }
      if (input === `/api/actions/${action.id}/status`) statusWrites += 1;
      if (input === `/api/actions/${action.id}/claim`) claims += 1;
      throw new Error(`unexpected delayed CDP fallback request: ${String(input)}`);
    };
    const view = render(
      <SessionHarness sdk={sdk} sessionFetch={sessionFetch} moneyAction={action} />,
    );
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));
    fireEvent.click(page().getByRole("button", { name: "Check money action" }));
    await observationEntered.promise;

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
      pendingObservation.reject(new Error("CDP provider unavailable"));
      await pendingObservation.promise.catch(() => {});
    });

    await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("error:stale-session"));
    expect({ providerLookups, statusWrites, claims, walletSubmissions }).toEqual({
      providerLookups: 1,
      statusWrites: 0,
      claims: 0,
      walletSubmissions: 0,
    });
  });

  test("fences a delayed Base provider-error preserved-progress fallback after the verified owner switches", async () => {
    window.sessionStorage.setItem("home:account-provider", "base-account");
    const action = preparedMoneyAction("base-account", "2026-12-08T05:20:00.000Z");
    const pendingObservation = deferred<never>();
    const observationEntered = deferred<void>();
    let accessToken = "token-a";
    let providerLookups = 0;
    let statusWrites = 0;
    let claims = 0;
    let walletSubmissions = 0;
    const getCallsStatus = async () => {
      providerLookups += 1;
      observationEntered.resolve();
      return pendingObservation.promise;
    };
    const sdk = baseSdk({
      getAccessToken: async () => accessToken,
    });
    const sessionFetch: SessionFetch = async (input, init) => {
      if (input === "/api/session") {
        return new Headers(init?.headers).get("Authorization") === `Bearer token-b`
          ? sessionResponse(sessionFor("subject-b", ADDRESS_B))
          : sessionResponse(sessionFor("subject-a", ADDRESS_A, "base-account"));
      }
      if (input === `/api/actions/${action.id}`) {
        return Response.json({
          operation: storedMoneyAction(action, "included", { submissionId: "base-submission" }),
        });
      }
      if (input === `/api/actions/${action.id}/status`) statusWrites += 1;
      if (input === `/api/actions/${action.id}/claim`) claims += 1;
      throw new Error(`unexpected delayed Base fallback request: ${String(input)}`);
    };
    const baseAccountRestorer: BaseAccountRestorer = async () => connectedBaseAccount({
      sendCalls: async () => {
        walletSubmissions += 1;
        return "base-submission";
      },
      getCallsStatus,
    });
    const view = render(
      <SessionHarness
        sdk={sdk}
        sessionFetch={sessionFetch}
        baseAccountEnabled
        baseAccountRestorer={baseAccountRestorer}
        moneyAction={action}
      />,
    );
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));
    fireEvent.click(page().getByRole("button", { name: "Check money action" }));
    await observationEntered.promise;

    fireEvent.click(page().getByRole("button", { name: "Probe sign out" }));
    await waitFor(() => expect(page().getByTestId("status").textContent).toBe("signed-out"));

    accessToken = "token-b";
    view.rerender(
      <SessionHarness
        sdk={{ ...sdk, ownerKey: OWNER_B }}
        sessionFetch={sessionFetch}
        baseAccountEnabled
        baseAccountRestorer={baseAccountRestorer}
        moneyAction={action}
      />,
    );
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_B));
    await act(async () => {
      pendingObservation.reject(new Error("Base provider unavailable"));
      await pendingObservation.promise.catch(() => {});
    });

    await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("error:stale-session"));
    expect({ providerLookups, statusWrites, claims, walletSubmissions }).toEqual({
      providerLookups: 1,
      statusWrites: 0,
      claims: 0,
      walletSubmissions: 0,
    });
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
          getUserOperation: async () => sdkObservation(`0x${"ab".repeat(32)}`),
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
        return sdkObservation(userOperationHash);
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

  test("fences recovered candidate acknowledgment when the verified owner switches", async () => {
    const action = preparedMoneyAction("cdp-embedded", "2026-12-08T05:20:00.000Z");
    const userOperationHash = `0x${"cd".repeat(32)}` as `0x${string}`;
    const transactionHash = `0x${"ef".repeat(32)}` as `0x${string}`;
    const submissionEntered = deferred<void>();
    const pendingSubmission = deferred<Response>();
    let accessToken = "token-a";
    let providerLookups = 0;
    let receiptReads = 0;
    let claims = 0;
    let walletSubmissions = 0;
    const sdk = baseSdk({
      getAccessToken: async () => accessToken,
      sendUserOperation: async () => {
        walletSubmissions += 1;
        return { userOperationHash };
      },
      getUserOperation: async () => {
        providerLookups += 1;
        return embeddedObservation(action, userOperationHash, transactionHash);
      },
    });
    const sessionFetch: SessionFetch = async (input, init) => {
      if (input === "/api/session") {
        return new Headers(init?.headers).get("Authorization") === "Bearer token-b"
          ? sessionResponse(sessionFor("subject-b", ADDRESS_B))
          : sessionResponse(sessionFor("subject-a", ADDRESS_A));
      }
      if (input === `/api/actions/${action.id}`) {
        return Response.json({ operation: storedMoneyAction(action, "submitted", { userOperationHash }) });
      }
      if (input === `/api/actions/${action.id}/submission`) {
        submissionEntered.resolve();
        return pendingSubmission.promise;
      }
      if (String(input).startsWith("/api/transfer-receipt?")) receiptReads += 1;
      if (input === `/api/actions/${action.id}/claim`) claims += 1;
      throw new Error(`unexpected owner-switch recovery request: ${String(input)}`);
    };
    const view = render(<SessionHarness sdk={sdk} sessionFetch={sessionFetch} moneyAction={action} />);
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));
    fireEvent.click(page().getByRole("button", { name: "Check money action" }));
    await submissionEntered.promise;

    accessToken = "token-b";
    view.rerender(
      <SessionHarness sdk={{ ...sdk, ownerKey: OWNER_B }} sessionFetch={sessionFetch} moneyAction={action} />,
    );
    await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_B));
    await act(async () => {
      pendingSubmission.resolve(Response.json({
        operation: storedMoneyAction(action, "submitted", { userOperationHash, transactionHash }),
      }));
      await pendingSubmission.promise;
    });
    await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe("error:stale-session"));
    expect({ providerLookups, receiptReads, claims, walletSubmissions }).toEqual({
      providerLookups: 1,
      receiptReads: 0,
      claims: 0,
      walletSubmissions: 0,
    });
  });

  test("rejects a 409 recovery acknowledgment whose canonical action or exact reference changed", async () => {
    const userOperationHash = `0x${"cd".repeat(32)}` as `0x${string}`;
    const transactionHash = `0x${"ef".repeat(32)}` as `0x${string}`;
    for (const mismatch of ["action", "reference"] as const) {
      const action = preparedMoneyAction("cdp-embedded", "2026-12-08T05:20:00.000Z");
      let reads = 0;
      let receiptReads = 0;
      let claims = 0;
      let walletSubmissions = 0;
      const sessionFetch: SessionFetch = async (input) => {
        if (input === "/api/session") return sessionResponse(sessionFor("subject-a", ADDRESS_A));
        if (input === `/api/actions/${action.id}`) {
          reads += 1;
          const rereadAction: PreparedMoneyAction = mismatch === "action"
            ? { ...action, owner: { ...action.owner, address: ADDRESS_B as `0x${string}` } }
            : action;
          return Response.json({
            operation: reads === 1
              ? storedMoneyAction(action, "submitted", { userOperationHash })
              : storedMoneyAction(
                rereadAction,
                "submitted",
                {
                  userOperationHash,
                  transactionHash: mismatch === "reference" ? `0x${"aa".repeat(32)}` : transactionHash,
                },
              ),
          });
        }
        if (input === `/api/actions/${action.id}/submission`) {
          return Response.json({ error: { code: "ACTION_NOT_CLAIMED", message: "race" } }, { status: 409 });
        }
        if (String(input).startsWith("/api/transfer-receipt?")) receiptReads += 1;
        if (input === `/api/actions/${action.id}/claim`) claims += 1;
        throw new Error(`unexpected mismatched acknowledgment request: ${String(input)}`);
      };
      render(
        <SessionHarness
          sdk={baseSdk({
            sendUserOperation: async () => {
              walletSubmissions += 1;
              return { userOperationHash };
            },
            getUserOperation: async () => embeddedObservation(action, userOperationHash, transactionHash),
          })}
          sessionFetch={sessionFetch}
          moneyAction={action}
        />,
      );
      await waitFor(() => expect(page().getByTestId("address").textContent).toBe(ADDRESS_A));
      fireEvent.click(page().getByRole("button", { name: "Check money action" }));
      await waitFor(() => expect(page().getByTestId("money-action-status").textContent).toBe(
        mismatch === "action" ? "error:invalid-response" : "error:submission-unknown",
      ));
      expect({ reads, receiptReads, claims, walletSubmissions }).toEqual({
        reads: 2,
        receiptReads: 0,
        claims: 0,
        walletSubmissions: 0,
      });
      cleanup();
      window.sessionStorage.clear();
    }
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
      getUserOperation: async () => sdkObservation(`0x${"ab".repeat(32)}`),
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
            getUserOperation: async () => sdkObservation(`0x${"ab".repeat(32)}`),
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
        return sdkObservation(userOperationHash, { status: "complete", transactionHash: hash });
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
            if (polls === 2) return sdkObservation(userOperationHash, { status: "complete" });
            return sdkObservation(userOperationHash, { status: "complete", transactionHash });
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
          getUserOperation: async () => sdkObservation(userOperationHash, { status: "dropped" }),
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
      getUserOperation: async () => sdkObservation(`0x${"ab".repeat(32)}`, {
        status: "complete",
        transactionHash: `0x${"cd".repeat(32)}`,
      }),
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


});
