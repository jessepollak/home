import "@/client/account/dom-test-harness";

import { getHomeQueryClient } from "@/client/query/query-client";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { ownerQueryKey } from "@/client/query/query-client";
import { borrowOverviewBody } from "@/tests/browser/fixtures/bodies";
import { afterEach, describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { MORPHO_BLUE_ADDRESS, VERIFIED_MORPHO_MARKETS } from "@/shared/morpho-markets/config";
import type { BorrowMarketSnapshot, BorrowOverviewResponse } from "@/shared/borrowing/contract";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { formatAddress } from "@/shared/formatting";

const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const {
  BorrowExperience,
  borrowTeaserPositionDescription,
  openingBorrowAvailableBaseUnits,
  presentBorrowAssetMark,
  recommendedOpeningCollateralBaseUnits,
  recommendedRepayMaximumBaseUnits,
} = await import("./borrowing-experience");
const { BorrowMoneyDialog, parseClientTokenAmount, selectPrimaryBorrowAsset } = await import("./borrow-money-dialog");

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const OWNER_B = "0x2222222222222222222222222222222222222222" as const;
const BLOCK_HASH = `0x${"ab".repeat(32)}` as `0x${string}`;
const CBBTC_IMAGE = "https://assets.example/cbbtc.png";
const BORROW_MARKET = VERIFIED_MORPHO_MARKETS[0]!;
const BORROW_MARKET_ID = BORROW_MARKET.marketId;
const BORROW_LOAN_TOKEN = BORROW_MARKET.loanToken;
const BORROW_COLLATERAL_TOKEN = BORROW_MARKET.collateralToken;
const assetMarkResolution = {
  images: { [BORROW_COLLATERAL_TOKEN.id]: CBBTC_IMAGE },
  pending: false,
};

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

describe("BorrowExperience redesign", () => {
  for (const selectedMarketId of [null, BORROW_MARKET_ID]) {
    test(`shows loading instead of sign-in while ${selectedMarketId ? "direct market" : "overview"} session settles`, () => {
      render(<BorrowExperience session={null} sessionSettling selectedMarketId={selectedMarketId} />);
      const body = within(document.body);
      const loading = body.getByText("Loading Borrow overview").closest("[aria-busy]");
      expect(loading?.getAttribute("aria-busy")).toBe("true");
      expect(body.queryByText("Sign in to view Borrow")).toBeNull();
    });

    test(`shows sign-in on ${selectedMarketId ? "direct market" : "overview"} with settled signed-out session`, () => {
      render(<BorrowExperience session={null} selectedMarketId={selectedMarketId} />);
      const body = within(document.body);
      expect(body.getByText("Sign in to view Borrow")).toBeTruthy();
      expect(body.queryByText("Loading Borrow overview")).toBeNull();
    });
  }

  test("renders the exact-contract cbBTC image and canonical Bitcoin identity in the market heading", async () => {
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(detail())} assetMarkResolution={assetMarkResolution} />);
    const body = within(document.body);
    expect(await body.findByRole("heading", { level: 3, name: "Bitcoin" })).toBeTruthy();
    expect(body.getAllByTestId("borrow-market-card")).toHaveLength(1);
    const headingMark = body.getByRole("heading", { level: 3, name: "Bitcoin" }).parentElement?.previousElementSibling;
    expect(headingMark?.querySelector("img")?.getAttribute("src")).toBe(CBBTC_IMAGE);
    expect(headingMark?.textContent).toBe("");
    expect(body.getByText("Borrow USDC with cbBTC")).toBeTruthy();
    expect(body.getByText("Borrowed")).toBeTruthy();
    expect(body.getByRole("meter", { name: "Liquidation buffer" }).getAttribute("aria-valuetext")).toBe("Bitcoin can fall 37.5% before liquidation");
    expect(body.queryByText("Active positions")).toBeNull();
    expect(body.queryByText("Borrow opportunities")).toBeNull();
    expect(body.queryByText("Enabled")).toBeNull();
  });

  test("opens the no-position Borrow amount modal directly with wallet-derived availability and automatic collateral", async () => {
    const snapshot = noPosition();
    const requests: Array<{ kind: string; params: unknown }> = [];
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(snapshot)} prepareMoneyAction={async (kind, params) => { requests.push({ kind, params }); return prepared("supply-and-borrow"); }} executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    const body = within(document.body);
    fireEvent.click(await body.findByRole("button", { name: "Borrow" }));
    const dialog = within(await body.findByRole("dialog", { name: "Borrow" }));
    expect(dialog.getByRole("img", { name: /\$500\.00 available/ })).toBeTruthy();
    expect(dialog.getByLabelText("USDC").querySelector("[data-mark='shimmer'] img")?.getAttribute("src")).toBe("/currency-flags/us.svg");
    const numpadKey = dialog.getByRole("button", { name: "1" });
    fireEvent.click(numpadKey);
    const preview = dialog.getByTestId("borrow-collateral-preview");
    expect(preview.textContent).toMatch(/will lock .*cbBTC as collateral/);
    expect(preview.getAttribute("role")).toBeNull();
    expect(numpadKey.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    await dialog.findByText("Network");
    expect(dialog.getByRole("button", { name: "Confirm action" }).getAttribute("data-money-action-id")).toBe("11111111-1111-4111-8111-111111111111");
    expect(dialog.getByText("Base")).toBeTruthy();
    expect(dialog.getByText("Variable rate")).toBeTruthy();
    expect(dialog.getByText("Locked as collateral (cbBTC)")).toBeTruthy();
    expect(dialog.queryByText("You spend (cbBTC)")).toBeNull();
    expect(dialog.queryByText("LLTV")).toBeNull();
    expect(dialog.getByRole("meter", { name: "Liquidation buffer" })).toBeTruthy();
    expect(requests).toEqual([{ kind: "borrow", params: { marketId: BORROW_MARKET_ID, operation: "supply-and-borrow", amountBaseUnits: "1000000", collateralAmountBaseUnits: recommendedOpeningCollateralBaseUnits(snapshot, "1000000") } }]);
  });

  test("keeps the collateral preview stable below the numpad and explains over-available amounts without a live region", async () => {
    const snapshot = noPosition();
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(snapshot)} prepareMoneyAction={async () => prepared("supply-and-borrow")} executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    const body = within(document.body);
    fireEvent.click(await body.findByRole("button", { name: "Borrow" }));
    const dialog = within(await body.findByRole("dialog", { name: "Borrow" }));
    const preview = dialog.getByTestId("borrow-collateral-preview");
    expect(preview.textContent).toContain("Enter an amount to preview");
    for (let index = 0; index < 6; index += 1) {
      fireEvent.click(dialog.getByRole("button", { name: "9" }));
    }
    expect(dialog.getByTestId("borrow-collateral-preview")).toBe(preview);
    expect(preview.textContent).toContain("needs more cbBTC than is available");
    expect(preview.closest("[role='status'], [role='alert']")).toBeNull();
    expect((dialog.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("uses supplied collateral for a zero-debt position without requiring or locking more wallet cbBTC", async () => {
    const base = detail();
    const snapshot = detail({
      wallet: { ...base.wallet, collateralBalanceRaw: "0" },
      position: {
        ...base.position,
        borrowSharesRaw: "0",
        debtAssetsRaw: "0",
        healthFactorWad: null,
        liquidationPriceRaw: null,
      },
    });
    const requests: Array<{ kind: string; params: unknown }> = [];
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(snapshot, overview({ position: false, snapshots: [snapshot] }))} prepareMoneyAction={async (kind, params) => { requests.push({ kind, params }); return prepared("borrow"); }} executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    const body = within(document.body);
    const availableTicker = await body.findByRole("img", { name: "150.00 USDC" });
    expect(availableTicker.getAttribute("data-reserve-digits")).toBe("false");
    expect(body.getByText(/0\.5000 cbBTC locked as collateral/)).toBeTruthy();
    expect(body.queryByText("You need cbBTC in this wallet before you can borrow.")).toBeNull();
    const borrow = body.getByRole("button", { name: "Borrow" }) as HTMLButtonElement;
    expect(borrow.disabled).toBe(false);
    fireEvent.click(borrow);
    const dialog = within(await body.findByRole("dialog", { name: "Borrow" }));
    expect(dialog.getByRole("img", { name: /\$150\.00 available/ })).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "1" }));
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    await dialog.findByText("Network");
    expect(dialog.getByText("From").closest("dl")?.querySelector("dt")?.textContent).toBe("From");
    expect(dialog.getByRole("button", { name: `Copy ${formatAddress(prepared().owner.address)}` })).toBeTruthy();
    expect(dialog.getByRole("button", { name: "Confirm action" }).getAttribute("data-money-action-id")).toBe("11111111-1111-4111-8111-111111111111");
    expect(requests).toEqual([{ kind: "borrow", params: { marketId: BORROW_MARKET_ID, operation: "borrow", amountBaseUnits: "1000000" } }]);
    expect(dialog.queryByText(/Locked as collateral/)).toBeNull();
  });

  test("keeps a card-action sheet mounted through closing and returns focus to its trigger", async () => {
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(detail())} prepareMoneyAction={async () => prepared()} executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    const body = within(document.body);
    const trigger = await body.findByRole("button", { name: "Borrow more" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await body.findByRole("dialog", { name: "Borrow" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close Borrow action" }));
    expect(document.body.contains(dialog)).toBe(true);
    await waitFor(() => expect(document.body.contains(dialog)).toBe(false));
    await waitFor(() => expect(document.activeElement === trigger).toBe(true));
  });

  test("opens a configured market query directly into the Borrow modal instead of a detail inspector", async () => {
    render(<BorrowExperience session={session()} selectedMarketId={BORROW_MARKET_ID} fetchAccountResource={async () => noPosition()} prepareMoneyAction={async () => prepared("supply-and-borrow")} executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    const body = within(document.body);
    expect(await body.findByRole("dialog", { name: "Borrow" })).toBeTruthy();
    expect(body.queryByText("Market and position")).toBeNull();
    expect(body.queryByText("Available liquidity")).toBeNull();
  });

  test("keeps a direct Borrow modal mounted with its verified snapshot while the detail refetches", async () => {
    const first = noPosition();
    const unavailable = noPosition({ wallet: { ...first.wallet, collateralBalanceRaw: "0" } });
    let fetches = 0;
    render(<BorrowExperience session={session()} selectedMarketId={BORROW_MARKET_ID} fetchAccountResource={async () => ++fetches === 1 ? first : unavailable} prepareMoneyAction={async () => prepared("supply-and-borrow")} executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    const body = within(document.body);
    const dialog = within(await body.findByRole("dialog", { name: "Borrow" }));
    fireEvent.click(dialog.getByRole("button", { name: "1" }));
    await act(async () => { await getHomeQueryClient().invalidateQueries(); });
    await waitFor(() => expect(fetches).toBeGreaterThan(1));
    expect(body.getByRole("dialog", { name: "Borrow" })).toBeTruthy();
    expect(dialog.getByTestId("borrow-collateral-preview").textContent).toMatch(/will lock .*cbBTC/);
  });

  test("keeps the no-cbBTC market visible but inert", async () => {
    const snapshot = noPosition({ wallet: { ...noPosition().wallet, collateralBalanceRaw: "0" } });
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(snapshot)} />);
    const body = within(document.body);
    expect(await body.findByRole("heading", { name: "Bitcoin" })).toBeTruthy();
    expect(body.getByText("You need cbBTC in this wallet before you can borrow.")).toBeTruthy();
    expect((body.getByRole("button", { name: "Borrow" }) as HTMLButtonElement).disabled).toBe(true);
    expect(body.queryByRole("link")).toBeNull();
  });

  test("exposes explicit market actions and list semantics", async () => {
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(detail())} />);
    const body = within(document.body);
    const card = await body.findByTestId("borrow-market-card");
    expect(body.getByRole("list", { name: "Borrow markets" })).toBeTruthy();
    expect(body.getByRole("listitem")).toBe(card);
    expect(body.queryByText("Manage", { exact: true })).toBeNull();
    const manage = body.getByRole("group", { name: "Manage Bitcoin position" });
    const manageButtons = within(manage).getAllByRole("button");
    expect(manageButtons.map((button) => button.textContent)).toEqual(["Add collateral", "Withdraw"]);
    expect(body.queryByRole("button", { name: "Repay all" })).toBeNull();
    expect(body.queryByRole("button", { name: "Close Bitcoin position" })).toBeNull();
  });

  test("keeps the minimum action set in urgent state while disabling risk increases", async () => {
    const snapshot = detail({ position: { ...detail().position, healthFactorWad: "1200000000000000000" } });
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(snapshot)} />);
    const body = within(document.body);
    const buttons = await body.findAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Borrow more", "Repay", "Add collateral", "Withdraw"]);
    expect((body.getByRole("button", { name: "Borrow more" }) as HTMLButtonElement).disabled).toBe(true);
    expect((body.getByRole("button", { name: "Withdraw collateral from Bitcoin position" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("announces immediate-risk copy at liquidation", async () => {
    const liquidatable = detail({ position: { ...detail().position, healthFactorWad: "1000000000000000000" } });
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(liquidatable)} />);
    const body = within(document.body);
    const immediateMeter = await body.findByRole("meter", { name: "Liquidation buffer" });
    expect(immediateMeter.getAttribute("aria-valuetext")).toBe("Immediate liquidation risk");
    expect(body.queryByText(/can fall 0%/)).toBeNull();
  });

  test("compacts prepared warnings into one accessible warning list", async () => {
    const warnings = ["This review leaves a limited liquidation buffer.", "This review uses all currently indexed market liquidity."];
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(detail())} prepareMoneyAction={async () => prepared("borrow", { warnings })} executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    const body = within(document.body);
    fireEvent.click(await body.findByRole("button", { name: "Borrow more" }));
    const dialog = within(await body.findByRole("dialog", { name: "Borrow" }));
    fireEvent.click(dialog.getByRole("button", { name: "1" }));
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    expect(await dialog.findByText("Review warnings")).toBeTruthy();
    expect(dialog.getAllByRole("listitem").map((item) => item.textContent)).toEqual(warnings);
    expect(dialog.queryByText("Review warning")).toBeNull();
  });

  test("prepares an entered amount below debt as a partial repay with the partial-payment warning", async () => {
    const requests: Array<{ kind: string; params: unknown }> = [];
    const partialWarning = "This is a partial repayment. The remaining debt continues to accrue at a variable rate.";
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(detail())} prepareMoneyAction={async (kind, params) => { requests.push({ kind, params }); return prepared("repay", { warnings: [partialWarning] }); }} executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    const body = within(document.body);
    fireEvent.click(await body.findByRole("button", { name: "Repay" }));
    const dialog = within(await body.findByRole("dialog", { name: "Repay" }));
    fireEvent.click(dialog.getByRole("button", { name: "5" }));
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    expect(await dialog.findByText(partialWarning)).toBeTruthy();
    expect(dialog.getByRole("button", { name: "Confirm action" }).getAttribute("data-money-action-id")).toBe("11111111-1111-4111-8111-111111111111");
    expect(requests).toEqual([{ kind: "repay", params: { marketId: BORROW_MARKET_ID, operation: "repay", amountBaseUnits: "5000000" } }]);
  });

  test("prepares Max and an amount at current debt as buffered repay-all without a partial-payment warning", async () => {
    const expectedMaximum = recommendedRepayMaximumBaseUnits("100000000", "200000000", "1000000000");
    const requests: Array<{ kind: string; params: unknown }> = [];
    const view = render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(detail())} prepareMoneyAction={async (kind, params) => { requests.push({ kind, params }); return prepared("repay-all"); }} executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    const body = within(document.body);
    fireEvent.click(await body.findByRole("button", { name: "Repay" }));
    let dialog = within(await body.findByRole("dialog", { name: "Repay" }));
    fireEvent.click(dialog.getByRole("button", { name: "Max" }));
    expect(dialog.getByText("Maximum repayment")).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    await dialog.findByText("Maximum repayment (USDC)");
    expect(dialog.getByRole("button", { name: "Confirm action" }).getAttribute("data-money-action-id")).toBe("11111111-1111-4111-8111-111111111111");
    expect(dialog.queryByText(/This is a partial repayment/)).toBeNull();
    expect(requests[0]).toEqual({ kind: "repay", params: { marketId: BORROW_MARKET_ID, operation: "repay-all", maximumRepayBaseUnits: expectedMaximum } });

    view.unmount();
    getHomeQueryClient().clear();
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(detail())} prepareMoneyAction={async (kind, params) => { requests.push({ kind, params }); return prepared("repay-all"); }} executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    const nextBody = within(document.body);
    fireEvent.click(await nextBody.findByRole("button", { name: "Repay" }));
    dialog = within(await nextBody.findByRole("dialog", { name: "Repay" }));
    for (const digit of ["1", "0", "0"]) fireEvent.click(dialog.getByRole("button", { name: digit }));
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    await dialog.findByText("Maximum repayment (USDC)");
    expect(requests[1]).toEqual({ kind: "repay", params: { marketId: BORROW_MARKET_ID, operation: "repay-all", maximumRepayBaseUnits: expectedMaximum } });
  });

  test("repay-all waits for the USDC reserve before setting its reviewed maximum", async () => {
    let resolveReserve!: (value: unknown) => void;
    const reserveResponse = new Promise<unknown>((resolve) => { resolveReserve = resolve; });
    const requests: unknown[] = [];
    render(<BorrowMoneyDialog session={session()} snapshot={detail()} operation="repay-all" regionId="US"
      fetchAccountResource={async () => reserveResponse}
      prepareMoneyAction={async (_kind, params) => { requests.push(params); return prepared("repay-all"); }}
      executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} onClose={() => {}} />);
    const dialog = within(await within(document.body).findByRole("dialog", { name: "Repay all" }));
    expect((dialog.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
    expect(dialog.queryByRole("button", { name: "Max" })).toBeNull();
    await act(async () => { resolveReserve({ version: 1, usdcReserveBaseUnits: "20000" }); });
    await waitFor(() => expect((dialog.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    await dialog.findByRole("button", { name: "Confirm action" });
    expect(requests).toEqual([{ marketId: BORROW_MARKET_ID, operation: "repay-all", maximumRepayBaseUnits: recommendedRepayMaximumBaseUnits("100000000", "199980000", "1000000000") }]);
  });

  test("allows an exact partial repay while the USDC reserve is unavailable", async () => {
    const requests: unknown[] = [];
    render(<BorrowMoneyDialog session={session()} snapshot={detail()} operation="repay" regionId="US"
      fetchAccountResource={async () => { throw new Error("policy unavailable"); }}
      prepareMoneyAction={async (_kind, params) => { requests.push(params); return prepared("repay"); }}
      executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} onClose={() => {}} />);
    const dialog = within(await within(document.body).findByRole("dialog", { name: "Repay" }));
    expect(dialog.queryByRole("button", { name: "Max" })).toBeNull();
    fireEvent.click(dialog.getByRole("button", { name: "5" }));
    expect((dialog.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    await dialog.findByRole("button", { name: "Confirm action" });
    expect(requests).toEqual([{ marketId: BORROW_MARKET_ID, operation: "repay", amountBaseUnits: "5000000" }]);
  });

  test("keeps wallet-short Max as an accurate partial repay", async () => {
    const base = detail();
    const snapshot = detail({ wallet: { ...base.wallet, loanBalanceRaw: "50000000" } });
    const requests: Array<{ kind: string; params: unknown }> = [];
    const partialWarning = "This is a partial repayment. The remaining debt continues to accrue at a variable rate.";
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(snapshot)} prepareMoneyAction={async (kind, params) => { requests.push({ kind, params }); return prepared("repay", { amounts: [{ assetId: BORROW_LOAN_TOKEN.id, symbol: "USDC", decimals: 6, amountBaseUnits: "50000000", direction: "spend" }], warnings: [partialWarning] }); }} executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    const body = within(document.body);
    fireEvent.click(await body.findByRole("button", { name: "Repay" }));
    const dialog = within(await body.findByRole("dialog", { name: "Repay" }));
    fireEvent.click(dialog.getByRole("button", { name: "Max" }));
    expect(dialog.queryByText("Maximum repayment")).toBeNull();
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    expect(await dialog.findByText(partialWarning)).toBeTruthy();
    expect(requests).toEqual([{ kind: "repay", params: { marketId: BORROW_MARKET_ID, operation: "repay", amountBaseUnits: "50000000" } }]);
  });

  test.each([
    { code: "NETWORK_FEE_UNFUNDED", status: 409, message: "Add USDC to cover the network fee." },
    { code: "NETWORK_FEE_UNAVAILABLE", status: 502, message: "The network fee could not be checked. Try again." },
  ])("shows the exact $code prepare message", async ({ code, status, message }) => {
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(detail())} prepareMoneyAction={async () => { throw Object.assign(new Error("fee error"), { status, code, serverMessage: message }); }} executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    const body = within(document.body);
    fireEvent.click(await body.findByRole("button", { name: "Borrow more" }));
    const dialog = within(await body.findByRole("dialog", { name: "Borrow" }));
    fireEvent.click(dialog.getByRole("button", { name: "1" }));
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    expect((await dialog.findByRole("alert")).textContent).toContain(message);
  });
  test("surfaces sanitized typed prepare errors without transport details", async () => {
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(detail())} prepareMoneyAction={async () => { throw Object.assign(new Error("submission-pending"), { status: 409, code: "LIMIT_EXCEEDED", serverMessage: "The amount exceeds the current Home-adjusted collateral and liquidity limit." }); }} executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    const body = within(document.body);
    fireEvent.click(await body.findByRole("button", { name: "Borrow more" }));
    const dialog = within(await body.findByRole("dialog", { name: "Borrow" }));
    fireEvent.click(dialog.getByRole("button", { name: "1" }));
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    expect((await dialog.findByRole("alert")).textContent).toContain("The amount exceeds the current Home-adjusted collateral and liquidity limit. No transaction was submitted.");
    expect(document.body.textContent).not.toContain("submission-pending");
  });

  test("preserves unavailable and stale truthfulness", async () => {
    render(<BorrowExperience session={session()} fetchAccountResource={async () => overview({ unavailable: true })} />);
    const body = within(document.body);
    expect((await body.findByRole("alert")).textContent).toContain("Some Borrow data is unavailable");
    expect(body.getByRole("heading", { name: "Bitcoin" })).toBeTruthy();
    expect((body.getByRole("button", { name: "Borrow" }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).not.toContain("$0.00");
  });

  test("clears prior-owner values while the next owner loads", async () => {
    let resolveB!: (value: unknown) => void;
    const pendingB = new Promise((resolve) => { resolveB = resolve; });
    const view = render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(detail())} />);
    expect(await within(document.body).findByText("Borrowed")).toBeTruthy();
    view.rerender(<BorrowExperience session={session(OWNER_B, "borrow-ui-user-b")} fetchAccountResource={() => pendingB} />);
    expect(within(document.body).queryByText("Borrowed")).toBeNull();
    resolveB(overview({ owner: OWNER_B }));
    await waitFor(() => expect(within(document.body).getByRole("heading", { name: "Bitcoin" })).toBeTruthy());
  });

  test("handles server ACTION_EXPIRED as an expired review without ambiguous retry copy", async () => {
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(detail())} prepareMoneyAction={async () => prepared()} executeMoneyAction={async () => { throw Object.assign(new Error("gone"), { code: "ACTION_EXPIRED", status: 410 }); }} />);
    const body = within(document.body);
    fireEvent.click(await body.findByRole("button", { name: "Borrow more" }));
    const dialog = within(await body.findByRole("dialog", { name: "Borrow" }));
    fireEvent.click(dialog.getByRole("button", { name: "1" }));
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    fireEvent.click(await dialog.findByRole("button", { name: "Confirm action" }));
    expect(await dialog.findByText(/This Borrow review expired/)).toBeTruthy();
    expect(dialog.getByRole("button", { name: "Confirm action" }).hasAttribute("data-money-action-id")).toBe(false);
    expect(document.body.textContent).not.toContain("dispatch outcome is unresolved");
  });

  test("reactively expires prepared review", async () => {
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(detail())} prepareMoneyAction={async () => prepared("borrow", { expiresAt: new Date(Date.now() + 40).toISOString() })} executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    const body = within(document.body);
    fireEvent.click(await body.findByRole("button", { name: "Borrow more" }));
    const dialog = within(await body.findByRole("dialog", { name: "Borrow" }));
    fireEvent.click(dialog.getByRole("button", { name: "1" }));
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    const confirm = await dialog.findByRole("button", { name: "Confirm action" });
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(true));
    expect(confirm.hasAttribute("data-money-action-id")).toBe(false);
    expect(dialog.getByText(/Go back and prepare this action again/)).toBeTruthy();
  });

  for (const { label, operation } of [
    { label: "Add collateral", operation: "supply-collateral" },
    { label: "Withdraw collateral from Bitcoin position", operation: "withdraw-collateral" },
  ] as const) {
    test(`marks only the ${operation} confirm control`, async () => {
      render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(detail())} prepareMoneyAction={async () => {
        const action = prepared();
        if (action.metadata?.product !== "borrow") throw new Error("missing borrow metadata");
        return {
          ...action, kind: operation,
          amounts: [{ assetId: BORROW_COLLATERAL_TOKEN.id, symbol: "cbBTC", decimals: 8, amountBaseUnits: "100000000", direction: operation === "supply-collateral" ? "spend" as const : "receive" as const }],
          metadata: { ...action.metadata, operation },
        };
      }} executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
      const body = within(document.body);
      fireEvent.click(await body.findByRole("button", { name: label }));
      const dialog = within(await body.findByRole("dialog", { name: operation === "supply-collateral" ? "Add collateral" : "Withdraw collateral" }));
      expect(dialog.getByRole("button", { name: "Continue" }).hasAttribute("data-money-action-id")).toBe(false);
      fireEvent.click(dialog.getByRole("button", { name: "1" }));
      fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
      const confirm = await dialog.findByRole("button", { name: "Confirm action" });
      expect(confirm.getAttribute("data-money-action-id")).toBe("11111111-1111-4111-8111-111111111111");
      expect(dialog.getAllByRole("button", { name: "Back" }).every((button) => !button.hasAttribute("data-money-action-id"))).toBe(true);
    });
  }
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
  });
});

