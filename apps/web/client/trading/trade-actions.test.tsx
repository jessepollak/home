import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { cryptoAssets } from "@/config/invest-assets";

const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const {
  AccountWalletClientProvider,
  createBlockedAccountWalletClient,
} = await import("@/client/account/cdp-client");
const { TradeActions } = await import("./trade-actions");

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const ADDRESS_B = "0x2222222222222222222222222222222222222222" as const;
const bitcoin = cryptoAssets.find((asset) => asset.id === "cbbtc")!;

function page() {
  return within(document.body);
}

function verifiedClient(
  accountProvider: "cdp-embedded" | "base-account",
  owner = "a",
): AccountWalletClient {
  return {
    ...createBlockedAccountWalletClient("unconfigured"),
    projectConfigured: true,
    signInAvailability: "ready",
    ownerKey: `owner-${owner}`,
    status: "verified",
    session: {
      user: { subject: `subject-${owner}` },
      smartAccount: { address: owner === "a" ? ADDRESS : ADDRESS_B, chainId: 8453 },
      accountProvider,
    },
  };
}

afterEach(cleanup);

describe("TradeActions canTrade", () => {
  test("enables Buy and Sell for verified email CDP and Base Account sessions", () => {
    for (const provider of ["cdp-embedded", "base-account"] as const) {
      cleanup();
      render(
        <AccountWalletClientProvider client={verifiedClient(provider)}>
          <TradeActions asset={bitcoin} />
        </AccountWalletClientProvider>,
      );
      const buy = page().getByRole("button", { name: "Buy" }) as HTMLButtonElement;
      const sell = page().getByRole("button", { name: "Sell" }) as HTMLButtonElement;
      expect(buy.disabled).toBe(false);
      expect(sell.disabled).toBe(false);
    }
  });

  test("keeps Buy and Sell disabled without a verified trade boundary", () => {
    render(
      <AccountWalletClientProvider client={createBlockedAccountWalletClient("unconfigured")}>
        <TradeActions asset={bitcoin} />
      </AccountWalletClientProvider>,
    );
    const buy = page().getByRole("button", { name: "Buy" }) as HTMLButtonElement;
    const sell = page().getByRole("button", { name: "Sell" }) as HTMLButtonElement;
    expect(buy.disabled).toBe(true);
    expect(sell.disabled).toBe(true);
  });
});

