import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { cryptoAssets } from "@/config/invest-assets";
import { AccountWalletClientProvider, createBlockedAccountWalletClient } from "@/client/account/cdp-client";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { getHomeQueryClient } from "@/client/query/query-client";
import { balancesSnapshot } from "@/tests/browser/fixtures/balances";
import { TransferExecutionError } from "@/shared/transfers/types";
import type { ResourceFailureKind } from "@/client/account/resource-failure";
import { retryTradeAvailability } from "./use-trade-availability";

const { cleanup, render, waitFor } = await import("@testing-library/react");
const { TradeActions } = await import("./trade-actions");
const bitcoin = cryptoAssets.find((asset) => asset.id === "cbbtc")!;
const owner = balancesSnapshot().owner.address;

function show(
  status: "available" | "provider-unconfigured" | "signer-unsupported" | "failed",
  balance = "100000",
  refresh?: () => Promise<void>,
  fetchAvailability?: (request: number) => Promise<unknown> | unknown,
) {
  let balanceRequests = 0;
  let availabilityRequests = 0;
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
    fetchAccountResource: async () => {
      availabilityRequests += 1;
      if (fetchAvailability) return fetchAvailability(availabilityRequests);
      if (status === "failed") throw new Error("synthetic network failure");
      return status === "available" ? { version: 1, status } : { version: 1, status: "unavailable", reason: status };
    },
  };
  const view = render(<AccountWalletClientProvider client={client}><PresentationRegionProvider regionId="US"><TradeActions asset={bitcoin} /></PresentationRegionProvider></AccountWalletClientProvider>);
  return { ...view, availabilityRequests: () => availabilityRequests };
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
  test("a transient trade availability failure keeps checking and then enables Buy", async () => {
    const view = show("available", "100000", undefined, (request) => {
      if (request === 1) throw Object.assign(new TransferExecutionError("unavailable"), { kind: "http" satisfies ResourceFailureKind, status: 503 });
      return { version: 1, status: "available" };
    });
    await waitFor(() => expect(getHomeQueryClient().getQueryCache().findAll().find((query) => query.queryKey[1] === "trade-availability")?.state.fetchFailureCount).toBe(1));
    expect(view.availabilityRequests()).toBe(1);
    expect(view.getByText("Checking trading availability…")).toBeTruthy();
    expect(view.queryByText("Trading isn't available right now.")).toBeNull();
    await waitFor(() => expect((view.getByRole("button", { name: "Buy" }) as HTMLButtonElement).disabled).toBe(false));
    expect(view.queryByText("Trading isn't available right now.")).toBeNull();
    expect(view.availabilityRequests()).toBe(2);
  });
  test("persistent transient failures show unavailable after two retries", async () => {
    const view = show("available", "100000", undefined, () => {
      throw Object.assign(new TransferExecutionError("unavailable"), { kind: "http" satisfies ResourceFailureKind, status: 503 });
    });
    await waitFor(() => expect(view.getByText("Trading isn't available right now.")).toBeTruthy(), { timeout: 2_000 });
    expect(view.availabilityRequests()).toBe(3);
    expect(view.queryByText("Checking trading availability…")).toBeNull();
  });
  test("a definitive unavailable response is not retried", async () => {
    const view = show("provider-unconfigured");
    await waitFor(() => expect(view.getByText("Trading isn't available right now.")).toBeTruthy());
    expect(view.availabilityRequests()).toBe(1);
  });
  test("retries only transient transport errors and caps retries at two", () => {
    const transient = [
      Object.assign(new TransferExecutionError("unavailable"), { kind: "network" satisfies ResourceFailureKind }),
      ...[429, 500, 503, 599].map((status) => Object.assign(new TransferExecutionError("unavailable"), { kind: "http" satisfies ResourceFailureKind, status })),
    ];
    for (const error of transient) {
      expect(retryTradeAvailability(0, error)).toBe(true);
      expect(retryTradeAvailability(1, error)).toBe(true);
      expect(retryTradeAvailability(2, error)).toBe(false);
    }
    for (const status of [400, 401, 404, 499, 600]) {
      expect(retryTradeAvailability(0, Object.assign(new TransferExecutionError("unavailable"), { kind: "http" satisfies ResourceFailureKind, status }))).toBe(false);
    }
    for (const kind of ["parse", "access", "http"] as const) {
      expect(retryTradeAvailability(0, Object.assign(new TransferExecutionError("unavailable"), { kind }))).toBe(false);
    }
    expect(retryTradeAvailability(0, new TransferExecutionError("unavailable"))).toBe(false);
    expect(retryTradeAvailability(0, new TransferExecutionError("invalid-request"))).toBe(false);
    expect(retryTradeAvailability(0, new Error("Invalid trading availability response."))).toBe(false);
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
