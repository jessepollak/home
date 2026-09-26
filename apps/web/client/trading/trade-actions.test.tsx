import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { cryptoAssets } from "@/config/invest-assets";
import { AccountWalletClientProvider, createBlockedAccountWalletClient } from "@/client/account/cdp-client";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { getHomeQueryClient } from "@/client/query/query-client";
import { balancesSnapshot } from "@/tests/browser/fixtures/balances";

const { cleanup, render, waitFor } = await import("@testing-library/react");
const { TradeActions } = await import("./trade-actions");
const bitcoin = cryptoAssets.find((asset) => asset.id === "cbbtc")!;
const owner = balancesSnapshot().owner.address;

function show(status: "available" | "provider-unconfigured" | "signer-unsupported" | "failed", balance = "100000", refresh?: () => Promise<void>) {
  let balanceRequests = 0;
  const session = {
    user: { subject: "playwright-smoke-subject" },
    smartAccount: { address: owner, chainId: 8453 as const },
    accountProvider: "cdp-embedded" as const,
  };
  const client = {
    ...createBlockedAccountWalletClient("provider-unavailable"),
    status: "verified" as const,
    verification: "server" as const,
    session,
    fetchBalances: async () => {
      if (balanceRequests++ > 0 && refresh) await refresh();
      return { ...balancesSnapshot(), holdings: balancesSnapshot().holdings.map((holding) => holding.id === "cbbtc" ? { ...holding, balance: { status: "ready" as const, baseUnits: balance } } : holding) };
    },
    fetchAccountResource: async () => status === "failed"
      ? Promise.reject(new Error("synthetic network failure"))
      : status === "available" ? { version: 1, status }
      : { version: 1, status: "unavailable", reason: status },
  };
  return render(<AccountWalletClientProvider client={client}><PresentationRegionProvider regionId="US"><TradeActions asset={bitcoin} /></PresentationRegionProvider></AccountWalletClientProvider>);
}

afterEach(() => { cleanup(); getHomeQueryClient().clear(); });

describe("Bitcoin trading availability", () => {
  test("Buy and Sell enable only when the owner is available and balances loaded", async () => {
    const view = show("available");
    expect((view.getByRole("button", { name: "Buy" }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect((view.getByRole("button", { name: "Buy" }) as HTMLButtonElement).disabled).toBe(false));
    expect((view.getByRole("button", { name: "Sell" }) as HTMLButtonElement).disabled).toBe(false);
  });
  test("a background balances refresh keeps Buy and Sell usable", async () => {
    let refreshing = false;
    let finish: (() => void) | undefined;
    const view = show("available", "100000", () => new Promise<void>((resolve) => { refreshing = true; finish = resolve; }));
    await waitFor(() => expect((view.getByRole("button", { name: "Buy" }) as HTMLButtonElement).disabled).toBe(false));
    void getHomeQueryClient().invalidateQueries();
    await waitFor(() => expect(refreshing).toBe(true));
    expect((view.getByRole("button", { name: "Buy" }) as HTMLButtonElement).disabled).toBe(false);
    expect((view.getByRole("button", { name: "Sell" }) as HTMLButtonElement).disabled).toBe(false);
    finish?.();
    await waitFor(() => expect(getHomeQueryClient().isFetching()).toBe(0));
  });
  test("unconfigured provider and unsupported signer expose distinct recovery copy", async () => {
    const provider = show("provider-unconfigured");
    await waitFor(() => expect(provider.getByText("Trading isn't available right now.")).toBeTruthy());
    expect((provider.getByRole("button", { name: "Buy" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    getHomeQueryClient().clear();
    const signer = show("signer-unsupported");
    await waitFor(() => expect(signer.getByText("Trading isn't available for this account.")).toBeTruthy());
  });
  test("zero Bitcoin holding disables Sell while preserving Buy", async () => {
    const view = show("available", "0");
    await waitFor(() => expect(view.getByText("No Bitcoin available to sell.")).toBeTruthy());
    expect((view.getByRole("button", { name: "Buy" }) as HTMLButtonElement).disabled).toBe(false);
    expect((view.getByRole("button", { name: "Sell" }) as HTMLButtonElement).disabled).toBe(true);
  });
  test("failed availability shows unavailable instead of checking forever", async () => {
    const view = show("failed");
    await waitFor(() => expect(view.getByText("Trading isn't available right now.")).toBeTruthy());
    expect(view.queryByText("Checking trading availability…")).toBeNull();
    expect((view.getByRole("button", { name: "Buy" }) as HTMLButtonElement).disabled).toBe(true);
    expect((view.getByRole("button", { name: "Sell" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    const other = cryptoAssets.find((asset) => asset.id !== "cbbtc")!;
    const alternative = render(<TradeActions asset={other} />);
    expect((alternative.getByRole("button", { name: "Buy" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
