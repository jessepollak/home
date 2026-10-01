import { parseAddress } from "@/shared/chain/hex";
import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { cryptoAssets, type InvestAsset } from "@/config/invest-assets";
import { AccountWalletClientProvider, createBlockedAccountWalletClient } from "@/client/account/cdp-client";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { getHomeQueryClient } from "@/client/query/query-client";
import { balancesSnapshot } from "@/tests/browser/fixtures/balances";
import { TransferExecutionError } from "@/shared/transfers/types";
import type { ResourceFailureKind } from "@/client/account/resource-failure";
import { retryTradeAvailability, tradeAvailabilityRefetchInterval } from "./use-trade-availability";
import { invalidateAfterAction, invalidateIndexedScopes } from "@/client/query/after-action";
import { dataOwnerKey } from "@/client/account/owner-keys";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { TradeActions } = await import("./trade-actions");
const bitcoin = cryptoAssets.find((asset) => asset.id === "cbbtc")!;
const xrp = cryptoAssets.find((asset) => asset.id === "cbxrp")!;
const owner = balancesSnapshot().owner.address;
function buyButton(view: ReturnType<typeof render>): HTMLButtonElement {
  const control = view.getByRole("button", { name: "Buy" });
  if (!(control instanceof HTMLButtonElement)) throw new Error("Expected a Buy button");
  return control;
}

function show(
  asset: InvestAsset = bitcoin,
  status: "available" | "blocked" | "provider-unconfigured" | "signer-unsupported" | "token-unreadable" | "failed" = "available",
  holding = "100000",
  refresh?: () => Promise<void>,
  fetchAvailability?: (request: number, response: () => unknown) => Promise<unknown> | unknown,
) {
  let balanceRequests = 0;
  let availabilityRequests = 0;
  const session = {
    user: { subject: "playwright-smoke-subject" },
    smartAccount: { address: owner, chainId: 8453 as const },
    accountProvider: "cdp-embedded" as const,
  };
  const paths: string[] = [];
  const client = {
    ...createBlockedAccountWalletClient("provider-unavailable"),
    status: "verified" as const,
    verification: "server" as const,
    ownerKey: session.user.subject,
    session,
    fetchBalances: async () => {
      if (balanceRequests++ > 0 && refresh) await refresh();
      return balancesSnapshot();
    },
    fetchAccountResource: async (path: string) => {
      paths.push(path);
      availabilityRequests += 1;
      if (fetchAvailability) return fetchAvailability(availabilityRequests, response);
      return status === "failed" ? Promise.reject(new Error("synthetic failure")) : response();
    },
  };
  function response() {
    return status === "available" || status === "blocked"
      ? { version: 2, status: "available", token: { assetId: asset.id, address: asset.contractAddress.toLowerCase(), symbol: asset.representation.tokenSymbol, decimals: asset.id === "cbbtc" ? 8 : 6 }, buy: status === "blocked" ? "blocked" : "available", balanceBaseUnits: holding }
      : { version: 2, status: "unavailable", reason: status };
  }
  const view = render(<AccountWalletClientProvider client={client}><PresentationRegionProvider regionId="US"><TradeActions asset={asset} /></PresentationRegionProvider></AccountWalletClientProvider>);
  return { ...view, paths, availabilityRequests: () => availabilityRequests };
}

afterEach(() => { cleanup(); getHomeQueryClient().clear(); });