describe("Borrow multi-market overview", () => {
  test("renders five registry identities, exact symbols and address-derived marks without per-card detail requests", async () => {
    const requests: string[] = [];
    render(<BorrowExperience session={session()} fetchAccountResource={async (path) => { requests.push(path); return borrowOverviewBody(); }} />);
    const body = within(document.body);
    await waitFor(() => expect(body.getAllByTestId("borrow-market-card")).toHaveLength(5));
    for (const [name, symbol, mark] of [
      ["Bitcoin", "cbBTC", "btc"], ["XRP", "cbXRP", "xrp"], ["Staked ETH", "cbETH", "eth"],
      ["Dogecoin", "cbDOGE", "doge"], ["Cardano", "cbADA", "ada"],
    ]) {
      const heading = body.getByRole("heading", { name });
      const card = heading.closest("[data-testid=borrow-market-card]");
      expect(card).toBeTruthy();
      expect(card!.textContent).toContain(`Borrow USDC with ${symbol}`);
      expect(heading.parentElement?.previousElementSibling?.querySelector("img")?.getAttribute("src")).toBe(`/asset-marks/${mark}.svg`);
    }
    await waitFor(() => expect(getHomeQueryClient().getQueryData(ownerQueryKey(dataOwnerKey(session()), "borrow", "detail", VERIFIED_MORPHO_MARKETS[2]!.marketId))).toBeTruthy());
    expect(requests).toEqual(["/api/borrow"]);
  });

  test("leaves an unavailable market visible without presenting a zero balance", async () => {
    render(<BorrowExperience session={session()} fetchAccountResource={async () => borrowOverviewBody({ unavailableMarketId: VERIFIED_MORPHO_MARKETS[1]!.marketId })} />);
    const body = within(document.body);
    const heading = await body.findByRole("heading", { name: "XRP" });
    const card = within(heading.closest("[data-testid=borrow-market-card]") as HTMLElement);
    expect((card.getByRole("button", { name: "Borrow" }) as HTMLButtonElement).disabled).toBe(true);
    expect(card.getByText("Current verified chain state is unavailable for this market.")).toBeTruthy();
    expect(card.queryByText(/\$0\.00/)).toBeNull();
  });

  test.each([
    ["Staked ETH", 2, "3059024445000000000000000000", "$3,059.02", "cbETH"],
    ["XRP", 1, "1504740000000000000000000000000000000", "$1.50", "cbXRP"],
  ] as const)("formats %s liquidation price with the registry token decimals", async (name, index, raw, dollars, symbol) => {
    const market = VERIFIED_MORPHO_MARKETS[index]!;
    const snapshot = detail({ position: { ...detail().position, liquidationPriceRaw: raw } }, market);
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(snapshot)} />);
    const body = within(document.body);
    await body.findByRole("heading", { name });
    expect(body.getByText(`Liquidation around ${dollars} per ${symbol}`)).toBeTruthy();
  });
});

