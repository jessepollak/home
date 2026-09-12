import "./dom-test-harness";

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

const { act, cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);
const { useMemo, useState } = await import("react");
const { AccountSignInSheet, SignInBlockedPanel } = await import("./account-screen");
const {
  AccountWalletClientProvider,
  AccountWalletSessionOwner,
  CdpAccountProvider,
  createBlockedAccountWalletClient,
  useAccountWallet,
} = await import("./cdp-client");

function page() {
  return within(document.body);
}

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
      signInWithSiwe: async () => ({
        flowId: "unused-siwe-flow",
        message: "unused SIWE message",
      }),
      verifySiweSignature: async () => {},
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
  test("uses shared sheet typography, controls, and accessible Phosphor artwork", async () => {
    render(
      <SheetHarness
        requestEmailCode={async () => ({ flowId: "presentation-flow" })}
        baseAccountEnabled
        baseAccountConnector={async () => {
          throw new BaseAccountConnectorError("cancelled");
        }}
      />,
    );

    fireEvent.click(page().getByRole("button", { name: "Open account" }));

    const heading = await page().findByRole("heading", {
      level: 2,
      name: "Sign in to Home",
    });
    expect(heading.getAttribute("data-text-style")).toBe("sheet-title");

    const close = page().getByRole("button", { name: "Close sign in" });
    expect(close.classList.contains("home-ui-icon-button")).toBe(true);
    expect(close.getAttribute("data-variant")).toBe("secondary");
    expect(close.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(close.querySelector("svg")?.getAttribute("width")).toBe("20");

    for (const name of ["Continue with email", "Sign in with Base Account"]) {
      const button = await page().findByRole("button", { name });
      expect(button.classList.contains("home-ui-button")).toBe(true);
    }
    expect(
      page()
        .getByRole("button", { name: "Sign in with Base Account" })
        .getAttribute("data-variant"),
    ).toBe("secondary");
  });

  test("uses a modal dialog, keeps dynamic focus inside, and restores its trigger on Escape", async () => {
    const codeRequest = deferred<{ flowId: string }>();
    const trigger = render(
      <SheetHarness requestEmailCode={() => codeRequest.promise} />,
    ).getByRole("button", { name: "Open account" });

    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await page().findByRole("dialog", { name: "Sign in to Home" });
    const emailInput = await page().findByRole("textbox", {
      name: "Email address",
    });
    expect(dialog).toBeInstanceOf(HTMLDialogElement);
    expect((dialog as HTMLDialogElement).open).toBe(true);
    expect(page().queryByText("Secure account")).toBeNull();
    expect(page().queryByText(/details stay hidden until verification/i)).toBeNull();
    expect(document.body.style.overflow).toBe("hidden");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(emailInput);

    fireEvent.input(emailInput, {
      target: { value: "person@example.com" },
    });
    await waitFor(() =>
      expect((emailInput as HTMLInputElement).value).toBe("person@example.com"),
    );
    fireEvent.click(page().getByRole("button", { name: "Continue with email" }), {
      detail: 0,
      clientX: 0,
      clientY: 0,
    });
    await waitFor(() =>
      expect(
        (page().getByRole("button", {
          name: "Sending code…",
        }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );

    await act(async () => {
      codeRequest.resolve({ flowId: "flow-1" });
      await codeRequest.promise;
    });

    const otpInput = await page().findByRole("textbox", {
      name: "Verification code",
    });
    expect(page().getByText("Sent to person@example.com. Codes expire.")).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(otpInput);

    const cancel = new Event("cancel", { cancelable: true });
    fireEvent(dialog, cancel);

    await waitFor(() => expect((dialog as HTMLDialogElement).open).toBe(false));
    expect(cancel.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("");
  });

  test("lets the close control cancel an in-flight email request and ignores its late result", async () => {
    const codeRequest = deferred<{ flowId: string }>();
    render(<SheetHarness requestEmailCode={() => codeRequest.promise} />);
    fireEvent.click(page().getByRole("button", { name: "Open account" }));
    const email = await page().findByRole("textbox", { name: "Email address" });
    fireEvent.input(email, { target: { value: "fixture@example.test" } });
    fireEvent.click(page().getByRole("button", { name: "Continue with email" }));
    fireEvent.click(page().getByRole("button", { name: "Close sign in" }));
    expect((document.querySelector("dialog") as HTMLDialogElement).open).toBe(false);

    await act(async () => {
      codeRequest.resolve({ flowId: "late-flow" });
      await codeRequest.promise;
    });
    fireEvent.click(page().getByRole("button", { name: "Open account" }));
    await waitFor(() =>
      expect((document.querySelector("dialog") as HTMLDialogElement).open).toBe(true),
    );
    expect(await page().findByRole("textbox", { name: "Email address" })).toBeTruthy();
    expect(page().queryByRole("textbox", { name: "Verification code" })).toBeNull();
  });

  test("does not let an existing verified session auto-close a new email attempt", async () => {
    render(
      <SheetHarness
        requestEmailCode={async () => ({ flowId: "new-email-flow" })}
        initiallySignedIn
      />,
    );
    await waitFor(() =>
      expect(page().getByTestId("session-status").textContent).toBe("verified"),
    );
    fireEvent.click(page().getByRole("button", { name: "Open account" }));
    const dialog = await page().findByRole("dialog", { name: "Sign in to Home" });
    expect((dialog as HTMLDialogElement).open).toBe(true);

    const email = page().getByRole("textbox", { name: "Email address" });
    fireEvent.input(email, { target: { value: "new@example.test" } });
    fireEvent.click(page().getByRole("button", { name: "Continue with email" }));
    expect(await page().findByRole("textbox", { name: "Verification code" })).toBeTruthy();
    expect((dialog as HTMLDialogElement).open).toBe(true);
  });

  test("shows email and Base Account side by side only when the deployment flag is enabled", async () => {
    const disabledView = render(
      <SheetHarness
        requestEmailCode={async () => ({ flowId: "unused-flow" })}
      />,
    );
    fireEvent.click(page().getByRole("button", { name: "Open account" }));
    expect(
      await page().findByRole("button", { name: "Continue with email" }),
    ).toBeTruthy();
    expect(
      page().queryByRole("button", { name: "Sign in with Base Account" }),
    ).toBeNull();
    disabledView.unmount();

    render(
      <SheetHarness
        requestEmailCode={async () => ({ flowId: "unused-flow" })}
        baseAccountEnabled
        baseAccountConnector={async () => {
          throw new BaseAccountConnectorError("cancelled");
        }}
      />,
    );
    fireEvent.click(page().getByRole("button", { name: "Open account" }));
    expect(
      await page().findByRole("button", { name: "Continue with email" }),
    ).toBeTruthy();
    fireEvent.click(
      page().getByRole("button", { name: "Sign in with Base Account" }),
    );
    expect((await page().findByRole("alert")).textContent).toContain(
      "Base Account sign-in was canceled",
    );
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
    const dialog = page().getByRole("dialog", { name: "Sign in to Home" });
    fireEvent.click(
      await page().findByRole("button", { name: "Sign in with Base Account" }),
    );
    expect(
      await page().findByRole("button", { name: "Cancel sign in" }),
    ).toBeTruthy();
    expect((dialog as HTMLDialogElement).open).toBe(false);

    fireEvent.click(page().getByRole("button", { name: "Cancel sign in" }));
    await waitFor(() => expect(page().queryByRole("button", { name: "Cancel sign in" })).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  test("closes on a click outside the dialog surface but not on an inside click", async () => {
    render(
      <SheetHarness
        requestEmailCode={async () => ({ flowId: "unused-flow" })}
      />,
    );
    const trigger = page().getByRole("button", { name: "Open account" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await page().findByRole("dialog", { name: "Sign in to Home" });
    dialog.getBoundingClientRect = () =>
      ({
        left: 100,
        right: 500,
        top: 100,
        bottom: 600,
        width: 400,
        height: 500,
        x: 100,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.click(page().getByRole("heading", { name: "Sign in to Home" }), {
      clientX: 200,
      clientY: 200,
    });
    expect((dialog as HTMLDialogElement).open).toBe(true);

    fireEvent.click(dialog, { clientX: 20, clientY: 20 });
    await waitFor(() => expect((dialog as HTMLDialogElement).open).toBe(false));
    expect(document.activeElement).toBe(trigger);
  });

  test("missing public project ID shows setup guidance instead of an outage", async () => {
    render(
      <CdpAccountProvider projectId={null}>
        <button type="button" onClick={() => {}}>
          Open account
        </button>
        <AccountSignInSheet open onClose={() => {}} />
      </CdpAccountProvider>,
    );

    const dialog = await page().findByRole("dialog", { name: "Sign in to Home" });
    expect((dialog as HTMLDialogElement).open).toBe(true);
    expect(page().getByText("Sign-in is not configured")).toBeTruthy();
    expect(page().getByText(/NEXT_PUBLIC_CDP_PROJECT_ID/)).toBeTruthy();
    expect(page().getByText(/\.env\.example/)).toBeTruthy();
    expect(page().getByText(/apps\/web\/\.env\.local/)).toBeTruthy();
    const setupLink = page().getByRole("link", { name: "docs/cdp-setup.md" });
    expect((setupLink as HTMLAnchorElement).href).toContain("docs/cdp-setup.md");
    expect(page().queryByRole("textbox", { name: "Email address" })).toBeNull();
    expect(page().queryByText("Sign-in is unavailable")).toBeNull();
    expect(page().queryByText("Try again later.")).toBeNull();
    expect(page().queryByText("Sign-in is not configured for this deployment.")).toBeNull();
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

  test("configured provider outage uses different copy from missing project ID", () => {
    render(
      <AccountWalletClientProvider
        client={createBlockedAccountWalletClient("provider-unavailable")}
      >
        <AccountSignInSheet open onClose={() => {}} />
      </AccountWalletClientProvider>,
    );

    expect(page().getByText("Sign-in is unavailable")).toBeTruthy();
    expect(page().getByText("The sign-in service is not responding. Try again later.")).toBeTruthy();
    expect(page().queryByText("Sign-in is not configured")).toBeNull();
    expect(page().queryByText(/NEXT_PUBLIC_CDP_PROJECT_ID/)).toBeNull();
    expect(page().queryByRole("textbox", { name: "Email address" })).toBeNull();
    expect(page().queryByRole("link", { name: "docs/cdp-setup.md" })).toBeNull();
  });

  test("blocked-panel reasons stay visually distinct", () => {
    const unconfigured = render(
      <SignInBlockedPanel reason="unconfigured" />,
    );
    expect(unconfigured.getByText("Sign-in is not configured")).toBeTruthy();
    unconfigured.unmount();

    render(<SignInBlockedPanel reason="provider-unavailable" />);
    expect(page().getByText("Sign-in is unavailable")).toBeTruthy();
    expect(page().queryByText("Sign-in is not configured")).toBeNull();
  });
});
