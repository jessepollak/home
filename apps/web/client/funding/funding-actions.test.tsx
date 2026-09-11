import "@/client/account/dom-test-harness";

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import type { Root } from "react-dom/client";
import type { AccountWalletClient } from "@/client/account/cdp-client";

const replaceCalls: string[] = [];
mock.module("next/navigation", () => ({
  useRouter: () => ({
    replace: (href: string) => replaceCalls.push(href),
  }),
  usePathname: () => "/dashboard",
}));

const { act, fireEvent, waitFor, within } = await import("@testing-library/react");
const { hydrateRoot } = await import("react-dom/client");
const { FundingActionsForWallet } = await import("./funding-actions");

(window as typeof window & {
  happyDOM: { settings: { disableIframePageLoading: boolean } };
}).happyDOM.settings.disableIframePageLoading = true;

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const PAYMENT_LINK =
  "https://pay.coinbase.com/v2/api-onramp/apple-pay?sessionToken=fixture-token";
const originalConsoleError = console.error;

type FundingWallet = Pick<
  AccountWalletClient,
  "ownerKey" | "status" | "session" | "fetchAccountResource"
>;

function verifiedWallet(): FundingWallet {
  return {
    ownerKey: "funding-owner",
    status: "verified",
    session: {
      user: { subject: "funding-subject" },
      smartAccount: { address: ADDRESS, chainId: 8453 },
      accountProvider: "cdp-embedded",
    },
    fetchAccountResource: async () => {
      throw new Error("hosted funding fixture not configured");
    },
  };
}

async function hydrateFundingActions(element: ReactElement) {
  const serverMarkup = renderToString(element);
  const container = document.createElement("div");
  container.innerHTML = serverMarkup;
  document.body.append(container);
  const hydrationErrors: unknown[] = [];
  let root!: Root;

  await act(async () => {
    root = hydrateRoot(container, element, {
      onRecoverableError: (error) => hydrationErrors.push(error),
    });
  });

  return { container, hydrationErrors, root, serverMarkup };
}

async function unmount(root: Root, container: HTMLElement) {
  await act(async () => root.unmount());
  container.remove();
}

function page() {
  return within(document.body);
}

beforeEach(() => {
  console.error = (...args: unknown[]) => {
    if (String(args[0]).includes("Iframe page loading is disabled")) return;
    originalConsoleError(...args);
  };
});

afterEach(() => {
  console.error = originalConsoleError;
  replaceCalls.length = 0;
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

describe("FundingActions hydration", () => {
  test("hydrates the closed default without rendering the portal on the server", async () => {
    const fixture = await hydrateFundingActions(
      <FundingActionsForWallet wallet={verifiedWallet()} />,
    );

    try {
      expect(fixture.serverMarkup).toContain("Add money");
      expect(fixture.serverMarkup).not.toContain("<dialog");
      expect(fixture.hydrationErrors).toEqual([]);
      expect(fixture.container.querySelector("dialog")).toBeNull();
      const dialog = document.body.querySelector("dialog");
      expect(dialog).toBeTruthy();
      expect(dialog?.hasAttribute("open")).toBe(false);
      expect(dialog?.closest(".action-row")).toBeNull();
    } finally {
      await unmount(fixture.root, fixture.container);
    }
  });

  test("hydrates initialOpen and settles with the Add money portal open", async () => {
    const fixture = await hydrateFundingActions(
      <FundingActionsForWallet wallet={verifiedWallet()} initialOpen />,
    );

    try {
      expect(fixture.serverMarkup).toContain("Add money");
      expect(fixture.serverMarkup).not.toContain("<dialog");
      expect(fixture.hydrationErrors).toEqual([]);
      const dialog = document.body.querySelector("dialog");
      expect(dialog?.hasAttribute("open")).toBe(true);
      expect(dialog?.getAttribute("aria-labelledby")).toBe("add-money-title");
      expect(dialog?.textContent).toContain("Fund this Base account");
      expect(dialog?.closest(".action-row")).toBeNull();
    } finally {
      await unmount(fixture.root, fixture.container);
    }
  });

  test("hydrates a Coinbase return and settles on the Receive portal", async () => {
    const fixture = await hydrateFundingActions(
      <FundingActionsForWallet wallet={verifiedWallet()} returnedFromCoinbase />,
    );

    try {
      expect(fixture.serverMarkup).toContain("Add money");
      expect(fixture.serverMarkup).not.toContain("<dialog");
      expect(fixture.hydrationErrors).toEqual([]);
      const dialog = document.body.querySelector("dialog");
      expect(dialog?.hasAttribute("open")).toBe(true);
      expect(dialog?.textContent).toContain("Receive on Base");
      expect(dialog?.textContent).toContain("0x1111…111111");
      expect(dialog?.closest(".action-row")).toBeNull();
    } finally {
      await unmount(fixture.root, fixture.container);
    }
  });

  test("pending dismissal calls onClosed, cleans the dashboard route, and reopening does not resend", async () => {
    let requestCount = 0;
    let closedCount = 0;
    const fixture = await hydrateFundingActions(
      <FundingActionsForWallet
        wallet={{
          ...verifiedWallet(),
          fetchAccountResource: async () => {
            requestCount += 1;
            return {
              url: PAYMENT_LINK,
              presentation: "iframe",
              asset: {
                id: "usdc",
                symbol: "USDC",
                decimals: 6,
                tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              },
              network: { name: "Base", chainId: 8453 },
            };
          },
        }}
        initialOpen
        onClosed={() => {
          closedCount += 1;
        }}
      />,
    );

    try {
      fireEvent.click(page().getByRole("button", { name: /Buy USDC with Coinbase/ }));
      fireEvent.click(page().getByRole("button", { name: "Continue to Coinbase" }));
      const frame = await page().findByTitle("Coinbase payment") as HTMLIFrameElement;
      const source = {} as MessageEventSource;
      Object.defineProperty(frame, "contentWindow", {
        configurable: true,
        value: source,
      });
      act(() => {
        window.dispatchEvent(new MessageEvent("message", {
          source,
          origin: "https://pay.coinbase.com",
          data: { eventName: "onramp_api.polling_success" },
        }));
      });

      await page().findByRole(
        "dialog",
        { name: "Deposit pending" },
        { timeout: 3_000 },
      );
      fireEvent.click(page().getByRole("button", { name: "Close and check balance" }));
      await waitFor(() => expect(closedCount).toBe(1));
      expect(replaceCalls).toEqual(["/dashboard"]);
      expect(requestCount).toBe(1);

      fireEvent.click(page().getByRole("button", { name: "Add money" }));
      expect(page().getByRole("dialog", { name: "Add money" })).toBeTruthy();
      expect(page().getByRole("button", { name: /Buy USDC with Coinbase/ })).toBeTruthy();
      expect(requestCount).toBe(1);
    } finally {
      await unmount(fixture.root, fixture.container);
    }
  });
});
