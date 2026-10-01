import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, mock, test } from "bun:test";
import { hydrateServerRender } from "@/tests/helpers/hydration";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { getHomeQueryClient } from "@/client/query/query-client";
import { FUNDING_OPEN_ORDER_VERSION } from "@/shared/funding/contracts/open-order";
import { FUNDING_PROVIDERS_VERSION } from "@/shared/funding/contracts/providers";

const replaceCalls: string[] = [];
const actualNavigation = await import("next/navigation");
await mock.module("next/navigation", () => ({
  ...actualNavigation,
  useRouter: () => ({
    replace: (href: string) => replaceCalls.push(href),
  }),
  usePathname: () => "/home",
}));

const { act, waitFor } = await import("@testing-library/react");
const { FundingActionsForWallet } = await import("./funding-actions");
// The Add money sheet renders only after this deferred chunk is evaluated, which a loaded
// shared runner can stretch past Bun's 5 s default watchdog inside a test. Warming the
// chunk at file load keeps that cost out of the test windows without resolving the sheet's
// shared loader, so this file's cold-open shell and handoff still run.
await import("./add-money-dialog");

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;

function providersOk(providers: unknown[]) {
  return { version: FUNDING_PROVIDERS_VERSION, direction: "onramp" as const, providers };
}

type FundingWallet = Pick<
  AccountWalletClient,
  "ownerKey" | "status" | "verification" | "session" | "fetchAccountResource"
>;

function verifiedWallet(): FundingWallet {
  return {
    ownerKey: "funding-owner",
    status: "verified",
    verification: "server",
    session: {
      user: { subject: "funding-subject" },
      smartAccount: { address: ADDRESS, chainId: 8453 },
      accountProvider: "cdp-embedded",
    },
    fetchAccountResource: async () => {
      throw new Error("funding fixture not configured");
    },
  };
}

afterEach(() => {
  replaceCalls.length = 0;
  getHomeQueryClient().clear();
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

describe("FundingActions hydration", () => {
  test("hydrates a Coinbase return and settles on the Receive portal", async () => {
    const fixture = await hydrateServerRender(
      <FundingActionsForWallet wallet={verifiedWallet()} returnedFromProvider />,
    );

    try {
      expect(fixture.serverMarkup).toContain("Add money");
      expect(fixture.serverMarkup).not.toContain('data-slot="drawer-popup"');
      expect(fixture.hydrationErrors).toEqual([]);
      const drawer = await waitFor(() => {
        const popup = document.body.querySelector('[data-slot="drawer-popup"]');
        expect(popup?.textContent).toContain("Receive on Base");
        return popup;
      });
      expect(drawer?.textContent).toContain("Receive on Base");
      expect(drawer?.textContent).toContain("0x1111…111111");
      expect(drawer?.closest(".action-row")).toBeNull();
    } finally {
      await fixture.unmount();
    }
  });

  test("a verification return received after mount opens the pending deposit review", async () => {
    window.history.replaceState(null, "", "/home?add-money=1&return=verification");
    const requests: string[] = [];
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      requests.push(path);
      if (path.startsWith("/api/funding/providers?")) return providersOk([{ direction: "onramp", providerId: "ripio", displayName: "Ripio", region: "AR", assetId: "base:wars", assetSymbol: "wARS", assetDecimals: 18, currency: "ARS", paymentMethods: [{ id: "bank_transfer", label: "Bank transfer" }], quotes: true, customerSetup: null }]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: { id: "11111111-1111-4111-8111-111111111111", providerId: "ripio", state: "awaiting-payment", fiatAmount: "1000", providerStatus: null, instructions: null } };
      throw new Error(`unexpected request: ${path}`);
    } };
    const fixture = await hydrateServerRender(<FundingActionsForWallet wallet={wallet} regionId="AR" />);

    try {
      expect(fixture.hydrationErrors).toEqual([]);
      expect(document.body.textContent).not.toContain("Deposit pending");
      await act(async () => fixture.root.render(<FundingActionsForWallet wallet={wallet} regionId="AR" returnedFromProvider />));
      await waitFor(() => expect(document.body.querySelector('[data-slot="drawer-popup"]')?.textContent).toContain("Deposit pending"));
      expect(requests.every((path) => path.startsWith("/api/funding/providers?") || path.startsWith("/api/funding/orders?"))).toBe(true);
    } finally {
      await fixture.unmount();
      window.history.replaceState(null, "", "/home");
    }
  });

  test("closing an inbound flow reopened by the trigger clears the flow instead of leaving the page", async () => {
    window.history.replaceState(null, "", "/home?flow=add-money");
    const back = mock(() => {});
    const originalBack = window.history.back;
    Object.defineProperty(window.history, "back", { configurable: true, value: back });
    const fixture = await hydrateServerRender(
      <FundingActionsForWallet wallet={verifiedWallet()} initialFlow="add-money" />,
    );

    try {
      const trigger = Array.from(fixture.container.querySelectorAll<HTMLAnchorElement>("a"))
        .find((button) => button.textContent?.includes("Add money"));
      expect(trigger?.getAttribute("href")).toBe("/home?flow=add-money");
      await act(async () => trigger?.click());
      expect(`${window.location.pathname}${window.location.search}`).toBe("/home?flow=add-money");
      const close = await waitFor(() => {
        const button = document.body.querySelector<HTMLButtonElement>('[data-slot="drawer-popup"] button[aria-label="Close add money"]');
        expect(button).not.toBeNull();
        return button;
      });
      await act(async () => close?.click());

      expect(back).not.toHaveBeenCalled();
      expect(`${window.location.pathname}${window.location.search}`).toBe("/home");
    } finally {
      Object.defineProperty(window.history, "back", { configurable: true, value: originalBack });
      await fixture.unmount();
    }
  });
});
