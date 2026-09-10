import "@/features/account/dom-test-harness";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { StrictMode } from "react";
import type { AccountWalletClient } from "@/features/account/cdp-client";

const { act, cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);
const { FundingExperienceForWallet } = await import("./funding-experience");

(window as typeof window & {
  happyDOM: { settings: { disableIframePageLoading: boolean } };
}).happyDOM.settings.disableIframePageLoading = true;

const ADDRESS_A = "0x1111111111111111111111111111111111111111" as const;
const ADDRESS_B = "0x2222222222222222222222222222222222222222" as const;
const HOSTED_URL =
  "https://pay.coinbase.com/buy/select-asset?sessionToken=hosted";
const PAYMENT_LINK_A =
  "https://pay.coinbase.com/v2/api-onramp/apple-pay?sessionToken=attempt-a";
const PAYMENT_LINK_B =
  "https://pay.coinbase.com/v2/api-onramp/google-pay?sessionToken=attempt-b";

type FundingWallet = Pick<
  AccountWalletClient,
  "ownerKey" | "status" | "session" | "fetchAccountResource"
>;

function onramp(
  presentation: "iframe" | "hosted" = "hosted",
  url = presentation === "iframe" ? PAYMENT_LINK_A : HOSTED_URL,
) {
  return {
    url,
    presentation,
    asset: {
      id: "usdc",
      symbol: "USDC",
      decimals: 6,
      tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    },
    network: { name: "Base", chainId: 8453 },
  };
}

function verifiedWallet(address: `0x${string}` = ADDRESS_A): FundingWallet {
  return {
    ownerKey: `owner-${address}`,
    status: "verified",
    session: {
      user: { subject: `subject-${address}` },
      smartAccount: { address, chainId: 8453 },
      accountProvider: "base-account",
    },
    fetchAccountResource: async () => {
      throw new Error("funding fixture not configured");
    },
  };
}

function page() {
  return within(document.body);
}

function openBuy() {
  const button = page().queryByRole("button", { name: /Buy USDC with Coinbase/ });
  if (button) fireEvent.click(button);
}

function bindFrameSource(
  frame: HTMLIFrameElement,
  source: MessageEventSource,
) {
  Object.defineProperty(frame, "contentWindow", {
    configurable: true,
    value: source,
  });
}

function sendCoinbaseMessage(
  source: MessageEventSource | null,
  origin: string,
  eventName: string,
) {
  window.dispatchEvent(
    new MessageEvent("message", {
      source,
      origin,
      data: { eventName },
    }),
  );
}

const originalConsoleError = console.error;

beforeEach(() => {
  console.error = (...args: unknown[]) => {
    if (String(args[0]).includes("Iframe page loading is disabled")) return;
    originalConsoleError(...args);
  };
});

afterEach(() => {
  console.error = originalConsoleError;
  cleanup();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
});

