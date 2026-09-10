import "@/features/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { AccountWalletClient } from "@/features/account/cdp-client";
import { cryptoAssets } from "@/config/invest-assets";

const { cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
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

afterEach(cleanup);

describe("TradeActions hosted swap availability", () => {
  test("shows the actionable unavailable copy before requesting a wallet signature", async () => {
    const requests: Array<{ path: string; method?: string }> = [];
    let walletProviderCalls = 0;
    const client: AccountWalletClient = {
      ...createBlockedAccountWalletClient("unconfigured"),
      projectConfigured: true,
      signInAvailability: "ready",
      ownerKey: "owner-a",
      status: "verified",
      session: {
        user: { subject: "subject-a" },
        smartAccount: { address: ADDRESS, chainId: 8453 },
        accountProvider: "base-account",
      },
      fetchAccountResource: async (path, options) => {
        requests.push({ path, method: options?.method });
        throw Object.assign(new Error("Hosted swaps are unavailable."), {
          code: "HOSTED_SWAP_UNAVAILABLE",
        });
      },
      signTypedData: async () => {
        walletProviderCalls += 1;
        throw new Error("A wallet signature must not be requested.");
      },
      signInWithBaseAccount: async () => {
        walletProviderCalls += 1;
      },
    };

    render(
      <AccountWalletClientProvider client={client}>
        <TradeActions asset={bitcoin} />
      </AccountWalletClientProvider>,
    );

    fireEvent.click(page().getByRole("button", { name: "Buy" }));
    fireEvent.click(page().getByRole("button", { name: "1" }));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(page().getByRole("alert").textContent).toBe(
        "Swaps aren’t available right now. No trade was submitted. Try again later.",
      ),
    );
    expect(requests).toEqual([{ path: "/api/trades", method: "POST" }]);
    expect(walletProviderCalls).toBe(0);
  });
});
