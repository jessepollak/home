import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { AccountWalletClientProvider, createBlockedAccountWalletClient } from "@/client/account/cdp-client";
import { getHomeQueryClient } from "@/client/query/query-client";
import { balancesSnapshot } from "@/tests/browser/fixtures/balances";
import { borrowOverviewBody, sessionBody } from "@/tests/browser/fixtures/bodies";
import { VERIFIED_MORPHO_MARKETS } from "@/shared/morpho-markets/config";
import { buyRouteForToken } from "@/shared/trading/assets";

const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { BorrowOverview } = await import("./borrow-overview");
const bitcoin = VERIFIED_MORPHO_MARKETS[0]!.marketId;
const xrp = VERIFIED_MORPHO_MARKETS[1]!.marketId;
const session = {
  user: sessionBody.user,
  smartAccount: { address: sessionBody.smartAccount.address as `0x${string}`, chainId: 8453 as const },
  accountProvider: "cdp-embedded" as const,
};

type Scenario = { cash?: string; availability?: "available" | "blocked" | "unavailable" | "checking"; blockedAssetId?: string; balances?: "ready" | "loading" | "error" | "stale"; intro?: boolean; introHeld?: boolean; unavailableMarketId?: string; notHeldMarketIds?: string[]; verified?: boolean };
function show({ cash = "12340000", availability = "available", balances = "ready", intro = false, introHeld = false, unavailableMarketId, notHeldMarketIds, verified = true, blockedAssetId }: Scenario = {}) {
  const overview = borrowOverviewBody({ openMarketId: intro ? null : notHeldMarketIds?.includes(VERIFIED_MORPHO_MARKETS[2]!.marketId)
    ? VERIFIED_MORPHO_MARKETS[0]!.marketId : VERIFIED_MORPHO_MARKETS[2]!.marketId,
    notHeldMarketIds: notHeldMarketIds ?? (intro && !introHeld ? VERIFIED_MORPHO_MARKETS.map((market) => market.marketId) : [bitcoin, xrp]), unavailableMarketId });
  const paths: string[] = [];
  const client = {
    ...createBlockedAccountWalletClient("provider-unavailable"),
    ...(verified ? { status: "verified" as const, verification: "server" as const, session } : {}),
    fetchBalances: async () => {
      if (balances === "loading") return new Promise<ReturnType<typeof balancesSnapshot>>(() => {});
      if (balances === "error") throw new Error("Balances unavailable");
      const snapshot = balancesSnapshot();
      return { ...snapshot, ...(balances === "stale" ? { stale: true as const } : {}), holdings: snapshot.holdings.map((holding) => holding.id === "usdc"
        ? { ...holding, balance: { status: "ready" as const, baseUnits: cash } } : holding) };
    },
    fetchAccountResource: async (path: string) => {
      paths.push(path);
      if (path.startsWith("/api/trades?assetId=")) {
        if (availability === "checking") return new Promise<unknown>(() => {});
        const assetId = decodeURIComponent(path.slice("/api/trades?assetId=".length));
        const market = VERIFIED_MORPHO_MARKETS.find((entry) => buyRouteForToken({ chainId: entry.chainId, address: entry.collateralToken.address }) === assetId);
        if (availability !== "unavailable" && market) return { version: 2, status: "available", token: {
          assetId, address: market.collateralToken.address.toLowerCase(), symbol: market.collateralToken.symbol, decimals: market.collateralToken.decimals,
        }, buy: availability === "blocked" || blockedAssetId === assetId ? "blocked" : "available", balanceBaseUnits: "0" };
        return { version: 2, status: "unavailable", reason: "provider-unconfigured" };
      }
      if (path === "/api/actions/trade-pending") return { version: 1, trade: null };
      return { version: 1, usdcReserveBaseUnits: null };
    },
  };
  const view = render(<AccountWalletClientProvider client={client}><BorrowOverview session={session} overview={overview} /></AccountWalletClientProvider>);
  return { ...view, client, overview, paths };
}

