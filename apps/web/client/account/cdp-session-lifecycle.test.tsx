/* eslint-disable @typescript-eslint/no-unused-vars -- split suites share the centralized account harness imports. */
import { afterEach, describe, expect, test } from "bun:test";
import {
  ADDRESS_A, ADDRESS_B, ADDRESS_C, OWNER_A, OWNER_B, OWNER_C,
  AccountProbe, AccountWalletSessionOwner, CdpAccountProvider, StrictMode, TestJournalLock, TestJournalStorage,
  act, baseSdk, cleanup, connectedBaseAccount, createBlockedAccountWalletClient, deferred,
  embeddedObservation, fireEvent, page, portfolioResponse, preparedMoneyAction, render,
  sdkObservation, sessionFor, sessionResponse, storedMoneyAction, waitFor as testingLibraryWaitFor, SessionHarness,
  BASE_CHAIN_ID,
  type AccountWalletSdkBoundary, type PreparedMoneyAction, type SessionFetch, type VerifiedAccountSession,
} from "./cdp-client-test-harness";
import { BaseAccountConnectorError, type BaseAccountConnector, type BaseAccountRestorer, type ConnectedBaseAccount } from "./base-account-connector";
import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";
import { ProviderHandleJournal } from "@/client/money-actions/provider-handle-journal";

const waitFor = <T,>(
  callback: () => T | Promise<T>,
  options?: Parameters<typeof testingLibraryWaitFor>[1],
) => testingLibraryWaitFor(callback, { interval: 1, ...options });

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("session lifecycle", () => {
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
      await Promise.resolve();
    });

    expect(validationCalls).toBe(1);
    expect(page().getByTestId("address").textContent).toBe(
      "private-details-hidden",
    );

    fireEvent.click(page().getByRole("button", { name: "Probe sign out" }));
    await waitFor(() => {
      expect(signOutCalls).toBe(2);
      expect(page().getByTestId("status").textContent).toBe("signed-out");
    });
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
      await Promise.resolve();
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
      await Promise.resolve();
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
      await Promise.resolve();
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
      await Promise.resolve();
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
    await waitFor(() => {
      expect(signOutCalls).toBe(2);
      expect(page().getByTestId("status").textContent).toBe("signed-out");
    });
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
      await Promise.resolve();
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
      await Promise.resolve();
    });
    expect(page().getByTestId("status").textContent).toBe("signout-error");

    fireEvent.click(page().getByRole("button", { name: "Probe sign out" }));
    await waitFor(() => {
      expect(signOutCalls).toBe(2);
      expect(page().getByTestId("status").textContent).toBe("signed-out");
    });
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
      await Promise.resolve();
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
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(page().getByTestId("status").textContent).not.toBe("signout-error");
      expect(page().getByTestId("message").textContent).not.toContain(
        "late owner-a",
      );
      expect(page().getByTestId("address").textContent).toBe(ADDRESS_B);
    });
  });

  test("fences owner B cleanup across representative failure, settlement, and successor paths", async () => {
    const cases = [
      { bFailureReason: "401", ownerACleanupOutcome: "success", postJoinState: "fresh-a" },
      { bFailureReason: "missing-connection", ownerACleanupOutcome: "failure", postJoinState: "fresh-c" },
      { bFailureReason: "401", ownerACleanupOutcome: "failure", postJoinState: "owner-null-success" },
      { bFailureReason: "missing-connection", ownerACleanupOutcome: "failure", postJoinState: "owner-null-success" },
      { bFailureReason: "missing-connection", ownerACleanupOutcome: "success", postJoinState: "owner-null-failure" },
    ] as const;

    for (const { bFailureReason, ownerACleanupOutcome, postJoinState } of cases) {
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
            await Promise.resolve();
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
              await Promise.resolve();
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
            cleanup();
            window.localStorage.clear();
            window.sessionStorage.clear();
            continue;
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
            await Promise.resolve();
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
            cleanup();
            window.localStorage.clear();
            window.sessionStorage.clear();
            continue;
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
            await Promise.resolve();
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

      cleanup();
      window.localStorage.clear();
      window.sessionStorage.clear();
    }
  });

  test("scopes pending provider hints to owner B across representative successor paths", async () => {
    const cases = [
      {
        persistedHint: "pending:base-account",
        freshOwner: { label: "A", ownerKey: OWNER_A, address: ADDRESS_A },
        freshArrival: "before-b-settlement",
        ownerBCleanupOutcome: "success",
      },
      {
        persistedHint: "pending:base-account",
        freshOwner: { label: "C", ownerKey: OWNER_C, address: ADDRESS_C },
        freshArrival: "after-b-settlement",
        ownerBCleanupOutcome: "failure",
      },
      {
        persistedHint: "pending:cdp-embedded",
        freshOwner: { label: "A", ownerKey: OWNER_A, address: ADDRESS_A },
        freshArrival: "after-b-settlement",
        ownerBCleanupOutcome: "success",
      },
      {
        persistedHint: "pending:cdp-embedded",
        freshOwner: { label: "C", ownerKey: OWNER_C, address: ADDRESS_C },
        freshArrival: "before-b-settlement",
        ownerBCleanupOutcome: "failure",
      },
    ] as const;

    for (const { persistedHint, freshOwner, freshArrival, ownerBCleanupOutcome } of cases) {
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
                await Promise.resolve();
              });
              expect(page().getByTestId("status").textContent).toBe("verified");
              expect(page().getByTestId("address").textContent).toBe(
                freshOwner.address,
              );
              expect(sessionCalls).toBe(1);
              expect(signOutCalls).toBe(1);
              expect(signOutOwners).toEqual([OWNER_B]);
            }

      cleanup();
      window.localStorage.clear();
      window.sessionStorage.clear();
    }
  });

  test("replaces owner B blocked selection across representative settlement and successor paths", async () => {
    const cases = [
      {
        ownerACleanupOutcome: "success",
        freshOwner: { label: "A", ownerKey: OWNER_A, address: ADDRESS_A },
        freshArrival: "before-b-settlement",
      },
      {
        ownerACleanupOutcome: "success",
        freshOwner: { label: "C", ownerKey: OWNER_C, address: ADDRESS_C },
        freshArrival: "after-b-failure",
      },
      {
        ownerACleanupOutcome: "failure",
        freshOwner: { label: "A", ownerKey: OWNER_A, address: ADDRESS_A },
        freshArrival: "after-b-failure",
      },
      {
        ownerACleanupOutcome: "failure",
        freshOwner: { label: "C", ownerKey: OWNER_C, address: ADDRESS_C },
        freshArrival: "before-b-settlement",
      },
    ] as const;

    for (const { ownerACleanupOutcome, freshOwner, freshArrival } of cases) {
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
              await Promise.resolve();
            });
            expect(page().getByTestId("status").textContent).toBe("verified");
            expect(page().getByTestId("address").textContent).toBe(
              freshOwner.address,
            );
            expect(signOutCalls).toBe(2);
          }

      cleanup();
      window.localStorage.clear();
      window.sessionStorage.clear();
    }
  });

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
      await Promise.resolve();
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
      await Promise.resolve();
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
      await Promise.resolve();
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
      await Promise.resolve();
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
      await Promise.resolve();
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


});
