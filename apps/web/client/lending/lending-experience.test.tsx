import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { getHomeQueryClient } from "@/client/query/query-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { LendingMarketDetailResponse, LendingOverview } from "@/shared/lending/contract";
import { DEFAULT_VERIFIED_MORPHO_MARKET } from "@/shared/morpho-markets/config";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";

const { cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { LendExperience } = await import("./lending-experience");
const OWNER = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const HASH = `0x${"ab".repeat(32)}` as `0x${string}`;
const market = DEFAULT_VERIFIED_MORPHO_MARKET;
const identity = { id: market.marketId, morpho: market.morpho, loanToken: market.loanToken, collateralToken: market.collateralToken, oracle: market.oracle, irm: market.irm, lltvWad: market.lltvWad.toString(), rank: market.rank };
const source = { provider: "Base JSON-RPC" as const, blockNumber: "100", blockHash: HASH, blockTimestamp: "1789387200", fetchedAt: "2026-09-14T12:00:00.000Z" };
const state = { totalSupplyAssetsRaw: "1000000000", totalSupplySharesRaw: "1000000000", totalBorrowAssetsRaw: "500000000", liquidityAssetsRaw: "500000000", feeWad: "0", utilizationWad: "500000000000000000", supplyAprWad: "50000000000000000" };

function session(address: `0x${string}` = OWNER): VerifiedAccountSession { return { user: { subject: "lend-user" }, smartAccount: { address, chainId: 8453 }, accountProvider: "cdp-embedded" }; }
function detail(overrides: Partial<LendingMarketDetailResponse> = {}): LendingMarketDetailResponse {
  return { version: "1", chainId: 8453, walletAddress: OWNER, market: identity, source, wallet: { collateralBalanceRaw: "0", loanBalanceRaw: "250000000", collateralAllowanceRaw: "0", loanAllowanceRaw: "0" }, lending: { version: "1", mode: "enabled", canSupply: true, canWithdraw: true, reason: null, state, position: { supplySharesRaw: "100000000", suppliedAssetsRaw: "100000000", withdrawableAssetsRaw: "100000000" } }, ...overrides };
}
function overview(options: { owner?: `0x${string}`; position?: boolean; mode?: "enabled" | "reducing-only" | "withdraw-only"; unavailable?: boolean; dust?: boolean } = {}): { version: "1"; chainId: 8453; owner: { address: `0x${string}`; accountProvider: "cdp-embedded" }; lending: LendingOverview } {
  const owner = options.owner ?? OWNER; const mode = options.mode ?? "enabled";
  const position = { market: identity, source, supplySharesRaw: "1", suppliedAssetsRaw: options.dust ? "0" : "100000000", withdrawableAssetsRaw: options.unavailable ? "0" : options.dust ? "0" : "100000000" };
  return { version: "1", chainId: 8453, owner: { address: owner, accountProvider: "cdp-embedded" }, lending: { version: "1", opportunities: [{ market: identity, availability: options.unavailable ? { status: "unavailable", mode, canSupply: false, canWithdraw: false, reason: "Current verified lending state is unavailable.", source: null, state: null } : { status: "available", mode, canSupply: mode === "enabled", canWithdraw: true, reason: mode === "enabled" ? null : "New lending is paused.", source, state } }], positions: options.position === false ? [] : [position] } };
}
function prepared(operation: "supply" | "withdraw" | "withdraw-all", overrides: Partial<PreparedMoneyAction> = {}): PreparedMoneyAction {
  return { id: "11111111-1111-4111-8111-111111111111", owner: { subject: "lend-user", address: OWNER, chainId: 8453, accountProvider: "cdp-embedded" }, kind: operation === "supply" ? "lend-supply" : "lend-withdraw", title: operation === "supply" ? "Supply USDC" : operation === "withdraw-all" ? "Withdraw all USDC supply" : "Withdraw USDC", calls: [{ to: market.morpho, data: "0x1234", value: "0" }], amounts: [{ assetId: market.loanToken.id, symbol: "USDC", decimals: 6, amountBaseUnits: "100000000", direction: operation === "supply" ? "spend" : "receive", ...(operation === "withdraw-all" ? { estimated: true } : {}) }], warnings: ["Morpho rates, liquidity, and share value can change before the wallet submits this action."], metadata: { product: "lend", operation, marketId: market.marketId, loanAsset: { id: market.loanToken.id, symbol: "USDC" }, supplySharesRaw: "100000000", suppliedAssetsRaw: "100000000", withdrawableAssetsRaw: "100000000", supplyAprWad: state.supplyAprWad, source: { blockNumber: source.blockNumber, blockHash: source.blockHash, blockTimestamp: source.blockTimestamp } }, createdAt: "2026-09-14T12:00:00.000Z", expiresAt: "2030-09-14T12:02:00.000Z", ...overrides };
}
function accountFetch(detailResponse: LendingMarketDetailResponse, overviewResponse = overview()) { return async (path: string) => path === "/api/borrow" ? overviewResponse : detailResponse; }
const actionProps = { prepareMoneyAction: async () => prepared("supply"), executeMoneyAction: async (action: PreparedMoneyAction) => ({ id: action.id, status: "submitted" as const }) };

afterEach(() => { cleanup(); getHomeQueryClient().clear(); });

describe("LendExperience", () => {
  test("renders a responsive market card with the standard USDC mark and position facts", async () => {
    render(<LendExperience session={session()} fetchAccountResource={accountFetch(detail())} {...actionProps} />);
    const body = within(document.body); const card = await body.findByTestId("lend-market-card");
    expect(card.className).not.toMatch(/(?:^|\s)h-\d/);
    expect(body.getByRole("img", { name: "USDC icon" }).querySelector("img")?.getAttribute("src")).toBe("/currency-flags/us.svg");
    expect(body.getByText("Variable rate")).toBeTruthy(); expect(body.getByText("Wallet")).toBeTruthy(); expect(body.getByText("Supplied")).toBeTruthy(); expect(body.getByText("Withdrawable")).toBeTruthy();
    expect(body.getByRole("group", { name: "Manage lending position" }).className).toContain("grid-cols-2");
  });

  test("renders a lend-only opportunity without inventing a position", async () => {
    render(<LendExperience session={session()} fetchAccountResource={accountFetch(detail({ lending: { ...detail().lending, position: { supplySharesRaw: "0", suppliedAssetsRaw: "0", withdrawableAssetsRaw: "0" } } }), overview({ position: false }))} {...actionProps} />);
    const body = within(document.body); expect(await body.findByRole("button", { name: "Lend" })).toBeTruthy(); expect(body.getByRole("button", { name: "Withdraw" }).hasAttribute("disabled")).toBe(true);
  });

  test("keeps reducing-only and dust positions visible with only management actions", async () => {
    const reducing = detail({ lending: { ...detail().lending, mode: "reducing-only", canSupply: false, reason: "New lending is paused.", position: { supplySharesRaw: "1", suppliedAssetsRaw: "0", withdrawableAssetsRaw: "0" } } });
    render(<LendExperience session={session()} fetchAccountResource={accountFetch(reducing, overview({ mode: "reducing-only", dust: true }))} {...actionProps} />);
    const body = within(document.body); expect(await body.findByText("New lending is paused.")).toBeTruthy(); expect(body.getByRole("button", { name: "Lend more" }).hasAttribute("disabled")).toBe(true); expect(body.getByRole("button", { name: "Withdraw" }).hasAttribute("disabled")).toBe(false); expect(body.getByText("Withdrawals are temporarily unavailable")).toBeTruthy();
  });

  test("keeps an owned position visible when its opportunity is unavailable", async () => {
    render(<LendExperience session={session()} fetchAccountResource={async (path) => path === "/api/borrow" ? overview({ unavailable: true }) : Promise.reject(new Error("unavailable"))} {...actionProps} />);
    const body = within(document.body); expect(await body.findByText("Market currently unavailable")).toBeTruthy(); expect(body.getByTestId("lend-market-card")).toBeTruthy();
  });

  test("fences owner data and renders loading and unavailable states", async () => {
    const pending = new Promise<unknown>(() => {});
    const { unmount } = render(<LendExperience session={session()} fetchAccountResource={async () => pending} />);
    expect(within(document.body).getByText("Loading lending markets")).toBeTruthy(); unmount(); getHomeQueryClient().clear();
    render(<LendExperience session={session()} fetchAccountResource={async () => overview({ owner: OTHER })} />);
    expect(await within(document.body).findByText("Lend is unavailable")).toBeTruthy();
  });

  test("supplies through amount-first review with server-authored APY and Base", async () => {
    const requests: Array<{ kind: string; params: unknown }> = [];
    const empty = detail({ lending: { ...detail().lending, position: { supplySharesRaw: "0", suppliedAssetsRaw: "0", withdrawableAssetsRaw: "0" } } });
    render(<LendExperience session={session()} fetchAccountResource={accountFetch(empty, overview({ position: false }))} prepareMoneyAction={async (kind, params) => { requests.push({ kind, params }); return prepared("supply"); }} executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    const body = within(document.body); fireEvent.click(await body.findByRole("button", { name: "Lend" })); const dialog = within(await body.findByRole("dialog", { name: "Lend" }));
    expect(dialog.getByRole("button", { name: "Max" })).toBeTruthy(); fireEvent.click(dialog.getByRole("button", { name: "1" })); fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    expect(await dialog.findByText("Lend to this market")).toBeTruthy(); expect(dialog.getByText("Variable rate")).toBeTruthy(); expect(dialog.getByText("Base")).toBeTruthy(); expect(requests[0]).toEqual({ kind: "lend-supply", params: { marketId: market.marketId, operation: "supply", amountBaseUnits: "1000000" } });
  });

  test("routes withdraw Max to share-based withdraw-all only for a fully liquid position", async () => {
    const requests: unknown[] = [];
    render(<LendExperience session={session()} fetchAccountResource={accountFetch(detail())} prepareMoneyAction={async (_kind, params) => { requests.push(params); return prepared("withdraw-all"); }} executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    const body = within(document.body); fireEvent.click(await body.findByRole("button", { name: "Withdraw" })); const dialog = within(await body.findByRole("dialog", { name: "Withdraw" })); fireEvent.click(dialog.getByRole("button", { name: "Max" })); fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    expect(await dialog.findByText("Withdraw full lending position")).toBeTruthy(); expect(requests[0]).toEqual({ marketId: market.marketId, operation: "withdraw-all" });
  });

  test("uses exact partial withdrawal when Max is liquidity-bounded", async () => {
    const partial = detail({ lending: { ...detail().lending, position: { supplySharesRaw: "100000000", suppliedAssetsRaw: "100000000", withdrawableAssetsRaw: "40000000" } } }); const requests: unknown[] = [];
    render(<LendExperience session={session()} fetchAccountResource={accountFetch(partial)} prepareMoneyAction={async (_kind, params) => { requests.push(params); return prepared("withdraw", { amounts: [{ assetId: market.loanToken.id, symbol: "USDC", decimals: 6, amountBaseUnits: "40000000", direction: "receive" }] }); }} executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    const body = within(document.body); fireEvent.click(await body.findByRole("button", { name: "Withdraw" })); const dialog = within(await body.findByRole("dialog", { name: "Withdraw" })); fireEvent.click(dialog.getByRole("button", { name: "Max" })); fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    expect(await dialog.findByText("Withdraw exact amount")).toBeTruthy(); expect(requests[0]).toEqual({ marketId: market.marketId, operation: "withdraw", amountBaseUnits: "40000000" });
  });

  test("shows an actionable zero-liquidity state without hiding the position", async () => {
    const illiquid = detail({ lending: { ...detail().lending, canWithdraw: false, position: { supplySharesRaw: "100000000", suppliedAssetsRaw: "100000000", withdrawableAssetsRaw: "0" } } });
    render(<LendExperience session={session()} fetchAccountResource={accountFetch(illiquid)} {...actionProps} />);
    const body = within(document.body); fireEvent.click(await body.findByRole("button", { name: "Withdraw" })); const dialog = within(await body.findByRole("dialog", { name: "Withdraw" })); expect(dialog.getByText("No liquidity available")).toBeTruthy(); expect(dialog.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(true);
  });

  test("preserves a share-based cleanup path for a dust position", async () => {
    const dust = detail({ lending: { ...detail().lending, canWithdraw: false, position: { supplySharesRaw: "1", suppliedAssetsRaw: "0", withdrawableAssetsRaw: "0" } } }); const requests: unknown[] = [];
    render(<LendExperience session={session()} fetchAccountResource={accountFetch(dust, overview({ dust: true }))} prepareMoneyAction={async (_kind, params) => { requests.push(params); return prepared("withdraw-all", { amounts: [{ assetId: market.loanToken.id, symbol: "USDC", decimals: 6, amountBaseUnits: "0", direction: "receive", estimated: true }] }); }} executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />);
    const body = within(document.body); fireEvent.click(await body.findByRole("button", { name: "Withdraw" })); const dialog = within(await body.findByRole("dialog", { name: "Withdraw" })); expect(dialog.getByText("Dust cleanup")).toBeTruthy(); fireEvent.click(dialog.getByRole("button", { name: "Continue" })); expect(await dialog.findByText("Withdraw full lending position")).toBeTruthy(); expect(requests[0]).toEqual({ marketId: market.marketId, operation: "withdraw-all" });
  });

  test("handles preparation failure, expiry, and wallet rejection", async () => {
    let fail = true;
    const empty = detail({ lending: { ...detail().lending, position: { supplySharesRaw: "0", suppliedAssetsRaw: "0", withdrawableAssetsRaw: "0" } } });
    render(<LendExperience session={session()} fetchAccountResource={accountFetch(empty, overview({ position: false }))} prepareMoneyAction={async () => { if (fail) throw { code: "LEND_SIMULATION_FAILED", status: 502 }; return prepared("supply", { expiresAt: "2020-09-14T11:00:00.000Z" }); }} executeMoneyAction={async (action) => ({ id: action.id, status: "rejected" })} />);
    const body = within(document.body); fireEvent.click(await body.findByRole("button", { name: "Lend" })); const dialog = within(await body.findByRole("dialog", { name: "Lend" })); fireEvent.click(dialog.getByRole("button", { name: "1" })); fireEvent.click(dialog.getByRole("button", { name: "Continue" })); expect(await dialog.findByText(/simulation could not verify/)).toBeTruthy();
    fail = false; fireEvent.click(dialog.getByRole("button", { name: "Continue" })); await waitFor(() => expect(dialog.getByText("Lending review expired")).toBeTruthy()); expect(dialog.getByRole("button", { name: "Confirm action" }).hasAttribute("disabled")).toBe(true);
  });
});
