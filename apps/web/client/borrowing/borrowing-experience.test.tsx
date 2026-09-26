import "@/client/account/dom-test-harness";

import { getHomeQueryClient } from "@/client/query/query-client";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { HomeShellRoutingProvider, type HomeShellRouting } from "@/client/home/panel-routing";
import { ownerQueryKey } from "@/client/query/query-client";
import { afterEach, describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { MORPHO_BLUE_ADDRESS, VERIFIED_MORPHO_MARKETS } from "@/shared/morpho-markets/config";
import type { BorrowMarketSnapshot, BorrowOverviewResponse } from "@/shared/borrowing/contract";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";

const { cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const {
  BorrowExperience,
  borrowTeaserPositionDescription,
  formatCash,
  openingBorrowAvailableBaseUnits,
  presentBorrowAssetMark,
  recommendedOpeningCollateralBaseUnits,
  recommendedRepayMaximumBaseUnits,
} = await import("./borrowing-experience");
const { parseClientTokenAmount, selectPrimaryBorrowAsset } = await import("./borrow-money-dialog");


const OWNER = "0x1111111111111111111111111111111111111111" as const;
const BLOCK_HASH = `0x${"ab".repeat(32)}` as `0x${string}`;
const BORROW_MARKET = VERIFIED_MORPHO_MARKETS[0]!;
const BORROW_MARKET_ID = BORROW_MARKET.marketId;
const BORROW_LOAN_TOKEN = BORROW_MARKET.loanToken;
const BORROW_COLLATERAL_TOKEN = BORROW_MARKET.collateralToken;

function session(address: `0x${string}` = OWNER, subject = "borrow-ui-user"): VerifiedAccountSession {
  return { user: { subject }, smartAccount: { address, chainId: 8453 }, accountProvider: "cdp-embedded" };
}

function detail(overrides: Partial<BorrowMarketSnapshot> = {}, market = BORROW_MARKET): BorrowMarketSnapshot {
  return {
    version: "1",
    chainId: 8453,
    walletAddress: OWNER,
    market: { id: market.marketId, morpho: market.morpho, loanToken: market.loanToken, collateralToken: market.collateralToken, oracle: market.oracle, irm: market.irm, lltvWad: market.lltvWad.toString(), rank: market.rank },
    eligibility: { mode: "enabled", newRisk: true, reason: null },
    source: { provider: "Base JSON-RPC", blockNumber: "100", blockHash: BLOCK_HASH, blockTimestamp: "1788897600", fetchedAt: "2026-09-13T12:00:00.000Z" },
    state: { oraclePriceRaw: "800000000000000000000000000000000000000", borrowRatePerSecondWad: "1000000000", borrowAprWad: "31536000000000000", totalSupplyAssetsRaw: "1000000000", totalBorrowAssetsRaw: "500000000", totalBorrowSharesRaw: "500000000", liquidityAssetsRaw: "500000000", lastUpdateTimestamp: "1788897500" },
    wallet: { collateralBalanceRaw: "100000000", loanBalanceRaw: "200000000", collateralAllowanceRaw: "0", loanAllowanceRaw: "0" },
    position: { collateralRaw: "50000000", borrowSharesRaw: "100000000", debtAssetsRaw: "100000000", rawBorrowCapacityAssetsRaw: "200000000", borrowCapacityAssetsRaw: "150000000", rawWithdrawableCollateralRaw: "10000000", withdrawableCollateralRaw: "5000000", healthFactorWad: "1600000000000000000", liquidationPriceRaw: "600000000000000000000000000000000000000" },
    ...overrides,
  };
}

function noPosition(overrides: Partial<BorrowMarketSnapshot> = {}): BorrowMarketSnapshot {
  const base = detail();
  return detail({
    position: { ...base.position, collateralRaw: "0", borrowSharesRaw: "0", debtAssetsRaw: "0", rawBorrowCapacityAssetsRaw: "0", borrowCapacityAssetsRaw: "0", rawWithdrawableCollateralRaw: "0", withdrawableCollateralRaw: "0", healthFactorWad: null, liquidationPriceRaw: null },
    ...overrides,
  });
}

function overview({ position = true, unavailable = false, owner = OWNER, snapshots }: { position?: boolean; unavailable?: boolean; owner?: `0x${string}`; snapshots?: BorrowMarketSnapshot[] } = {}): BorrowOverviewResponse {
  const markets = (snapshots ?? [detail()]).map((snapshot) => ({ ...snapshot, walletAddress: owner }));
  const source = markets[0]?.source ?? null;
  return {
    version: "2",
    chainId: 8453,
    owner: { address: owner, accountProvider: "cdp-embedded" },
    discovery: {
      status: unavailable ? "partial" : "complete",
      sourceBlock: unavailable || !source ? null : { provider: source.provider, blockNumber: source.blockNumber, blockHash: source.blockHash, blockTimestamp: source.blockTimestamp },
      candidateCount: markets.length,
      verifiedCount: unavailable ? 0 : markets.length,
      reason: unavailable ? "Current verified chain state is unavailable. Missing values are unavailable, not zero." : null,
      fetchedAt: "2026-09-13T12:00:00.000Z",
    },
    opportunities: markets.map((snapshot) => ({
      market: snapshot.market,
      availability: unavailable
        ? { status: "unavailable" as const, mode: snapshot.eligibility.mode, reason: "Current verified chain state is unavailable for this market." as const, source: null }
        : { status: "available" as const, mode: snapshot.eligibility.mode, reason: null, source: snapshot.source, snapshot },
    })),
    positions: position && !unavailable ? markets.map((snapshot) => ({ market: snapshot.market, source: snapshot.source, collateralRaw: snapshot.position.collateralRaw, borrowSharesRaw: snapshot.position.borrowSharesRaw, debtAssetsRaw: snapshot.position.debtAssetsRaw, healthFactorWad: snapshot.position.healthFactorWad })) : [],
  };
}

function prepared(operation: "borrow" | "supply-and-borrow" | "repay" | "repay-all" = "borrow", overrides: Partial<PreparedMoneyAction> = {}): PreparedMoneyAction {
  const amounts = operation === "supply-and-borrow"
    ? [
        { assetId: BORROW_COLLATERAL_TOKEN.id, symbol: "cbBTC", decimals: 8, amountBaseUnits: "2181", direction: "spend" as const },
        { assetId: BORROW_LOAN_TOKEN.id, symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "receive" as const },
      ]
    : operation === "repay-all"
      ? [
          { assetId: BORROW_LOAN_TOKEN.id, symbol: "USDC", decimals: 6, amountBaseUnits: "100000000", direction: "spend" as const, estimated: true },
          { assetId: BORROW_LOAN_TOKEN.id, symbol: "USDC", decimals: 6, amountBaseUnits: "100000362", direction: "spend" as const, maximum: true },
        ]
      : [{ assetId: BORROW_LOAN_TOKEN.id, symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: operation === "repay" ? "spend" as const : "receive" as const }];
  return {
    id: "11111111-1111-4111-8111-111111111111",
    owner: { subject: "borrow-ui-user", address: OWNER, chainId: 8453, accountProvider: "cdp-embedded" },
    kind: operation === "repay" || operation === "repay-all" ? "repay" : "borrow",
    title: operation === "supply-and-borrow" ? "Borrow USDC against cbBTC" : operation === "repay-all" ? "Repay all USDC debt" : operation === "repay" ? "Repay USDC" : "Borrow USDC",
    calls: [{ to: MORPHO_BLUE_ADDRESS, data: "0x1234", value: "0" }],
    amounts,
    warnings: [],
    metadata: { product: "borrow", operation, marketId: BORROW_MARKET_ID, loanAsset: { id: BORROW_LOAN_TOKEN.id, symbol: "USDC" }, collateralAsset: { id: BORROW_COLLATERAL_TOKEN.id, symbol: "cbBTC" }, projectedHealthFactorWad: "1500000000000000000", projectedLiquidationPriceRaw: "610000000000000000000000000000000000000", borrowAprWad: "31536000000000000", source: { blockNumber: "100", blockHash: BLOCK_HASH, blockTimestamp: "1788897600" } },
    createdAt: "2026-09-13T12:00:00.000Z",
    expiresAt: "2030-09-13T12:02:00.000Z",
    ...overrides,
  };
}

function accountFetch(snapshot: BorrowMarketSnapshot, response = overview({ position: BigInt(snapshot.position.debtAssetsRaw) > BigInt(0), snapshots: [snapshot] })) {
  return async (path: string) => path === "/api/actions/network-fee" ? { version: 1, usdcReserveBaseUnits: null } : path === "/api/borrow" ? response : snapshot;
}

afterEach(() => {
  cleanup();
  getHomeQueryClient().clear();
});

describe("Borrow overview and management", () => {
  test("keeps signed-out notice and shows the overview loading skeleton while session settles", () => {
    const body = within(document.body);
    render(<BorrowExperience session={null} />);
    expect(body.getByText("Sign in to view Borrow")).toBeTruthy();
    cleanup();
    render(<BorrowExperience session={null} sessionSettling />);
    expect(body.getByText("Loading Borrow overview").closest("[aria-busy]")?.getAttribute("aria-busy")).toBe("true");
  });

  test("renders exact debt and APR in Open loans", async () => {
    render(<BorrowExperience session={session()} regionId="US" fetchAccountResource={accountFetch(detail())} />);
    const body = within(document.body);
    const loans = within(await body.findByRole("button", { description: "Manage Bitcoin loan" }).then((row) => row.closest("section")!));
    expect(loans.getByRole("button", { description: "Manage Bitcoin loan" })).toBeTruthy();
    expect(body.getByText("Borrowed")).toBeTruthy();
    expect(body.getAllByText(/APR/)).toBeTruthy();
  });

  test("renders wide debt and held opening capacity as dollars, preserving collateral units and inert rows", async () => {
    const { BorrowOverview } = await import("./borrow-overview");
    const loan = detail({ position: { ...detail().position, debtAssetsRaw: "123456780000", borrowSharesRaw: "123456780000" } });
    const xrp = noPosition({ position: { ...noPosition().position, collateralRaw: "500000000", withdrawableCollateralRaw: "500000000" } });
    const ethMarket = VERIFIED_MORPHO_MARKETS[2]!;
    const eth = noPosition({
      state: { ...noPosition().state, liquidityAssetsRaw: "123456780000" },
      wallet: { ...noPosition().wallet, collateralBalanceRaw: "1000000000000000000000" },
    });
    const held = { ...eth, market: detail({}, ethMarket).market };
    const noCapacity = noPosition({
      state: { ...noPosition().state, liquidityAssetsRaw: "0" },
      wallet: { ...noPosition().wallet, collateralBalanceRaw: "200000000" },
    });
    const doge = { ...noCapacity, market: detail({}, VERIFIED_MORPHO_MARKETS[3]!).market };
    const unheld = { ...noPosition(), market: detail({}, VERIFIED_MORPHO_MARKETS[4]!).market, wallet: { ...noPosition().wallet, collateralBalanceRaw: "0" } };
    const data = overview({ snapshots: [loan, { ...xrp, market: detail({}, VERIFIED_MORPHO_MARKETS[1]!).market }, held, doge, unheld] });
    let submitted: unknown = null;
    const view = render(<BorrowOverview session={session()} regionId="US" overview={data}
      prepareMoneyAction={async (_kind, params) => {
        submitted = params;
        const action = prepared("supply-and-borrow");
        if (action.metadata?.product !== "borrow") throw new Error("Expected Borrow review");
        return { ...action, metadata: { ...action.metadata, marketId: held.market.id } };
      }}
      executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })}
      fetchAccountResource={async () => ({ version: 1, usdcReserveBaseUnits: null })} />);
    const body = within(document.body);
    expect(body.getByRole("img", { name: "$123,456.78" })).toBeTruthy();
    const debtRow = body.getByRole("button", { description: "Manage Bitcoin loan" });
    expect(debtRow.textContent).toContain("$123,456.78");
    expect(debtRow.textContent).not.toContain("USDC");
    const zeroDebt = body.getByRole("button", { description: "Manage XRP loan" });
    expect(zeroDebt.textContent).toContain("No debt");
    expect(zeroDebt.textContent).toContain("XRP");
    const heldRow = body.getByRole("button", { description: "Borrow against Staked ETH" });
    expect(openingBorrowAvailableBaseUnits(held)).toBe("123456780000");
    expect(heldRow.textContent).toContain("$123,456.78");
    expect(heldRow.textContent).toContain("Available");
    expect(heldRow.textContent).not.toContain("USDC");
    expect(heldRow.textContent).not.toContain("In wallet");
    expect(within(heldRow).getByText("3.15% APR")).toBeTruthy();
    const assets = within(body.getByRole("region", { name: "Assets you can borrow against" }));
    expect(assets.getByText("No USDC to borrow now").closest("li")?.textContent).toContain("In wallet");
    expect(assets.getByText("No USDC to borrow now").closest("li")?.textContent).toContain("DOGE");
    expect(assets.getByText("Cardano").closest("li")?.textContent).toContain("Not in wallet");
    expect(assets.queryByRole("button", { description: "Borrow against Cardano" })).toBeNull();
    fireEvent.click(debtRow);
    const management = within(await body.findByRole("dialog", { name: "Bitcoin" }));
    expect(management.getByRole("img", { name: "$123,456.78" })).toBeTruthy();
    fireEvent.click(management.getByRole("button", { name: "Details" }));
    expect(management.getByText("Available to borrow").nextElementSibling?.textContent).toMatch(/^\$/);
    expect(management.getByText("Collateral").nextElementSibling?.textContent).toContain("cbBTC");
    fireEvent.click(management.getByRole("button", { name: "Close Bitcoin details" }));
    await waitFor(() => expect(body.queryByRole("dialog", { name: "Bitcoin" })).toBeNull());
    fireEvent.click(heldRow);
    const heldSheet = within(await body.findByRole("dialog", { name: "Staked ETH" }));
    expect(heldSheet.getByRole("img", { name: "$123,456.78" })).toBeTruthy();
    fireEvent.click(heldSheet.getByRole("button", { name: "Borrow" }));
    const money = within(await body.findByRole("dialog", { name: "Borrow" }));
    expect(money.getByText("$123,456.78 available")).toBeTruthy();
    fireEvent.click(money.getByRole("button", { name: "Max" }));
    fireEvent.click(money.getByRole("button", { name: "Continue" }));
    expect(await body.findByRole("button", { name: "Confirm action" })).toBeTruthy();
    expect(submitted).toMatchObject({ operation: "supply-and-borrow", amountBaseUnits: "123456780000" });
    view.unmount();
  }, 30_000);

  test("keeps unavailable assets unavailable and same-symbol noncanonical loans in token units", async () => {
    const { BorrowOverview } = await import("./borrow-overview");
    const market = VERIFIED_MORPHO_MARKETS[0]!;
    const available = detail({ market: { ...detail().market, loanToken: { ...market.loanToken, id: market.collateralToken.id } } });
    const unavailable = { ...noPosition(), market: detail({}, VERIFIED_MORPHO_MARKETS[1]!).market };
    const data = overview({ snapshots: [available, unavailable] });
    data.positions = data.positions.filter((position) => BigInt(position.debtAssetsRaw) > BigInt(0));
    data.discovery.status = "partial";
    data.opportunities[1] = { market: data.opportunities[1]!.market, availability: { status: "unavailable", mode: "enabled", reason: "Unavailable", source: null } };
    render(<BorrowOverview session={session()} regionId="US" overview={data} />);
    const body = within(document.body);
    expect(body.getByRole("img", { name: /USDC/ })).toBeTruthy();
    expect(body.getByText("Couldn't load").closest("li")?.textContent).not.toContain("$0.00");
  });

  test("uses complete priced Home valuation only when the overview is complete", async () => {
    const priced = { kind: "position" as const, status: "complete" as const, value: "$101.50", rate: null, debts: [{ marketId: BORROW_MARKET_ID, baseUnits: "100000000" }] };
    const view = render(<BorrowExperience session={session()} regionId="US" borrowSummary={priced} fetchAccountResource={accountFetch(detail())} />);
    const body = within(document.body);
    expect(await body.findByRole("img", { name: "$101.50" })).toBeTruthy();
    view.rerender(<BorrowExperience session={session()} regionId="US" borrowSummary={{ ...priced, status: "partial" }} fetchAccountResource={accountFetch(detail())} />);
    expect(body.getByRole("img", { name: "$100.00" })).toBeTruthy();
  });

  test("a stale priced summary falls back to the exact overview debt", async () => {
    render(<BorrowExperience session={session()} regionId="US"
      borrowSummary={{ kind: "position", status: "complete", value: "$101.50", rate: null, debts: [{ marketId: BORROW_MARKET_ID, baseUnits: "99000000" }] }}
      fetchAccountResource={accountFetch(detail())} />);
    const body = within(document.body);
    expect(await body.findByRole("img", { name: "$100.00" })).toBeTruthy();
    expect(body.queryByRole("img", { name: "$101.50" })).toBeNull();
  });

  test("zero debt shows the region's display currency and No open loans", async () => {
    render(<BorrowExperience session={session()} regionId="GB" fetchAccountResource={accountFetch(noPosition())} />);
    const body = within(document.body);
    expect(await body.findByRole("img", { name: "£0.00" })).toBeTruthy();
    expect(body.getByText("No open loans")).toBeTruthy();
  });

  test("partial data never uses priced valuation and Retry refetches", async () => {
    let reads = 0;
    const partial = overview();
    partial.discovery.status = "partial";
    render(<BorrowExperience session={session()} borrowSummary={{ kind: "position", status: "complete", value: "$101.50", rate: null, debts: [{ marketId: BORROW_MARKET_ID, baseUnits: "100000000" }] }} fetchAccountResource={async () => { reads++; return partial; }} />);
    const body = within(document.body);
    expect(await body.findByText("Some loans couldn't be checked")).toBeTruthy();
    expect(body.queryByRole("img", { name: "$101.50" })).toBeNull();
    fireEvent.click(body.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(reads).toBe(2));
  });

  test("failed and entirely unverified responses show unavailable rather than zero", async () => {
    const body = within(document.body);
    render(<BorrowExperience session={session()} fetchAccountResource={async () => { throw new Error("offline"); }} />);
    expect(await body.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Borrow is unavailable"));
    expect(body.getByText("Unavailable")).toBeTruthy();
    cleanup();
    render(<BorrowExperience session={session()} fetchAccountResource={async () => overview({ unavailable: true })} />);
    expect(await body.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Borrow is unavailable"));
    expect(body.queryByText("No open loans")).toBeNull();
  });
  test("keeps verified rows with a refresh failure and offers another retry", async () => {
    let reads = 0;
    render(<BorrowExperience session={session()} fetchAccountResource={async () => {
      reads++;
      if (reads > 1) throw new Error("offline");
      return overview();
    }} />);
    const body = within(document.body);
    expect(await body.findByRole("button", { description: "Manage Bitcoin loan" })).toBeTruthy();
    await waitFor(() => expect(reads).toBe(1));
    const owner = dataOwnerKey(session());
    await getHomeQueryClient().invalidateQueries({ queryKey: ownerQueryKey(owner, "borrow", "overview") });
    expect(await body.findByText("Borrow data could not be refreshed")).toBeTruthy();
    expect(body.getByRole("button", { description: "Manage Bitcoin loan" })).toBeTruthy();
    expect(body.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  test("row opens management with pinned actions and Details hides technical facts", async () => {
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(detail())} prepareMoneyAction={async () => prepared("repay")} executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    const body = within(document.body);
    const row = await body.findByRole("button", { description: "Manage Bitcoin loan" });
    fireEvent.click(row);
    const sheet = within(await body.findByRole("dialog", { name: "Bitcoin" }));
    expect((sheet.getByRole("button", { name: "Repay" }) as HTMLButtonElement).disabled).toBe(false);
    expect((sheet.getByRole("button", { name: "Borrow more" }) as HTMLButtonElement).disabled).toBe(false);
    expect(sheet.getByRole("button", { name: "Details" }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(sheet.getByRole("button", { name: "Details" }));
    expect(sheet.getByText("Max LTV")).toBeTruthy();
    fireEvent.click(sheet.getByRole("button", { name: "Close Bitcoin details" }));
    await waitFor(() => expect(document.activeElement).toBe(row));
  }, 30_000);

  test("repay transitions to money sheet then returns focus to its launching action", async () => {
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(detail())} prepareMoneyAction={async () => prepared("repay")} executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    const body = within(document.body);
    fireEvent.click(await body.findByRole("button", { description: "Manage Bitcoin loan" }));
    const management = within(await body.findByRole("dialog", { name: "Bitcoin" }));
    fireEvent.click(management.getByRole("button", { name: "Repay" }));
    const money = within(await body.findByRole("dialog", { name: "Repay" }));
    await waitFor(() => expect(body.queryByRole("dialog", { name: "Bitcoin" })).toBeNull());
    fireEvent.click(money.getByRole("button", { name: "Close Borrow action" }));
    const returned = within(await body.findByRole("dialog", { name: "Bitcoin" }));
    await waitFor(() => expect(document.activeElement).toBe(returned.getByRole("button", { name: "Repay" })));
  }, 30_000);

  test("View in Activity leaves the overview without reopening the management sheet or refocusing Borrow", async () => {
    const { BorrowOverview } = await import("./borrow-overview");
    const panels: string[] = [];
    render(<HomeShellRoutingProvider value={{ openPanel: (panel: string) => { panels.push(panel); } } as HomeShellRouting}>
      <BorrowOverview session={session()} overview={overview()}
        fetchAccountResource={accountFetch(detail())}
        prepareMoneyAction={async () => prepared("repay")}
        executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />
    </HomeShellRoutingProvider>);
    const body = within(document.body);
    const row = body.getByRole("button", { description: "Manage Bitcoin loan" });
    fireEvent.click(row);
    fireEvent.click(within(await body.findByRole("dialog", { name: "Bitcoin" })).getByRole("button", { name: "Repay" }));
    const money = within(await body.findByRole("dialog", { name: "Repay" }));
    fireEvent.change(money.getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    fireEvent.click(money.getByRole("button", { name: "Continue" }));
    fireEvent.click(await money.findByRole("button", { name: "Confirm action" }));
    fireEvent.click(await money.findByRole("button", { name: "View in Activity" }));
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => expect(body.queryByRole("dialog", { name: "Repay" })).toBeNull());
    expect(panels).toEqual(["activity"]);
    expect(body.queryByRole("dialog", { name: "Bitcoin" })).toBeNull();
    expect(document.activeElement).not.toBe(row);
    expect(document.activeElement).not.toBe(body.getByText("Borrowed"));
  }, 30_000);

  test("urgent position sorts ahead of healthy and disables risk-increasing actions", async () => {
    const healthy = detail();
    const urgent = detail({ position: { ...detail().position, healthFactorWad: "1200000000000000000" } }, VERIFIED_MORPHO_MARKETS[2]!);
    render(<BorrowExperience session={session()} fetchAccountResource={async () => overview({ snapshots: [healthy, urgent] })}
      prepareMoneyAction={async () => prepared()} executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    const body = within(document.body);
    const loans = within(await body.findByRole("button", { description: "Manage Staked ETH loan" }).then((row) => row.closest("section")!));
    expect(loans.getAllByRole("button")[0]?.textContent).toContain("Staked ETH");
    fireEvent.click(loans.getByRole("button", { description: "Manage Staked ETH loan" }));
    const sheet = within(await body.findByRole("dialog", { name: "Staked ETH" }));
    expect((sheet.getByRole("button", { name: "Borrow more" }) as HTMLButtonElement).disabled).toBe(true);
    expect((sheet.getByRole("button", { name: /Withdraw collateral/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  test("does not reopen an unavailable market after the money flow", async () => {
    const { BorrowOverview } = await import("./borrow-overview");
    const available = overview();
    const view = render(<BorrowOverview session={session()} overview={available}
      prepareMoneyAction={async () => prepared("repay")}
      executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    const body = within(document.body);
    fireEvent.click(body.getByRole("button", { description: "Manage Bitcoin loan" }));
    const sheet = within(await body.findByRole("dialog", { name: "Bitcoin" }));
    fireEvent.click(sheet.getByRole("button", { name: "Repay" }));
    await body.findByRole("dialog", { name: "Repay" });
    view.rerender(<BorrowOverview session={session()} overview={overview({ unavailable: true })}
      prepareMoneyAction={async () => prepared("repay")}
      executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    await waitFor(() => expect(body.queryByRole("dialog", { name: "Repay" })).toBeNull());
    expect(body.queryByRole("dialog", { name: "Bitcoin" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(body.getByText("Borrowed")));
  }, 30_000);
});
describe("Borrow direct market", () => {
  test("keeps the configured market route on the direct money dialog", async () => {
    let closed = 0;
    render(<BorrowExperience session={session()} selectedMarketId={BORROW_MARKET_ID}
      onSelectMarket={(id) => { if (id === null) closed++; }}
      fetchAccountResource={accountFetch(detail())}
      prepareMoneyAction={async () => prepared("borrow")}
      executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    const body = within(document.body);
    const money = within(await body.findByRole("dialog", { name: "Borrow" }));
    expect(money.getByRole("textbox", { name: "Amount" })).toBeTruthy();
    fireEvent.click(money.getByRole("button", { name: "Close Borrow action" }));
    await waitFor(() => expect(closed).toBe(1));
  }, 30_000);
});
describe("Borrow asset identity", () => {
  test("uses exact asset keys for cash currency and preserves pending and unknown fallbacks", () => {
    const usdc = presentBorrowAssetMark(BORROW_LOAN_TOKEN, {});
    expect({ name: usdc.name, symbol: usdc.symbol, currency: usdc.currency }).toEqual({
      name: BORROW_LOAN_TOKEN.name,
      symbol: BORROW_LOAN_TOKEN.symbol,
      currency: "USD",
    });

    const lookalikeUsdc = presentBorrowAssetMark({
      ...BORROW_LOAN_TOKEN,
      id: BORROW_COLLATERAL_TOKEN.id,
    }, {});
    expect(lookalikeUsdc.currency).toBeNull();

    const pending = presentBorrowAssetMark(BORROW_COLLATERAL_TOKEN, { pending: true });
    expect(pending.pending).toBe(true);
    expect(pending.imageUrl).toBeNull();

    const unknown = presentBorrowAssetMark({
      ...BORROW_COLLATERAL_TOKEN,
      id: "eip155:8453/erc20:0x0000000000000000000000000000000000000001",
      name: "Unknown Bitcoin",
      symbol: "uBTC",
    }, {});
    expect({ imageUrl: unknown.imageUrl, pending: unknown.pending, currency: unknown.currency }).toEqual({
      imageUrl: null,
      pending: false,
      currency: null,
    });
  });

  test("selects the canonical primary asset for every Borrow operation", () => {
    const withDebt = detail();
    const withoutDebt = noPosition();
    const expected = {
      "supply-collateral": BORROW_COLLATERAL_TOKEN.id,
      borrow: BORROW_LOAN_TOKEN.id,
      "supply-and-borrow": BORROW_LOAN_TOKEN.id,
      repay: BORROW_LOAN_TOKEN.id,
      "repay-all": BORROW_LOAN_TOKEN.id,
      "withdraw-collateral": BORROW_COLLATERAL_TOKEN.id,
      "close-position": BORROW_LOAN_TOKEN.id,
    } as const;
    for (const [operation, assetId] of Object.entries(expected)) {
      expect(selectPrimaryBorrowAsset(withDebt, operation as keyof typeof expected).id).toBe(assetId);
    }
    expect(selectPrimaryBorrowAsset(withoutDebt, "close-position").id).toBe(BORROW_COLLATERAL_TOKEN.id);
  });
});

describe("Borrow bigint helpers", () => {
  test("derives wallet capacity and targets 1.50 without locking all Bitcoin", () => {
    const snapshot = noPosition();
    expect(openingBorrowAvailableBaseUnits(snapshot)).toBe("500000000");
    const target = recommendedOpeningCollateralBaseUnits(snapshot, "1000000");
    expect(target).not.toBeNull();
    expect(BigInt(target!)).toBeLessThan(BigInt(snapshot.wallet.collateralBalanceRaw));
  });

  test("uses the whole wallet only when the 1.50 target is impossible but the 1.25 floor remains possible", () => {
    const snapshot = noPosition({ state: { ...noPosition().state, liquidityAssetsRaw: "100000000000" }, wallet: { ...noPosition().wallet, collateralBalanceRaw: "100000" } });
    const available = openingBorrowAvailableBaseUnits(snapshot);
    expect(BigInt(available)).toBeGreaterThan(BigInt(0));
    expect(recommendedOpeningCollateralBaseUnits(snapshot, available)).toBe(snapshot.wallet.collateralBalanceRaw);
    expect(recommendedOpeningCollateralBaseUnits(snapshot, (BigInt(available) + BigInt(1)).toString())).toBeNull();
  });

  test("normalizes amounts and uses a one-hour rate-based repay-all buffer plus one unit", () => {
    expect(parseClientTokenAmount("25.", 6)).toBe("25000000");
    expect(recommendedRepayMaximumBaseUnits("100000000", "200000000", "1000000000")).toBe("100000362");
    expect(recommendedRepayMaximumBaseUnits("100000000", "100000100", "1000000000")).toBe("100000100");
  });

  test("describes a collateral-only server position without a zero borrowed amount", () => {
    const active = overview().positions[0];
    const collateralOnly = { ...active, borrowSharesRaw: "0", debtAssetsRaw: "0", healthFactorWad: null };
    expect(borrowTeaserPositionDescription(collateralOnly, "US")).toBe("No debt · 0.5000 cbBTC locked");
    expect(borrowTeaserPositionDescription(active, "US")).toContain("$100.00 borrowed · ");
    expect(formatCash("100000000", { ...BORROW_LOAN_TOKEN, id: BORROW_COLLATERAL_TOKEN.id }, "US")).toContain("USDC");
  });
});
