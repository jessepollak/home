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

const { cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const {
  BorrowExperience,
  openingBorrowAvailableBaseUnits,
  parseClientTokenAmount,
  partialRepayMaximumBaseUnits,
  recommendedOpeningCollateralBaseUnits,
  recommendedRepayMaximumBaseUnits,
  selectUrgentBorrowPosition,
} = await import("./borrowing-experience");

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const OWNER_B = "0x2222222222222222222222222222222222222222" as const;
const BLOCK_HASH = `0x${"ab".repeat(32)}` as `0x${string}`;

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

function prepared(operation: "borrow" | "supply-and-borrow" = "borrow", overrides: Partial<PreparedMoneyAction> = {}): PreparedMoneyAction {
  const amounts = operation === "supply-and-borrow"
    ? [
        { assetId: BORROW_COLLATERAL_TOKEN.id, symbol: "cbBTC", decimals: 8, amountBaseUnits: "2181", direction: "spend" as const },
        { assetId: BORROW_LOAN_TOKEN.id, symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "receive" as const },
      ]
    : [{ assetId: BORROW_LOAN_TOKEN.id, symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "receive" as const }];
  return {
    id: "11111111-1111-4111-8111-111111111111",
    owner: { subject: "borrow-ui-user", address: OWNER, chainId: 8453, accountProvider: "cdp-embedded" },
    kind: "borrow",
    title: operation === "supply-and-borrow" ? "Borrow USDC against cbBTC" : "Borrow USDC",
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
  test("renders one Bitcoin market card even when the market has an active position", async () => {
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(detail())} />);
    const body = within(document.body);
    expect(await body.findByRole("heading", { level: 3, name: "Bitcoin" })).toBeTruthy();
    expect(body.getAllByTestId("borrow-market-card")).toHaveLength(1);
    expect(body.getByTestId("bitcoin-mark").getAttribute("aria-hidden")).toBe("true");
    expect(body.queryByRole("img", { name: "Bitcoin icon" })).toBeNull();
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
    fireEvent.click(dialog.getByRole("button", { name: "1" }));
    expect(dialog.getByText(/will lock .*cbBTC as collateral/)).toBeTruthy();
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
    expect(await body.findByRole("img", { name: "150.00 USDC" })).toBeTruthy();
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
    expect(card.querySelector("[data-slot='card-content']")?.className).toContain("py-0");
    const borrowedSummary = body.getByText("Borrowed").parentElement?.parentElement;
    expect(borrowedSummary?.className).toContain("grid-cols-1");
    expect(borrowedSummary?.className).toContain("sm:grid-cols-2");
    expect(body.getByText("Borrowed").nextElementSibling?.className).not.toContain("truncate");
    const borrow = body.getByRole("button", { name: "Borrow more" });
    expect(borrow.parentElement?.className).toContain("grid-cols-1");
    expect(borrow.className).toContain("min-h-11");
    expect(body.getByRole("button", { name: "Withdraw" }).className).toContain("min-h-11");
    expect(body.getByRole("button", { name: "Close" }).className).toContain("min-h-11");
    expect(card.className).not.toContain("hover:bg-muted");
  });

  test("prioritizes Repay and Add collateral in urgent state", async () => {
    const snapshot = detail({ position: { ...detail().position, healthFactorWad: "1200000000000000000" } });
    render(<BorrowExperience session={session()} fetchAccountResource={accountFetch(snapshot)} />);
    const body = within(document.body);
    const buttons = await body.findAllByRole("button");
    expect(buttons.slice(0, 2).map((button) => button.textContent)).toEqual(["Repay", "Add collateral"]);
    expect(body.queryByRole("button", { name: "Borrow more" })).toBeNull();
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
    expect(partialRepayMaximumBaseUnits("100000000", "200000000")).toBe("99999999");
    expect(recommendedRepayMaximumBaseUnits("100000000", "200000000", "1000000000")).toBe("100000362");
    expect(recommendedRepayMaximumBaseUnits("100000000", "100000100", "1000000000")).toBe("100000100");
  });

  test("selects the most urgent active position before registry rank", () => {
    const healthy = overview().positions[0];
    const urgent = { ...healthy, market: { ...healthy.market, rank: 2 }, healthFactorWad: "1200000000000000000" };
    expect(selectUrgentBorrowPosition([healthy, urgent])).toBe(urgent);
  });
});
