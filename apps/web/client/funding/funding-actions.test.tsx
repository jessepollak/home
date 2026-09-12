import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import type { Root } from "react-dom/client";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { getHomeQueryClient } from "@/client/query/query-client";

const replaceCalls: string[] = [];
mock.module("next/navigation", () => ({
  useRouter: () => ({
    replace: (href: string) => replaceCalls.push(href),
  }),
  usePathname: () => "/dashboard",
}));

const { act } = await import("@testing-library/react");
const { hydrateRoot } = await import("react-dom/client");
const { FundingActionsForWallet } = await import("./funding-actions");

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;

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
});
