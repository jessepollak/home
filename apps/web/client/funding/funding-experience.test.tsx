import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { getHomeQueryClient } from "@/client/query/query-client";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { FundingExperienceForWallet } = await import("./funding-experience");
const { shouldPollFundingOrder } = await import("./order-flow");

const ADDRESS_A = "0x1111111111111111111111111111111111111111" as const;
const ADDRESS_B = "0x2222222222222222222222222222222222222222" as const;
const REDIRECT_URL = "https://checkout.idrx.co/?token=synthetic";
const APPLE_PAY_URL = "https://pay.coinbase.com/embedded/apple-pay";

type FundingWallet = Pick<
  AccountWalletClient,
  "ownerKey" | "status" | "session" | "fetchAccountResource"
>;

function fundingBinding() {
  return { providerId: "ripio", displayName: "Ripio", region: "AR", assetId: "base:wars", assetSymbol: "wARS", assetDecimals: 18, currency: "ARS", paymentMethods: [{ id: "bank_transfer", label: "Bank transfer" }], quotes: true, kyc: null };
}

function redirectBinding() {
  return { providerId: "idrx", displayName: "IDRX", region: "ID", assetId: "base:idrx", assetSymbol: "IDRX", assetDecimals: 2, currency: "IDR", paymentMethods: [{ id: "qris", label: "QRIS" }], quotes: false, kyc: null };
}

function applePayBinding() {
  return { providerId: "coinbase", displayName: "Coinbase", region: "US", assetId: "base:usdc", assetSymbol: "USDC", assetDecimals: 6, currency: "USD", paymentMethods: [{ id: "apple-pay", label: "Apple Pay" }], quotes: true, kyc: null };
}

function applePayOrder(state = "awaiting-payment", url = APPLE_PAY_URL) {
  return { id: "11111111-1111-4111-8111-111111111111", providerId: "coinbase", state, fiatAmount: "25", expectedTokenAmountAtomic: "24500000", fees: [{ label: "Coinbase fee", amount: "0.50", currency: "USD" }], providerStatus: null, instructions: { kind: "embed", url, presentation: "apple-pay", amount: "25.50", currency: "USD" } };
}

