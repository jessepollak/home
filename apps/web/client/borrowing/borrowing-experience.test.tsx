import "@/client/account/dom-test-harness";

import { getHomeQueryClient } from "@/client/query/query-client";
import { afterEach, describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  BORROW_COLLATERAL_TOKEN,
  BORROW_IRM_ADDRESS,
  BORROW_LLTV_WAD,
  BORROW_LOAN_TOKEN,
  BORROW_MARKET_ID,
  BORROW_ORACLE_ADDRESS,
  MORPHO_BLUE_ADDRESS,
} from "@/shared/borrowing/config";
import type { BorrowMarketSnapshot, BorrowOverviewResponse } from "@/shared/borrowing/contract";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";

const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const {
  BorrowExperience,
  borrowTeaserPositionDescription,
  openingBorrowAvailableBaseUnits,
  parseClientTokenAmount,
  presentBorrowAssetMark,
  recommendedOpeningCollateralBaseUnits,
  recommendedRepayMaximumBaseUnits,
  selectPrimaryBorrowAsset,
  selectUrgentBorrowPosition,
} = await import("./borrowing-experience");

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const OWNER_B = "0x2222222222222222222222222222222222222222" as const;
const BLOCK_HASH = `0x${"ab".repeat(32)}` as `0x${string}`;
const CBBTC_IMAGE = "https://assets.example/cbbtc.png";
const assetMarkResolution = {
  images: { [BORROW_COLLATERAL_TOKEN.id]: CBBTC_IMAGE },
  pending: false,
};

function session(address: `0x${string}` = OWNER, subject = "borrow-ui-user"): VerifiedAccountSession {
  return { user: { subject }, smartAccount: { address, chainId: 8453 }, accountProvider: "cdp-embedded" };
}

