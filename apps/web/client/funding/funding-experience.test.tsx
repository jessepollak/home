import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { StrictMode } from "react";
import type { AccountWalletClient } from "@/client/account/cdp-client";

const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { FundingExperienceForWallet } = await import("./funding-experience");

const ADDRESS_A = "0x1111111111111111111111111111111111111111" as const;
const ADDRESS_B = "0x2222222222222222222222222222222222222222" as const;
const HOSTED_URL = "https://pay.coinbase.com/buy/select-asset?sessionToken=fixture";

type FundingWallet = Pick<
  AccountWalletClient,
  "ownerKey" | "status" | "session" | "fetchAccountResource"
>;

function hosted() {
  return {
    url: HOSTED_URL,
    asset: {
      id: "usdc",
      symbol: "USDC",
      decimals: 6,
      tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    },
    network: { name: "Base", chainId: 8453 },
  };
}

function fundingBinding() {
  return { providerId: "ripio", displayName: "Ripio", region: "AR", assetId: "base:wars", assetSymbol: "wARS", assetDecimals: 18, currency: "ARS", paymentMethods: [{ id: "bank_transfer", label: "Bank transfer" }], quotes: true, kyc: null };
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
      throw new Error("hosted funding fixture not configured");
    },
  };
}

function page() {
  return within(document.body);
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
});

