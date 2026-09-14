import "./dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, describe, expect, test } from "bun:test";
import type {
  AccountWalletClient,
  AccountWalletSdkBoundary,
} from "./cdp-client";
import {
  BaseAccountConnectorError,
  type BaseAccountConnector,
  type BaseAccountRestorer,
} from "./base-account-connector";

const { act, cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);
const { useMemo, useState } = await import("react");
const { AccountSignInSheet } = await import("./account-screen");
const {
  AccountWalletClientProvider,
  createBlockedAccountWalletClient,
  useAccountWallet,
} = await import("./cdp-client");
const { AccountWalletSessionOwner } = await import("./cdp-session-lifecycle");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function SessionStatusProbe() {
  const account = useAccountWallet();
  return (
    <>
      <output data-testid="session-status">{account.status}</output>
      <button type="button" onClick={() => void account.signOut().catch(() => {})}>
        Sign out fixture session
      </button>
    </>
  );
}

const noopSignOut = async () => {};

function SheetHarness({
  requestEmailCode,
  baseAccountEnabled = false,
  baseAccountConnector,
  baseAccountRestorer,
  signOut,
  initiallySignedIn = false,
  restoredAccountProvider = "cdp-embedded",
}: {
  requestEmailCode: AccountWalletSdkBoundary["signInWithEmail"];
  baseAccountEnabled?: boolean;
  baseAccountConnector?: BaseAccountConnector;
  baseAccountRestorer?: BaseAccountRestorer;
  signOut?: AccountWalletSdkBoundary["signOut"];
  initiallySignedIn?: boolean;
  restoredAccountProvider?: "cdp-embedded" | "base-account";
}) {
  const [open, setOpen] = useState(false);
  const sessionFetch = useMemo(
    () => async () => Response.json({
      user: { subject: "existing-subject" },
      smartAccount: {
        address: "0x1111111111111111111111111111111111111111",
        chainId: 8453,
      },
      accountProvider: restoredAccountProvider,
    }),
    [restoredAccountProvider],
  );
  const sdk = useMemo<AccountWalletSdkBoundary>(
    () => ({
      isInitialized: true,
      isSignedIn: initiallySignedIn,
      ownerKey: initiallySignedIn ? "existing-owner" : null,
      signInWithEmail: requestEmailCode,
      verifyEmailOTP: async () => {},
      requestBaseAccountChallenge: async () => ({
        nonce: "a".repeat(48), chainId: 8453, domain: "home.example", uri: "https://home.example",
        version: "1", statement: "Sign in to Home.", issuedAt: "2026-09-13T12:00:00.000Z",
        expirationTime: "2026-09-13T12:05:00.000Z",
      }),
      verifyBaseAccountProof: async () => {},
      getAccessToken: async () => initiallySignedIn ? "fixture-token" : null,
      signOut: signOut ?? noopSignOut,
    }),
    [initiallySignedIn, requestEmailCode, signOut],
  );

  return (
    <AccountWalletSessionOwner
      sdk={sdk}
      baseAccountEnabled={baseAccountEnabled}
      baseAccountConnector={baseAccountConnector}
      baseAccountRestorer={baseAccountRestorer}
      sessionFetch={sessionFetch}
    >
      <SessionStatusProbe />
      <button type="button" onClick={() => setOpen(true)}>
        Open account
      </button>
      <AccountSignInSheet open={open} onClose={() => setOpen(false)} />
    </AccountWalletSessionOwner>
  );
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  document.body.style.overflow = "";
});