afterEach(() => { cleanup(); getHomeQueryClient().clear(); });

describe("Borrow collateral Buy entry", () => {
  test("row pointer intent opens and focuses Amount within the click", async () => {
    const view = show();
    const buy = await view.findByRole("button", { name: "Buy Bitcoin" });
    await waitFor(() => expect(buy.getAttribute("aria-disabled")).toBeNull());
    await act(async () => { fireEvent.pointerDown(buy); await import("@/client/trading/trade-money-dialog"); });
    fireEvent.click(buy);
    expect(document.activeElement).toBe(within(document.body).getByRole("textbox", { name: "Amount" }));
  });
  test.each([...VERIFIED_MORPHO_MARKETS])("opens exact $collateralToken.symbol Buy sheet", async (market) => {
    const view = show({ notHeldMarketIds: [market.marketId] });
    const name = market.collateralDisplay.name;
    const buy = await view.findByRole("button", { name: `Buy ${name}` });
    await waitFor(() => expect(buy.getAttribute("aria-disabled")).toBeNull());
    const assetId = buyRouteForToken({ chainId: market.chainId, address: market.collateralToken.address });
    expect(view.paths).toContain(`/api/trades?assetId=${encodeURIComponent(assetId!)}`);
    expect(getHomeQueryClient().getQueryCache().getAll().some((query) => query.queryKey[2] === assetId &&
      (query.state.data as { token?: { address: string; decimals: number } })?.token?.address === market.collateralToken.address.toLowerCase() &&
      (query.state.data as { token?: { decimals: number } })?.token?.decimals === market.collateralToken.decimals)).toBe(true);
    fireEvent.click(buy);
    expect(await within(document.body).findByRole("dialog", { name: `Buy ${name}` })).toBeTruthy();
    if (market.collateralToken.symbol === "cbETH") {
      expect(assetId).toBe(`base:${market.collateralToken.address.toLowerCase()}`);
      expect(market.collateralToken.decimals).toBe(18);
      expect(within(document.body).queryByRole("dialog", { name: "Buy Ethereum" })).toBeNull();
    }
  }, 45_000);
  test("one click opens one Buy sheet; closing restores focus and allows reopening, without opening Borrow management", async () => {
    const view = show();
    const buy = await view.findByRole("button", { name: "Buy Bitcoin" });
    await waitFor(() => expect(buy.getAttribute("aria-disabled")).toBeNull());
    expect(buy.textContent).toBe("Buy");
    expect(await view.findByRole("button", { name: "Buy XRP" })).toBeTruthy();
    fireEvent.click(buy);
    const body = within(document.body);
    expect(await body.findByRole("dialog", { name: "Buy Bitcoin" })).toBeTruthy();
    expect(body.getAllByRole("dialog", { name: "Buy Bitcoin" })).toHaveLength(1);
    expect(body.queryByRole("dialog", { name: "Bitcoin" })).toBeNull();
    fireEvent.click(body.getByRole("button", { name: "Close trade dialog" }));
    await waitFor(() => expect(document.activeElement === buy).toBe(true));
    fireEvent.click(buy);
    expect(await body.findByRole("dialog", { name: "Buy Bitcoin" })).toBeTruthy();
  }, 45_000);
  test("closing Buy focuses Borrowed when its non-intro row becomes held", async () => {
    const view = show();
    const buy = await view.findByRole("button", { name: "Buy Bitcoin" });
    await waitFor(() => expect(buy.getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(buy);
    const body = within(document.body);
    expect(await body.findByRole("dialog", { name: "Buy Bitcoin" })).toBeTruthy();
    view.rerender(<AccountWalletClientProvider client={view.client}><BorrowOverview session={session}
      overview={borrowOverviewBody({ notHeldMarketIds: [xrp] })} /></AccountWalletClientProvider>);
    expect(view.queryByRole("button", { name: "Buy Bitcoin" })).toBeNull();
    expect(body.getByRole("dialog", { name: "Buy Bitcoin" })).toBeTruthy();
    fireEvent.click(body.getByRole("button", { name: "Close trade dialog" }));
    await waitFor(() => expect(document.activeElement === view.getByText("Borrowed")).toBe(true));
  }, 45_000);
  test("held rows keep Borrow activation and unverified market rows have no Buy or not-in-wallet context", async () => {
    const held = show();
    expect(held.getByRole("button", { description: "Borrow against Dogecoin" })).toBeTruthy();
    cleanup(); getHomeQueryClient().clear();
    const unavailable = show({ unavailableMarketId: bitcoin });
    const row = unavailable.getByText("Bitcoin").closest("li")!;
    expect(within(row).queryByRole("button", { name: "Buy Bitcoin" })).toBeNull();
    expect(row.textContent).not.toContain("Not in wallet");
    expect(row.textContent).toContain("Couldn't load");
  });
  test("a blocked asset is inert while another collateral remains buyable", async () => {
    const blockedAssetId = buyRouteForToken({ chainId: VERIFIED_MORPHO_MARKETS[1]!.chainId, address: VERIFIED_MORPHO_MARKETS[1]!.collateralToken.address })!;
    const view = show({ blockedAssetId });
    await waitFor(() => expect(getHomeQueryClient().getQueryCache().getAll().filter((query) => query.queryKey[1] === "trade-availability" && query.state.status === "success")).toHaveLength(2));
    expect(view.queryByRole("button", { name: "Buy XRP" })).toBeNull();
    expect(view.getByRole("button", { name: "Buy Bitcoin" })).toBeTruthy();
  });
  test("missing session and blocked buying omit every Buy row", async () => {
    const signedOut = show({ verified: false });
    expect(signedOut.queryByRole("button", { name: /^Buy / })).toBeNull();
    cleanup(); getHomeQueryClient().clear();
    const blocked = show({ availability: "blocked" });
    await waitFor(() => expect(getHomeQueryClient().getQueryCache().getAll().filter((query) => query.queryKey[1] === "trade-availability" && query.state.status === "success")).toHaveLength(2));
    expect(blocked.queryByRole("button", { name: /^Buy / })).toBeNull();
  });
  test("unavailable trading omits Buy; checking and loading disable it", async () => {
    const unavailable = show({ availability: "unavailable" });
    await waitFor(() => expect(getHomeQueryClient().getQueryCache().getAll().find((query) => query.queryKey[1] === "trade-availability")?.state.status).toBe("success"));
    expect(unavailable.queryByRole("button", { name: "Buy Bitcoin" })).toBeNull();
    cleanup(); getHomeQueryClient().clear();
    const checking = show({ availability: "checking" });
    expect(checking.getByRole("button", { name: "Buy Bitcoin" }).getAttribute("aria-busy")).toBe("true");
    cleanup(); getHomeQueryClient().clear();
    const loading = show({ balances: "loading" });
    expect(loading.getByRole("button", { name: "Buy Bitcoin" }).getAttribute("aria-busy")).toBe("true");
    cleanup(); getHomeQueryClient().clear();
    const errored = show({ balances: "error" });
    await waitFor(() => expect(getHomeQueryClient().getQueryCache().getAll().find((query) => query.queryKey[1] === "balances")?.state.status).toBe("error"));
    expect(errored.queryByRole("button", { name: "Buy Bitcoin" })).toBeNull();
    cleanup(); getHomeQueryClient().clear();
    const stale = show({ balances: "stale" });
    await waitFor(() => expect(getHomeQueryClient().getQueryCache().getAll().find((query) => query.queryKey[1] === "balances")?.state.status).toBe("success"));
    expect(stale.queryByRole("button", { name: "Buy Bitcoin" })).toBeNull();
  });
  test("zero verified Cash disables Buy and replaces the wallet context even in the intro picker", async () => {
    const inline = show({ cash: "0" });
    const inlineBuy = await inline.findByRole("button", { name: "Buy Bitcoin" });
    await waitFor(() => expect((inlineBuy as HTMLButtonElement).disabled).toBe(true));
    const inlineRow = inlineBuy.closest("li")!;
    expect(inlineRow.textContent).toContain("No\u00a0Cash\u00a0to\u00a0buy · ");
    expect(inlineRow.textContent).not.toContain("Not in wallet");
    cleanup(); getHomeQueryClient().clear();
    const view = show({ cash: "0", intro: true });
    fireEvent.click(view.getByRole("button", { name: "See supported assets" }));
    const picker = within(await within(document.body).findByRole("dialog", { name: "Supported assets" }));
    const buy = await picker.findByRole("button", { name: "Buy Bitcoin" });
    await waitFor(() => expect(picker.getAllByText(/No.Cash.to.buy/)).toHaveLength(5));
    expect((buy as HTMLButtonElement).disabled).toBe(true);
  });
  test("picker Buy waits for picker closure and restores focus to the intro action", async () => {
    const view = show({ intro: true });
    const intro = view.getByRole("button", { name: "See supported assets" });
    fireEvent.click(intro);
    const body = within(document.body);
    const pickerDialog = await body.findByRole("dialog", { name: "Supported assets" });
    const picker = within(pickerDialog);
    expect(pickerDialog.hasAttribute("data-open")).toBe(true);
    const buy = await picker.findByRole("button", { name: "Buy Staked ETH" });
    await waitFor(() => expect(buy.getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(buy);
    await waitFor(() => expect(pickerDialog.hasAttribute("data-open")).toBe(false));
    expect(await body.findByRole("dialog", { name: "Buy Staked ETH" })).toBeTruthy();
    fireEvent.click(body.getByRole("button", { name: "Close trade dialog" }));
    await waitFor(() => expect(document.activeElement === intro).toBe(true));
  }, 45_000);
  test("after picker Buy, reopening and choosing a held market opens its management sheet", async () => {
    const view = show({ intro: true, introHeld: true });
    const intro = view.getByRole("button", { name: "Choose an asset" });
    const body = within(document.body);
    fireEvent.click(intro);
    const picker = within(await body.findByRole("dialog", { name: "Choose an asset" }));
    const buy = await picker.findByRole("button", { name: "Buy Bitcoin" });
    await waitFor(() => expect(buy.getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(buy);
    expect(await body.findByRole("dialog", { name: "Buy Bitcoin" })).toBeTruthy();
    fireEvent.click(body.getByRole("button", { name: "Close trade dialog" }));
    await waitFor(() => expect(document.activeElement === intro).toBe(true));
    fireEvent.click(intro);
    const reopened = within(await body.findByRole("dialog", { name: "Choose an asset" }));
    fireEvent.click(reopened.getByRole("button", { description: "Borrow against Dogecoin" }));
    expect(await body.findByRole("dialog", { name: "Dogecoin" })).toBeTruthy();
    expect(body.queryByRole("dialog", { name: "Buy Bitcoin" })).toBeNull();
  }, 45_000);
  test("a previous owner's open Buy sheet cannot render for a new owner", async () => {
    const view = show();
    const buy = await view.findByRole("button", { name: "Buy Bitcoin" });
    await waitFor(() => expect(buy.getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(buy);
    expect(await within(document.body).findByRole("dialog", { name: "Buy Bitcoin" })).toBeTruthy();
    view.rerender(<AccountWalletClientProvider client={view.client}><BorrowOverview
      session={{ ...session, user: { subject: "another-owner" } }} overview={view.overview} /></AccountWalletClientProvider>);
    expect(within(document.body).queryByRole("dialog", { name: "Buy Bitcoin" })).toBeNull();
  }, 25_000);
});