function detail(overrides: Partial<BorrowMarketSnapshot> = {}): BorrowMarketSnapshot {
  return {
    version: "1",
    chainId: 8453,
    walletAddress: OWNER,
    market: { id: BORROW_MARKET_ID, morpho: MORPHO_BLUE_ADDRESS, loanToken: BORROW_LOAN_TOKEN, collateralToken: BORROW_COLLATERAL_TOKEN, oracle: BORROW_ORACLE_ADDRESS, irm: BORROW_IRM_ADDRESS, lltvWad: BORROW_LLTV_WAD.toString(), rank: 1 },
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

function overview({ position = true, unavailable = false, owner = OWNER }: { position?: boolean; unavailable?: boolean; owner?: `0x${string}` } = {}): BorrowOverviewResponse {
  const snapshot = detail({ walletAddress: owner });
  return {
    version: "1",
    chainId: 8453,
    owner: { address: owner, accountProvider: "cdp-embedded" },
    discovery: { status: unavailable ? "partial" : "complete", candidateCount: 1, verifiedCount: unavailable ? 0 : 1, reason: unavailable ? "Current verified chain state is unavailable. Missing values are unavailable, not zero." : null, fetchedAt: "2026-09-13T12:00:00.000Z" },
    opportunities: [{
      market: snapshot.market,
      availability: unavailable
        ? { status: "unavailable", mode: "enabled", reason: "Current verified chain state is unavailable for this market.", source: null }
        : { status: "available", mode: "enabled", reason: null, source: snapshot.source },
    }],
    positions: position && !unavailable ? [{ market: snapshot.market, source: snapshot.source, collateralRaw: snapshot.position.collateralRaw, borrowSharesRaw: snapshot.position.borrowSharesRaw, debtAssetsRaw: snapshot.position.debtAssetsRaw, healthFactorWad: snapshot.position.healthFactorWad }] : [],
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

function accountFetch(snapshot: BorrowMarketSnapshot, response = overview({ position: BigInt(snapshot.position.debtAssetsRaw) > BigInt(0) })) {
  return async (path: string) => path === "/api/borrow" ? response : snapshot;
}

afterEach(() => {
  cleanup();
  getHomeQueryClient().clear();
});

describe("BorrowExperience redesign", () => {
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
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(snapshot, overview({ position: false }))} prepareMoneyAction={async (kind, params) => { requests.push({ kind, params }); return prepared("borrow"); }} executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
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
    expect(requests).toEqual([{ kind: "borrow", params: { marketId: BORROW_MARKET_ID, operation: "borrow", amountBaseUnits: "1000000" } }]);
    expect(dialog.queryByText(/Locked as collateral/)).toBeNull();
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

  test("uses explicit responsive actions without a full-row hover target", async () => {
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(detail())} />);
    const body = within(document.body);
    const card = await body.findByTestId("borrow-market-card");
    expect(card.className).toContain("overflow-hidden");
    const borrowedSummary = body.getByText("Borrowed").parentElement?.parentElement;
    expect(borrowedSummary?.className).toContain("grid-cols-1");
    expect(borrowedSummary?.className).toContain("sm:grid-cols-2");
    expect(body.getByText("Borrowed").nextElementSibling?.className).not.toContain("truncate");
    const borrow = body.getByRole("button", { name: "Borrow more" });
    expect(borrow.parentElement?.className).toContain("grid-cols-1");
    expect(borrow.className).toContain("min-h-11");
    expect(body.getByRole("list", { name: "Borrow markets" })).toBeTruthy();
    expect(body.getByRole("listitem")).toBe(card);
    expect(body.queryByText("Manage", { exact: true })).toBeNull();
    const manage = body.getByRole("group", { name: "Manage Bitcoin position" });
    const manageButtons = within(manage).getAllByRole("button");
    expect(manage.className).toContain("grid-cols-2");
    expect(manage.className).not.toContain("border-t");
    expect(manageButtons.map((button) => button.textContent)).toEqual(["Add collateral", "Withdraw"]);
    expect(manageButtons.every((button) => button.className.includes("min-h-11") && button.className.includes("w-full"))).toBe(true);
    expect(body.queryByRole("button", { name: "Repay all" })).toBeNull();
    expect(body.queryByRole("button", { name: "Close Bitcoin position" })).toBeNull();
    expect(card.className).not.toContain("hover:bg-muted");
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

  test("uses destructive buffer treatment below the 1.25 floor and immediate-risk copy at liquidation", async () => {
    const belowFloor = detail({ position: { ...detail().position, healthFactorWad: "1200000000000000000" } });
    const view = render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(belowFloor)} />);
    const body = within(document.body);
    const meter = await body.findByRole("meter", { name: "Liquidation buffer" });
    expect(meter.previousElementSibling?.querySelector("p")?.className).toContain("text-destructive");
    expect(meter.firstElementChild?.className).toContain("bg-destructive");

    view.unmount();
    getHomeQueryClient().clear();
    const liquidatable = detail({ position: { ...detail().position, healthFactorWad: "1000000000000000000" } });
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(liquidatable)} />);
    const nextBody = within(document.body);
    const immediateMeter = await nextBody.findByRole("meter", { name: "Liquidation buffer" });
    expect(immediateMeter.getAttribute("aria-valuetext")).toBe("Immediate liquidation risk");
    expect(nextBody.queryByText(/can fall 0%/)).toBeNull();
  });

  test("keeps healthy buffer treatment on existing neutral tokens", async () => {
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(detail())} />);
    const body = within(document.body);
    const meter = await body.findByRole("meter", { name: "Liquidation buffer" });
    expect(meter.previousElementSibling?.querySelector("p")?.className).not.toContain("text-destructive");
    expect(meter.firstElementChild?.className).toContain("bg-primary");
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
    expect(dialog.getByText(/Go back and prepare this action again/)).toBeTruthy();
  });
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

  test("selects the most urgent active position before registry rank", () => {
    const healthy = overview().positions[0];
    const urgent = { ...healthy, market: { ...healthy.market, rank: 2 }, healthFactorWad: "1200000000000000000" };
    expect(selectUrgentBorrowPosition([healthy, urgent])).toBe(urgent);
  });

  test("describes a collateral-only server position without a zero borrowed amount", () => {
    const active = overview().positions[0];
    const collateralOnly = { ...active, borrowSharesRaw: "0", debtAssetsRaw: "0", healthFactorWad: null };
    expect(borrowTeaserPositionDescription(collateralOnly, "US")).toBe("No debt · 0.5000 cbBTC locked");
  });
});