describe("FundingExperience", () => {
  test("keeps Coinbase return routing and copies the full Base address", async () => {
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
    expect(page().queryByRole("button", { name: "Copy address" })).toBeNull();
    expect(page().queryByRole("button", { name: "Check received" })).toBeNull();

    fireEvent.click(page().getByRole("button", { name: /Copy 0x1111…111111/ }));
    await waitFor(() => expect(copied).toBe(ADDRESS_A));
    expect(page().getByRole("button", { name: "Copied" })).toBeTruthy();
    expect(page().queryByLabelText(`Full Base address ${ADDRESS_A}`)).toBeNull();
  });

  test("offers the full selectable address when clipboard access is unavailable", async () => {
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

  test("offers the full selectable address when clipboard write is rejected", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new Error("denied"); } },
    });
    render(
      <FundingExperienceForWallet
        wallet={verifiedWallet()}
        navigateToHostedOnramp={() => {}}
        initialStep="receive"
      />,
    );

    fireEvent.click(page().getByRole("button", { name: /Copy 0x1111…111111/ }));

    await waitFor(() => {
      expect(page().getByRole("alert").textContent).toContain(
        "Select and copy the full address below",
      );
    });
    expect(page().getByLabelText(`Full Base address ${ADDRESS_A}`).textContent).toBe(
      ADDRESS_A,
    );
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
    expect(page().getByText(/other tokens in Home's supported Base inventory/)).toBeTruthy();
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
    render(<FundingExperienceForWallet wallet={wallet} navigateToHostedOnramp={() => {}} regionId="AR" />);
    const provider = await page().findByRole("button", { name: /Deposit ARS Use Ripio/ });
    fireEvent.click(provider);
    expect(page().getByRole("dialog", { name: "Deposit ARS" })).toBeTruthy();
    for (const key of ["1", "0", "0", "0"]) fireEvent.click(page().getByRole("button", { name: key }));
    fireEvent.click(page().getByRole("button", { name: "Review quote" }));
    await page().findByRole("heading", { name: "Review quote" });
    expect(page().getByText("Receive: 1000 wARS")).toBeTruthy();
    expect(page().getByText("Rail: 10 ARS")).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Confirm deposit" }));
    await page().findByRole("heading", { name: "Review payment details" });
    expect(page().getByText("Provider: 12 ARS")).toBeTruthy();
    expect(page().queryByText("1234567890")).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "View payment instructions" }));
    await page().findByText("Deposit pending");
    expect(page().getByText("1234567890")).toBeTruthy();
    expect(requests.find((item) => item.path === "/api/funding/orders")?.body).toEqual({ quoteToken: "signed-token" });
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
    render(<FundingExperienceForWallet wallet={wallet} navigateToHostedOnramp={() => {}} regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS Use Ripio/ }));
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
    render(<FundingExperienceForWallet wallet={wallet} navigateToHostedOnramp={() => {}} regionId="AR" />);
    fireEvent.click(page().getByRole("button", { name: /Receive crypto/ }));
    expect(page().getByRole("dialog", { name: "Receive" })).toBeTruthy();
    await act(async () => { resolveOrder({ order: { id: "11111111-1111-4111-8111-111111111111", providerId: "ripio", state: "dispatch-ambiguous", fiatAmount: "1000", providerStatus: null, instructions: null } }); await pendingOrder; });
    expect(page().getByRole("dialog", { name: "Receive" })).toBeTruthy();
    expect(page().queryByText("Check Activity before trying again")).toBeNull();
  });

  test("shows only server-configured bindings and leaves the US Coinbase row working", async () => {
    const argentina = render(<FundingExperienceForWallet wallet={{ ...verifiedWallet(), fetchAccountResource: async (path) => path.startsWith("/api/funding/providers") ? { providers: [] } : { order: null } }} navigateToHostedOnramp={() => {}} regionId="AR" />);
    await waitFor(() => expect(page().queryByRole("button", { name: /Deposit ARS/ })).toBeNull());
    argentina.unmount();
    render(<FundingExperienceForWallet wallet={verifiedWallet()} navigateToHostedOnramp={() => {}} regionId="US" />);
    expect(page().getByRole("button", { name: /Use Coinbase to deposit USD/ })).toBeTruthy();
    expect(page().queryByRole("button", { name: /Use Ripio/ })).toBeNull();
  });

  test("keeps hosted navigation active after StrictMode effect replay", async () => {
    const navigations: string[] = [];
    render(
      <StrictMode>
        <FundingExperienceForWallet
          wallet={{ ...verifiedWallet(), fetchAccountResource: async () => hosted() }}
          navigateToHostedOnramp={(url) => navigations.push(url)}
          regionId="US"
        />
      </StrictMode>,
    );

    fireEvent.click(page().getByRole("button", { name: /Use Coinbase to deposit USD/ }));
    fireEvent.click(page().getByRole("button", { name: "Continue to Coinbase" }));
    await waitFor(() => expect(navigations).toEqual([HOSTED_URL]));
  });

  test("closing a pending hosted onramp prevents delayed navigation and stale persistence", async () => {
    let resolveRequest!: (value: unknown) => void;
    const pending = new Promise<unknown>((resolve) => {
      resolveRequest = resolve;
    });
    const navigations: string[] = [];
    let closes = 0;

    render(
      <FundingExperienceForWallet
        wallet={{ ...verifiedWallet(), fetchAccountResource: async () => pending }}
        navigateToHostedOnramp={(url) => navigations.push(url)}
        regionId="US"
        onClose={() => {
          closes += 1;
        }}
      />,
    );

    fireEvent.click(page().getByRole("button", { name: /Use Coinbase to deposit USD/ }));
    fireEvent.click(page().getByRole("button", { name: "Continue to Coinbase" }));
    await waitFor(() => expect(page().getByRole("button", { name: "Opening Coinbase…" })).toBeTruthy());
    fireEvent.click(page().getByRole("button", { name: "Close add money" }));

    await act(async () => {
      resolveRequest(hosted());
      await pending;
    });

    expect(closes).toBeGreaterThan(0);
    expect(navigations).toEqual([]);
    expect(window.sessionStorage.length).toBe(0);
  });

  test("unmounting a pending hosted onramp prevents delayed navigation", async () => {
    let resolveRequest!: (value: unknown) => void;
    const pending = new Promise<unknown>((resolve) => {
      resolveRequest = resolve;
    });
    const navigations: string[] = [];
    const view = render(
      <FundingExperienceForWallet
        wallet={{ ...verifiedWallet(), fetchAccountResource: async () => pending }}
        navigateToHostedOnramp={(url) => navigations.push(url)}
        regionId="US"
      />,
    );

    fireEvent.click(page().getByRole("button", { name: /Use Coinbase to deposit USD/ }));
    fireEvent.click(page().getByRole("button", { name: "Continue to Coinbase" }));
    await waitFor(() => expect(page().getByRole("button", { name: "Opening Coinbase…" })).toBeTruthy());
    view.unmount();

    await act(async () => {
      resolveRequest(hosted());
      await pending;
    });

    expect(navigations).toEqual([]);
  });

  test("hides the prior verified address as soon as the account boundary changes", () => {
    const view = render(
      <FundingExperienceForWallet
        wallet={verifiedWallet(ADDRESS_A)}
        navigateToHostedOnramp={() => {}}
        initialStep="receive"
      />,
    );
    expect(page().getByTitle(ADDRESS_A)).toBeTruthy();

    view.rerender(
      <FundingExperienceForWallet
        wallet={{ ...verifiedWallet(ADDRESS_B), status: "validating", session: null }}
        navigateToHostedOnramp={() => {}}
        initialStep="receive"
      />,
    );

    expect(page().queryByTitle(ADDRESS_A)).toBeNull();
    expect(page().getByText(/Sign in and verify a Base account/)).toBeTruthy();
  });

  test("signed-out empty state offers sign in without exposing funding actions", () => {
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

    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe(
      "/?account=signin",
    );
    expect(page().queryByRole("button", { name: /Receive crypto/ })).toBeNull();
    expect(page().queryByRole("button", { name: "Continue to Coinbase" })).toBeNull();
  });
});
