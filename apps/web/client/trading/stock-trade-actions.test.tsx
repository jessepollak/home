import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { stockAssets } from "@/config/invest-assets";
import { AccountWalletClientProvider, createBlockedAccountWalletClient } from "@/client/account/cdp-client";
import { getHomeQueryClient } from "@/client/query/query-client";

const { cleanup, render, waitFor } = await import("@testing-library/react");
const { StockTradeActions } = await import("./stock-trade-actions");
const stock = stockAssets[0];
const owner = "0x1111111111111111111111111111111111111111" as const;
const session = { user: { subject: "stock-test" }, smartAccount: { address: owner, chainId: 8453 as const }, accountProvider: "cdp-embedded" as const };

afterEach(() => { cleanup(); getHomeQueryClient().clear(); });

function show(state: "signed-out" | "no-account" | "pending" | "error" | "restricted" | "eligible" | "invalid") {
  const client = state === "signed-out" ? createBlockedAccountWalletClient("provider-unavailable") : {
    ...createBlockedAccountWalletClient("provider-unavailable"),
    status: "verified" as const, verification: "server" as const,
    session: state === "no-account" ? { ...session, smartAccount: null } : session,
    fetchAccountResource: async (path: string) => {
      expect(path).toBe("/api/trades/stock-eligibility");
      if (state === "pending") return new Promise<unknown>(() => {});
      if (state === "error") throw new Error("offline");
      if (state === "invalid") return { version: 1, buy: "eligible", sell: "restricted" };
      return { version: 1, buy: state, sell: "eligible" };
    },
  };
  return render(<AccountWalletClientProvider client={client}><StockTradeActions asset={stock} layout="row" /></AccountWalletClientProvider>);
}

describe("stock trade note", () => {
  test.each(["signed-out", "no-account"] as const)("does not query for %s", (state) => {
    expect(show(state).getByRole("status").textContent).toBe("Stocks aren't available yet.");
  });
  test("shows checking while the request is pending", () => {
    expect(show("pending").getByRole("status").textContent).toBe("Checking stock trading…");
  });
  test.each(["error", "invalid"] as const)("fails closed on %s", async (state) => {
    const view = show(state);
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("Stock trading isn't available right now."));
  });
  test.each([["restricted", "Stock buys aren't available in your location."], ["eligible", "Stocks can't be traded in Home yet."]] as const)("displays %s status without trade controls", async (state, copy) => {
    const view = show(state);
    await waitFor(() => expect(view.getByRole("status").textContent).toBe(copy));
    expect(view.queryByRole("button")).toBeNull();
  });
});