function multiMethodBinding() {
  return {
    ...fundingBinding(),
    region: "CO",
    assetId: "base:wcop",
    assetSymbol: "wCOP",
    currency: "COP",
    paymentMethods: [
      { id: "bank_transfer", label: "Bank transfer" },
      { id: "breb", label: "Bre-B" },
      { id: "bancolombia", label: "Bancolombia" },
      { id: "nequi", label: "Nequi" },
    ],
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

afterEach(() => {
  cleanup();
  getHomeQueryClient().clear();
  window.sessionStorage.clear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
});

describe("FundingExperience", () => {
  test("does not present a disabled regional candidate as receive support", async () => {
    await act(async () => {
      render(
        <FundingExperienceForWallet
          wallet={verifiedWallet()}
          navigateToRedirect={() => {}}
          initialStep="receive"
          regionId="BR"
        />,
      );
    });

    expect(await page().findByRole("heading", { name: "Receive" })).toBeTruthy();
    const supportedAssets = page().getByRole("region", {
      name: "Supported receive assets on Base",
    });
    expect(supportedAssets.textContent).toContain("USDC");
    expect(supportedAssets.textContent).not.toContain("BRZ");
  });

  test("keeps provider bindings visible and disabled until a failed open-order read is retried", async () => {
    let orderReads = 0;
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) {
          return { providers: [redirectBinding()] };
        }
        if (path.startsWith("/api/funding/orders?")) {
          orderReads += 1;
          if (orderReads === 1) throw new Error("ORDER_UNAVAILABLE");
          return { order: null };
        }
        throw new Error("unexpected request");
      },
    };

    render(
      <FundingExperienceForWallet
        wallet={wallet}
        navigateToRedirect={() => {}}
        regionId="ID"
      />,
    );

    const provider = await page().findByRole("button", {
      name: /Deposit IDR/,
    });
    expect(provider.hasAttribute("disabled")).toBe(true);
    expect(page().getByRole("alert").textContent).toContain(
      "Home couldn't check for an open deposit. Retry.",
    );

    fireEvent.click(page().getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(orderReads).toBe(2));
    await waitFor(() => expect(provider.hasAttribute("disabled")).toBe(false));
    expect(page().queryByRole("alert")).toBeNull();
  });

  test("hides an open-order read error when there are no provider bindings", async () => {
    let orderReads = 0;
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) return { providers: [] };
        if (path.startsWith("/api/funding/orders?")) {
          orderReads += 1;
          throw new Error("ORDER_UNAVAILABLE");
        }
        throw new Error("unexpected request");
      },
    };

    render(
      <FundingExperienceForWallet
        wallet={wallet}
        navigateToRedirect={() => {}}
        regionId="AR"
      />,
    );

    const receive = await page().findByRole("button", { name: /Receive crypto/ });
    await waitFor(() => expect(orderReads).toBe(1));
    expect(receive.hasAttribute("disabled")).toBe(false);
    expect(page().queryByRole("alert")).toBeNull();
  });

  test("keeps a provider-list failure visible for retry", async () => {
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) {
          throw new Error("PROVIDERS_UNAVAILABLE");
        }
        if (path.startsWith("/api/funding/orders?")) return { order: null };
        throw new Error("unexpected request");
      },
    };

    render(
      <FundingExperienceForWallet
        wallet={wallet}
        navigateToRedirect={() => {}}
        regionId="AR"
      />,
    );

    expect((await page().findByRole("alert")).textContent).toContain(
      "Funding methods are unavailable. Try again.",
    );
    expect(page().getByRole("button", { name: /Receive crypto/ })).toBeTruthy();
    expect(page().getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  test("derives provider row copy from the binding and summarizes extra methods", async () => {
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) return { providers: [multiMethodBinding()] };
        if (path.startsWith("/api/funding/orders?")) return { order: null };
        throw new Error("unexpected request");
      },
    };

    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="CO" />);

    const provider = await page().findByRole("button", { name: /Deposit COP/ });
    expect(provider.textContent).toContain("Deposit COP");
    expect(provider.textContent).toContain("Ripio · Bank transfer · Bre-B · +2");
    expect(provider.textContent).not.toContain("Deposit COP with Ripio");
  });

  test("lists configured provider bindings and creates an order with only the quote token", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string, options?: { body?: unknown }) => {
        requests.push({ path, body: options?.body });
        if (path.startsWith("/api/funding/providers")) return { providers: [fundingBinding()] };
        if (path.startsWith("/api/funding/orders?")) return { order: null };
        if (path === "/api/funding/quotes") return { quoteToken: "signed-token", quote: { fiatAmount: "1000", tokenAmountAtomic: "1000000000000000000000", fees: [{ label: "Rail", amount: "10", currency: "ARS" }], expiresAt: "2099-01-01T00:00:00.000Z" } };
        if (path === "/api/funding/orders") return { order: { id: "11111111-1111-4111-8111-111111111111", providerId: "ripio", state: "awaiting-payment", fiatAmount: "1000", expectedTokenAmountAtomic: "1000000000000000000000", fees: [{ label: "Provider", amount: "12", currency: "ARS" }], providerStatus: null, instructions: { kind: "bank-transfer", rail: "CVU", accountNumber: "1234567890", amount: "1000", currency: "ARS" } } };
        throw new Error("unexpected request");
      },
    };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    const provider = await page().findByRole("button", { name: /Deposit ARS/ });
    fireEvent.click(provider);
    expect(page().getByRole("dialog", { name: "Deposit ARS" })).toBeTruthy();
    for (const key of ["1", "0", "0", "0"]) fireEvent.click(page().getByRole("button", { name: key }));
    fireEvent.click(page().getByRole("button", { name: "Review quote" }));
    await page().findByRole("heading", { name: "Review quote" });
    expect(page().queryByText("Sandbox — not a real deposit")).toBeNull();
    expect(page().getByText("Receive").parentElement?.textContent).toContain("1.000\u00A0wARS");
    expect(page().getByText("Rail").parentElement?.textContent).toContain("$10,00");
    fireEvent.click(page().getByRole("button", { name: "Confirm deposit" }));
    await page().findByRole("heading", { name: "Review payment details" });
    expect(page().getByText("Provider").parentElement?.textContent).toContain("$12,00");
    expect(page().queryByText("1234567890")).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "View payment instructions" }));
    await page().findByText("Deposit pending");
    expect(page().queryByText("Sandbox — not a real deposit")).toBeNull();
    expect(page().getByText("1234567890")).toBeTruthy();
    expect(requests.find((item) => item.path === "/api/funding/orders")?.body).toEqual({ quoteToken: "signed-token" });
  });

  test("shows the sandbox badge on all three review and status screens", async () => {
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) return { providers: [fundingBinding()] };
        if (path.startsWith("/api/funding/orders?")) return { order: null };
        if (path === "/api/funding/quotes") return { sandbox: true, quoteToken: "sandbox-token", quote: { fiatAmount: "1000", tokenAmountAtomic: "1000000000000000000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" } };
        if (path === "/api/funding/orders") return { order: { id: "11111111-1111-4111-8111-111111111111", providerId: "ripio", sandbox: true, state: "awaiting-payment", fiatAmount: "1000", expectedTokenAmountAtomic: "1000000000000000000000", fees: [], providerStatus: null, instructions: { kind: "bank-transfer", rail: "CVU", accountNumber: "1234567890", amount: "1000", currency: "ARS" } } };
        throw new Error("unexpected request");
      },
    };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    for (const key of ["1", "0", "0", "0"]) fireEvent.click(page().getByRole("button", { name: key }));
    fireEvent.click(page().getByRole("button", { name: "Review quote" }));
    await page().findByRole("heading", { name: "Review quote" });
    expect(page().getAllByText("Sandbox — not a real deposit")).toHaveLength(1);
    fireEvent.click(page().getByRole("button", { name: "Confirm deposit" }));
    await page().findByRole("heading", { name: "Review payment details" });
    expect(page().getAllByText("Sandbox — not a real deposit")).toHaveLength(1);
    fireEvent.click(page().getByRole("button", { name: "View payment instructions" }));
    await page().findByText("Deposit pending");
    expect(page().getAllByText("Sandbox — not a real deposit")).toHaveLength(1);
  });

  test("stops polling sandbox sent-unverified orders but continues for live orders", () => {
    expect(shouldPollFundingOrder({ state: "sent-unverified", sandbox: true })).toBe(false);
    expect(shouldPollFundingOrder({ state: "sent-unverified", sandbox: false })).toBe(true);
    expect(shouldPollFundingOrder({ state: "awaiting-payment", sandbox: true })).toBe(true);
  });

  test("shows sandbox sent-unverified as complete without polling", async () => {
    let statusCalls = 0;
    const order = { id: "11111111-1111-4111-8111-111111111111", providerId: "coinbase", sandbox: true, state: "sent-unverified", fiatAmount: "5", expectedTokenAmountAtomic: "4880000", fees: [{ label: "Coinbase fee", amount: "0.12", currency: "USD" }], providerStatus: "ONRAMP_ORDER_STATUS_COMPLETED", instructions: { kind: "embed", url: APPLE_PAY_URL, presentation: "apple-pay", amount: "5", currency: "USD" } };
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) return { providers: [applePayBinding()] };
        if (path.includes("/api/funding/orders/11111111")) { statusCalls += 1; return { order }; }
        if (path.startsWith("/api/funding/orders?")) return { order };
        throw new Error("unexpected request");
      },
    };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="US" />);
    expect(await page().findByRole("heading", { name: "Sandbox complete — no real funds moved" })).toBeTruthy();
    expect(page().getAllByText("Sandbox — not a real deposit")).toHaveLength(1);
    expect(statusCalls).toBe(0);
  });

  test("retries a lost order response with the exact original quote token", async () => {
    let quoteCalls = 0;
    const orderBodies: unknown[] = [];
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string, options?: { body?: unknown }) => {
      if (path.startsWith("/api/funding/providers")) return { providers: [fundingBinding()] };
      if (path.startsWith("/api/funding/orders?")) return { order: null };
      if (path === "/api/funding/quotes") { quoteCalls += 1; return { quoteToken: "original-signed-token", quote: { fiatAmount: "1000", tokenAmountAtomic: "1000000000000000000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" } }; }
      if (path === "/api/funding/orders") { orderBodies.push(options?.body); if (orderBodies.length === 1) throw new Error("lost response"); return { order: { id: "11111111-1111-4111-8111-111111111111", providerId: "ripio", state: "dispatch-ambiguous", fiatAmount: "1000", providerStatus: null, instructions: null } }; }
      throw new Error("unexpected request");
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    for (const key of ["1", "0", "0", "0"]) fireEvent.click(page().getByRole("button", { name: key }));
    fireEvent.click(page().getByRole("button", { name: "Review quote" }));
    await page().findByRole("heading", { name: "Review quote" });
    fireEvent.click(page().getByRole("button", { name: "Confirm deposit" }));
    await page().findByRole("alert");
    expect(page().getByRole("button", { name: "Back" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(page().getByRole("button", { name: "Confirm deposit" }));
    await page().findByText("Check Activity before trying again");
    expect(quoteCalls).toBe(1);
    expect(orderBodies).toEqual([{ quoteToken: "original-signed-token" }, { quoteToken: "original-signed-token" }]);
  });

  test("late ambiguous resume never overrides an explicit Receive selection", async () => {
    let resolveOrder!: (value: unknown) => void;
    const pendingOrder = new Promise<unknown>((resolve) => { resolveOrder = resolve; });
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers")) return { providers: [fundingBinding()] };
      if (path.startsWith("/api/funding/orders?")) return pendingOrder;
      throw new Error("unexpected request");
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    fireEvent.click(page().getByRole("button", { name: /Receive crypto/ }));
    expect(page().getByRole("dialog", { name: "Receive" })).toBeTruthy();
    await act(async () => { resolveOrder({ order: { id: "11111111-1111-4111-8111-111111111111", providerId: "ripio", state: "dispatch-ambiguous", fiatAmount: "1000", providerStatus: null, instructions: null } }); await pendingOrder; });
    expect(page().getByRole("dialog", { name: "Receive" })).toBeTruthy();
    expect(page().queryByText("Check Activity before trying again")).toBeNull();
  });

  test("keeps the generic redirect renderer for non-Coinbase providers", async () => {
    const navigations: string[] = [];
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) return { providers: [redirectBinding()] };
        if (path.startsWith("/api/funding/orders?")) return { order: null };
        if (path === "/api/funding/quotes") return { quoteToken: "signed-token", quote: { fiatAmount: "25000", tokenAmountAtomic: "2500000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" } };
        if (path === "/api/funding/orders") return { order: { id: "11111111-1111-4111-8111-111111111111", providerId: "idrx", state: "awaiting-payment", fiatAmount: "25000", expectedTokenAmountAtomic: "2500000", fees: [], providerStatus: null, instructions: { kind: "redirect", url: REDIRECT_URL } } };
        throw new Error("unexpected request");
      },
    };

    render(
      <FundingExperienceForWallet
        wallet={wallet}
        navigateToRedirect={(url) => navigations.push(url)}
        regionId="ID"
      />,
    );

    fireEvent.click(await page().findByRole("button", { name: /Deposit IDR/ }));
    for (const key of ["2", "5", "0", "0", "0"]) fireEvent.click(page().getByRole("button", { name: key }));
    fireEvent.click(page().getByRole("button", { name: "Review quote" }));
    await page().findByRole("heading", { name: "Review quote" });
    fireEvent.click(page().getByRole("button", { name: "Confirm deposit" }));

    await waitFor(() => expect(navigations).toEqual([REDIRECT_URL]));
    expect(page().getByRole("link", { name: "Continue to payment" }).getAttribute("href")).toBe(REDIRECT_URL);
  });

  test("a resumed open redirect order never auto-navigates; it keeps the explicit link", async () => {
    const navigations: string[] = [];
    const openOrder = { id: "11111111-1111-4111-8111-111111111111", providerId: "idrx", state: "awaiting-payment", fiatAmount: "25000", expectedTokenAmountAtomic: "2500000", fees: [], providerStatus: null, instructions: { kind: "redirect", url: REDIRECT_URL } };
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) return { providers: [redirectBinding()] };
        if (path.startsWith("/api/funding/orders")) return { order: openOrder };
        throw new Error("unexpected request");
      },
    };

    render(
      <FundingExperienceForWallet
        wallet={wallet}
        navigateToRedirect={(url) => navigations.push(url)}
        regionId="ID"
      />,
    );

    expect(await page().findByRole("link", { name: "Continue to payment" })).toBeTruthy();
    await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
    expect(navigations).toEqual([]);
  });

  test("renders Apple Pay only after economics review and refetches only for trusted messages", async () => {
    const navigations: string[] = [];
    const requests: Array<{ path: string; method?: string }> = [];
    let statusCalls = 0;
    let resolveStatus!: (value: unknown) => void;
    const statusResult = new Promise<unknown>((resolve) => { resolveStatus = resolve; });
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string, options?: { method?: "GET" | "POST" }) => {
        requests.push({ path, method: options?.method });
        if (path.startsWith("/api/funding/providers")) return { providers: [applePayBinding()] };
        if (path.startsWith("/api/funding/orders?")) return { order: null };
        if (path === "/api/funding/quotes") return { quoteToken: "signed-token", quote: { fiatAmount: "25", tokenAmountAtomic: "24500000", fees: [{ label: "Coinbase fee", amount: "0.50", currency: "USD" }], expiresAt: "2099-01-01T00:00:00.000Z" } };
        if (path === "/api/funding/orders") return { order: applePayOrder() };
        if (path === "/api/funding/orders/11111111-1111-4111-8111-111111111111") {
          statusCalls += 1;
          return statusResult;
        }
        throw new Error("unexpected request");
      },
    };

    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={(url) => navigations.push(url)} regionId="US" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit USD/ }));
    for (const key of ["2", "5"]) fireEvent.click(page().getByRole("button", { name: key }));
    fireEvent.click(page().getByRole("button", { name: "Review quote" }));
    await page().findByRole("heading", { name: "Review quote" });
    fireEvent.click(page().getByRole("button", { name: "Confirm deposit" }));
    await page().findByRole("heading", { name: "Review payment details" });
    // The created order repriced ($25 quoted, $25.50 charged); the review shows the real total.
    expect(page().getByText("You pay").parentElement?.textContent).toContain("$25.50");
    expect(Boolean(page().queryByTitle("Apple Pay")), "iframe before economics confirmation").toBe(false);
    expect(navigations).toEqual([]);

    fireEvent.click(page().getByRole("button", { name: "View payment instructions" }));
    const iframe = await page().findByTitle("Apple Pay") as HTMLIFrameElement;
    expect(iframe.getAttribute("src")).toBe(APPLE_PAY_URL);
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(iframe.getAttribute("allow")).toBe("payment");
    expect(page().getByText("Pay $25.50 with Apple Pay")).toBeTruthy();
    expect(navigations).toEqual([]);

    const source = iframe.contentWindow!;
    const send = (data: unknown, origin = "https://pay.coinbase.com", eventSource: MessageEventSource = source) => {
      window.dispatchEvent(new MessageEvent("message", { data, origin, source: eventSource }));
    };
    send(JSON.stringify({ eventName: "onramp_api.commit_success" }), "https://evil.example");
    send(JSON.stringify({ eventName: "onramp_api.commit_success" }), "https://pay.coinbase.com", window);
    send("not-json");
    send(JSON.stringify({ eventName: "onramp_api.unknown" }));
    await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
    expect(statusCalls).toBe(0);

    send(JSON.stringify({ eventName: "onramp_api.commit_success" }));
    send({ eventName: "onramp_api.polling_success" });
    await waitFor(() => expect(statusCalls).toBe(1));
    expect(navigations).toEqual([]);
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(2);

    resolveStatus({ order: applePayOrder("settling") });
    await waitFor(() => expect(Boolean(page().queryByTitle("Apple Pay")), "iframe after settling").toBe(false));
  });

  test("removes the Apple Pay message listener on unmount", async () => {
    const addListener = spyOn(window, "addEventListener");
    const removeListener = spyOn(window, "removeEventListener");
    const openOrder = applePayOrder();
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) return { providers: [applePayBinding()] };
        if (path.startsWith("/api/funding/orders")) return { order: openOrder };
        throw new Error("unexpected request");
      },
    };
    const view = render(
      <FundingExperienceForWallet
        wallet={wallet}
        navigateToRedirect={() => {}}
        regionId="US"
      />,
    );

    try {
      await page().findByRole("heading", { name: "Review payment details" });
      fireEvent.click(page().getByRole("button", { name: "View payment instructions" }));
      await page().findByTitle("Apple Pay");
      const messageRegistration = addListener.mock.calls.find(
        ([type]) => type === "message",
      );
      expect(messageRegistration).toBeDefined();

      view.unmount();

      expect(removeListener).toHaveBeenCalledWith(
        "message",
        messageRegistration?.[1],
      );
    } finally {
      addListener.mockRestore();
      removeListener.mockRestore();
    }
  });

  test("refuses to render an insecure embed URL", async () => {
    const openOrder = applePayOrder("awaiting-payment", "http://pay.coinbase.com/embedded/apple-pay");
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) return { providers: [applePayBinding()] };
        if (path.startsWith("/api/funding/orders")) return { order: openOrder };
        throw new Error("unexpected request");
      },
    };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="US" />);
    await page().findByRole("heading", { name: "Review payment details" });
    fireEvent.click(page().getByRole("button", { name: "View payment instructions" }));
    expect(page().queryByTitle("Apple Pay")).toBeNull();
  });

  test("hides the prior verified address as soon as the account boundary changes", () => {
    const view = render(
      <FundingExperienceForWallet
        wallet={verifiedWallet(ADDRESS_A)}
        navigateToRedirect={() => {}}
        initialStep="receive"
      />,
    );
    expect(page().getByTitle(ADDRESS_A)).toBeTruthy();

    view.rerender(
      <FundingExperienceForWallet
        wallet={{ ...verifiedWallet(ADDRESS_B), status: "validating", session: null }}
        navigateToRedirect={() => {}}
        initialStep="receive"
      />,
    );

    expect(page().queryByTitle(ADDRESS_A)).toBeNull();
    expect(page().getByText(/Sign in and verify a Base account/)).toBeTruthy();
  });

  test("signed-out empty state offers sign in without exposing funding actions", async () => {
    await act(async () => {
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
          navigateToRedirect={() => {}}
        />,
      );
    });

    expect(await page().findByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe(
      "/?account=signin",
    );
    expect(page().queryByRole("button", { name: /Receive crypto/ })).toBeNull();
    expect(page().queryByRole("button", { name: "Continue to Coinbase" })).toBeNull();
  });
});