describe("TradeActions private amount dismissal", () => {
  function renderTrade(client: AccountWalletClient) {
    return render(
      <AccountWalletClientProvider client={client}>
        <TradeActions asset={bitcoin} />
      </AccountWalletClientProvider>,
    );
  }

  function composeThirteen() {
    fireEvent.click(page().getByRole("button", { name: "Buy" }));
    fireEvent.click(page().getByRole("button", { name: "1" }));
    fireEvent.click(page().getByRole("button", { name: "3" }));
    expect(document.querySelector("[data-primary-amount]")?.textContent).toBe("$13");
  }

  function rerenderTrade(
    view: ReturnType<typeof render>,
    client: AccountWalletClient,
  ) {
    view.rerender(
      <AccountWalletClientProvider client={client}>
        <TradeActions asset={bitcoin} />
      </AccountWalletClientProvider>,
    );
  }

  test("preserves the outgoing $13 snapshot during ordinary same-owner dismissal", () => {
    const restoreMotion = stubReducedMotion(false);
    try {
      renderTrade(verifiedClient("cdp-embedded"));
      composeThirteen();

      fireEvent.click(page().getByRole("button", { name: "Close trade" }));

      expect(document.querySelector("[data-primary-amount]")?.textContent).toBe("$13");
      expect(document.querySelector('dialog[data-state="closing"]')).toBeTruthy();
    } finally {
      restoreMotion();
    }
  });

  test("drops the previous owner's $13 immediately when the account changes", () => {
    const view = renderTrade(verifiedClient("cdp-embedded"));
    composeThirteen();

    rerenderTrade(view, verifiedClient("cdp-embedded", "b"));

    expect(document.querySelector("[data-primary-amount]")).toBeNull();
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  test("drops the previous owner's $13 immediately on sign-out", () => {
    const view = renderTrade(verifiedClient("cdp-embedded"));
    composeThirteen();

    rerenderTrade(view, createBlockedAccountWalletClient("unconfigured"));

    expect(document.querySelector("[data-primary-amount]")).toBeNull();
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  test("interrupts an ordinary exit to drop $13 when its account boundary changes", () => {
    const restoreMotion = stubReducedMotion(false);
    try {
      const view = renderTrade(verifiedClient("cdp-embedded"));
      composeThirteen();
      fireEvent.click(page().getByRole("button", { name: "Close trade" }));
      expect(document.querySelector("[data-primary-amount]")?.textContent).toBe("$13");

      rerenderTrade(view, verifiedClient("cdp-embedded", "b"));

      expect(document.querySelector("[data-primary-amount]")).toBeNull();
      expect(document.querySelector("dialog[open]")).toBeNull();
    } finally {
      restoreMotion();
    }
  });

  test("keeps the same-owner amount-to-permit transition intact after the amount exit", async () => {
    const restoreMotion = stubReducedMotion(false);
    try {
      let requestSignal: AbortSignal | undefined;
      renderTrade({
        ...verifiedClient("cdp-embedded"),
        fetchAccountResource: async (_path, options) => {
          requestSignal = options?.signal;
          return tradeIntent();
        },
      });
      composeThirteen();
      fireEvent.click(page().getByRole("button", { name: "Continue" }));

      await waitFor(() =>
        expect(page().getByRole("button", { name: "Authorize exact spend" })).toBeTruthy(),
      );
      expect(requestSignal).toBeDefined();

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });

      expect(document.querySelector("[data-primary-amount]")).toBeNull();
      expect(page().getByRole("heading", { name: "Review buy" })).toBeTruthy();
      expect(
        (page().getByRole("button", { name: "Authorize exact spend" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
      expect(requestSignal?.aborted).toBe(false);
    } finally {
      restoreMotion();
    }
  });

  test("aborts a pending prepare on owner change and lets the next owner compose", () => {
    const pending = pendingPrepareClient("a");
    const view = renderTrade(pending.client);
    composeThirteen();
    fireEvent.click(page().getByRole("button", { name: "Continue" }));

    expect(page().getByRole("button", { name: "Preparing…" })).toBeTruthy();
    expect(pending.signal()?.aborted).toBe(false);

    rerenderTrade(view, verifiedClient("cdp-embedded", "b"));

    expect(pending.signal()?.aborted).toBe(true);
    expect(document.querySelector("dialog[open]")).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Buy" }));
    fireEvent.click(page().getByRole("button", { name: "1" }));
    expect(document.querySelector("[data-primary-amount]")?.textContent).toBe("$1");
    expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled)
      .toBe(false);
  });

  test("aborts a pending prepare on sign-out and resets before the next sign-in", () => {
    const pending = pendingPrepareClient("a");
    const view = renderTrade(pending.client);
    composeThirteen();
    fireEvent.click(page().getByRole("button", { name: "Continue" }));

    expect(page().getByRole("button", { name: "Preparing…" })).toBeTruthy();
    expect(pending.signal()?.aborted).toBe(false);

    rerenderTrade(view, createBlockedAccountWalletClient("unconfigured"));

    expect(pending.signal()?.aborted).toBe(true);
    expect(document.querySelector("dialog[open]")).toBeNull();
    rerenderTrade(view, verifiedClient("cdp-embedded", "b"));
    fireEvent.click(page().getByRole("button", { name: "Buy" }));
    fireEvent.click(page().getByRole("button", { name: "1" }));
    expect(document.querySelector("[data-primary-amount]")?.textContent).toBe("$1");
    expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled)
      .toBe(false);
  });
});

function tradeIntent() {
  return {
    status: "signature-required",
    id: "12345678-1234-4123-8123-123456789abc",
    intentHash: "1".repeat(64),
    title: "Review buy",
    signerAddress: ADDRESS,
    signingRequestId: "trade-permit:12345678-1234-4123-8123-123456789abc",
    signingTypedData: {
      domain: {
        name: "Coinbase Smart Wallet",
        version: "1",
        chainId: 8453,
        verifyingContract: ADDRESS,
      },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        CoinbaseSmartWalletMessage: [{ name: "hash", type: "bytes32" }],
      },
      primaryType: "CoinbaseSmartWalletMessage",
      message: { hash: `0x${"2".repeat(64)}` },
    },
    permit: {
      domain: {
        name: "Permit2",
        chainId: 8453,
        verifyingContract: "0x000000000022d473030f116ddee9f6b43ac78ba3",
      },
      types: {},
      primaryType: "PermitTransferFrom",
      message: {},
    },
    spend: { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "13000000" },
    receive: {
      assetId: "cbbtc",
      symbol: "cbBTC",
      decimals: 8,
      minimumAmountBaseUnits: "1000",
    },
    warnings: [],
    permitExpiresAt: "2030-01-01T00:00:00.000Z",
    expiresAt: "2030-01-01T00:00:00.000Z",
  };
}

function pendingPrepareClient(owner: string) {
  let requestSignal: AbortSignal | undefined;
  const client: AccountWalletClient = {
    ...verifiedClient("cdp-embedded", owner),
    fetchAccountResource: (_path, options) => new Promise((_resolve, reject) => {
      requestSignal = options?.signal;
      requestSignal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    }),
  };
  return {
    client,
    signal: () => requestSignal,
  };
}

function stubReducedMotion(enabled: boolean) {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: enabled && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  })) as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}
