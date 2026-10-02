import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { BORROW_MARKETS } from "@/shared/borrowing/config";
import { recommendedOpeningCollateralBaseUnits } from "./borrowing-experience";
import type { RegionId } from "@/config/regions";
import { dataOwnerKey } from "@/client/account/owner-keys";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { HomeShellRoutingProvider, type HomeShellRouting } from "@/client/home/panel-routing";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { BorrowMarketSnapshot } from "@/shared/borrowing/contract";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { parseRecentActionsPayload } from "@/shared/actions/contracts/list";
import { formatExactPresentationTokenAmount } from "@/shared/formatting";
import { TransferExecutionError } from "@/shared/transfers/types";
import { borrowOverviewBody, sessionBody } from "@/tests/browser/fixtures/bodies";

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { BorrowMoneyDialog } = await import("./borrow-money-dialog");

const session = sessionBody as VerifiedAccountSession;
const availability = borrowOverviewBody().opportunities[2]!.availability;
if (availability.status !== "available") throw new Error("Borrow fixture unavailable");
const snapshot = availability.snapshot;
const action: PreparedMoneyAction = {
  id: "11111111-1111-4111-8111-111111111111",
  owner: { subject: session.user.subject, address: session.smartAccount!.address, chainId: 8453, accountProvider: session.accountProvider },
  kind: "borrow", title: "Borrow USDC", calls: [], warnings: [],
  amounts: [{ assetId: snapshot.market.loanToken.id, symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "receive" }],
  metadata: { product: "borrow", operation: "borrow", marketId: snapshot.market.id, riskIncreased: true, loanAsset: { id: snapshot.market.loanToken.id, symbol: "USDC" }, collateralAsset: { id: snapshot.market.collateralToken.id, symbol: snapshot.market.collateralToken.symbol }, projectedHealthFactorWad: null, projectedLiquidationPriceRaw: null, borrowAprWad: "31536000000000000", source: { blockNumber: "100", blockHash: snapshot.source.blockHash, blockTimestamp: "1788897600" } },
  createdAt: "2026-09-25T12:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z",
};
const key = ownerQueryKey(dataOwnerKey(session), "actions");
const row = { id: action.id, owner: action.owner, status: "pending", kind: action.kind,
  createdAt: action.createdAt, confirmedAt: action.createdAt,
  summary: { title: action.title, amounts: action.amounts, warnings: action.warnings, expiresAt: action.expiresAt, metadata: action.metadata } };
const parsed = (rows: unknown[]) => parseRecentActionsPayload({ actions: rows }, session);

function mount({ prepare = async () => action, execute = async () => ({ id: action.id, status: "submitted" as const }), fetch = async () => ({ actions: [] }), close = () => {}, openPanel = () => {}, marketSnapshot = snapshot, operation = "borrow", regionId = "US" }: {
  regionId?: RegionId;
  operation?: "borrow" | "supply-and-borrow" | "withdraw-collateral" | "supply-collateral";
  prepare?: AccountWalletClient["prepareMoneyAction"];
  marketSnapshot?: BorrowMarketSnapshot;
  execute?: (prepared: PreparedMoneyAction) => Promise<{ id: string; status: "submitted" | "failed" | "rejected" }>;
  fetch?: (path: string) => Promise<unknown>;
  close?: () => void;
  openPanel?: (panel: string) => void;
} = {}) {
  const routing = { openPanel } as HomeShellRouting;
  render(<HomeShellRoutingProvider value={routing}><BorrowMoneyDialog session={session} snapshot={marketSnapshot} operation={operation} regionId={regionId} fetchAccountResource={async (path) => path === "/api/actions/network-fee" ? { version: 1, usdcReserveBaseUnits: null } : fetch(path)} prepareMoneyAction={prepare} executeMoneyAction={execute} onClose={close} /></HomeShellRoutingProvider>);
  return within(document.body);
}

