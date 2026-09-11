import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { StrictMode } from "react";
import type { AccountWalletClient } from "@/client/account/cdp-client";

const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { FundingExperienceForWallet } = await import("./funding-experience");
const { MoneyDataRefreshProvider } = await import("@/client/money-actions/refresh");

const ADDRESS_A = "0x1111111111111111111111111111111111111111" as const;
const ADDRESS_B = "0x2222222222222222222222222222222222222222" as const;
const HOSTED_URL = "https://pay.coinbase.com/buy/select-asset?sessionToken=fixture";

type FundingWallet = Pick<
  AccountWalletClient,
  "ownerKey" | "status" | "session" | "fetchAccountResource"
>;

function idrxVa() {
  return {
    presentation: "virtual-account",
    rail: "bank-va",
    asset: {
      id: "idrx",
      symbol: "IDRX",
      decimals: 2,
      tokenAddress: "0x18bc5bcc660cf2b9ce3cd51a404afe1a0cbd3c22",
    },
    network: { name: "Base", chainId: 8453 },
    merchantOrderId: "order-1",
    reference: "ref-1",
    virtualAccountNo: "8680770000001234",
    virtualAccountName: "HOME TEST",
    amount: "24000",
    baseAmount: "20000",
    fees: [{ name: "VA", amount: "4000" }],
    expiredDate: "2026-09-12T12:00:00.000Z",
    channelId: "MANDIRI",
    verification: { status: "pending", boundary: "balance-and-activity" },
  };
}

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

  test("gates IDRX to Indonesia and reconciles only through balance and activity refresh", async () => {
    const calls: Array<[string, unknown?]> = [];
    let refreshes = 0;
    let created = false;
    render(
      <MoneyDataRefreshProvider onConfirmed={() => { refreshes += 1; }}>
        <FundingExperienceForWallet
        wallet={{
          ...verifiedWallet(),
          fetchAccountResource: async (...args) => {
            calls.push(args);
            if (args[0] === "/api/funding/idrx-attempt") {
              return created
                ? { status: "completed", result: idrxVa() }
                : { status: "none" };
            }
            created = true;
            return idrxVa();
          },
        }}
        navigateToHostedOnramp={() => {}}
        regionId="ID"
        />
      </MoneyDataRefreshProvider>,
    );

    fireEvent.click(page().getByRole("button", { name: /Buy IDRX with rupiah/ }));
    const create = await page().findByRole("button", { name: "Create virtual account" });
    expect(create.hasAttribute("disabled")).toBeTrue();
    fireEvent.click(page().getByRole("checkbox"));
    fireEvent.click(create);

    await waitFor(() => expect(page().getByText("Funding pending")).toBeTruthy());
    expect(page().getByText("8680770000001234")).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Check balance & activity" }));
    expect(refreshes).toBe(1);
    expect(page().getByText(/Funding stays pending until IDRX appears/)).toBeTruthy();
    expect(calls.filter(([path]) => path === "/api/funding/idrx-mint")).toEqual([["/api/funding/idrx-mint", {
      method: "POST",
      body: {
        assetId: "idrx",
        country: "ID",
        attemptId: expect.any(String),
        toBeMinted: "20000",
        rail: "bank-va",
        channelId: "MANDIRI",
        consent: true,
      },
      signal: expect.any(AbortSignal),
    }]]);

    fireEvent.click(page().getByRole("button", { name: "Back" }));
    fireEvent.click(page().getByRole("button", { name: /Buy IDRX with rupiah/ }));
    expect(page().getByText("8680770000001234")).toBeTruthy();
    expect(calls.filter(([path]) => path === "/api/funding/idrx-mint")).toHaveLength(1);
  });

  test("recovers completed VA instructions after close discards the initiating response", async () => {
    let resolveMint!: (value: unknown) => void;
    const pendingMint = new Promise<unknown>((resolve) => { resolveMint = resolve; });
    let persistedResult: unknown = null;
    let dispatches = 0;
    const view = render(
      <FundingExperienceForWallet
        wallet={{
          ...verifiedWallet(),
          fetchAccountResource: async (path) => {
            if (path === "/api/funding/idrx-attempt") {
              return persistedResult
                ? { status: "completed", result: persistedResult }
                : { status: "none" };
            }
            dispatches += 1;
            return pendingMint;
          },
        }}
        navigateToHostedOnramp={() => {}}
        regionId="ID"
      />,
    );
    fireEvent.click(page().getByRole("button", { name: /Buy IDRX with rupiah/ }));
    await page().findByRole("button", { name: "Create virtual account" });
    fireEvent.click(page().getByRole("checkbox"));
    fireEvent.click(page().getByRole("button", { name: "Create virtual account" }));
    fireEvent.click(page().getByRole("button", { name: "Close add money" }));

    persistedResult = idrxVa();
    await act(async () => { resolveMint(persistedResult); await pendingMint; });
    expect(page().queryByText("8680770000001234")).toBeNull();

    view.rerender(
      <FundingExperienceForWallet
        wallet={{
          ...verifiedWallet(),
          fetchAccountResource: async (path) => path === "/api/funding/idrx-attempt"
            ? { status: "completed", result: persistedResult }
            : (() => { throw new Error("must not redispatch"); })(),
        }}
        navigateToHostedOnramp={() => {}}
        regionId="ID"
        open
      />,
    );
    fireEvent.click(page().getByRole("button", { name: /Buy IDRX with rupiah/ }));
    expect(await page().findByText("8680770000001234")).toBeTruthy();
    expect(dispatches).toBe(1);
  });

  test("retains an ambiguous IDRX attempt across back navigation and does not offer redispatch", async () => {
    let dispatches = 0;
    let pendingAttemptId: string | null = null;
    render(
      <FundingExperienceForWallet
        wallet={{
          ...verifiedWallet(),
          fetchAccountResource: async (path, options) => {
            if (path === "/api/funding/idrx-attempt") {
              return pendingAttemptId
                ? { status: "pending", attemptId: pendingAttemptId }
                : { status: "none" };
            }
            dispatches += 1;
            pendingAttemptId = (options?.body as { attemptId: string }).attemptId;
            throw Object.assign(new Error("pending"), { status: 409 });
          },
        }}
        navigateToHostedOnramp={() => {}}
        regionId="ID"
      />,
    );
    fireEvent.click(page().getByRole("button", { name: /Buy IDRX with rupiah/ }));
    await page().findByRole("button", { name: "Create virtual account" });
    fireEvent.click(page().getByRole("checkbox"));
    fireEvent.click(page().getByRole("button", { name: "Create virtual account" }));
    await waitFor(() => expect(page().getByText("Funding pending")).toBeTruthy());
    expect(dispatches).toBe(1);
    expect(page().queryByRole("button", { name: "Create virtual account" })).toBeNull();

    fireEvent.click(page().getByRole("button", { name: "Back" }));
    fireEvent.click(page().getByRole("button", { name: /Buy IDRX with rupiah/ }));
    expect(page().getByText("Funding pending")).toBeTruthy();
    expect(page().queryByRole("button", { name: "Create virtual account" })).toBeNull();
    expect(dispatches).toBe(1);
  });

  test("does not expose the Indonesia issuer rail in another region", () => {
    render(
      <FundingExperienceForWallet
        wallet={verifiedWallet()}
        navigateToHostedOnramp={() => {}}
        regionId="US"
      />,
    );
    expect(page().queryByRole("button", { name: /Buy IDRX with rupiah/ })).toBeNull();
  });

  test("keeps hosted navigation active after StrictMode effect replay", async () => {
    const navigations: string[] = [];
    render(
      <StrictMode>
        <FundingExperienceForWallet
          wallet={{ ...verifiedWallet(), fetchAccountResource: async () => hosted() }}
          navigateToHostedOnramp={(url) => navigations.push(url)}
        />
      </StrictMode>,
    );

    fireEvent.click(page().getByRole("button", { name: /Buy USDC with Coinbase/ }));
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
        onClose={() => {
          closes += 1;
        }}
      />,
    );

    fireEvent.click(page().getByRole("button", { name: /Buy USDC with Coinbase/ }));
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
      />,
    );

    fireEvent.click(page().getByRole("button", { name: /Buy USDC with Coinbase/ }));
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
