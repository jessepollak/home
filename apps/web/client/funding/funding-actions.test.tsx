import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import type { Root } from "react-dom/client";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { getHomeQueryClient } from "@/client/query/query-client";

const replaceCalls: string[] = [];
const actualNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...actualNavigation,
  useRouter: () => ({
    replace: (href: string) => replaceCalls.push(href),
  }),
  usePathname: () => "/home",
}));

const { act, waitFor } = await import("@testing-library/react");
const { hydrateRoot } = await import("react-dom/client");
const { FundingActionsForWallet } = await import("./funding-actions");

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;

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

afterEach(() => {
  replaceCalls.length = 0;
  getHomeQueryClient().clear();
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

describe("FundingActions hydration", () => {
  test("hydrates a Coinbase return and settles on the Receive portal", async () => {
    const fixture = await hydrateFundingActions(
      <FundingActionsForWallet wallet={verifiedWallet()} returnedFromProvider />,
    );

    try {
      expect(fixture.serverMarkup).toContain("Add money");
      expect(fixture.serverMarkup).not.toContain('data-slot="drawer-popup"');
      expect(fixture.hydrationErrors).toEqual([]);
      const drawer = await waitFor(() => {
        const popup = document.body.querySelector('[data-slot="drawer-popup"]');
        expect(popup).not.toBeNull();
        return popup;
      });
      expect(drawer?.textContent).toContain("Receive on Base");
      expect(drawer?.textContent).toContain("0x1111…111111");
      expect(drawer?.closest(".action-row")).toBeNull();
    } finally {
      await unmount(fixture.root, fixture.container);
    }
  });

  test("closing an inbound flow reopened by the trigger clears the flow instead of leaving the page", async () => {
    window.history.replaceState(null, "", "/home?flow=add-money");
    const back = mock(() => {});
    const originalBack = window.history.back;
    Object.defineProperty(window.history, "back", { configurable: true, value: back });
    const fixture = await hydrateFundingActions(
      <FundingActionsForWallet wallet={verifiedWallet()} initialFlow="add-money" />,
    );

    try {
      const trigger = Array.from(fixture.container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Add money"));
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
      await unmount(fixture.root, fixture.container);
    }
  });
});
