import "@/features/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { AccountWalletClient } from "@/features/account/cdp-client";
import { cryptoAssets } from "@/config/invest-assets";

const { cleanup, render, within } = await import("@testing-library/react");
const {
  AccountWalletClientProvider,
  createBlockedAccountWalletClient,
} = await import("@/features/account/cdp-client");
const { TradeActions } = await import("./trade-actions");

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const bitcoin = cryptoAssets.find((asset) => asset.id === "cbbtc")!;

function page() {
  return within(document.body);
}

function verifiedClient(
  accountProvider: "cdp-embedded" | "base-account",
): AccountWalletClient {
  return {
    ...createBlockedAccountWalletClient("unconfigured"),
    projectConfigured: true,
    signInAvailability: "ready",
    ownerKey: "owner-a",
    status: "verified",
    session: {
      user: { subject: "subject-a" },
      smartAccount: { address: ADDRESS, chainId: 8453 },
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