describe("FundingExperience", () => {
  test("keeps Coinbase return routing, Base/regional assets, and clipboard copy", async () => {
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => { copied = value; } },
    });

    render(
      <FundingExperienceForWallet
        wallet={verifiedWallet()}
        navigateToHostedOnramp={() => {}}
        returnedFromCoinbase
        regionId="ID"
      />,
    );

    expect(page().getByRole("dialog", { name: "Receive" })).toBeTruthy();
    expect(page().getByText("Receive on Base")).toBeTruthy();
    expect(page().getByText("USDC")).toBeTruthy();
    expect(page().getByText("IDRX")).toBeTruthy();
    expect(page().getByText(/other tokens in Home's supported Base inventory/)).toBeTruthy();

    fireEvent.click(page().getByRole("button", { name: /Copy 0x1111…111111/ }));
    await waitFor(() => expect(copied).toBe(ADDRESS_A));
    expect(page().getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  test("offers the selectable full address when clipboard access is unavailable", async () => {
    render(
      <FundingExperienceForWallet
        wallet={verifiedWallet()}
        navigateToHostedOnramp={() => {}}
        initialStep="receive"
      />,
    );

    fireEvent.click(page().getByRole("button", { name: /Copy 0x1111…111111/ }));

    const alert = await page().findByRole("alert");
    expect(alert.textContent).toContain("Select and copy the full address below");
    const fallback = page().getByLabelText(`Full Base address ${ADDRESS_A}`);
    expect(fallback.textContent).toBe(ADDRESS_A);
    expect(fallback.getAttribute("tabindex")).toBe("0");
  });

  test("does not present a disabled regional candidate as receive support", () => {
    render(
      <FundingExperienceForWallet
        wallet={verifiedWallet()}
        navigateToHostedOnramp={() => {}}
        initialStep="receive"
        regionId="BR"
      />,
    );

    expect(page().getByText("USDC")).toBeTruthy();
    expect(page().queryByText("BRZ")).toBeNull();
  });

  test("freezes the requested amount and method while Coinbase is opening", async () => {
    let resolveOnramp: ((value: ReturnType<typeof onramp>) => void) | null = null;
    const request = new Promise<ReturnType<typeof onramp>>((resolve) => {
      resolveOnramp = resolve;
    });
    render(
      <FundingExperienceForWallet
        wallet={{
          ...verifiedWallet(),
          fetchAccountResource: async () => request,
        }}
        navigateToHostedOnramp={() => {}}
      />,
    );

    openBuy();
    fireEvent.change(page().getByLabelText("USD amount"), {
      target: { value: "42.5" },
    });
    fireEvent.click(page().getByLabelText("Google Pay"));
    fireEvent.click(page().getByRole("button", { name: "Continue to Coinbase" }));

    expect(
      (page().getByRole("button", { name: "Opening Coinbase…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(page().getByLabelText("Coinbase payment details").textContent).toContain("$42.50");
    expect(page().getByLabelText("Coinbase payment details").textContent).toContain("Google Pay");
    expect(page().queryByLabelText("USD amount")).toBeNull();
    expect(page().queryByLabelText("Apple Pay")).toBeNull();
    expect(page().queryByLabelText("Google Pay")).toBeNull();

    await act(async () => resolveOnramp?.(onramp("iframe")));
    await page().findByTitle("Coinbase payment");
    expect(page().getByLabelText("Coinbase payment details").textContent).toContain("$42.50");
  });

  test("requires explicit amount and method, then renders a verified inline response", async () => {
    const calls: unknown[] = [];
    const navigations: string[] = [];
    render(
      <StrictMode>
        <FundingExperienceForWallet
          wallet={{
            ...verifiedWallet(),
            fetchAccountResource: async (...args) => {
              calls.push(args);
              return onramp("iframe");
            },
          }}
          navigateToHostedOnramp={(url) => navigations.push(url)}
        />
      </StrictMode>,
    );

    openBuy();
    fireEvent.change(page().getByLabelText("USD amount"), {
      target: { value: "42.5" },
    });
    fireEvent.click(page().getByLabelText("Google Pay"));
    fireEvent.click(page().getByRole("button", { name: "Continue to Coinbase" }));

    await waitFor(() => expect(page().getByTitle("Coinbase payment")).toBeTruthy());
    expect(calls).toEqual([
      [
        "/api/funding/onramp-session",
        {
          method: "POST",
          body: {
            assetId: "usdc",
            paymentMethod: "google-pay",
            paymentAmount: "42.5",
          },
          signal: expect.any(AbortSignal),
        },
      ],
    ]);
    const frame = page().getByTitle("Coinbase payment");
    expect(frame.getAttribute("src")).toBe(PAYMENT_LINK_A);
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
    expect(
      frame.getAttribute("referrerpolicy") ?? frame.getAttribute("referrerPolicy"),
    ).toBe("no-referrer");
    expect(frame.getAttribute("allow")).toBe("payment");
    expect(page().getByLabelText("Coinbase payment details").textContent).toContain("$42.50");
    expect(page().getByLabelText("Coinbase payment details").textContent).toContain("Google Pay");
    expect(page().queryByLabelText("USD amount")).toBeNull();
    expect(page().getByRole("button", { name: "Change payment details" })).toBeTruthy();
    expect(navigations).toEqual([]);
  });

  test("rejects invalid amounts before requesting Coinbase", async () => {
    let calls = 0;
    render(
      <FundingExperienceForWallet
        wallet={{
          ...verifiedWallet(),
          fetchAccountResource: async () => {
            calls += 1;
            return onramp("iframe");
          },
        }}
        navigateToHostedOnramp={() => {}}
      />,
    );

    openBuy();
    fireEvent.change(page().getByLabelText("USD amount"), {
      target: { value: "0" },
    });
    fireEvent.click(page().getByRole("button", { name: "Continue to Coinbase" }));

    expect(page().getByRole("alert").textContent).toContain("between 1 and 9999.99");
    expect(calls).toBe(0);
  });

  test("keeps hosted fallback presentation-aware after StrictMode replay", async () => {
    const navigations: string[] = [];
    render(
      <StrictMode>
        <FundingExperienceForWallet
          wallet={{
            ...verifiedWallet(),
            fetchAccountResource: async () => onramp("hosted"),
          }}
          navigateToHostedOnramp={(url) => navigations.push(url)}
        />
      </StrictMode>,
    );

    openBuy();
    fireEvent.click(page().getByRole("button", { name: "Continue to Coinbase" }));
    await waitFor(() => expect(navigations).toEqual([HOSTED_URL]));
    expect(page().queryByTitle("Coinbase payment")).toBeNull();
  });

  test("accepts messages only from the active Coinbase iframe source", async () => {
    render(
      <FundingExperienceForWallet
        wallet={{
          ...verifiedWallet(),
          fetchAccountResource: async () => onramp("iframe"),
        }}
        navigateToHostedOnramp={() => {}}
      />,
    );
    openBuy();
    fireEvent.click(page().getByRole("button", { name: "Continue to Coinbase" }));
    const frame = await page().findByTitle("Coinbase payment") as HTMLIFrameElement;
    const activeSource = {} as MessageEventSource;
    const otherSource = {} as MessageEventSource;
    bindFrameSource(frame, activeSource);

    act(() => {
      sendCoinbaseMessage(
        activeSource,
        "https://evil.example",
        "onramp_api.cancel",
      );
      sendCoinbaseMessage(
        otherSource,
        "https://pay.coinbase.com",
        "onramp_api.cancel",
      );
    });
    expect(page().getByTitle("Coinbase payment")).toBeTruthy();

    act(() => {
      sendCoinbaseMessage(
        activeSource,
        "https://pay.coinbase.com",
        "onramp_api.cancel",
      );
    });
    await waitFor(() => expect(page().queryByTitle("Coinbase payment")).toBeNull());
  });

  test("binds messages to the active replacement attempt", async () => {
    let requestCount = 0;
    render(
      <FundingExperienceForWallet
        wallet={{
          ...verifiedWallet(),
          fetchAccountResource: async () => {
            requestCount += 1;
            return requestCount === 1
              ? onramp("iframe", PAYMENT_LINK_A)
              : onramp("iframe", PAYMENT_LINK_B);
          },
        }}
        navigateToHostedOnramp={() => {}}
      />,
    );
    openBuy();
    fireEvent.click(page().getByRole("button", { name: "Continue to Coinbase" }));
    const firstFrame = await page().findByTitle("Coinbase payment") as HTMLIFrameElement;
    const firstSource = {} as MessageEventSource;
    bindFrameSource(firstFrame, firstSource);

    fireEvent.click(page().getByRole("button", { name: "Change payment details" }));
    expect(page().queryByTitle("Coinbase payment")).toBeNull();
    fireEvent.click(page().getByLabelText("Google Pay"));
    fireEvent.click(page().getByRole("button", { name: "Continue to Coinbase" }));
    await waitFor(() =>
      expect(page().getByTitle("Coinbase payment").getAttribute("src")).toBe(
        PAYMENT_LINK_B,
      ),
    );
    const secondFrame = page().getByTitle("Coinbase payment") as HTMLIFrameElement;
    expect(secondFrame).not.toBe(firstFrame);
    const secondSource = {} as MessageEventSource;
    bindFrameSource(secondFrame, secondSource);

    act(() => {
      sendCoinbaseMessage(
        firstSource,
        "https://pay.coinbase.com",
        "onramp_api.polling_success",
      );
    });
    expect(page().getByRole("dialog", { name: "Buy" })).toBeTruthy();

    act(() => {
      sendCoinbaseMessage(
        secondSource,
        "https://pay.coinbase.com",
        "onramp_api.polling_success",
      );
    });
    await waitFor(() =>
      expect(page().getByRole("dialog", { name: "Deposit pending" })).toBeTruthy(),
    );
    expect(page().getByLabelText("Coinbase payment details").textContent).toContain("Google Pay");
    expect(
      page().getByText("Your deposit isn’t confirmed on Base. Close to refresh your balance."),
    ).toBeTruthy();
    expect(page().queryByText("Check received")).toBeNull();
    expect(page().queryByTitle("Coinbase payment")).toBeNull();
    expect(page().queryByTitle("Coinbase receipt")).toBeNull();
    expect(page().queryByRole("button", { name: /Coinbase receipt/ })).toBeNull();
    expect(page().queryByRole("button", { name: "Continue to Coinbase" })).toBeNull();
    expect(page().getByRole("button", { name: "Close and check balance" })).toBeTruthy();
  });

  test("pending close fires once and stale checkout messages cannot refresh or redispatch", async () => {
    let requestCount = 0;
    let closeCount = 0;
    const view = render(
      <FundingExperienceForWallet
        wallet={{
          ...verifiedWallet(),
          fetchAccountResource: async () => {
            requestCount += 1;
            return onramp("iframe");
          },
        }}
        navigateToHostedOnramp={() => {}}
        onClose={() => {
          closeCount += 1;
        }}
      />,
    );

    openBuy();
    fireEvent.change(page().getByLabelText("USD amount"), {
      target: { value: "42.5" },
    });
    fireEvent.click(page().getByLabelText("Google Pay"));
    fireEvent.click(page().getByRole("button", { name: "Continue to Coinbase" }));
    const frame = await page().findByTitle("Coinbase payment") as HTMLIFrameElement;
    const source = {} as MessageEventSource;
    bindFrameSource(frame, source);

    act(() => {
      sendCoinbaseMessage(
        source,
        "https://pay.coinbase.com",
        "onramp_api.polling_success",
      );
    });
    await page().findByRole("dialog", { name: "Deposit pending" });
    expect(page().getByLabelText("Coinbase payment details").textContent).toContain("$42.50");
    expect(page().getByLabelText("Coinbase payment details").textContent).toContain("Google Pay");

    fireEvent.click(page().getByRole("button", { name: "Close and check balance" }));
    expect(closeCount).toBe(1);
    view.rerender(
      <FundingExperienceForWallet
        wallet={verifiedWallet()}
        navigateToHostedOnramp={() => {}}
        open={false}
        onClose={() => {
          closeCount += 1;
        }}
      />,
    );

    act(() => {
      sendCoinbaseMessage(
        source,
        "https://pay.coinbase.com",
        "onramp_api.polling_success",
      );
      document.querySelector("dialog")?.dispatchEvent(new Event("close"));
    });
    expect(closeCount).toBe(1);
    expect(requestCount).toBe(1);
    expect(page().queryByTitle("Coinbase payment")).toBeNull();
    expect(page().queryByTitle("Coinbase receipt")).toBeNull();
  });

  test("Change payment details and Back both cancel an active inline attempt", async () => {
    render(
      <FundingExperienceForWallet
        wallet={{
          ...verifiedWallet(),
          fetchAccountResource: async () => onramp("iframe"),
        }}
        navigateToHostedOnramp={() => {}}
      />,
    );
    openBuy();
    fireEvent.click(page().getByRole("button", { name: "Continue to Coinbase" }));
    await page().findByTitle("Coinbase payment");
    fireEvent.click(page().getByRole("button", { name: "Change payment details" }));
    expect(page().queryByTitle("Coinbase payment")).toBeNull();
    expect(page().getByLabelText("USD amount")).toBeTruthy();

    fireEvent.click(page().getByRole("button", { name: "Continue to Coinbase" }));
    await page().findByTitle("Coinbase payment");
    fireEvent.click(page().getAllByRole("button", { name: "Back" })[0]!);
    expect(page().queryByTitle("Coinbase payment")).toBeNull();
    expect(page().getByRole("dialog", { name: "Add money" })).toBeTruthy();
  });

  test("closing, hiding, unmounting, and owner change fence pending requests", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const pendingWallet = {
      ...verifiedWallet(),
      fetchAccountResource: async () =>
        new Promise<unknown>((resolve) => resolvers.push(resolve)),
    };
    const navigations: string[] = [];
    let closes = 0;
    const view = render(
      <FundingExperienceForWallet
        wallet={pendingWallet}
        navigateToHostedOnramp={(url) => navigations.push(url)}
        onClose={() => { closes += 1; }}
      />,
    );

    openBuy();
    fireEvent.click(page().getByRole("button", { name: "Continue to Coinbase" }));
    await waitFor(() => expect(resolvers).toHaveLength(1));
    fireEvent.click(page().getByRole("button", { name: "Close add money" }));
    await act(async () => resolvers[0]?.(onramp("hosted")));
    expect(closes).toBe(1);
    expect(navigations).toEqual([]);

    view.rerender(
      <FundingExperienceForWallet
        wallet={pendingWallet}
        navigateToHostedOnramp={(url) => navigations.push(url)}
        open
      />,
    );
    openBuy();
    fireEvent.click(page().getByRole("button", { name: "Continue to Coinbase" }));
    await waitFor(() => expect(resolvers).toHaveLength(2));
    view.rerender(
      <FundingExperienceForWallet
        wallet={pendingWallet}
        navigateToHostedOnramp={(url) => navigations.push(url)}
        open={false}
      />,
    );
    await act(async () => resolvers[1]?.(onramp("iframe")));
    expect(navigations).toEqual([]);

    view.rerender(
      <FundingExperienceForWallet
        wallet={pendingWallet}
        navigateToHostedOnramp={(url) => navigations.push(url)}
        open
      />,
    );
    openBuy();
    fireEvent.click(page().getByRole("button", { name: "Continue to Coinbase" }));
    await waitFor(() => expect(resolvers).toHaveLength(3));
    view.rerender(
      <FundingExperienceForWallet
        wallet={verifiedWallet(ADDRESS_B)}
        navigateToHostedOnramp={(url) => navigations.push(url)}
        open
      />,
    );
    await act(async () => resolvers[2]?.(onramp("hosted")));
    expect(navigations).toEqual([]);
    expect(page().queryByTitle(ADDRESS_A)).toBeNull();

    view.rerender(
      <FundingExperienceForWallet
        wallet={pendingWallet}
        navigateToHostedOnramp={(url) => navigations.push(url)}
        open
      />,
    );
    openBuy();
    fireEvent.click(page().getByRole("button", { name: "Continue to Coinbase" }));
    await waitFor(() => expect(resolvers).toHaveLength(4));
    view.unmount();
    await act(async () => resolvers[3]?.(onramp("hosted")));
    expect(navigations).toEqual([]);
  });

  test("signed-out empty state does not expose funding actions", () => {
    render(
      <FundingExperienceForWallet
        wallet={{
          ownerKey: null,
          status: "signed-out",
          session: null,
          fetchAccountResource: async () => {
            throw new Error("signed out");
          },
        }}
        navigateToHostedOnramp={() => {}}
      />,
    );

    expect(page().getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe(
      "/?account=signin",
    );
    expect(page().queryByRole("button", { name: /Receive crypto/ })).toBeNull();
    expect(page().queryByLabelText("USD amount")).toBeNull();
  });
});