describe("Borrow direct market refresh", () => {
  test("uses the detail endpoint when opening a market from a cached overview", async () => {
    const fixture = borrowOverviewBody();
    const requests: string[] = [];
    const fetchAccountResource = async (path: string) => {
      requests.push(path);
      return path === "/api/borrow" ? fixture : fixture.opportunities[0]!.availability.status === "available" ? fixture.opportunities[0]!.availability.snapshot : null;
    };
    const view = render(<BorrowExperience session={session()} fetchAccountResource={fetchAccountResource} />);
    await within(document.body).findByRole("heading", { name: "Cardano" });
    view.rerender(<BorrowExperience session={session()} selectedMarketId={BORROW_MARKET_ID} fetchAccountResource={fetchAccountResource} />);
    await waitFor(() => expect(requests).toContain(`/api/borrow/markets/${BORROW_MARKET_ID}`));
    expect(requests.filter((path) => path === "/api/borrow")).toHaveLength(1);
  });
});

describe("Borrow overview action refresh", () => {
  test("refreshes the embedded snapshot after a completed action", async () => {
    const updated = detail({ position: { ...detail().position, debtAssetsRaw: "200000000" } });
    let reads = 0;
    const fetchAccountResource = async (path: string) => {
      if (path !== "/api/borrow") throw new Error("Overview must not fetch per-card detail.");
      reads += 1;
      return overview({ snapshots: [reads === 1 ? detail() : updated] });
    };
    render(<BorrowExperience session={session()} fetchAccountResource={fetchAccountResource} prepareMoneyAction={async () => prepared()} executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    const body = within(document.body);
    fireEvent.click(await body.findByRole("button", { name: "Borrow more" }));
    const dialog = within(await body.findByRole("dialog", { name: "Borrow" }));
    fireEvent.click(dialog.getByRole("button", { name: "1" }));
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    fireEvent.click(await dialog.findByRole("button", { name: "Confirm action" }));
    await waitFor(() => expect(reads).toBeGreaterThanOrEqual(2));
    const result = within(await body.findByRole("dialog", { name: "Borrow" }));
    expect(result.getByText("Borrowing 1 USDC")).toBeTruthy();
    fireEvent.click(result.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(body.getByRole("img", { name: /200\.00.*USDC/ })).toBeTruthy());
  });
});