describe("per-asset trading availability", () => {
  test("a verified session without an SDK owner stays unable to trade", () => {
    const session = { user: { subject: "trade-a" }, smartAccount: { address: owner, chainId: 8453 as const }, accountProvider: "cdp-embedded" as const };
    let requests = 0;
    const client = { ...createBlockedAccountWalletClient("provider-unavailable"), status: "verified" as const, verification: "server" as const, session,
      fetchBalances: async () => { requests++; return balancesSnapshot(); },
      fetchAccountResource: async () => { requests++; throw new Error("No owner-scoped request expected"); } };
    const view = render(<AccountWalletClientProvider client={client}><PresentationRegionProvider regionId="US"><TradeActions asset={bitcoin} /></PresentationRegionProvider></AccountWalletClientProvider>);
    expect(buyButton(view).disabled).toBe(true);
    expect(view.queryByRole("textbox", { name: "Amount" })).toBeNull();
    expect(requests).toBe(0);
  });
  test("a mounted trade does not return after switching owners or signing out", async () => {
    const base = createBlockedAccountWalletClient("provider-unavailable");
    const sessionA = { user: { subject: "trade-a" }, smartAccount: { address: owner, chainId: 8453 as const }, accountProvider: "cdp-embedded" as const };
    const sessionB = { ...sessionA, user: { subject: "trade-b" }, smartAccount: { address: "0x2222222222222222222222222222222222222222" as const, chainId: 8453 as const } };
    const available = { version: 2, status: "available", token: { assetId: bitcoin.id, address: bitcoin.contractAddress.toLowerCase(), symbol: bitcoin.representation.tokenSymbol, decimals: 8 }, buy: "available", balanceBaseUnits: "100000" };
    const clientA = { ...base, status: "verified" as const, verification: "server" as const, ownerKey: "trade-a", session: sessionA,
      fetchBalances: async () => balancesSnapshot(), fetchAccountResource: async () => available };
    const clientB = { ...clientA, ownerKey: "trade-b", session: sessionB,
      fetchBalances: async () => ({ ...balancesSnapshot(), owner: { address: sessionB.smartAccount.address, chainId: 8453 as const } }) };
    const surface = (client: typeof clientA) => <AccountWalletClientProvider client={client}><PresentationRegionProvider regionId="US"><TradeActions asset={bitcoin} /></PresentationRegionProvider></AccountWalletClientProvider>;
    const view = render(surface(clientA));
    const buy = buyButton(view);
    await waitFor(() => expect(buy.disabled).toBe(false));
    fireEvent.click(buy);
    await view.findByRole("textbox", { name: "Amount" });
    view.rerender(surface(clientB));
    await waitFor(() => expect(view.queryByRole("textbox", { name: "Amount" })).toBeNull());
    view.rerender(surface(clientA));
    await waitFor(() => expect(buyButton(view).disabled).toBe(false));
    expect(view.queryByRole("textbox", { name: "Amount" })).toBeNull();
    view.rerender(<AccountWalletClientProvider client={base}><PresentationRegionProvider regionId="US"><TradeActions asset={bitcoin} /></PresentationRegionProvider></AccountWalletClientProvider>);
    view.rerender(surface(clientA));
    await waitFor(() => expect(buyButton(view).disabled).toBe(false));
    expect(view.queryByRole("textbox", { name: "Amount" })).toBeNull();
  });
  test.each(["Buy", "Sell"] as const)("%s pointer intent mounts a closed sheet so click focuses Amount in the tap", async (label) => {
    const view = show();
    const button = view.getByRole("button", { name: label }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    await act(async () => { fireEvent.pointerDown(button); await import("./trade-money-dialog"); });
    fireEvent.click(button);
    expect(document.activeElement).toBe(view.getByRole("textbox", { name: "Amount" }));
  });
  test.each(["Buy", "Sell"] as const)("%s without pointer intent still focuses Amount after loading", async (label) => {
    const view = show();
    const button = view.getByRole("button", { name: label }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(document.activeElement).toBe(view.getByRole("textbox", { name: "Amount" })));
  });
  test.each([
    ["signed-out", "Sign in to trade."],
    ["restoring", "Checking trading availability…"],
    ["validating", "Checking trading availability…"],
    ["verified", "Trading isn't available for this account."],
  ] as const)("%s without a verified smart account shows %s", (status, message) => {
    const client = { ...createBlockedAccountWalletClient("provider-unavailable"), status,
      ...(status === "verified" ? { verification: "server" as const, session: { user: { subject: "test" }, smartAccount: null, accountProvider: "cdp-embedded" as const } } : {}) };
    const view = render(<AccountWalletClientProvider client={client}><TradeActions asset={bitcoin} /></AccountWalletClientProvider>);
    expect(view.getByText(message)).toBeTruthy();
    expect((view.getByRole("button", { name: "Buy" }) as HTMLButtonElement).disabled).toBe(true);
    expect((view.getByRole("button", { name: "Sell" }) as HTMLButtonElement).disabled).toBe(true);
  });
  test("Buy and Sell enable only when the owner is available and balances loaded", async () => {
    const view = show();
    expect((view.getByRole("button", { name: "Buy" }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect((view.getByRole("button", { name: "Buy" }) as HTMLButtonElement).disabled).toBe(false));
    expect((view.getByRole("button", { name: "Sell" }) as HTMLButtonElement).disabled).toBe(false);
  });
  test("a background balances refresh keeps Buy and Sell usable", async () => {
    let refreshing = false;
    let finish: (() => void) | undefined;
    const view = show(bitcoin, "available", "100000", () => new Promise<void>((resolve) => { refreshing = true; finish = resolve; }));
    await waitFor(() => expect((view.getByRole("button", { name: "Buy" }) as HTMLButtonElement).disabled).toBe(false));
    void getHomeQueryClient().invalidateQueries();
    await waitFor(() => expect(refreshing).toBe(true));
    expect((view.getByRole("button", { name: "Buy" }) as HTMLButtonElement).disabled).toBe(false);
    expect((view.getByRole("button", { name: "Sell" }) as HTMLButtonElement).disabled).toBe(false);
    finish?.();
    await waitFor(() => expect(getHomeQueryClient().isFetching()).toBe(0));
  });
  test("configured crypto besides Bitcoin trades, with sell determined by chain balance", async () => {
    const view = show(xrp, "available", "2500000");
    await waitFor(() => expect((view.getByRole("button", { name: "Sell" }) as HTMLButtonElement).disabled).toBe(false));
    expect((view.getByRole("button", { name: "Buy" }) as HTMLButtonElement).disabled).toBe(false);
    expect(view.paths).toContain("/api/trades?assetId=cbxrp");
  });
  test("a submitted and a settled trade both refresh this token's chain balance", async () => {
    let holding = "0";
    const view = show(xrp, "available", "0", undefined, (_request, response) => ({ ...(response() as object), balanceBaseUnits: holding }));
    await waitFor(() => expect(view.getByText("No cbXRP available to sell.")).toBeTruthy());
    const owner = dataOwnerKey({ user: { subject: "playwright-smoke-subject" }, smartAccount: { address: balancesSnapshot().owner.address, chainId: 8453 }, accountProvider: "cdp-embedded" });
    await invalidateAfterAction(getHomeQueryClient(), owner);
    expect(view.availabilityRequests()).toBe(2);
    holding = "2500000";
    await invalidateIndexedScopes(getHomeQueryClient(), owner);
    await waitFor(() => expect((view.getByRole("button", { name: "Sell" }) as HTMLButtonElement).disabled).toBe(false));
    expect(view.availabilityRequests()).toBe(3);
  });
  test("blocked buy leaves sell enabled", async () => {
    const view = show(xrp, "blocked");
    await waitFor(() => expect(view.getByText("Buying is unavailable. You can still sell or send.")).toBeTruthy());
    expect((view.getByRole("button", { name: "Buy" }) as HTMLButtonElement).disabled).toBe(true);
    expect((view.getByRole("button", { name: "Sell" }) as HTMLButtonElement).disabled).toBe(false);
  });
  test("zero onchain balance disables sell while preserving buy", async () => {
    const view = show(xrp, "available", "0");
    await waitFor(() => expect(view.getByText("No cbXRP available to sell.")).toBeTruthy());
    expect((view.getByRole("button", { name: "Buy" }) as HTMLButtonElement).disabled).toBe(false);
    expect((view.getByRole("button", { name: "Sell" }) as HTMLButtonElement).disabled).toBe(true);
  });
  test("a transient trade availability failure keeps checking and then enables Buy", async () => {
    const view = show(bitcoin, "available", "100000", undefined, (request, response) => {
      if (request === 1) throw Object.assign(new TransferExecutionError("unavailable"), { kind: "http" satisfies ResourceFailureKind, status: 503 });
      return response();
    });
    await waitFor(() => expect(getHomeQueryClient().getQueryCache().findAll().find((query) => query.queryKey[1] === "trade-availability")?.state.fetchFailureCount).toBe(1));
    expect(view.availabilityRequests()).toBe(1);
    expect(view.getByText("Checking trading availability…")).toBeTruthy();
    expect(view.queryByText("Trading isn't available right now. Try again later.")).toBeNull();
    await waitFor(() => expect((view.getByRole("button", { name: "Buy" }) as HTMLButtonElement).disabled).toBe(false));
    expect(view.queryByText("Trading isn't available right now. Try again later.")).toBeNull();
    expect(view.availabilityRequests()).toBe(2);
  });
  test("persistent transient failures show unavailable after two retries", async () => {
    const view = show(bitcoin, "available", "100000", undefined, () => {
      throw Object.assign(new TransferExecutionError("unavailable"), { kind: "http" satisfies ResourceFailureKind, status: 503 });
    });
    await waitFor(() => expect(view.getByText("Trading isn't available right now. Try again later.")).toBeTruthy(), { timeout: 2_000 });
    expect(view.availabilityRequests()).toBe(3);
    expect(view.queryByText("Checking trading availability…")).toBeNull();
  });
  test("a definitive unavailable response is not retried", async () => {
    const view = show(bitcoin, "provider-unconfigured");
    await waitFor(() => expect(view.getByText("Trading isn't available right now. Try again later.")).toBeTruthy());
    expect(view.availabilityRequests()).toBe(1);
  });
  test("keeps refreshing successful availability so balance and chain recovery reach a mounted page", () => {
    const token = { assetId: "cbbtc", address: parseAddress("0x2222222222222222222222222222222222222222")!, symbol: "cbBTC", decimals: 8 };
    expect(tradeAvailabilityRefetchInterval({ state: { status: "error" } })).toBe(30_000);
    expect(tradeAvailabilityRefetchInterval({ state: { status: "success", data: { version: 2, status: "unavailable", reason: "chain-unavailable" } } })).toBe(30_000);
    expect(tradeAvailabilityRefetchInterval({ state: { status: "success", data: { version: 2, status: "available", token, buy: "available", balanceBaseUnits: "1" } } })).toBe(60_000);
    expect(tradeAvailabilityRefetchInterval({ state: { status: "success", data: { version: 2, status: "unavailable", reason: "asset-unsupported" } } })).toBe(false);
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
  test.each([
    ["provider-unconfigured", "Trading isn't available right now. Try again later."],
    ["signer-unsupported", "Trading isn't available for this account."],
    ["token-unreadable", "This token couldn't be read on Base. You can still send it."],
    ["failed", "Trading isn't available right now. Try again later."],
  ] as const)("%s has distinct recovery", async (status, message) => {
    const view = show(xrp, status);
    await waitFor(() => expect(view.getByText(message)).toBeTruthy());
    expect((view.getByRole("button", { name: "Buy" }) as HTMLButtonElement).disabled).toBe(true);
    expect((view.getByRole("button", { name: "Sell" }) as HTMLButtonElement).disabled).toBe(true);
    if (status === "failed") expect(view.queryByText("Checking trading availability…")).toBeNull();
  });
  test("cached Bitcoin availability never enables a different asset", async () => {
    const first = show(bitcoin);
    await waitFor(() => expect((first.getByRole("button", { name: "Sell" }) as HTMLButtonElement).disabled).toBe(false));
    cleanup();
    const second = show(xrp, "blocked");
    await waitFor(() => expect(second.getByText("Buying is unavailable. You can still sell or send.")).toBeTruthy());
    expect(second.paths).toContain("/api/trades?assetId=cbxrp");
  });
});