async function review(body: ReturnType<typeof within>) {
  const dialog = within(await body.findByRole("dialog", { name: "Borrow" }));
  fireEvent.change(dialog.getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
  fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
  return { dialog, confirm: await dialog.findByRole("button", { name: "Confirm action" }) };
}

afterEach(() => { cleanup(); getHomeQueryClient().clear(); });

function describedByText(input: HTMLElement): string {
  return (input.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
}

describe("Supply and borrow amount and review", () => {
  for (const market of [BORROW_MARKETS[0]!, BORROW_MARKETS[2]!]) {
    test(`${market.collateralToken.symbol} shows collateral only from the prepared action on review and re-prepares after Back`, async () => {
      const opportunity = borrowOverviewBody({ openMarketId: null }).opportunities.find((item) => item.market.id === market.marketId);
      if (opportunity?.availability.status !== "available") throw new Error("Borrow fixture unavailable");
      const marketSnapshot = opportunity.availability.snapshot;
      const collateral = market.collateralToken;
      const preparedAmounts = collateral.decimals === 8 ? ["1234567", "2345678"] : ["123456789012345678", "234567890123456789"];
      const intents: unknown[] = [];
      const body = mount({ operation: "supply-and-borrow", marketSnapshot, prepare: async (_kind, params) => {
        intents.push(params);
        const index = intents.length - 1;
        return {
          ...action,
          amounts: [
            { assetId: collateral.id, symbol: collateral.symbol, decimals: collateral.decimals, amountBaseUnits: preparedAmounts[index]!, direction: "spend" },
            { assetId: market.loanToken.id, symbol: market.loanToken.symbol, decimals: market.loanToken.decimals, amountBaseUnits: `${index + 1}000000`, direction: "receive" },
          ],
          metadata: { ...action.metadata!, operation: "supply-and-borrow", marketId: market.marketId, collateralAsset: { id: collateral.id, symbol: collateral.symbol } },
        } as PreparedMoneyAction;
      } });
      const dialog = within(await body.findByRole("dialog", { name: "Borrow" }));
      const continueButton = dialog.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
      expect(dialog.queryByText(/collateral|will lock|Enter an amount to preview/i)).toBeNull();
      expect(continueButton.disabled).toBe(true);
      const input = dialog.getByRole("textbox", { name: "Amount" });
      fireEvent.change(input, { target: { value: "1" } });
      expect(dialog.queryByText(/collateral|will lock|Enter an amount to preview/i)).toBeNull();
      expect(continueButton.disabled).toBe(false);
      fireEvent.click(continueButton);
      expect(await dialog.findByRole("button", { name: "Confirm action" })).toBeTruthy();
      expect(intents).toHaveLength(1);
      expect(intents[0]).toMatchObject({ operation: "supply-and-borrow", amountBaseUnits: "1000000" });
      const recommended = recommendedOpeningCollateralBaseUnits(marketSnapshot, "1000000");
      expect(recommended).not.toBeNull();
      expect((intents[0] as { collateralAmountBaseUnits: string }).collateralAmountBaseUnits).toBe(recommended!);
      expect(preparedAmounts[0]).not.toBe(recommended);
      const lockedLabel = `Locked as collateral (${collateral.symbol})`;
      expect(dialog.getByText(lockedLabel).nextElementSibling?.textContent).toBe(formatExactPresentationTokenAmount(preparedAmounts[0]!, collateral.decimals, collateral.symbol));
      expect(dialog.getByText("You receive (USDC)").nextElementSibling?.textContent).toBe("1 USDC");
      expect(dialog.getByText("Variable rate")).toBeTruthy();
      fireEvent.click(dialog.getAllByRole("button", { name: "Back" })[0]!);
      expect(dialog.queryByText(/collateral|will lock|Enter an amount to preview/i)).toBeNull();
      fireEvent.change(dialog.getByRole("textbox", { name: "Amount" }), { target: { value: "2" } });
      fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
      expect(await dialog.findByRole("button", { name: "Confirm action" })).toBeTruthy();
      expect(intents).toHaveLength(2);
      expect(intents[1]).toMatchObject({ operation: "supply-and-borrow", amountBaseUnits: "2000000" });
      expect(dialog.getByText(lockedLabel).nextElementSibling?.textContent).toBe(formatExactPresentationTokenAmount(preparedAmounts[1]!, collateral.decimals, collateral.symbol));
      expect(dialog.getByText("You receive (USDC)").nextElementSibling?.textContent).toBe("2 USDC");
    });

    test(`${market.collateralToken.symbol} insufficient collateral blocks prepare and describes the invalid amount`, async () => {
      const opportunity = borrowOverviewBody({ openMarketId: null }).opportunities.find((item) => item.market.id === market.marketId);
      if (opportunity?.availability.status !== "available") throw new Error("Borrow fixture unavailable");
      const marketSnapshot = { ...opportunity.availability.snapshot, wallet: { ...opportunity.availability.snapshot.wallet, collateralBalanceRaw: "1" } };
      let prepares = 0;
      const body = mount({ operation: "supply-and-borrow", marketSnapshot, prepare: async () => { prepares++; return action; } });
      const dialog = within(await body.findByRole("dialog", { name: "Borrow" }));
      const input = dialog.getByRole("textbox", { name: "Amount" });
      fireEvent.change(input, { target: { value: "1" } });
      expect(input.getAttribute("aria-invalid")).toBe("true");
      const collateralError = dialog.getByText(`That amount needs more ${market.collateralToken.symbol} than is available in this wallet.`);
      expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(collateralError.id);
      expect(describedByText(input)).toContain(collateralError.textContent!);
      expect(dialog.queryByText(/Only .* available/)).toBeNull();
      const continueButton = dialog.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
      expect(continueButton.disabled).toBe(true);
      fireEvent.click(continueButton);
      expect(prepares).toBe(0);
    });
  }

  test("an amount above liquidity with enough collateral keeps the standard available ceiling", async () => {
    const opportunity = borrowOverviewBody({ openMarketId: null }).opportunities.find((item) => item.market.id === BORROW_MARKETS[0]!.marketId);
    if (opportunity?.availability.status !== "available") throw new Error("Borrow fixture unavailable");
    const body = mount({ operation: "supply-and-borrow", marketSnapshot: opportunity.availability.snapshot });
    const dialog = within(await body.findByRole("dialog", { name: "Borrow" }));
    const input = dialog.getByRole("textbox", { name: "Amount" });
    fireEvent.change(input, { target: { value: "600" } });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(describedByText(input)).toContain("Only $500.00 available");
    expect(dialog.queryByText(/needs more/)).toBeNull();
    expect((dialog.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Borrow action result", () => {
  test("USD entry for priced collateral prepares the exact floored native amount and reviews collateral units", async () => {
    if (action.metadata?.product !== "borrow") throw new Error("missing Borrow metadata");
    const expected = (BigInt(123) * BigInt(10) ** BigInt(18 + 24) /
      (BigInt(snapshot.state.oraclePriceRaw) * BigInt(100))).toString();
    const prepared: PreparedMoneyAction = {
      ...action,
      kind: "supply-collateral",
      title: "Add collateral",
      amounts: [{ assetId: snapshot.market.collateralToken.id, symbol: snapshot.market.collateralToken.symbol, decimals: snapshot.market.collateralToken.decimals, amountBaseUnits: expected, direction: "spend" }],
      metadata: { ...action.metadata, operation: "supply-collateral" },
    };
    let requested: unknown;
    const body = mount({ operation: "supply-collateral", prepare: async (_kind, params) => { requested = params; return prepared; } });
    const dialog = within(await body.findByRole("dialog", { name: "Add collateral" }));
    expect(dialog.getByRole("button", { name: /as the primary amount/ })).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: /as the primary amount/ }));
    fireEvent.input(dialog.getByRole("textbox", { name: "Amount" }), { target: { value: "1.23" } });
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    expect(await dialog.findByRole("button", { name: "Confirm action" })).toBeTruthy();
    expect(requested).toMatchObject({ operation: "supply-collateral", amountBaseUnits: expected });
    expect(dialog.getByText(`Locked as collateral (${snapshot.market.collateralToken.symbol})`).parentElement?.textContent)
      .toContain(formatExactPresentationTokenAmount(expected, snapshot.market.collateralToken.decimals, snapshot.market.collateralToken.symbol));
  });
  test("collateral in a non-USD display region stays in native units without a dollar toggle", async () => {
    const body = mount({ operation: "supply-collateral", regionId: "DE" });
    const dialog = within(await body.findByRole("dialog", { name: "Add collateral" }));
    expect(dialog.queryByRole("button", { name: /as the primary amount/ })).toBeNull();
    fireEvent.input(dialog.getByRole("textbox", { name: "Amount" }), { target: { value: "1.23" } });
    expect((dialog.getByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("1.23");
  });
  test("amount step shows dollar availability without changing the atomic Max submitted for review", async () => {
    const raw = "123456780000";
    const marketSnapshot = { ...snapshot, position: { ...snapshot.position, borrowCapacityAssetsRaw: raw } };
    let submitted: unknown = null;
    const body = mount({ marketSnapshot, prepare: async (_kind, params) => { submitted = params; return action; } });
    const dialog = within(await body.findByRole("dialog", { name: "Borrow" }));
    expect(dialog.getByText("$123,456.78 available")).toBeTruthy();
    expect(dialog.queryByRole("button", { name: /as the primary amount/ })).toBeNull();
    fireEvent.click(dialog.getByRole("button", { name: "Max" }));
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    expect(await dialog.findByRole("button", { name: "Confirm action" })).toBeTruthy();
    expect(submitted).toMatchObject({ amountBaseUnits: raw });
    expect(dialog.getByText("You receive (USDC)")).toBeTruthy();
    expect(dialog.queryByText(/Locked as collateral/)).toBeNull();
  });
  test("collateral availability stays in collateral units", async () => {
    const marketSnapshot = { ...snapshot, position: { ...snapshot.position, collateralRaw: "50000000", withdrawableCollateralRaw: "50000000" } };
    const body = mount({ marketSnapshot, operation: "withdraw-collateral" });
    const label = await body.findByText(/ available$/);
    expect(label.textContent).toContain(snapshot.market.collateralToken.symbol);
    expect(label.textContent).not.toContain("$");
  });
  test("explains a withdrawn Borrow offer during preparation and confirmation", async () => {
    const body = mount({ prepare: async () => { throw { status: 409, code: "PRODUCT_NOT_OFFERED" }; } });
    const dialog = within(await body.findByRole("dialog", { name: "Borrow" }));
    fireEvent.change(dialog.getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    expect((await dialog.findByRole("alert")).textContent).toContain("This is no longer offered.");
    cleanup();
    const later = mount({ execute: async () => { throw { status: 409, code: "PRODUCT_NOT_OFFERED" }; } });
    const reviewStep = await review(later);
    fireEvent.click(reviewStep.confirm);
    expect((await reviewStep.dialog.findByRole("alert")).textContent).toContain("This is no longer offered.");
  });
  test("submitting keeps the focused marked button busy and ignores a second press", async () => {
    let finish!: (value: { id: string; status: "submitted" }) => void;
    let calls = 0;
    const body = mount({ execute: async () => { calls++; return new Promise((resolve) => { finish = resolve; }); } });
    const { dialog, confirm } = await review(body);
    confirm.focus();
    fireEvent.click(confirm);
    expect(dialog.getByRole("button", { name: "Confirm action" })).toBe(confirm);
    expect(confirm.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(confirm);
    expect(dialog.getByRole("button", { name: "Close Borrow action" }).hasAttribute("disabled")).toBe(true);
    expect(dialog.queryByText("Waiting for your wallet…")).toBeNull();
    fireEvent.click(confirm);
    expect(calls).toBe(1);
    await act(async () => finish({ id: action.id, status: "submitted" }));
    expect(await dialog.findByText("Borrowing 1 USDC")).toBeTruthy();
  });

  test("preparing keeps the amount step with a busy Continue until the review is ready", async () => {
    let finish!: (value: PreparedMoneyAction) => void;
    let calls = 0;
    const body = mount({ prepare: async () => { calls++; return new Promise((resolve) => { finish = resolve; }); } });
    const dialog = within(await body.findByRole("dialog", { name: "Borrow" }));
    fireEvent.change(dialog.getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    const continueButton = dialog.getByRole("button", { name: "Continue" });
    fireEvent.click(continueButton);
    expect(dialog.getByRole("heading", { name: "Borrow" })).toBeTruthy();
    expect(dialog.getByRole("button", { name: "Continue" })).toBe(continueButton);
    expect(continueButton.getAttribute("aria-busy")).toBe("true");
    expect(dialog.getByRole("textbox", { name: "Amount" })).toBeTruthy();
    expect(dialog.queryByText(/Preparing/)).toBeNull();
    expect(dialog.queryByRole("heading", { name: "Confirm" })).toBeNull();
    expect(dialog.getByRole("button", { name: "Close Borrow action" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(continueButton);
    fireEvent.keyDown(dialog.getByRole("textbox", { name: "Amount" }), { key: "Enter" });
    expect(calls).toBe(1);
    await act(async () => finish(action));
    expect(await dialog.findByRole("button", { name: "Confirm action" })).toBeTruthy();
    expect(dialog.getByRole("heading", { name: "Confirm" })).toBeTruthy();
  });

  test("preparing keeps focus on a read-only amount with Max disabled and ignores edits", async () => {
    let finish!: (value: PreparedMoneyAction) => void;
    const intents: unknown[] = [];
    const body = mount({ prepare: async (_kind, params) => { intents.push(params); return new Promise((resolve) => { finish = resolve; }); } });
    const dialog = within(await body.findByRole("dialog", { name: "Borrow" }));
    const input = dialog.getByRole("textbox", { name: "Amount" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1" } });
    act(() => { input.focus(); });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(dialog.getByRole("button", { name: "Continue" }).getAttribute("aria-busy")).toBe("true");
    expect(input.readOnly).toBe(true);
    expect(input.disabled).toBe(false);
    expect(input.getAttribute("aria-readonly")).toBe("true");
    expect(document.activeElement).toBe(input);
    expect((dialog.getByRole("button", { name: "Max" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.click(dialog.getByRole("button", { name: "Max" }));
    expect(input.value).toBe("1");
    await act(async () => finish(action));
    expect(await dialog.findByRole("button", { name: "Confirm action" })).toBeTruthy();
    expect(dialog.getAllByText("1 USDC").length).toBeGreaterThan(0);
    expect(intents).toHaveLength(1);
  });

  test("an owner change during prepare drops the old review", async () => {
    let finish!: (value: PreparedMoneyAction) => void;
    const other: VerifiedAccountSession = { ...session, user: { ...session.user, subject: "other-subject" }, smartAccount: { ...session.smartAccount!, address: "0x2222222222222222222222222222222222222222" } };
    const flow = (owner: VerifiedAccountSession) => <BorrowMoneyDialog session={owner} snapshot={snapshot} operation="borrow" regionId="US" fetchAccountResource={async () => ({ version: 1, usdcReserveBaseUnits: null })} prepareMoneyAction={async () => new Promise((resolve) => { finish = resolve; })} executeMoneyAction={async () => ({ id: action.id, status: "submitted" })} onClose={() => {}} />;
    const { rerender } = render(flow(session));
    const dialog = within(await within(document.body).findByRole("dialog", { name: "Borrow" }));
    fireEvent.change(dialog.getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    rerender(flow(other));
    await act(async () => finish(action));
    expect(dialog.queryByRole("button", { name: "Confirm action" })).toBeNull();
    expect(dialog.queryByRole("alert")).toBeNull();
    expect(dialog.getByRole("button", { name: "Continue" }).getAttribute("aria-busy")).toBeNull();
  });

  test("a failed prepare returns the error on the amount step", async () => {
    const body = mount({ prepare: async () => { throw new Error("boom"); } });
    const dialog = within(await body.findByRole("dialog", { name: "Borrow" }));
    fireEvent.change(dialog.getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    expect(await dialog.findByRole("alert")).toBeTruthy();
    expect(dialog.getByRole("button", { name: "Continue" }).getAttribute("aria-busy")).toBeNull();
    expect(dialog.getByRole("textbox", { name: "Amount" })).toBeTruthy();
  });

  test("submitted is pending with two real stages; another owner cannot confirm it, but its own confirmed row can", async () => {
    const body = mount();
    const { dialog, confirm } = await review(body);
    fireEvent.click(confirm);
    expect(await dialog.findByText("Borrowing 1 USDC")).toBeTruthy();
    expect(dialog.getAllByRole("listitem")).toHaveLength(2);
    expect(dialog.getByText("Submitted")).toBeTruthy();
    expect(dialog.getByText("Confirming on Base")).toBeTruthy();
    expect(dialog.getByRole("button", { name: "Done" })).toBeTruthy();
    expect(dialog.getByRole("button", { name: "View in Activity" })).toBeTruthy();
    expect(dialog.queryByRole("button", { name: "Back" })).toBeNull();
    expect(dialog.getByRole("button", { name: "Close Borrow action" }).hasAttribute("disabled")).toBe(false);
    await act(async () => { getHomeQueryClient().setQueryData(key, parsed([{ ...row, owner: { ...row.owner, subject: "another" }, status: "confirmed" }])); });
    expect(dialog.getByText("Borrowing 1 USDC")).toBeTruthy();
    await act(async () => { getHomeQueryClient().setQueryData(key, parsed([{ ...row, status: "confirmed" }])); });
    expect(await dialog.findByText("Borrowed 1 USDC")).toBeTruthy();
    expect(dialog.queryByText("Confirming on Base")).toBeNull();
    expect(dialog.getByRole("button", { name: "Done" })).toBeTruthy();
  });

  test("submission invalidates the overview and every market detail for only this owner", async () => {
    const client = getHomeQueryClient();
    const owner = dataOwnerKey(session);
    const overviewKey = ownerQueryKey(owner, "borrow", "overview");
    const marketKeys = [ownerQueryKey(owner, "borrow-market", snapshot.market.id), ownerQueryKey(owner, "borrow-market", "other-market")];
    const foreignKey = ownerQueryKey("other-owner", "borrow-market", snapshot.market.id);
    for (const queryKey of [overviewKey, ...marketKeys, foreignKey]) client.setQueryData(queryKey, snapshot);
    const body = mount();
    const { dialog, confirm } = await review(body);
    fireEvent.click(confirm);
    await dialog.findByText("Borrowing 1 USDC");
    for (const queryKey of [overviewKey, ...marketKeys]) expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(foreignKey)?.isInvalidated).toBe(false);
  });

  test("failed row permits a fresh review while preserving the entered amount", async () => {
    let prepares = 0;
    const body = mount({ prepare: async () => { prepares++; return action; } });
    const { dialog, confirm } = await review(body);
    fireEvent.click(confirm);
    await dialog.findByText("Borrowing 1 USDC");
    await act(async () => { getHomeQueryClient().setQueryData(key, parsed([{ ...row, status: "failed" }])); });
    expect(await dialog.findByText("Borrow didn't go through")).toBeTruthy();
    expect(dialog.getByText("Your Borrow position didn't change.")).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Try again" }));
    expect(dialog.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect((dialog.getByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("1");
    expect(dialog.queryByRole("button", { name: "Confirm action" })).toBeNull();
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    expect(await dialog.findByRole("button", { name: "Confirm action" })).toBeTruthy();
    expect(prepares).toBe(2);
  });

  test("typed failed result goes straight to failed without an actions read", async () => {
    let actionsReads = 0;
    const body = mount({ execute: async () => ({ id: action.id, status: "failed" }), fetch: async () => { actionsReads++; return { actions: [] }; } });
    const { dialog, confirm } = await review(body);
    fireEvent.click(confirm);
    expect(await dialog.findByText("Borrow didn't go through")).toBeTruthy();
    expect(actionsReads).toBe(0);
    expect(dialog.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  test.each(["submission-unknown", "dispatch-unknown"] as const)("%s is not retriable and routes to Activity after closing", async (reason) => {
    const events: string[] = [];
    const body = mount({ execute: async () => { throw new TransferExecutionError(reason); }, close: () => events.push("close"), openPanel: (panel) => events.push(panel) });
    const { dialog, confirm } = await review(body);
    fireEvent.click(confirm);
    expect(await dialog.findByText("We can't confirm 1 USDC")).toBeTruthy();
    expect(dialog.getByText("It may have gone through. Check Activity before trying again.")).toBeTruthy();
    expect(dialog.queryByRole("button", { name: /try again|retry/i })).toBeNull();
    expect(dialog.queryByText("Confirming on Base")).toBeNull();
    fireEvent.click(dialog.getByRole("button", { name: "View in Activity" }));
    expect(events).toEqual(["close"]);
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(events).toEqual(["close", "activity"]);
  });

  test("rejected stays on the existing error handling", async () => {
    const body = mount({ execute: async () => ({ id: action.id, status: "rejected" }) });
    const { dialog, confirm } = await review(body);
    fireEvent.click(confirm);
    expect(await dialog.findByText("The wallet request was rejected.")).toBeTruthy();
    expect(dialog.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(dialog.getAllByRole("button", { name: "Back" })).toBeTruthy();
  });

  test("other thrown failures retain Retry recording this same action", async () => {
    const body = mount({ execute: async () => { throw new TransferExecutionError("unavailable"); } });
    const { dialog, confirm } = await review(body);
    fireEvent.click(confirm);
    expect(await dialog.findByText(/Retry recording this same action/)).toBeTruthy();
    expect(dialog.getByRole("button", { name: "Retry" }).getAttribute("data-money-action-id")).toBe(action.id);
  });
});