describe("production account sign-in sheet", () => {
  test("close cancels an in-flight email request and ignores its late result", async () => {
    const codeRequest = deferred<{ flowId: string }>();
    render(<SheetHarness requestEmailCode={() => codeRequest.promise} />);
    fireEvent.click(page().getByRole("button", { name: "Open account" }));
    const email = await page().findByRole("textbox", { name: "Email address" });
    fireEvent.input(email, { target: { value: "fixture@example.test" } });
    fireEvent.click(page().getByRole("button", { name: "Continue with email" }));
    fireEvent.click(page().getByRole("button", { name: "Close sign in" }));
    await waitFor(() => expect(page().queryByRole("dialog", { name: "Sign in to Home" })).toBeNull());

    await act(async () => {
      codeRequest.resolve({ flowId: "late-flow" });
      await codeRequest.promise;
    });
    fireEvent.click(page().getByRole("button", { name: "Open account" }));
    await page().findByRole("dialog", { name: "Sign in to Home" });
    expect(await page().findByRole("textbox", { name: "Email address" })).toBeTruthy();
    expect(page().queryByRole("textbox", { name: "Verification code" })).toBeNull();
  });

  test("existing verified session does not auto-close a new email attempt", async () => {
    render(
      <SheetHarness
        requestEmailCode={async () => ({ flowId: "new-email-flow" })}
        initiallySignedIn
      />,
    );
    await waitFor(() => expect(page().getByTestId("session-status").textContent).toBe("verified"));
    fireEvent.click(page().getByRole("button", { name: "Open account" }));
    await page().findByRole("dialog", { name: "Sign in to Home" });

    fireEvent.input(page().getByRole("textbox", { name: "Email address" }), {
      target: { value: "new@example.test" },
    });
    fireEvent.click(page().getByRole("button", { name: "Continue with email" }));
    expect(await page().findByRole("textbox", { name: "Verification code" })).toBeTruthy();
    expect(page().getByRole("dialog", { name: "Check your email" })).toBeTruthy();
  });

  test("blocks the real sign-in sheet while missing-connection cleanup is deferred", async () => {
    window.sessionStorage.setItem("home:account-provider", "base-account");
    const cleanupRequest = deferred<void>();
    let signOutCalls = 0;

    render(
      <SheetHarness
        requestEmailCode={async () => ({ flowId: "must-not-start" })}
        baseAccountEnabled
        baseAccountRestorer={async () => {
          throw new BaseAccountConnectorError("missing-connection");
        }}
        signOut={() => {
          signOutCalls += 1;
          return cleanupRequest.promise;
        }}
        initiallySignedIn
        restoredAccountProvider="base-account"
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("session-status").textContent).toBe(
        "signing-out",
      ),
    );
    expect(signOutCalls).toBe(1);

    fireEvent.click(page().getByRole("button", { name: "Open account" }));
    expect(await page().findByText("Finishing sign-out…")).toBeTruthy();
    expect(page().queryByRole("textbox", { name: "Email address" })).toBeNull();
    expect(
      page().queryByRole("button", { name: "Sign in with Base Account" }),
    ).toBeNull();

    await act(async () => {
      cleanupRequest.resolve();
      await cleanupRequest.promise;
    });
  });

  test("keeps real sign-in controls blocked when owner-null sign-out joins pending cleanup", async () => {
    window.sessionStorage.setItem("home:account-provider", "base-account");
    const cleanupRequest = deferred<void>();
    let signOutCalls = 0;
    const signOut = () => {
      signOutCalls += 1;
      return cleanupRequest.promise;
    };
    const view = render(
      <SheetHarness
        requestEmailCode={async () => ({ flowId: "must-not-start" })}
        baseAccountEnabled
        baseAccountRestorer={async () => {
          throw new BaseAccountConnectorError("missing-connection");
        }}
        signOut={signOut}
        initiallySignedIn
        restoredAccountProvider="base-account"
      />,
    );

    await waitFor(() => expect(signOutCalls).toBe(1));
    view.rerender(
      <SheetHarness
        requestEmailCode={async () => ({ flowId: "must-not-start" })}
        baseAccountEnabled
        baseAccountRestorer={async () => {
          throw new BaseAccountConnectorError("missing-connection");
        }}
        signOut={signOut}
        restoredAccountProvider="base-account"
      />,
    );
    fireEvent.click(
      page().getByRole("button", { name: "Sign out fixture session" }),
    );
    fireEvent.click(page().getByRole("button", { name: "Open account" }));

    expect(await page().findByText("Finishing sign-out…")).toBeTruthy();
    expect(signOutCalls).toBe(1);
    expect(window.sessionStorage.getItem("home:account-provider")).toBe(
      "pending:base-account",
    );
    expect(page().queryByRole("textbox", { name: "Email address" })).toBeNull();
    expect(
      page().queryByRole("button", { name: "Sign in with Base Account" }),
    ).toBeNull();

    await act(async () => {
      cleanupRequest.resolve();
      await cleanupRequest.promise;
    });
    await waitFor(() =>
      expect(page().getByTestId("session-status").textContent).toBe(
        "signed-out",
      ),
    );
    expect(window.sessionStorage.getItem("home:account-provider")).toBeNull();
  });

  test("hands off native modal ownership while Base Account connection is pending and permits cancellation", async () => {
    const connection = deferred<never>();
    const trigger = render(
      <SheetHarness
        requestEmailCode={async () => ({ flowId: "unused-flow" })}
        baseAccountEnabled
        baseAccountConnector={() => connection.promise}
      />,
    ).getByRole("button", { name: "Open account" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(page().getByRole("dialog", { name: "Sign in to Home" })).toBeTruthy();
    fireEvent.click(
      await page().findByRole("button", { name: "Sign in with Base Account" }),
    );
    expect(
      await page().findByRole("button", { name: "Cancel sign in" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(page().queryByRole("dialog", { name: "Sign in to Home" })).toBeNull(),
    );

    fireEvent.click(page().getByRole("button", { name: "Cancel sign in" }));
    await waitFor(() =>
      expect(page().queryByRole("button", { name: "Cancel sign in" })).toBeNull(),
    );
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  test("offers an explicit sign-out retry while failed cleanup keeps details private", async () => {
    let retries = 0;
    const client: AccountWalletClient = {
      ...createBlockedAccountWalletClient("provider-unavailable"),
      signInAvailability: "ready",
      baseAccountEnabled: true,
      status: "signout-error",
      message:
        "Base Account was disconnected. Private details remain hidden, but sign-out did not finish. Retry sign out.",
      signOut: async () => {
        retries += 1;
      },
    };

    render(
      <AccountWalletClientProvider client={client}>
        <AccountSignInSheet open onClose={() => {}} />
      </AccountWalletClientProvider>,
    );

    expect(page().getByText("Sign-out did not finish.")).toBeTruthy();
    expect(page().queryByRole("textbox", { name: "Email address" })).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Retry sign out" }));
    await waitFor(() => expect(retries).toBe(1));
  });
});
