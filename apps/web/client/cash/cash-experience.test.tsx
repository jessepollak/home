import "@/client/account/dom-test-harness";

import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { focusManager, onlineManager } from "@tanstack/react-query";
import { getHomeQueryClient, HomeQueryClientProvider, ownerQueryKey, publicQueryKey } from "@/client/query/query-client";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { invalidateAfterAction, type BalanceActionMarker } from "@/client/query/after-action";
import { HomeShellRoutingProvider, readHomeInboundPanelState, type HomeInboundPanelState, type HomeShellRouting } from "@/client/home/panel-routing";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { MoneyMotionProvider } from "@/components/money-ticker";
import { canonicalUsdcAsset, verifiedLocalCashAssets } from "@/config/portfolio-assets";
import { buildBalancesSnapshotFixture, priced, pricedCash, ready, unavailableBalance } from "@/shared/balances/fixtures";
import { parseAddress } from "@/shared/chain/hex";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";
import { cashConversionCurrencies } from "@/shared/trading/cash-conversion";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import type { BalancesSnapshot } from "@/shared/balances/types";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { TransferExecutionError } from "@/shared/transfers/types";
import { pinClock } from "@/tests/helpers/pin-clock";

const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { AuthenticatedCashExperience, CashExperience, savingsEntryRefreshInterval } = await import("./cash-experience");
const { AccountWalletContext } = await import("@/client/account/cdp-client");
import type { AccountWalletClient } from "@/client/account/cdp-client";
const { createBlockedAccountWalletClient } = await import("@/client/account/cdp-client");
const { OwnerBoundary } = await import("@/client/account/owner-boundary");
const { savingsWithdrawTargets } = await import("./savings-withdraw-targets");
const { savingsManagement } = await import("./savings-management");
import type { CashExperienceProps } from "./cash-experience";
const { page } = await import("@/tests/helpers/dom");
const [GAUNTLET, , STEAKHOUSE] = MORPHO_V1_CANDIDATE_ADDRESSES;
const NOW_ISO = "2026-09-10T12:04:00.000Z";
const NOW = Date.parse(NOW_ISO);
let restoreClock = () => {};
const now = () => NOW;
const sessionAccount: NonNullable<VerifiedAccountSession["smartAccount"]> = { address: "0x1111111111111111111111111111111111111111", chainId: 8453 };
const sessionBAccount: NonNullable<VerifiedAccountSession["smartAccount"]> = { address: "0x2222222222222222222222222222222222222222", chainId: 8453 };
const session: VerifiedAccountSession = { user: { subject: "cash-test" }, smartAccount: sessionAccount, accountProvider: "cdp-embedded" };
const sessionB: VerifiedAccountSession = { user: { subject: "cash-test-b" }, smartAccount: sessionBAccount, accountProvider: "cdp-embedded" };
function vault(vaultAddress: MorphoVaultCandidate["vaultAddress"], name: string, netApy: number): MorphoVaultCandidate {
  return { version: "v1", vaultAddress, name, symbol: "USDC vault", listed: true, chainId: 8453,
    asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 }, curatorAddress: null,
    grossApy: netApy + 0.005, netApy, feeRate: 0.1, totalAssetsRaw: "1250000000000", liquidityRaw: "850000000000",
    stateAsOf: "2026-09-10T12:00:00.000Z", blockNumber: "51026404",
    source: { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt: "2026-09-10T12:00:00.000Z" },
  };
}
const metadata: MorphoVaultsResult = { version: "v1", chainId: 8453, asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
  candidates: [vault(GAUNTLET, "Gauntlet USDC Prime", 0.041), vault(STEAKHOUSE, "Steakhouse USDC", 0.0385)],
  source: { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt: "2026-09-10T12:00:00.000Z" }, stale: false,
};
const cash = { usdc: { balance: ready("234000000"), value: priced("USD", "23400"), cashValue: pricedCash("USD", "23400") } };
const held = buildBalancesSnapshotFixture({ registry: {
  ...cash,
  "morpho-steakhouse-usdc": { balance: ready("800000000000000000000"), underlyingBalance: ready("800000000"), value: priced("USD", "80000") },
  "morpho-re7-usdc": { balance: ready("83000000000000000000"), underlyingBalance: ready("83000000"), value: priced("USD", "8300") },
} });
const single = buildBalancesSnapshotFixture({ registry: { ...cash, "morpho-steakhouse-usdc": { balance: ready("800000000000000000000"), underlyingBalance: ready("800000000"), value: priced("USD", "80000") } } });
const empty = buildBalancesSnapshotFixture({ registry: cash });
const unsupportedLocalCash = buildBalancesSnapshotFixture({ region: "MX", registry: {
  usdc: { balance: ready("5000000"), value: priced("MXN", "2500"), cashValue: pricedCash("USD", "500") },
} });
const noop = () => undefined;
const preparedInputs: unknown[] = [];
const routeCalls: string[] = [];
const prepareMoneyAction = async (_endpoint: string, input: unknown): Promise<PreparedMoneyAction> => { preparedInputs.push(input); throw new Error("Preparation intentionally unavailable"); };
const executeMoneyAction = async (): Promise<never> => { throw new Error("Not part of this test"); };
const walletWithoutAccount = { status: "verified", verification: "server", session: { ...session, smartAccount: null },
  fetchBalances: async () => { throw new Error("Not part of this test"); }, fetchAccountResource: async () => metadata,
  prepareMoneyAction, executeMoneyAction } as unknown as AccountWalletClient;
const fetchAccountResource = async (path: string) => {
  const assetId = new URL(path, "https://example.test").searchParams.get("assetId");
  const currency = cashConversionCurrencies.find((item) => item.tradeAssetId === assetId);
  return currency ? { version: 2, status: "available", token: { assetId, address: currency.address, symbol: currency.symbol, decimals: currency.decimals }, buy: "available", balanceBaseUnits: "100000" }
    : { version: 2, status: "unavailable", reason: "asset-unsupported" };
};

function Surface({ view = "savings", snapshot = held, status = "ready", stale = false, owner = session, session: currentSession, onAddMoney = noop, onOpenSavings = noop, onRetryBalances = noop, nowFn = now, onPrepare = prepareMoneyAction, onExecute = executeMoneyAction, fetchVaults, fetchAccountResource }: { view?: "cash" | "savings"; snapshot?: BalancesSnapshot | null; status?: "ready" | "loading" | "failed"; stale?: boolean; owner?: VerifiedAccountSession | null; session?: CashExperienceProps["session"]; onAddMoney?: CashExperienceProps["onAddMoney"]; onOpenSavings?: () => void; onRetryBalances?: () => void; nowFn?: () => number; onPrepare?: CashExperienceProps["prepareMoneyAction"]; onExecute?: CashExperienceProps["executeMoneyAction"]; fetchVaults?: CashExperienceProps["fetchVaults"]; fetchAccountResource?: CashExperienceProps["fetchAccountResource"] }) {
  return <main><CashExperience view={view} snapshot={snapshot} balanceStatus={status} balanceStale={stale} session={currentSession ?? owner} now={nowFn} fetchVaults={fetchVaults} fetchAccountResource={fetchAccountResource} onOpenSavings={onOpenSavings} onAddMoney={onAddMoney} onRetryBalances={onRetryBalances} prepareMoneyAction={onPrepare} executeMoneyAction={onExecute} /></main>;
}
const blockedCashWallet = createBlockedAccountWalletClient("unconfigured");
const ownedA = { ...single, owner: { address: sessionAccount.address, chainId: 8453 as const } };
const ownedB = { ...empty, owner: { address: sessionBAccount.address, chainId: 8453 as const } };
function cashWallet(active: VerifiedAccountSession | null): AccountWalletClient {
  return active ? { ...blockedCashWallet, status: "verified", verification: "server", ownerKey: active.user.subject, session: active,
    fetchBalances: async () => active.user.subject === session.user.subject ? ownedA : ownedB,
    fetchAccountResource: async () => metadata,
    prepareMoneyAction, executeMoneyAction,
  } : blockedCashWallet;
}
const walletA = cashWallet(session);
const walletB = cashWallet(sessionB);
function AuthenticatedOwnerSurface({ active }: { active: VerifiedAccountSession | null }) {
  return <AccountWalletContext.Provider value={active === session ? walletA : active === sessionB ? walletB : blockedCashWallet}>
    <PresentationRegionProvider regionId="US"><main><AuthenticatedCashExperience view="savings" onOpenSavings={noop} pendingCashout={null} /></main></PresentationRegionProvider>
  </AccountWalletContext.Provider>;
}
function RoutedAuthenticatedOwnerSurface({ active, deferClear = false }: { active: VerifiedAccountSession | null; deferClear?: boolean }) {
  const [flow, setFlow] = useState<HomeInboundPanelState["flow"]>(null);
  const [popRevision, setPopRevision] = useState(0);
  const routing: HomeShellRouting = {
    state: readHomeInboundPanelState({ panel: "cash", account: null, shelf: null, asset: null, market: null }, new URLSearchParams(flow ? { flow } : {})),
    popRevision, rootRequest: null, openPanel: noop,
    pushRoute: noop, leaveRoute: noop,
    canOpenAssetDetail: () => false, openAssetDetail: () => false,
    setFlow: (next) => { setFlow(next); return true; },
    clearFlow: ({ mode, normalizeInbound } = {}) => { routeCalls.push(`clear:${mode}`); if (!deferClear || normalizeInbound) setFlow(null); },
  };
  return <HomeShellRoutingProvider value={routing}>
    <button onClick={() => setFlow(null)}>Acknowledge routed flow</button>
    <button onClick={() => { setFlow("save-deposit"); setPopRevision((revision) => revision + 1); }}>Land a stale routed flow</button>
    <AuthenticatedOwnerSurface active={active} />
  </HomeShellRoutingProvider>;
}

function OwnerSwitchSurface({ snapshot }: { snapshot: BalancesSnapshot }) {
  const [active, setActive] = useState(session);
  return (
    <main>
      <button onClick={() => setActive(sessionB)}>Switch verified account</button>
      <AccountWalletContext.Provider value={active === session ? walletA : walletB}><OwnerBoundary>
      <CashExperience view="savings" snapshot={snapshot} balanceStatus="ready" session={active} now={now} onOpenSavings={noop} onAddMoney={noop} onRetryBalances={noop} prepareMoneyAction={prepareMoneyAction} executeMoneyAction={executeMoneyAction} />
      </OwnerBoundary></AccountWalletContext.Provider>
    </main>
  );
}

function SignInRoute({ initialFlow, snapshot }: { initialFlow: "save-deposit"; snapshot: BalancesSnapshot }) {
  const [flow, setFlow] = useState<string | null>(initialFlow);
  const [active, setActive] = useState<VerifiedAccountSession | null>(null);
  const routing = {
    state: { flow } as HomeInboundPanelState, activityReturn: null, popRevision: 0, rootRequest: null, openPanel: noop,
    canOpenAssetDetail: () => false, openAssetDetail: () => false,
    setFlow: (next: string) => { setFlow(next); return true; },
    clearFlow: () => { setFlow(null); },
    pushRoute: noop, leaveRoute: noop,
  };
  return <HomeShellRoutingProvider value={routing as Parameters<typeof HomeShellRoutingProvider>[0]["value"]}>
    <button onClick={() => setActive(session)}>Verify account</button>
    <main><CashExperience view="savings" snapshot={snapshot} balanceStatus="ready" session={active} now={now} onOpenSavings={noop} onAddMoney={noop} onRetryBalances={noop} prepareMoneyAction={prepareMoneyAction} executeMoneyAction={executeMoneyAction} /></main>
  </HomeShellRoutingProvider>;
}

function Route({ initialFlow, snapshot, view = "savings", status = "ready", deferClear = false, onPrepare, onExecute, fetchVaults, fetchAccountResource, addMoneyRoute = false }: { initialFlow: "save-deposit" | "save-withdraw" | null; snapshot: BalancesSnapshot; view?: "cash" | "savings"; status?: CashExperienceProps["balanceStatus"]; deferClear?: boolean; onPrepare?: CashExperienceProps["prepareMoneyAction"]; onExecute?: CashExperienceProps["executeMoneyAction"]; fetchVaults?: CashExperienceProps["fetchVaults"]; fetchAccountResource?: CashExperienceProps["fetchAccountResource"]; addMoneyRoute?: boolean }) {
  const [flow, setFlow] = useState<string | null>(initialFlow);
  const pushedFlow = useRef<string | null>(initialFlow);
  const routing = {
    state: { flow } as HomeInboundPanelState, popRevision: 0, rootRequest: null, openPanel: noop,
    canOpenAssetDetail: () => false, openAssetDetail: () => false,
    setFlow: (next: string, options?: { mode?: "push" | "replace" }) => { pushedFlow.current = next; routeCalls.push(`${options?.mode === "replace" ? "replace" : "push"}:${next}`); setFlow(next); return true; },
    clearFlow: ({ mode }: { mode?: "replace" | "push" } = {}) => { routeCalls.push(`clear:${mode}`); if (!deferClear) setFlow(null); },
    pushRoute: noop, leaveRoute: noop,
  };
  return <HomeShellRoutingProvider value={routing as Parameters<typeof HomeShellRoutingProvider>[0]["value"]}>
    <div data-shell-back><button onClick={() => setFlow(null)}>Browser Back</button></div>
    <div data-shell-forward><button onClick={() => setFlow(pushedFlow.current)}>Browser Forward</button></div>
    <Surface view={view} snapshot={snapshot} status={status} onPrepare={onPrepare} onExecute={onExecute} fetchVaults={fetchVaults} fetchAccountResource={fetchAccountResource} onAddMoney={addMoneyRoute ? (options) => routing.setFlow("add-money", { mode: options?.replaceFlow ? "replace" : "push" }) : noop} />
  </HomeShellRoutingProvider>;
}
function cached(metadataValue: MorphoVaultsResult = metadata) { getHomeQueryClient().setQueryData(publicQueryKey("savings-vaults"), metadataValue); }
function preparedDeposit(id = "cash-deposit-1", amountBaseUnits = "1000000"): PreparedMoneyAction {
  return {
    id, kind: "savings-deposit", title: "Deposit USDC",
    createdAt: "2026-09-10T12:00:00.000Z", expiresAt: "2099-09-10T12:00:00.000Z", calls: [], warnings: [],
    amounts: [
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits, direction: "spend" },
      { assetId: "vault", symbol: "vault shares", decimals: 18, amountBaseUnits: "1000000000000000000", direction: "receive", estimated: true },
    ],
    metadata: {
      product: "savings", operation: "deposit", vaultAddress: GAUNTLET, vaultName: metadata.candidates[0]!.name,
      network: { name: "Base", chainId: 8453 }, feeWad: "100000000000000000", limitBaseUnits: "250000000",
      previewSharesBaseUnits: "1000000000000000000", shareDecimals: 18, minimumSharesBaseUnits: "1000000000000000000",
      exchangeConstraint: "deposit-minimum-shares-or-revert",
      discoveryRate: { status: "current", netApy: "0.041", fetchedAt: metadata.source.fetchedAt, stateAsOf: "2026-09-10T12:00:00.000Z" },
      source: { blockNumber: "51026404", blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: "1789041840" },
    },
    owner: { subject: session.user.subject, address: session.smartAccount!.address, chainId: 8453, accountProvider: session.accountProvider },
  };
}

function preparedTrade(): PreparedMoneyAction {
  const euro = cashConversionCurrencies.find((currency) => currency.code === "EUR")!;
  const dollar = cashConversionCurrencies.find((currency) => currency.code === "USD")!;
  const from = { id: "usdc", address: dollar.address, symbol: dollar.symbol, decimals: dollar.decimals };
  const to = { id: euro.tradeAssetId, address: euro.address, symbol: euro.symbol, decimals: euro.decimals };
  return {
    id: "cash-trade-1", kind: "trade", title: "Convert", owner: { subject: session.user.subject, address: session.smartAccount!.address, chainId: 8453, accountProvider: session.accountProvider },
    createdAt: "2026-09-10T12:00:00.000Z", expiresAt: "2099-09-10T12:00:00.000Z", calls: [], warnings: [],
    amounts: [
      { assetId: from.id, symbol: from.symbol, decimals: from.decimals, amountBaseUnits: "1000000", direction: "spend" },
      { assetId: to.id, symbol: to.symbol, decimals: to.decimals, amountBaseUnits: "2000000", direction: "receive", estimated: true },
    ],
    signing: { signer: "cdp-embedded", evmAccount: parseAddress(session.smartAccount!.address)!, typedData: {
      domain: { name: "Coinbase Smart Wallet", version: "1", chainId: 8453, verifyingContract: session.smartAccount!.address },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
        ],
        CoinbaseSmartWalletMessage: [{ name: "hash", type: "bytes32" }],
      },
      primaryType: "CoinbaseSmartWalletMessage", message: { hash: `0x${"ab".repeat(32)}` },
    } },
    metadata: { product: "trade", provider: "cdp-swaps", direction: "buy", network: { name: "Base", chainId: 8453 }, assetId: to.id, assetName: euro.name, fromAsset: from, toAsset: to,
      fromAmountBaseUnits: "1000000", expectedToAmountBaseUnits: "2000000", minimumToAmountBaseUnits: "1980000", slippageBps: 100, fees: [], approval: "permit2-exact",
      quoteBlockNumber: "123", quotedAt: "2026-09-10T12:00:00.000Z", permitDeadline: "4102444800", executionDeadline: "4102444800" },
  };
}

function pendingActionRow(action: PreparedMoneyAction, status: "pending" | "unknown" | "failed" | "confirmed" = "pending", settledAt?: string) {
  return { id: action.id, kind: action.kind, status, owner: action.owner,
    createdAt: action.createdAt, confirmedAt: action.createdAt, ...(settledAt ? { settledAt } : {}), summary: {
      title: action.title, amounts: action.amounts, warnings: action.warnings,
      expiresAt: action.expiresAt, metadata: action.metadata,
    } };
}

function buttonElement(element: HTMLElement): HTMLButtonElement {
  if (!(element instanceof HTMLButtonElement)) throw new Error("Expected a button element");
  return element;
}
function inputElement(element: HTMLElement): HTMLInputElement {
  if (!(element instanceof HTMLInputElement)) throw new Error("Expected an input element");
  return element;
}

async function confirmDeposit(amount: string) {
  fireEvent.change(await page().findByRole("textbox", { name: "Amount" }), { target: { value: amount } });
  const next = buttonElement(page().getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(next.disabled).toBe(false));
  fireEvent.click(next);
  const confirm = buttonElement(await page().findByRole("button", { name: `Deposit $${amount}.00` }));
  expect(confirm.disabled).toBe(false);
  fireEvent.click(confirm);
  await page().findByRole("button", { name: "Done" });
}
async function finishDeposit() {
  fireEvent.click(page().getByRole("button", { name: "Done" }));
  await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
}
async function openMoreWaysDeposit() {
  const more = page().getByRole("region", { name: "More ways to save" });
  const deposit = buttonElement(within(more).getByRole("button", { description: "Deposit to Gauntlet USDC Prime" }));
  expect(deposit.disabled).toBe(false);
  fireEvent.click(deposit);
  await page().findByRole("textbox", { name: "Amount" });
}

beforeEach(() => { restoreClock = pinClock(NOW_ISO); });
afterEach(() => { restoreClock(); restoreClock = () => {}; cleanup(); getHomeQueryClient().clear(); focusManager.setFocused(undefined); onlineManager.setOnline(true); preparedInputs.length = 0; routeCalls.length = 0; });

describe("Cash L2", () => {
  for (const postAction of [false, true]) {
    test(`failed savings refresh labels retained balances only after a confirmed action (postAction=${postAction})`, async () => {
      cached();
      const client = getHomeQueryClient();
      const balanceKey = ownerQueryKey(dataOwnerKey(session), "balances", "US");
      client.setQueryData(balanceKey, held, { updatedAt: NOW - 1000 });
      let reads = 0;
      const wallet = Object.assign({}, walletWithoutAccount, { session, fetchBalances: async () => {
        reads += 1;
        throw new Error("balance refresh failed");
      } });
      render(<PresentationRegionProvider regionId="US"><AccountWalletContext.Provider value={wallet}><main><AuthenticatedCashExperience view="savings" onOpenSavings={noop} pendingCashout={null} /></main></AccountWalletContext.Provider></PresentationRegionProvider>);
      expect(page().queryByText("Balance may be out of date")).toBeNull();
      await act(async () => {
        if (postAction) await invalidateAfterAction(client, dataOwnerKey(session), NOW);
        else await client.invalidateQueries({ queryKey: balanceKey });
      });
      await waitFor(() => expect(client.getQueryState(balanceKey)?.status).toBe("error"));
      expect(reads).toBe(1);
      const hero = page().getByLabelText("Savings balance");
      const amount = within(hero).getByRole("img", { name: "$883.00" });
      if (postAction) {
        const caption = within(hero).getByText("Balance may be out of date");
        expect(amount.closest("[aria-describedby]")?.getAttribute("aria-describedby")).toBe(caption.id);
        expect(within(hero).queryByText(/^Earning /)).toBeNull();
      } else {
        expect(within(hero).queryByText("Balance may be out of date")).toBeNull();
        expect(amount.closest("[aria-describedby]")).toBeNull();
        expect(within(hero).getByText(/^Earning .*APY$/)).toBeTruthy();
      }
    });
  }

  test("a successful stale savings fallback retains the caption until fresh balances arrive", async () => {
    cached();
    const client = getHomeQueryClient();
    const owner = dataOwnerKey(session);
    const balanceKey = ownerQueryKey(owner, "balances", "US");
    const markerKey = ownerQueryKey(owner, "balances-action");
    client.setQueryData(balanceKey, held, { updatedAt: NOW - 1000 });
    const actionAt = Date.parse(held.fetchedAt) + 1;
    const fresh = { ...held, fetchedAt: new Date(actionAt + 1).toISOString() };
    let stale = true;
    const wallet = Object.assign({}, walletWithoutAccount, { session, fetchBalances: async () => stale ? { ...fresh, stale: true } : fresh });
    render(<PresentationRegionProvider regionId="US"><AccountWalletContext.Provider value={wallet}><main><AuthenticatedCashExperience view="savings" onOpenSavings={noop} pendingCashout={null} /></main></AccountWalletContext.Provider></PresentationRegionProvider>);
    await act(async () => { await invalidateAfterAction(client, owner, NOW); });
    const hero = page().getByLabelText("Savings balance");
    await waitFor(() => expect(within(hero).getByText("Balance may be out of date")).toBeTruthy());
    expect(client.getQueryState(balanceKey)?.status).toBe("success");
    expect(client.getQueryData<BalanceActionMarker>(markerKey)).toEqual({ at: actionAt, fresh: {} });
    expect(within(hero).queryByText(/^Earning /)).toBeNull();
    stale = false;
    await act(async () => { await client.refetchQueries({ queryKey: balanceKey, exact: true }); });
    await waitFor(() => expect(within(page().getByLabelText("Savings balance")).queryByText("Balance may be out of date") === null).toBe(true));
    expect(client.getQueryData<BalanceActionMarker>(markerKey)).toEqual({ at: actionAt, fresh: { US: true } });
    expect(within(page().getByLabelText("Savings balance")).getByText(/^Earning .*APY$/)).toBeTruthy();
    stale = true;
    await act(async () => { await client.refetchQueries({ queryKey: balanceKey, exact: true }); });
    expect(within(page().getByLabelText("Savings balance")).queryByText("Balance may be out of date") === null).toBe(true);
    expect(within(page().getByLabelText("Savings balance")).getByText(/^Earning .*APY$/)).toBeTruthy();
  });

  test("unsupported local currency shows verification pending without inventing an amount", () => {
    render(<Surface view="cash" snapshot={unsupportedLocalCash} />);
    const currencies = page().getByRole("region", { name: "Currencies" });
    const mexicanPesoRow = within(currencies).getByText("Mexican peso").closest("li");
    expect(mexicanPesoRow).not.toBeNull();
    expect(mexicanPesoRow?.textContent).toContain("Verification pending");
    expect(mexicanPesoRow?.textContent).not.toMatch(/[0-9]/);
    expect(within(mexicanPesoRow!).queryByRole("img", { name: "Verification pending" })).toBeNull();
    const usDollarRow = within(currencies).getByText("US dollar").closest("li");
    expect(usDollarRow).not.toBeNull();
    expect(within(usDollarRow!).getByRole("img", { name: "$5.00" })).toBeTruthy();
    expect(within(usDollarRow!).getByText("$25.00")).toBeTruthy();
  });
  test("held verified cash currencies render their own balances, including wBRL as Brazilian real", async () => {
    cached();
    const snapshot = buildBalancesSnapshotFixture({ registry: {
      [canonicalUsdcAsset.id]: { balance: ready("234000000"), value: priced("USD", "23400"), cashValue: pricedCash(canonicalUsdcAsset.cashCurrency, "23400") },
      [verifiedLocalCashAssets.EUR.id]: { balance: ready("15000000"), value: priced("USD", "1700"), cashValue: pricedCash(verifiedLocalCashAssets.EUR.cashCurrency, "1500") },
      [verifiedLocalCashAssets.IDR.id]: { balance: ready("190000000"), value: priced("USD", "11700"), cashValue: pricedCash(verifiedLocalCashAssets.IDR.cashCurrency, "190000000") },
      [verifiedLocalCashAssets.ARS.id]: { balance: ready("123450000000000000000"), value: priced("USD", "12000"), cashValue: pricedCash(verifiedLocalCashAssets.ARS.cashCurrency, "12345") },
      [verifiedLocalCashAssets.BRL.id]: { balance: ready("23450000000000000000"), value: priced("USD", "5000"), cashValue: pricedCash(verifiedLocalCashAssets.BRL.cashCurrency, "2345") },
      [verifiedLocalCashAssets.COP.id]: { balance: ready("1234560000000000000000"), value: priced("USD", "3000"), cashValue: pricedCash(verifiedLocalCashAssets.COP.cashCurrency, "123456") },
    } });
    render(<Surface view="cash" snapshot={snapshot} />);
    const currencies = within(await page().findByRole("region", { name: "Currencies" }));
    expect(currencies.getAllByRole("listitem")).toHaveLength(6);
    for (const [name, amount] of [["US dollar", "$234.00"], ["Euro", "€15.00"], ["Rupiah", "Rp 1,900,000.00"], ["Argentine peso", "$123.45"], ["Brazilian real", "R$ 23.45"], ["Colombian peso", "$1,234.56"]] as const) {
      const row = currencies.getByRole("button", { name: new RegExp(`^${name}`) });
      expect(row.textContent).toContain(amount);
    }
    const real = currencies.getByRole("button", { name: /^Brazilian real/ });
    expect(real.textContent).toContain(verifiedLocalCashAssets.BRL.symbol);
    expect(currencies.queryByText("Unsupported", { exact: true })).toBeNull();
  });
  test("shows priced pending escrow below the wallet-only Cash balance", () => {
    const snapshot = buildBalancesSnapshotFixture({ registry: cash });
    snapshot.holdings.find(({ id }) => id === "usdc")!.unitValue = { currency: "USD", amount: { atoms: "1", scale: 0 } };
    const view = render(<CashExperience view="cash" session={session} snapshot={snapshot} pendingCashout={{ state: "escrow", baseUnits: "20000000", partial: false }}
      balanceStatus="ready" now={now} onOpenSavings={noop} onAddMoney={noop} prepareMoneyAction={prepareMoneyAction} executeMoneyAction={executeMoneyAction} />);
    const hero = page().getByLabelText("Cash balance");
    expect(hero.querySelector("[data-pending-cash-out]")?.textContent).toContain("Pending cash-out");
    expect(hero.querySelector("[data-pending-cash-out] [role=img]")?.getAttribute("aria-label")).toBe("$20.00");
    expect(hero.querySelector("[role=img]")?.getAttribute("aria-label")).toBe("$234.00");
    view.rerender(<CashExperience view="cash" session={session} snapshot={snapshot} pendingCashout={{ state: "escrow", baseUnits: "20000000", partial: true }}
      balanceStatus="ready" now={now} onOpenSavings={noop} onAddMoney={noop} prepareMoneyAction={prepareMoneyAction} executeMoneyAction={executeMoneyAction} />);
    expect(hero.querySelector("[data-pending-cash-out] [role=img]")?.getAttribute("aria-label")).toBe("$20.00");
    expect(hero.querySelector("[role=img]")?.getAttribute("aria-label")).toBe("$234.00");
    view.rerender(<CashExperience view="cash" session={session} snapshot={snapshot} pendingCashout={null}
      balanceStatus="ready" now={now} onOpenSavings={noop} onAddMoney={noop} prepareMoneyAction={prepareMoneyAction} executeMoneyAction={executeMoneyAction} />);
    expect(page().getByLabelText("Cash balance").querySelector("[data-pending-cash-out]")).toBeNull();
    view.rerender(<CashExperience view="cash" session={session} snapshot={snapshot} pendingCashout={{ state: "unreadable" }}
      balanceStatus="ready" now={now} onOpenSavings={noop} onAddMoney={noop} prepareMoneyAction={prepareMoneyAction} executeMoneyAction={executeMoneyAction} />);
    expect(page().getByLabelText("Cash balance").querySelector("[data-pending-cash-out]")).toBeNull();
    expect(page().getByLabelText("Cash balance").querySelector("[role=img]")?.getAttribute("aria-label")).toBe("$234.00");
    view.rerender(<CashExperience view="cash" session={session} snapshot={snapshot} pendingCashout={{ state: "indeterminate" }}
      balanceStatus="ready" now={now} onOpenSavings={noop} onAddMoney={noop} prepareMoneyAction={prepareMoneyAction} executeMoneyAction={executeMoneyAction} />);
    expect(page().getByLabelText("Cash balance").querySelector("[data-pending-cash-out]")?.textContent).toContain("Pending cash-out");
    expect(page().getByLabelText("Cash balance").querySelector("[data-pending-cash-out]")?.textContent).toContain("—");
    expect(page().getByLabelText("Cash balance").querySelector("[role=img]")?.getAttribute("aria-label")).toBe("$234.00");
  });

  test("an owner change closes the currency sheet and returning to the same owner does not reopen it", async () => {
    cached();
    const view = render(<Surface view="cash" snapshot={held} fetchAccountResource={fetchAccountResource} />);
    fireEvent.click(await page().findByRole("button", { name: "Convert" }));
    expect(await page().findByRole("dialog", { name: "Convert to" })).toBeTruthy();
    const other: VerifiedAccountSession = { ...session, user: { subject: "cash-test-other" } };
    view.rerender(<Surface view="cash" snapshot={held} session={other} fetchAccountResource={fetchAccountResource} />);
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
    view.rerender(<Surface view="cash" snapshot={held} fetchAccountResource={fetchAccountResource} />);
    expect(page().queryByRole("dialog")).toBeNull();
  });
  test("the Cash Save entry stays visible while a deposit is unresolved", async () => {
    cached();
    const unfunded = buildBalancesSnapshotFixture({ registry: {
      usdc: { balance: ready("250000000"), value: priced("USD", "25000"), cashValue: pricedCash("USD", "25000") },
    } });
    render(<Surface view="cash" snapshot={unfunded} fetchAccountResource={async (path) => path.includes("/api/actions")
      ? { actions: [pendingActionRow(preparedDeposit(), "pending")] }
      : { version: 1, usdcReserveBaseUnits: "20000" }} />);
    fireEvent.click(await within(page().getByRole("region", { name: "Currencies" })).findByRole("button", { name: /^US dollar/ }));
    expect(await page().findByRole("dialog", { name: "US dollar" })).toBeTruthy();
    expect(await page().findByRole("button", { name: "Save" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Convert" })).toBeTruthy();
  });
  test("the Cash Save entry appears once the deposit history is clear", async () => {
    cached();
    const unfunded = buildBalancesSnapshotFixture({ registry: {
      usdc: { balance: ready("250000000"), value: priced("USD", "25000"), cashValue: pricedCash("USD", "25000") },
    } });
    render(<Surface view="cash" snapshot={unfunded} fetchAccountResource={async () => ({ actions: [] })} />);
    fireEvent.click(await within(page().getByRole("region", { name: "Currencies" })).findByRole("button", { name: /^US dollar/ }));
    expect(await page().findByRole("dialog", { name: "US dollar" })).toBeTruthy();
    await waitFor(() => expect(page().getByRole("button", { name: "Save" })).toBeTruthy());
  });
  test("Cash Save prepares during a history refetch and keeps Save available after submission", async () => {
    getHomeQueryClient().setQueryData(ownerQueryKey(dataOwnerKey(session), "actions"), { operations: [], unparsedSavingsDeposits: [], truncated: false, incomplete: false }, { updatedAt: NOW - 61_000 });
    cached();
    const releases: Array<() => void> = [];
    const preparations: unknown[] = [];
    const executed: string[] = [];
    let historyReads = 0;
    render(<Surface view="cash" snapshot={empty}
      onPrepare={async (_endpoint, input) => { preparations.push(input); return preparedDeposit(); }}
      onExecute={async (action) => { executed.push(action.id); return { id: action.id, status: "submitted" }; }}
      fetchAccountResource={async (path) => {
        if (path !== "/api/actions") return { version: 1, usdcReserveBaseUnits: "20000" };
        historyReads += 1;
        await new Promise<void>((resolve) => { releases.push(resolve); });
        return { actions: [] };
      }} />);
    fireEvent.click(await within(page().getByRole("region", { name: "Currencies" })).findByRole("button", { name: /^US dollar/ }));
    const detail = await page().findByRole("dialog", { name: "US dollar" });
    await waitFor(() => expect(historyReads).toBeGreaterThan(0));
    fireEvent.click(within(detail).getByRole("button", { name: "Save" }));
    const deposit = await page().findByRole("dialog", { name: "Deposit" });
    fireEvent.change(await within(deposit).findByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit $1.00" }));
    act(() => { releases.splice(0).forEach((release) => release()); });
    expect(preparations).toEqual([{ kind: "deposit", vaultAddress: GAUNTLET, amountBaseUnits: "1000000" }]);
    expect(executed).toEqual(["cash-deposit-1"]);
    fireEvent.click(await page().findByRole("button", { name: "Done" }));
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
    fireEvent.click(await within(page().getByRole("region", { name: "Currencies" })).findByRole("button", { name: /^US dollar/ }));
    const reopened = await page().findByRole("dialog", { name: "US dollar" });
    expect(within(reopened).getByRole("button", { name: "Save" })).toBeTruthy();
    expect(preparations).toEqual([{ kind: "deposit", vaultAddress: GAUNTLET, amountBaseUnits: "1000000" }]);
    expect(executed).toEqual(["cash-deposit-1"]);
  });
  test("an embedded ambiguous Save keeps the new-deposit entry available", async () => {
    getHomeQueryClient().setQueryData(ownerQueryKey(dataOwnerKey(session), "actions"), { operations: [], unparsedSavingsDeposits: [], truncated: false, incomplete: false }, { updatedAt: NOW - 61_000 });
    cached();
    const releases: Array<() => void> = [];
    const preparations: unknown[] = [];
    let executions = 0;
    render(<Surface view="cash" snapshot={empty}
      onPrepare={async (_endpoint, input) => { preparations.push(input); return preparedDeposit(); }}
      onExecute={async () => { executions += 1; throw new TransferExecutionError("submission-unknown"); }}
      fetchAccountResource={async (path) => {
        if (path !== "/api/actions") return { version: 1, usdcReserveBaseUnits: "20000" };
        await new Promise<void>((resolve) => { releases.push(resolve); });
        return { actions: [] };
      }} />);
    fireEvent.click(await within(page().getByRole("region", { name: "Currencies" })).findByRole("button", { name: /^US dollar/ }));
    fireEvent.click(within(await page().findByRole("dialog", { name: "US dollar" })).getByRole("button", { name: "Save" }));
    const deposit = await page().findByRole("dialog", { name: "Deposit" });
    fireEvent.change(await within(deposit).findByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    act(() => { releases.splice(0).forEach((release) => release()); });
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit $1.00" }));
    expect(executions).toBe(1);
    fireEvent.click(await page().findByRole("button", { name: "Done" }));
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
    fireEvent.click(await within(page().getByRole("region", { name: "Currencies" })).findByRole("button", { name: /^US dollar/ }));
    const reopened = await page().findByRole("dialog", { name: "US dollar" });
    expect(within(reopened).getByRole("button", { name: "Save" })).toBeTruthy();
    expect(preparations).toEqual([{ kind: "deposit", vaultAddress: GAUNTLET, amountBaseUnits: "1000000" }]);
  });
  test("another tab's pending deposit leaves embedded Save actionable", async () => {
    getHomeQueryClient().setQueryData(ownerQueryKey(dataOwnerKey(session), "actions"), { operations: [], unparsedSavingsDeposits: [], truncated: false, incomplete: false }, { updatedAt: NOW - 61_000 });
    cached();
    const preparations: unknown[] = [];
    let otherTabDeposit = false;
    const resource: CashExperienceProps["fetchAccountResource"] = async (path) => {
      if (path !== "/api/actions") return { version: 1, usdcReserveBaseUnits: "20000" };
      return { actions: otherTabDeposit ? [pendingActionRow({ ...preparedDeposit(), id: "other-tab-deposit" }, "pending")] : [] };
    };
    render(<Surface view="cash" snapshot={empty}
      onPrepare={async (_endpoint, input) => { preparations.push(input); return preparedDeposit(); }}
      onExecute={async (action) => ({ id: action.id, status: "submitted" })}
      fetchAccountResource={resource} />);
    fireEvent.click(await within(page().getByRole("region", { name: "Currencies" })).findByRole("button", { name: /^US dollar/ }));
    fireEvent.click(within(await page().findByRole("dialog", { name: "US dollar" })).getByRole("button", { name: "Save" }));
    const deposit = await page().findByRole("dialog", { name: "Deposit" });
    fireEvent.change(await within(deposit).findByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    act(() => { otherTabDeposit = true; });
    await act(async () => { await getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey(dataOwnerKey(session), "actions") }); });
    expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit $1.00" }));
    fireEvent.click(await page().findByRole("button", { name: "Done" }));
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
    fireEvent.click(await within(page().getByRole("region", { name: "Currencies" })).findByRole("button", { name: /^US dollar/ }));
    const reopened = await page().findByRole("dialog", { name: "US dollar" });
    expect(within(reopened).getByRole("button", { name: "Save" })).toBeTruthy();
    expect(preparations).toEqual([{ kind: "deposit", vaultAddress: GAUNTLET, amountBaseUnits: "1000000" }]);
  });
  test("Save remains actionable after Convert while action history is refreshing", async () => {
    getHomeQueryClient().setQueryData(ownerQueryKey(dataOwnerKey(session), "actions"), { operations: [], unparsedSavingsDeposits: [], truncated: false, incomplete: false }, { updatedAt: NOW - 61_000 });
    cached();
    let holdHistory = false;
    let reads = 0;
    const resource: CashExperienceProps["fetchAccountResource"] = async (path) => {
      if (path === "/api/actions") {
        reads += 1;
        if (holdHistory) await new Promise<void>(() => undefined);
        return { actions: [] };
      }
      if (path.includes("/api/trades?")) {
        const assetId = new URL(path, "https://example.test").searchParams.get("assetId");
        const currency = cashConversionCurrencies.find((item) => item.tradeAssetId === assetId);
        return currency
          ? { version: 2, status: "available", token: { assetId, address: currency.address, symbol: currency.symbol, decimals: currency.decimals }, buy: "available", balanceBaseUnits: "100000" }
          : { version: 2, status: "unavailable", reason: "asset-unsupported" };
      }
      return { version: 1, usdcReserveBaseUnits: "20000" };
    };
    render(<Surface view="cash" snapshot={empty}
      onPrepare={async (kind) => kind === "trade" ? preparedTrade() : preparedDeposit()}
      onExecute={async (action) => ({ id: action.id, status: "submitted" })}
      fetchAccountResource={resource} />);
    fireEvent.click(await page().findByRole("button", { name: "Convert" }));
    await waitFor(() => expect(reads).toBeGreaterThan(0));
    fireEvent.click(await page().findByRole("button", { name: /^Euro/ }));
    fireEvent.change(await page().findByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: /Convert \$1\.00/ }));
    fireEvent.click(await page().findByRole("button", { name: /^(Done|Close conversion)$/ }));
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
    holdHistory = true;
    fireEvent.click(await within(page().getByRole("region", { name: "Currencies" })).findByRole("button", { name: /^US dollar/ }));
    fireEvent.click(await page().findByRole("button", { name: "Save" }));
    const deposit = await page().findByRole("dialog", { name: "Deposit" });
    fireEvent.change(await within(deposit).findByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(await page().findByRole("button", { name: "Deposit $1.00" })).toBeTruthy();
  });
  test("uses the DE presentation region for savings labels despite a GLOBAL balance snapshot", async () => {
    cached();
    const globalSnapshot = buildBalancesSnapshotFixture({ registry: cash, region: "GLOBAL" });
    render(<PresentationRegionProvider regionId="DE"><Surface snapshot={globalSnapshot} /></PresentationRegionProvider>);
    expect((await page().findByText("Up to 4,10 % APY")).textContent).toBe("Up to 4,10\u00a0% APY");
  });

  test("routes an inbound deposit to the highest-rate vault and normalizes Back history", async () => {
    cached();
    render(<Route initialFlow="save-deposit" snapshot={held} />);
    await page().findByRole("dialog", { name: "Deposit" });
    await page().findByText("$234.00 available");
    const dialog = page().getByRole("dialog", { name: "Deposit" });
    expect(within(dialog).getByText("Gauntlet USDC Prime · 4.10% APY")).toBeTruthy();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Amount" }), { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(preparedInputs).toEqual([{ kind: "deposit", vaultAddress: GAUNTLET, amountBaseUnits: "2000000" }]));
    expect(routeCalls.slice(0, 2)).toEqual(["clear:replace", "push:save-deposit"]);
    fireEvent.click(page().getByRole("button", { name: "Browser Back", hidden: true }));
    await waitFor(() => expect(dialog.isConnected).toBe(false));
  });
  test("an unreadable open sheet clears its route once across rerenders and restores shell Back focus", async () => {
    (globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean }).BASE_UI_ANIMATIONS_DISABLED = false;
    cached();
    const unreadable = buildBalancesSnapshotFixture({ registry: { ...cash, usdc: { balance: unavailableBalance, value: { status: "unavailable" } } } });
    const view = render(<Route initialFlow="save-deposit" snapshot={held} deferClear />);
    await page().findByRole("dialog", { name: "Deposit" });
    routeCalls.length = 0;
    view.rerender(<Route initialFlow="save-deposit" snapshot={unreadable} deferClear />);
    await waitFor(() => expect(routeCalls).toEqual(["clear:replace"]));
    view.rerender(<Route initialFlow="save-deposit" snapshot={unreadable} deferClear />);
    view.rerender(<Route initialFlow="save-deposit" snapshot={unreadable} status="failed" deferClear />);
    expect(routeCalls).toEqual(["clear:replace"]);
    await waitFor(() => expect(document.activeElement).toBe(page().getByRole("button", { name: "Browser Back", hidden: true })));
  });
  test("an unreadable balance closes a management-entry money journey instead of returning to its tray", async () => {
    cached();
    const unavailable = buildBalancesSnapshotFixture({ registry: { ...cash, usdc: { balance: unavailableBalance, value: { status: "unavailable" } },
      "morpho-steakhouse-usdc": { balance: ready("800000000000000000000"), underlyingBalance: ready("800000000"), value: priced("USD", "80000") },
    } });
    const view = render(<Surface snapshot={single} />);
    const row = await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" });
    row.focus();
    fireEvent.click(row);
    fireEvent.click(await page().findByRole("button", { name: "Deposit more" }));
    await page().findByRole("textbox", { name: "Amount" });
    view.rerender(<Surface snapshot={unavailable} />);
    await waitFor(() => expect(Boolean(page().queryByRole("dialog"))).toBe(false));
    expect(document.activeElement === row).toBe(true);
  });
  test("a confirmed sheet remains open and never clears its route when balances fail", async () => {
    cached();
    const view = render(<Route initialFlow="save-deposit" snapshot={held}
      onPrepare={async () => preparedDeposit()}
      onExecute={async (action) => ({ id: action.id, status: "submitted" })} />);
    const dialog = await page().findByRole("dialog", { name: "Deposit" });
    fireEvent.change(await within(dialog).findByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit $1.00" }));
    await page().findByRole("heading", { name: "Depositing $1.00 to Save" });
    routeCalls.length = 0;
    view.rerender(<Route initialFlow="save-deposit" snapshot={held} status="failed"
      onPrepare={async () => preparedDeposit()}
      onExecute={async (action) => ({ id: action.id, status: "submitted" })} />);
    expect(page().getByRole("dialog", { name: "Deposit" })).toBeTruthy();
    expect(routeCalls).toEqual([]);
  });
  for (const { mode, snapshot, available } of [
    { mode: "deposit", snapshot: held, available: "$234.00 available" },
    { mode: "withdraw", snapshot: single, available: "$800.00 available" },
  ] as const) {
    test(`closing a direct ${mode} keeps its amount and available balance until the sheet finishes closing`, async () => {
      cached();
      render(<Route initialFlow={`save-${mode}`} snapshot={snapshot} />);
      const dialog = await page().findByRole("dialog", { name: mode === "deposit" ? "Deposit" : "Withdraw" });
      await within(dialog).findByRole("textbox", { name: "Amount" }, { timeout: 10_000 });
      expect(within(dialog).getByText(available)).toBeTruthy();
      fireEvent.click(within(dialog).getByRole("button", { name: `Close ${mode} dialog` }));
      expect(routeCalls.at(-1)).toBe("clear:replace");
      expect(within(dialog).getByRole("textbox", { name: "Amount", hidden: true })).toBeTruthy();
      expect(within(dialog).getByText(available)).toBeTruthy();
      await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
    }, 20_000);
  }
  test("a held savings row opens its tray closed before presenting it", async () => {
    cached();
    render(<Surface snapshot={single} />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    expect(page().queryByRole("dialog")).toBeNull();
    expect(await page().findByRole("dialog", { name: "Gauntlet USDC Prime" })).toBeTruthy();
  }, 20_000);
  test("routes an inbound withdrawal to the sole funded vault", async () => {
    cached();
    render(<Route initialFlow="save-withdraw" snapshot={single} />);
    expect(await within(await page().findByRole("dialog", { name: "Withdraw" })).findByText("$800.00 available")).toBeTruthy();
  });
  test("a routed withdrawal closes once when its selected shares become unreadable", async () => {
    cached();
    const unreadable = buildBalancesSnapshotFixture({ registry: { ...cash,
      "morpho-steakhouse-usdc": { balance: ready("800000000000000000000"), underlyingBalance: unavailableBalance, value: priced("USD", "80000") },
    } });
    const view = render(<Route initialFlow="save-withdraw" snapshot={single} deferClear />);
    await page().findByRole("dialog", { name: "Withdraw" });
    routeCalls.length = 0;
    view.rerender(<Route initialFlow="save-withdraw" snapshot={unreadable} deferClear />);
    await waitFor(() => expect(routeCalls).toEqual(["clear:replace"]));
    expect(page().queryByRole("dialog", { name: "Withdraw" })).toBeNull();
    view.rerender(<Route initialFlow="save-withdraw" snapshot={unreadable} status="failed" deferClear />);
    expect(routeCalls).toEqual(["clear:replace"]);
    expect(page().queryByRole("dialog", { name: "Withdraw" })).toBeNull();
  });
  test("an inbound withdrawal with two funded vaults clears the flow and leaves the tappable list", async () => {
    cached();
    render(<Route initialFlow="save-withdraw" snapshot={held} />);
    await waitFor(() => expect(routeCalls).toEqual(["clear:replace", "push:save-withdraw", "clear:replace"]));
    expect(page().queryByRole("dialog")).toBeNull();
    expect(page().getByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" })).toBeTruthy();
    expect(page().getByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" })).toBeTruthy();
  });
  test("an inbound first deposit without cash clears the flow rather than opening an unusable amount", async () => {
    cached();
    render(<Route initialFlow="save-deposit" snapshot={buildBalancesSnapshotFixture()} />);
    await waitFor(() => expect(routeCalls).toEqual(["clear:replace", "push:save-deposit", "clear:replace"]));
    expect(page().queryByRole("dialog", { name: "Deposit" })).toBeNull();
    expect(page().getByRole("button", { name: "Start saving" })).toBeTruthy();
  });
  test("an inbound withdrawal without a funded vault clears the flow", async () => {
    cached();
    render(<Route initialFlow="save-withdraw" snapshot={empty} />);
    await waitFor(() => expect(page().queryByRole("dialog", { name: "Withdraw" })).toBeNull());
    expect(page().queryByRole("region", { name: "Your savings" })).toBeNull();
    await waitFor(() => expect(routeCalls).toEqual(["clear:replace", "push:save-withdraw", "clear:replace"]));
  });
  test("withdraw targets use configured fallback only for held configured vaults", () => {
    const missing = { ...metadata, candidates: [metadata.candidates[1]!] };
    const [target] = savingsWithdrawTargets(single, missing);
    expect(target?.candidate.vaultAddress).toBe(GAUNTLET);
    expect(target?.candidate.listed).toBe(false);
    expect(target?.candidate.source.provider).toBe("Base JSON-RPC");
    expect(savingsWithdrawTargets(single, metadata)[0]?.candidate).toBe(metadata.candidates[0]);
    expect(savingsWithdrawTargets(held, null)).toHaveLength(2);
    const unconfigured = { ...single, holdings: single.holdings.map((holding) =>
      holding.kind === "vault-share" && holding.contractAddress?.toLowerCase() === GAUNTLET.toLowerCase()
        ? { ...holding, contractAddress: "0x9999999999999999999999999999999999999999" as const }
        : holding
    ) };
    expect(savingsWithdrawTargets(unconfigured, null)).toEqual([]);
    expect(savingsWithdrawTargets(null, metadata)).toEqual([]);
  });
  test("a routed withdrawal opens the configured held vault during a rate failure", async () => {
    render(<Route initialFlow="save-withdraw" snapshot={single} fetchVaults={async () => { throw new Error("Rates unavailable"); }} />);
    const dialog = await page().findByRole("dialog", { name: "Withdraw" });
    expect(await within(dialog).findByText("$800.00 available")).toBeTruthy();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(preparedInputs).toEqual([{ kind: "withdraw", vaultAddress: GAUNTLET, amountBaseUnits: "1000000" }]));
    expect(routeCalls).toEqual(["clear:replace", "push:save-withdraw"]);
  });
  test("a routed withdrawal opens a configured held vault missing from metadata", async () => {
    cached({ ...metadata, candidates: [metadata.candidates[1]!] });
    render(<Route initialFlow="save-withdraw" snapshot={single} />);
    expect(await within(await page().findByRole("dialog", { name: "Withdraw" })).findByText("$800.00 available")).toBeTruthy();
  });
  test("two held vaults clear the routed withdrawal during a rate failure and leave the list", async () => {
    render(<Route initialFlow="save-withdraw" snapshot={held} fetchVaults={async () => { throw new Error("Rates unavailable"); }} />);
    await waitFor(() => expect(routeCalls.at(-1)).toBe("clear:replace"));
    expect(page().queryByRole("dialog")).toBeNull();
    expect(page().getByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" })).toBeTruthy();
    expect(page().getByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" })).toBeTruthy();
  });
  test("balance failure clears a routed withdrawal", async () => {
    render(<Route initialFlow="save-withdraw" snapshot={single} status="failed" />);
    await waitFor(() => expect(routeCalls.at(-1)).toBe("clear:replace"));
    expect(page().queryByRole("dialog", { name: "Withdraw" })).toBeNull();
  });
  test("rate failure clears a routed deposit", async () => {
    render(<Route initialFlow="save-deposit" snapshot={single} fetchVaults={async () => { throw new Error("Rates unavailable"); }} />);
    await waitFor(() => expect(routeCalls.at(-1)).toBe("clear:replace"));
    expect(page().queryByRole("dialog", { name: "Deposit" })).toBeNull();
  });
  test("a cached metadata refetch failure clears a routed deposit before opening its amount step", async () => {
    getHomeQueryClient().setQueryData(publicQueryKey("savings-vaults"), metadata, { updatedAt: NOW - 61_000 });
    const fetchVaults = async () => { throw new Error("Rates unavailable"); };
    const view = render(<Route initialFlow="save-deposit" snapshot={held} view="cash" fetchVaults={fetchVaults} />);
    await waitFor(() => expect(getHomeQueryClient().getQueryState(publicQueryKey("savings-vaults"))?.status).toBe("error"));
    expect(getHomeQueryClient().getQueryData<MorphoVaultsResult>(publicQueryKey("savings-vaults"))).toEqual(metadata);
    routeCalls.length = 0;
    view.rerender(<Route initialFlow="save-deposit" snapshot={held} fetchVaults={fetchVaults} />);
    await waitFor(() => expect(routeCalls).toEqual(["clear:replace"]));
    expect(page().queryByRole("dialog", { name: "Deposit" })).toBeNull();
    expect(page().queryByRole("textbox", { name: "Amount" })).toBeNull();
  });
  test("an unconfigured held vault clears the routed withdrawal", async () => {
    const unconfigured = { ...single, holdings: single.holdings.map((holding) =>
      holding.kind === "vault-share" && holding.contractAddress?.toLowerCase() === GAUNTLET.toLowerCase()
        ? { ...holding, contractAddress: "0x9999999999999999999999999999999999999999" as const }
        : holding
    ) };
    cached();
    render(<Route initialFlow="save-withdraw" snapshot={unconfigured} />);
    await waitFor(() => expect(routeCalls.at(-1)).toBe("clear:replace"));
    expect(page().queryByRole("dialog", { name: "Withdraw" })).toBeNull();
  });
  test("returning from savings restores focus to the US dollar row", async () => {
    cached();
    function Journey() {
      const [view, setView] = useState<"cash" | "savings">("cash");
      return <><button onClick={() => setView("cash")}>Back</button><Surface view={view} onOpenSavings={() => setView("savings")} /></>;
    }
    render(<Journey />);
    const savings = within(await page().findByRole("region", { name: "Savings" })).getByRole("button", { name: /^US dollar/ });
    fireEvent.click(savings);
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await waitFor(() => expect(document.activeElement).toBe(within(page().getByRole("region", { name: "Savings" })).getByRole("button", { name: /^US dollar/ })));
  });
  test("unreadable balances never render as zero", async () => {
    cached();
    const unknown = buildBalancesSnapshotFixture({ registry: { ...cash, "morpho-steakhouse-usdc": { balance: unavailableBalance, underlyingBalance: unavailableBalance, value: { status: "unavailable" } } } });
    render(<Surface snapshot={unknown} />);
    const hero = page().getByLabelText("Savings balance");
    expect(hero.textContent).not.toContain("$0.00");
    expect(within(hero).getByText("Unavailable")).toBeTruthy();
  });
  test("first use chooses ranked vaults without dispatching until deposit review", async () => {
    cached({ ...metadata, candidates: [metadata.candidates[1]!, metadata.candidates[0]!] });
    let executions = 0;
    render(<Surface snapshot={empty} onExecute={async () => { executions++; throw new Error("Unexpected dispatch"); }} />);
    expect(page().getByRole("heading", { name: "Earn on your savings", level: 2 })).toBeTruthy();
    expect(page().queryByLabelText("Savings balance")).toBeNull();
    expect(page().getByText("Up to 4.10% APY")).toBeTruthy();
    expect(page().queryByRole("region", { name: "More ways to save" })).toBeNull();
    expect(page().queryByRole("button", { name: /Gauntlet USDC Prime/ })).toBeNull();
    page().getByRole("button", { name: "Start saving" }).focus();
    fireEvent.click(page().getByRole("button", { name: "Start saving" }));
    const options = await page().findByRole("dialog", { name: "Choose where to save" });
    expect(within(options).getAllByRole("button", { description: /Deposit to/ }).map((row) => row.textContent)).toEqual([
      "Gauntlet USDC Prime4.10% APYDeposit to Gauntlet USDC Prime", "Steakhouse USDC3.85% APYDeposit to Steakhouse USDC",
    ]);
    expect(within(options).getByRole("heading", { name: "Choose where to save" })).toBeTruthy();
    expect(preparedInputs).toEqual([]);
    expect(executions).toBe(0);
    fireEvent.click(within(options).getByRole("button", { name: /Steakhouse USDC/, description: "Deposit to Steakhouse USDC" }));
    const dialog = await page().findByRole("dialog", { name: "Deposit" });
    expect(await within(dialog).findByText("Steakhouse USDC · 3.85% APY")).toBeTruthy();
    expect(preparedInputs).toEqual([]);
    expect(executions).toBe(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Back" }));
    const returned = await page().findByRole("dialog", { name: "Choose where to save" });
    fireEvent.click(within(returned).getByRole("button", { name: /Gauntlet USDC Prime/, description: "Deposit to Gauntlet USDC Prime" }));
    const amountDialog = await page().findByRole("dialog", { name: "Deposit" });
    expect((await within(amountDialog).findByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("");
    fireEvent.click(within(amountDialog).getByRole("button", { name: "Close deposit dialog" }));
    await waitFor(() => expect(Boolean(page().queryByRole("dialog"))).toBe(false));
    await waitFor(() => expect(document.activeElement === page().getByRole("button", { name: "Start saving" })).toBe(true));
    expect(preparedInputs).toEqual([]);
    expect(executions).toBe(0);
  }, 20_000);
  test("picker keeps unavailable-rate candidates visible but not actionable, and resets after funding", async () => {
    cached({ ...metadata, candidates: [metadata.candidates[0]!, { ...metadata.candidates[1]!, netApy: null }] });
    const view = render(<Surface snapshot={empty} />);
    fireEvent.click(page().getByRole("button", { name: "Start saving" }));
    const options = await page().findByRole("dialog", { name: "Choose where to save" });
    expect(within(options).getByText("Rate unavailable")).toBeTruthy();
    expect(within(options).queryByRole("button", { name: /Steakhouse USDC/ })).toBeNull();
    view.rerender(<Surface snapshot={single} />);
    await waitFor(() => expect(Boolean(page().queryByRole("dialog"))).toBe(false));
    expect(page().getByRole("region", { name: "More ways to save" })).toBeTruthy();
    view.rerender(<Surface snapshot={empty} />);
    expect(page().getByRole("button", { name: "Start saving" })).toBeTruthy();
    expect(page().queryByRole("dialog")).toBeNull();
  });
  test("a funded balances refresh does not interrupt the selected vault's amount step", async () => {
    cached();
    const view = render(<Surface snapshot={empty} />);
    fireEvent.click(page().getByRole("button", { name: "Start saving" }));
    const picker = await page().findByRole("dialog", { name: "Choose where to save" });
    fireEvent.click(within(picker).getByRole("button", { name: /Gauntlet USDC Prime/, description: "Deposit to Gauntlet USDC Prime" }));
    const amount = await page().findByRole("dialog", { name: "Deposit" });
    fireEvent.change(await within(amount).findByRole("textbox", { name: "Amount" }), { target: { value: "2" } });
    view.rerender(<Surface snapshot={single} />);
    expect(within(page().getByRole("dialog", { name: "Deposit" })).getByRole("textbox", { name: "Amount" })).toHaveProperty("value", "2");
    expect(page().queryByRole("dialog", { name: "Choose where to save" })).toBeNull();
  });
  test("first use labels a stale rate by its last update rather than as current", async () => {
    cached({ ...metadata, stale: true });
    render(<Surface snapshot={empty} />);
    expect(page().getByText("Up to 4.10% APY at last update")).toBeTruthy();
    expect(page().queryByText(/^Currently up to/)).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Start saving" }));
    const options = await page().findByRole("dialog", { name: "Choose where to save" });
    expect(within(options).getByText("4.10% APY at last update")).toBeTruthy();
    fireEvent.click(within(options).getByRole("button", { name: /Gauntlet USDC Prime/, description: "Deposit to Gauntlet USDC Prime" }));
    const dialog = await page().findByRole("dialog", { name: "Deposit" });
    expect(await within(dialog).findByText("Gauntlet USDC Prime · 4.10% APY at last update")).toBeTruthy();
  });
  test("an open deposit destination follows refreshed vault metadata instead of the rate it opened with", async () => {
    cached();
    render(<Surface snapshot={empty} />);
    fireEvent.click(page().getByRole("button", { name: "Start saving" }));
    fireEvent.click(within(await page().findByRole("dialog", { name: "Choose where to save" })).getByRole("button", { name: /Gauntlet USDC Prime/, description: "Deposit to Gauntlet USDC Prime" }));
    const dialog = await page().findByRole("dialog", { name: "Deposit" });
    expect(await within(dialog).findByText("Gauntlet USDC Prime · 4.10% APY")).toBeTruthy();
    act(() => cached({ ...metadata, candidates: [vault(GAUNTLET, "Gauntlet USDC Prime", 0.037), metadata.candidates[1]!] }));
    await waitFor(() => expect(within(dialog).getByText("Gauntlet USDC Prime · 3.70% APY")).toBeTruthy());
    act(() => cached({ ...metadata, candidates: [metadata.candidates[1]!] }));
    await waitFor(() => expect(within(dialog).getByText("Gauntlet USDC Prime")).toBeTruthy());
  });
  test("no cash recovers through Add money and makes vault rows browse-only", async () => {
    cached();
    let added = 0;
    render(<Surface snapshot={buildBalancesSnapshotFixture()} onAddMoney={() => { added++; }} />);
    fireEvent.click(page().getByRole("button", { name: "Start saving" }));
    const dialog = await page().findByRole("dialog", { name: "Choose where to save" });
    expect(within(dialog).getByText("Add cash to start saving.")).toBeTruthy();
    expect(within(dialog).getByText("4.10% APY")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { description: /Deposit to/ })).toBeNull();
    expect(within(dialog).queryByRole("textbox", { name: "Amount" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Add money" }));
    expect(added).toBe(1);
    await waitFor(() => expect(Boolean(page().queryByRole("dialog"))).toBe(false));
  });
  test("a cash balance that degrades while the picker is open reads as unresolved, not as no cash", async () => {
    cached();
    let retries = 0;
    const surface = (snapshot: BalancesSnapshot) => <Surface snapshot={snapshot} onRetryBalances={() => { retries += 1; }} />;
    const view = render(surface(empty));
    fireEvent.click(page().getByRole("button", { name: "Start saving" }));
    const opened = await page().findByRole("dialog", { name: "Choose where to save" });
    expect(within(opened).queryByText("Add cash to start saving.")).toBeNull();
    view.rerender(surface(buildBalancesSnapshotFixture({ registry: { usdc: { balance: unavailableBalance, value: { status: "unavailable" } } } })));
    const dialog = await page().findByRole("dialog", { name: "Choose where to save" });
    expect(within(dialog).getByText(/Couldn't check your cash balance/)).toBeTruthy();
    expect(within(dialog).queryByText("Add cash to start saving.")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Add money" })).toBeNull();
    expect(within(dialog).queryByRole("button", { description: /Deposit to/ })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    expect(retries).toBe(1);
    expect(preparedInputs).toEqual([]);
  });
  test("window focus refreshes pending deposits without closing the picker", async () => {
    cached();
    focusManager.setFocused(false);
    let reads = 0;
    render(<HomeQueryClientProvider><Surface snapshot={empty} fetchAccountResource={async (path) => {
      if (path !== "/api/actions") return { version: 1, usdcReserveBaseUnits: "100000" };
      reads += 1;
      return reads === 1
        ? { actions: [] }
        : { actions: [pendingActionRow({ ...preparedDeposit(), id: "other-tab-deposit" }, "unknown")] };
    }} /></HomeQueryClientProvider>);
    fireEvent.click(await page().findByRole("button", { name: "Start saving" }));
    await page().findByRole("dialog", { name: "Choose where to save" });
    await waitFor(() => expect(reads).toBe(1));
    act(() => focusManager.setFocused(true));
    await waitFor(() => expect(reads).toBe(2));
    expect(page().getByRole("dialog", { name: "Choose where to save" })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
    expect(within(page().getByLabelText("Savings balance")).getByText("$1.00")).toBeTruthy();
    expect(preparedInputs).toEqual([]);
  });
  test("another tab's deposit does not close the amount step or block Continue during refetch", async () => {
    cached();
    const fresh = Promise.withResolvers<{ actions: unknown[] }>();
    let reads = 0;
    const executed: string[] = [];
    render(<HomeQueryClientProvider><Surface snapshot={empty}
      onPrepare={async () => ({ ...preparedDeposit(), id: "new-deposit" })}
      onExecute={async (action) => { executed.push(action.id); return { id: action.id, status: "submitted" }; }}
      fetchAccountResource={async (path) => {
        if (path !== "/api/actions") return { version: 1, usdcReserveBaseUnits: "100000" };
        reads += 1;
        return reads === 1 ? { actions: [] } : fresh.promise;
      }} /></HomeQueryClientProvider>);
    fireEvent.click(await page().findByRole("button", { name: "Start saving" }));
    fireEvent.click(within(await page().findByRole("dialog", { name: "Choose where to save" })).getByRole("button", { description: "Deposit to Gauntlet USDC Prime" }));
    const input = inputElement(await page().findByRole("textbox", { name: "Amount" }));
    fireEvent.change(input, { target: { value: "1" } });
    await act(async () => { void getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey(dataOwnerKey(session), "actions") }); });
    await waitFor(() => expect(reads).toBe(2));
    expect(buttonElement(page().getByRole("button", { name: "Continue" })).disabled).toBe(false);
    await act(async () => fresh.resolve({ actions: [pendingActionRow({ ...preparedDeposit(), id: "other-tab-deposit" }, "pending")] }));
    expect(page().getByRole("textbox", { name: "Amount" })).toBe(input);
    expect(input.value).toBe("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit $1.00" }));
    await waitFor(() => expect(executed).toEqual(["new-deposit"]));
  });
  test("a failed refresh over an empty cached history blocks first use immediately", async () => {
    cached();
    focusManager.setFocused(false);
    let reads = 0;
    render(<HomeQueryClientProvider><Surface snapshot={empty} fetchAccountResource={async (path) => {
      if (path !== "/api/actions") return { version: 1, usdcReserveBaseUnits: "100000" };
      reads += 1;
      if (reads === 1) return { actions: [] };
      throw new Error("Actions unavailable");
    }} /></HomeQueryClientProvider>);
    await page().findByRole("button", { name: "Start saving" });
    act(() => focusManager.setFocused(true));
    await page().findByText("Couldn't check your deposits");
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
    expect(preparedInputs).toEqual([]);
  });
  test("a failed refresh keeps a cached pending deposit visible rather than the unresolved first use", async () => {
    cached();
    focusManager.setFocused(false);
    let reads = 0;
    render(<HomeQueryClientProvider><Surface snapshot={empty} fetchAccountResource={async (path) => {
      if (path !== "/api/actions") return { version: 1, usdcReserveBaseUnits: "100000" };
      reads += 1;
      if (reads === 1) return { actions: [pendingActionRow({ ...preparedDeposit(), id: "prior-deposit" }, "unknown")] };
      throw new Error("Actions unavailable");
    }} /></HomeQueryClientProvider>);
    await waitFor(() => expect(within(page().getByLabelText("Savings balance")).getByText("$1.00")).toBeTruthy());
    act(() => focusManager.setFocused(true));
    await waitFor(() => expect(reads).toBeGreaterThan(1));
    expect(page().queryByText("Couldn't check your deposits")).toBeNull();
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
    expect(within(page().getByRole("region", { name: "Your savings" })).getByText("Pending")).toBeTruthy();
  });
  test("an inbound deposit opens beside another pending deposit", async () => {
    cached();
    render(<Route initialFlow="save-deposit" snapshot={empty} fetchAccountResource={async () => ({ actions: [pendingActionRow({ ...preparedDeposit(), id: "other-tab-deposit" }, "pending")] })} />);
    expect(await page().findByRole("textbox", { name: "Amount" })).toBeTruthy();
    expect(routeCalls).toEqual(["clear:replace", "push:save-deposit"]);
    expect(within(page().getByLabelText("Savings balance")).getByText("$1.00")).toBeTruthy();
    expect(preparedInputs).toEqual([]);
  });
  test("the first-use picker remains actionable while history is refetching", async () => {
    cached();
    const fresh = Promise.withResolvers<{ actions: unknown[] }>();
    let reads = 0;
    render(<HomeQueryClientProvider><Surface snapshot={empty} fetchAccountResource={async (path) => {
      if (path !== "/api/actions") return { version: 1, usdcReserveBaseUnits: "100000" };
      reads += 1;
      return reads === 1 ? { actions: [] } : fresh.promise;
    }} /></HomeQueryClientProvider>);
    fireEvent.click(await page().findByRole("button", { name: "Start saving" }));
    const picker = await page().findByRole("dialog", { name: "Choose where to save" });
    await act(async () => { void getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey(dataOwnerKey(session), "actions") }); });
    await waitFor(() => expect(reads).toBe(2));
    expect(within(picker).getAllByRole("button", { description: /Deposit to/ })).toHaveLength(2);
    await act(async () => fresh.resolve({ actions: [pendingActionRow({ ...preparedDeposit(), id: "other-tab-deposit" }, "pending")] }));
    expect(page().getByRole("dialog", { name: "Choose where to save" })).toBe(picker);
    await waitFor(() => expect(within(page().getByLabelText("Savings balance")).getByText("$1.00")).toBeTruthy());
    expect(preparedInputs).toEqual([]);
  });
  test("an in-flight deposit with a legacy review remains visible", async () => {
    cached();
    const legacy = pendingActionRow({
      ...preparedDeposit(),
      id: "legacy-deposit",
      metadata: {
        ...preparedDeposit().metadata,
        exchangeConstraint: "deposit-preview-no-minimum-shares",
        minimumSharesBaseUnits: undefined,
      } as PreparedMoneyAction["metadata"],
    }, "pending");
    render(<HomeQueryClientProvider><Surface snapshot={empty} fetchAccountResource={async (path) => {
      if (path !== "/api/actions") return { version: 1, usdcReserveBaseUnits: "100000" };
      return { actions: [legacy] };
    }} /></HomeQueryClientProvider>);
    await waitFor(() => expect(within(page().getByLabelText("Savings balance")).getByText("$1.00")).toBeTruthy());
    const savings = page().getByRole("region", { name: "Your savings" });
    expect(within(savings).getByText("Gauntlet USDC Prime")).toBeTruthy();
    expect(within(savings).getByText("Pending")).toBeTruthy();
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
    expect(preparedInputs).toEqual([]);
  });
  test("a history refetch does not disable confirming a deposit", async () => {
    cached();
    const slow = Promise.withResolvers<{ actions: unknown[] }>();
    let reads = 0;
    let prepares = 0;
    let executions = 0;
    render(<Route initialFlow="save-deposit" snapshot={empty}
      onPrepare={async () => { prepares += 1; return preparedDeposit(); }}
      onExecute={async (action) => { executions += 1; return { id: action.id, status: "submitted" }; }}
      fetchAccountResource={async (path) => {
        if (path !== "/api/actions") return { version: 1, usdcReserveBaseUnits: "100000" };
        reads += 1;
        return reads === 1 ? { actions: [] } : slow.promise;
      }} />);
    const amount = await page().findByRole("textbox", { name: "Amount" });
    fireEvent.change(amount, { target: { value: "1" } });
    await waitFor(() => expect(reads).toBe(1));
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(prepares).toBe(1));
    const submit = page().getByRole("button", { name: "Deposit $1.00" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    await act(async () => { void getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey(dataOwnerKey(session), "actions") }); });
    await waitFor(() => expect(reads).toBe(2));
    expect((page().getByRole("button", { name: "Deposit $1.00" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(page().getByRole("button", { name: "Deposit $1.00" }));
    await waitFor(() => expect(executions).toBe(1));
    await act(async () => slow.resolve({ actions: [] }));
    expect(await page().findByRole("button", { name: "Done" })).toBeTruthy();
  });
  test("a history refetch does not disable preparing a deposit", async () => {
    cached();
    const slow = Promise.withResolvers<{ actions: unknown[] }>();
    let reads = 0;
    render(<Route initialFlow="save-deposit" snapshot={empty} fetchAccountResource={async (path) => {
      if (path !== "/api/actions") return { version: 1, usdcReserveBaseUnits: "100000" };
      reads += 1;
      return reads === 1 ? { actions: [] } : slow.promise;
    }} />);
    const amount = await page().findByRole("textbox", { name: "Amount" });
    fireEvent.change(amount, { target: { value: "1" } });
    await act(async () => { void getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey(dataOwnerKey(session), "actions") }); });
    await waitFor(() => expect(reads).toBe(2));
    expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(preparedInputs).toEqual([{ kind: "deposit", vaultAddress: GAUNTLET, amountBaseUnits: "1000000" }]));
    await act(async () => slow.resolve({ actions: [pendingActionRow({ ...preparedDeposit(), id: "other-tab-deposit" }, "pending")] }));
    expect(page().getByRole("dialog", { name: "Deposit" })).toBeTruthy();
  });
  test("an inbound deposit stays open when refreshed history shows another tab's deposit", async () => {
    cached();
    focusManager.setFocused(false);
    let reads = 0;
    render(<HomeQueryClientProvider><Route initialFlow="save-deposit" snapshot={empty} fetchAccountResource={async (path) => {
      if (path !== "/api/actions") return { version: 1, usdcReserveBaseUnits: "100000" };
      reads += 1;
      return reads === 1
        ? { actions: [] }
        : { actions: [pendingActionRow({ ...preparedDeposit(), id: "other-tab-deposit" }, "pending")] };
    }} /></HomeQueryClientProvider>);
    expect(await page().findByRole("textbox", { name: "Amount" })).toBeTruthy();
    await waitFor(() => expect(reads).toBe(1));
    act(() => focusManager.setFocused(true));
    await waitFor(() => expect(reads).toBe(2));
    expect(page().getByRole("textbox", { name: "Amount" })).toBeTruthy();
    expect(routeCalls).toEqual(["clear:replace", "push:save-deposit"]);
    expect(preparedInputs).toEqual([]);
  });
  test("an inbound deposit opens before the first action history read resolves", async () => {
    cached();
    const history = Promise.withResolvers<{ actions: unknown[] }>();
    render(<Route initialFlow="save-deposit" snapshot={empty} fetchAccountResource={async () => history.promise} />);
    await page().findByText("Loading savings");
    expect(await page().findByRole("dialog", { name: "Deposit" })).toBeTruthy();
    expect(routeCalls).toEqual(["clear:replace", "push:save-deposit"]);
    await act(async () => history.resolve({ actions: [] }));
    const dialog = await page().findByRole("dialog", { name: "Deposit" });
    expect(await within(dialog).findByRole("textbox", { name: "Amount" })).toBeTruthy();
    expect(preparedInputs).toEqual([]);
  });
  test("a routed deposit does not wait for a newer action history read", async () => {
    const actionsKey = ownerQueryKey(dataOwnerKey(session), "actions");
    getHomeQueryClient().setQueryData(actionsKey, { operations: [], unparsedSavingsDeposits: [], truncated: false, incomplete: false }, { updatedAt: NOW - 61_000 });
    cached();
    onlineManager.setOnline(false);
    render(<Route initialFlow="save-deposit" snapshot={empty} fetchAccountResource={async (path) => {
      if (path !== "/api/actions") return { version: 1, usdcReserveBaseUnits: "100000" };
      return { actions: [] };
    }} />);
    const amount = await page().findByRole("textbox", { name: "Amount" });
    fireEvent.change(amount, { target: { value: "1" } });
    const submit = () => page().getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(submit().disabled).toBe(false);
    act(() => onlineManager.setOnline(true));
    await act(async () => { await getHomeQueryClient().refetchQueries({ queryKey: actionsKey }); });
    await waitFor(() => expect(submit().disabled).toBe(false));
    expect(preparedInputs).toEqual([]);
  });
  test("an offline action history holds the intro rather than offering Start saving", async () => {
    cached();
    onlineManager.setOnline(false);
    render(<HomeQueryClientProvider><Surface snapshot={empty} fetchAccountResource={async () => ({ actions: [] })} /></HomeQueryClientProvider>);
    await page().findByText("Loading savings");
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
    act(() => onlineManager.setOnline(true));
    await page().findByRole("button", { name: "Start saving" });
  });
  test("a rejected deposit result remains open when another deposit appears", async () => {
    cached();
    let serverPending = false;
    await submitFirstDeposit("rejected", async () => ({ actions: serverPending ? [pendingActionRow({ ...preparedDeposit(), id: "other-tab-deposit" }, "pending")] : [] }), () => { serverPending = true; });
    await page().findByText("The wallet request was rejected.");
    await act(async () => { await getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey(dataOwnerKey(session), "actions") }); });
    expect(page().getByText("The wallet request was rejected.")).toBeTruthy();
    expect(page().getByRole("dialog")).toBeTruthy();
    await waitFor(() => expect(within(page().getByLabelText("Savings balance")).getByText("$1.00")).toBeTruthy());
    expect(preparedInputs).toEqual([]);
  });
  test("a server-confirmed row for the submitted first deposit retires the pending marker", async () => {
    cached();
    let serverRows: unknown[] = [];
    const view = await submitFirstDeposit("submitted", async () => ({ actions: serverRows }), () => {
      serverRows = [pendingActionRow({ ...preparedDeposit(), id: "cash-deposit-1" }, "confirmed", "2026-09-10T11:55:00.000Z")];
    });
    fireEvent.click(await page().findByRole("button", { name: "Done" }));
    await waitFor(() => expect(Boolean(page().queryByRole("dialog"))).toBe(false));
    expect(within(page().getByLabelText("Savings balance")).getByText("$1.00")).toBeTruthy();
    view.rerender(<Surface snapshot={{ ...empty, block: { ...empty.block, timestamp: String(Date.parse("2026-09-10T12:00:00.000Z") / 1000) } }} onPrepare={async () => preparedDeposit()} onExecute={async (action) => ({ id: action.id, status: "submitted" })} fetchAccountResource={async () => ({ actions: serverRows })} />);
    await act(async () => { await getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey(dataOwnerKey(session), "actions") }); });
    await waitFor(() => expect(page().queryByRole("button", { name: "Start saving" })).toBeTruthy());
    expect(page().queryByText("Pending")).toBeNull();
  });
  test("a failed history refresh leaves an open deposit flow actionable", async () => {
    cached();
    focusManager.setFocused(false);
    let fail = false;
    render(<HomeQueryClientProvider><Surface snapshot={empty} fetchAccountResource={async (path) => {
      if (path !== "/api/actions") return { version: 1, usdcReserveBaseUnits: "100000" };
      if (fail) throw new Error("Actions unavailable");
      return { actions: [] };
    }} /></HomeQueryClientProvider>);
    fireEvent.click(await page().findByRole("button", { name: "Start saving" }));
    const picker = await page().findByRole("dialog", { name: "Choose where to save" });
    fireEvent.click(within(picker).getByRole("button", { description: "Deposit to Gauntlet USDC Prime" }));
    await page().findByRole("dialog", { name: "Deposit" });
    fail = true;
    act(() => focusManager.setFocused(true));
    expect(page().getByRole("dialog", { name: "Deposit" })).toBeTruthy();
    await page().findByText("Couldn't check your deposits");
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
    fireEvent.change(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    expect(buttonElement(page().getByRole("button", { name: "Continue" })).disabled).toBe(false);
    expect(preparedInputs).toEqual([]);
  });
  test("only an empty savings entry refreshes while idle and an in-flight deposit polls to its outcome", () => {
    expect(savingsEntryRefreshInterval({ funded: true, inFlightDeposits: 0 })).toBe(false);
    expect(savingsEntryRefreshInterval({ funded: true, inFlightDeposits: 1 })).toBe(false);
    expect(savingsEntryRefreshInterval({ funded: undefined, inFlightDeposits: 0 })).toBe(false);
    expect(savingsEntryRefreshInterval({ funded: undefined, inFlightDeposits: 1 })).toBe(5_000);
    expect(savingsEntryRefreshInterval({ funded: false, inFlightDeposits: 0 })).toBe(15_000);
    expect(savingsEntryRefreshInterval({ funded: false, inFlightDeposits: 1 })).toBe(5_000);
  });
  test("Browser Back closes the first-use savings picker and restores its opener", async () => {
    cached();
    render(<Route initialFlow={null} snapshot={empty} />);
    const opener = page().getByRole("button", { name: "Start saving" });
    opener.focus();
    fireEvent.click(opener);
    await page().findByRole("dialog", { name: "Choose where to save" });
    expect(routeCalls).toEqual(["push:save-deposit"]);
    fireEvent.click(page().getByRole("button", { name: "Browser Back", hidden: true }));
    await waitFor(() => expect(Boolean(page().queryByRole("dialog"))).toBe(false));
    expect(document.activeElement === opener).toBe(true);
    expect(preparedInputs).toEqual([]);
  });
  test("zero cash Add money replaces the savings flow without clearing it", async () => {
    cached();
    render(<Route initialFlow={null} snapshot={buildBalancesSnapshotFixture()} addMoneyRoute />);
    fireEvent.click(page().getByRole("button", { name: "Start saving" }));
    const picker = await page().findByRole("dialog", { name: "Choose where to save" });
    expect(routeCalls).toEqual(["push:save-deposit"]);
    fireEvent.click(within(picker).getByRole("button", { name: "Add money" }));
    expect(routeCalls).toEqual(["push:save-deposit", "replace:add-money"]);
    await waitFor(() => expect(Boolean(page().queryByRole("dialog"))).toBe(false));
    expect(page().getByRole("button", { name: "Start saving" })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Browser Back", hidden: true }));
    expect(page().queryByRole("dialog", { name: "Choose where to save" })).toBeNull();
    expect(preparedInputs).toEqual([]);
  });
  test("no usable opportunity offers retry rather than a dead action", async () => {
    cached({ ...metadata, candidates: metadata.candidates.map((candidate) => ({ ...candidate, netApy: null })) });
    render(<Surface snapshot={empty} />);
    expect(page().getByText("Rates are shown before you save")).toBeTruthy();
    expect(page().getByText("Savings options aren't available right now.")).toBeTruthy();
    expect(page().getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
    expect(page().queryByRole("region", { name: "More ways to save" })).toBeNull();
  });
  test("empty savings without a smart account offers no savings entry", async () => {
    cached();
    render(<Surface snapshot={empty} owner={{ ...session, smartAccount: null }} />);
    expect(page().getByText("Savings isn't available for this account.")).toBeTruthy();
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
    expect(page().queryByRole("region", { name: "More ways to save" })).toBeNull();
  });
  test("loading, failed, stale, partial and unknown balances do not show first use or a global Deposit", async () => {
    cached();
    const partial = { ...empty, coverage: { ...empty.coverage, registry: "partial" as const } };
    const cases = [
      { snapshot: null, status: "loading" as const }, { snapshot: null, status: "failed" as const },
      { snapshot: empty, stale: true }, { snapshot: { ...empty, stale: true as const } },
      { snapshot: partial }, { snapshot: buildBalancesSnapshotFixture({ registry: { ...cash, "morpho-steakhouse-usdc": { balance: unavailableBalance, underlyingBalance: unavailableBalance, value: { status: "unavailable" } } } }) },
    ];
    for (const props of cases) {
      const view = render(<Surface {...props} />);
      expect(page().queryByRole("heading", { name: "Earn on your savings" })).toBeNull();
      expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
      expect(page().queryByRole("button", { name: "Deposit" })).toBeNull();
      view.unmount();
    }
  });
  test("returning empty user and switching funded accounts derive first use from current data", async () => {
    cached();
    const other = { ...session, user: { subject: "other-saver" } };
    const view = render(<Surface snapshot={held} />);
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
    view.rerender(<Surface snapshot={empty} owner={other} />);
    expect(page().getByRole("button", { name: "Start saving" })).toBeTruthy();
    view.rerender(<Surface snapshot={held} owner={session} />);
    expect(page().getByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
    view.unmount();
    render(<Surface snapshot={empty} />);
    expect(page().getByRole("button", { name: "Start saving" })).toBeTruthy();
  });
  test("reload rehydrates a pending first deposit from the owner-scoped actions response", async () => {
    cached();
    const pending = { actions: [pendingActionRow({ ...preparedDeposit(), id: "prior-deposit" }, "unknown"),
      pendingActionRow({ ...preparedDeposit(), id: "second-deposit", amounts: preparedDeposit().amounts.map((amount) =>
        amount.symbol === "USDC" ? { ...amount, amountBaseUnits: "2000000" } : amount) })] };
    render(<Surface snapshot={empty} fetchAccountResource={async () => pending} />);
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
    await waitFor(() => expect(within(page().getByLabelText("Savings balance")).getByText("$3.00")).toBeTruthy());
    const savings = page().getByRole("region", { name: "Your savings" });
    expect(within(savings).getByText("Gauntlet USDC Prime")).toBeTruthy();
    expect(within(savings).getByText("$3.00")).toBeTruthy();
    expect(within(savings).getByText("Pending")).toBeTruthy();
    expect(within(savings).queryByRole("button", { name: /Gauntlet/ })).toBeNull();
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
    expect(preparedInputs).toEqual([]);
  });
  test("a malformed action amount blocks first use instead of being treated as absent", async () => {
    cached();
    const malformed = pendingActionRow(preparedDeposit(), "unknown");
    malformed.summary.amounts = [{ assetId: "usdc", amountBaseUnits: "1000000", direction: "spend" }] as never;
    render(<Surface snapshot={empty} fetchAccountResource={async () => ({ actions: [malformed] })} />);
    expect(await page().findByText("Couldn't check your deposits")).toBeTruthy();
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
    expect(page().queryByRole("dialog")).toBeNull();
    expect(preparedInputs).toEqual([]);
  });
  test("a malformed deposit that the server settled no longer blocks first use", async () => {
    cached();
    const settled = { ...empty, block: { ...empty.block, timestamp: String(Date.parse("2026-09-10T12:00:00.000Z") / 1000) } };
    const malformed = pendingActionRow(preparedDeposit(), "confirmed", "2026-09-10T11:55:00.000Z");
    malformed.summary.amounts = [{ assetId: "usdc", amountBaseUnits: "1000000", direction: "spend" }] as never;
    render(<Surface snapshot={settled} fetchAccountResource={async () => ({ actions: [malformed] })} />);
    expect(await page().findByRole("button", { name: "Start saving" })).toBeTruthy();
    expect(page().queryByText("Couldn't check your deposits")).toBeNull();
  });
  test("a null amount entry blocks first use instead of crashing the surface", async () => {
    cached();
    const malformed = pendingActionRow(preparedDeposit(), "unknown");
    malformed.summary.amounts = [null] as never;
    render(<Surface snapshot={empty} fetchAccountResource={async () => ({ actions: [malformed] })} />);
    expect(await page().findByText("Couldn't check your deposits")).toBeTruthy();
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
  });
  test("a savings deposit whose amount list is not an array blocks first use", async () => {
    cached();
    const malformed = pendingActionRow(preparedDeposit(), "unknown");
    malformed.summary.amounts = null as never;
    render(<Surface snapshot={empty} fetchAccountResource={async () => ({ actions: [malformed] })} />);
    expect(await page().findByText("Couldn't check your deposits")).toBeTruthy();
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
  });
  test("a settled savings deposit whose amount list is not an array no longer blocks first use", async () => {
    cached();
    const settled = { ...empty, block: { ...empty.block, timestamp: String(Date.parse("2026-09-10T12:00:00.000Z") / 1000) } };
    const malformed = pendingActionRow(preparedDeposit(), "confirmed", "2026-09-10T11:55:00.000Z");
    malformed.summary.amounts = null as never;
    render(<Surface snapshot={settled} fetchAccountResource={async () => ({ actions: [malformed] })} />);
    expect(await page().findByRole("button", { name: "Start saving" })).toBeTruthy();
    expect(page().queryByText("Couldn't check your deposits")).toBeNull();
  });
  test("a numeric amount base unit is treated as undisplayable instead of rounded", async () => {
    cached();
    const malformed = pendingActionRow(preparedDeposit(), "unknown");
    malformed.summary.amounts = preparedDeposit().amounts.map((amount) =>
      amount.symbol === "USDC" ? { ...amount, amountBaseUnits: 9007199254740993 } : amount) as never;
    render(<Surface snapshot={empty} fetchAccountResource={async () => ({ actions: [malformed] })} />);
    expect(await page().findByText("Couldn't check your deposits")).toBeTruthy();
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
    expect(page().queryByText("$9007199254740992")).toBeNull();
  });
  test("a settled malformed deposit with an unknown vault keeps blocking first use", async () => {
    cached();
    const settled = { ...empty, block: { ...empty.block, timestamp: String(Date.parse("2026-09-10T12:00:00.000Z") / 1000) } };
    const malformed = pendingActionRow(preparedDeposit(), "confirmed", "2026-09-10T11:55:00.000Z");
    malformed.summary.amounts = null as never;
    malformed.summary.metadata = { ...preparedDeposit().metadata, vaultAddress: "0x0000000000000000000000000000000000000001" } as never;
    render(<Surface snapshot={settled} fetchAccountResource={async () => ({ actions: [malformed] })} />);
    expect(await page().findByText("Couldn't check your deposits")).toBeTruthy();
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
  });
  test("a USDC amount with the wrong direction or decimals is undisplayable", async () => {
    cached();
    const malformed = pendingActionRow(preparedDeposit(), "unknown");
    malformed.summary.amounts = preparedDeposit().amounts.map((amount) =>
      amount.symbol === "USDC" ? { ...amount, direction: "receive", decimals: 18 } : amount) as never;
    render(<Surface snapshot={empty} fetchAccountResource={async () => ({ actions: [malformed] })} />);
    expect(await page().findByText("Couldn't check your deposits")).toBeTruthy();
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
  });
  test("a vault refresh that empties the picker keeps it with a retry", async () => {
    cached();
    render(<Surface snapshot={empty} />);
    fireEvent.click(page().getByRole("button", { name: "Start saving" }));
    await page().findByRole("dialog", { name: "Choose where to save" });
    act(() => { getHomeQueryClient().setQueryData(publicQueryKey("savings-vaults"), { ...metadata, candidates: [] }); });
    const dialog = await page().findByRole("dialog", { name: "Choose where to save" });
    expect(within(dialog).getByText("Savings options aren't available right now.")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(preparedInputs).toEqual([]);
  });
  test("first-use Back returns to the picker after a funded management tray was opened", async () => {
    cached();
    const view = render(<Surface snapshot={held} />);
    fireEvent.click(await page().findByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" }));
    await page().findByRole("dialog", { name: "Steakhouse USDC" });
    fireEvent.click(page().getByRole("button", { name: "Close Steakhouse USDC details" }));
    await waitFor(() => expect(Boolean(page().queryByRole("dialog"))).toBe(false));
    view.rerender(<Surface snapshot={empty} />);
    fireEvent.click(page().getByRole("button", { name: "Start saving" }));
    fireEvent.click(within(await page().findByRole("dialog", { name: "Choose where to save" })).getByRole("button", { name: /Gauntlet USDC Prime/, description: "Deposit to Gauntlet USDC Prime" }));
    const amount = await page().findByRole("dialog", { name: "Deposit" });
    fireEvent.click(await within(amount).findByRole("button", { name: "Back" }));
    await page().findByRole("dialog", { name: "Choose where to save" });
    expect(preparedInputs).toEqual([]);
  });
  test("a More-ways deposit stays actionable while history is loading", async () => {
    cached();
    const stale = { ...empty, stale: true as const };
    const fresh = Promise.withResolvers<{ actions: unknown[] }>();
    let reads = 0;
    render(<Surface snapshot={stale} fetchAccountResource={async () => {
      reads += 1;
      return reads === 1 ? { actions: [] } : fresh.promise;
    }} />);
    const more = await page().findByRole("region", { name: "More ways to save" });
    fireEvent.click(within(more).getAllByRole("button", { description: /Deposit to/ })[0]!);
    const amount = await page().findByRole("textbox", { name: "Amount" });
    fireEvent.change(amount, { target: { value: "1" } });
    const submit = () => page().getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(submit().disabled).toBe(false);
    fireEvent.click(submit());
    await waitFor(() => expect(preparedInputs).toEqual([{ kind: "deposit", vaultAddress: GAUNTLET, amountBaseUnits: "1000000" }]));
    await act(async () => fresh.resolve({ actions: [] }));
    await waitFor(() => expect(submit().disabled).toBe(false));
  });
  test("a More-ways deposit is actionable before the first history read resolves", async () => {
    cached();
    const stale = { ...empty, stale: true as const };
    const initial = Promise.withResolvers<{ actions: unknown[] }>();
    const fresh = Promise.withResolvers<{ actions: unknown[] }>();
    let reads = 0;
    render(<Surface snapshot={stale} fetchAccountResource={async () => {
      reads += 1;
      return reads === 1 ? initial.promise : fresh.promise;
    }} />);
    const more = await page().findByRole("region", { name: "More ways to save" });
    expect(within(more).getAllByRole("button", { description: /Deposit to/ })).toHaveLength(2);
    await act(async () => initial.resolve({ actions: [] }));
    const row = await within(more).findAllByRole("button", { description: /Deposit to/ });
    fireEvent.click(row[0]!);
    await act(async () => fresh.resolve({ actions: [] }));
    await page().findByRole("textbox", { name: "Amount" });
    expect(preparedInputs).toEqual([]);
  });
  test("an undisplayable savings-deposit row blocks first use instead of offering a flow that closes", async () => {
    cached();
    const emptyAmounts = pendingActionRow({ ...preparedDeposit(), id: "empty-amounts" }, "unknown");
    emptyAmounts.summary.amounts = [];
    const nonNumeric = pendingActionRow({ ...preparedDeposit(), id: "non-numeric" }, "unknown");
    nonNumeric.summary.amounts = preparedDeposit().amounts.map((amount) =>
      amount.symbol === "USDC" ? { ...amount, amountBaseUnits: "not-a-number" } : amount);
    render(<Surface snapshot={empty} fetchAccountResource={async () => ({ actions: [emptyAmounts, nonNumeric] })} />);
    expect(await page().findByText("Couldn't check your deposits")).toBeTruthy();
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
    expect(page().queryByRole("dialog")).toBeNull();
    expect(preparedInputs).toEqual([]);
  });
  test("a displayable pending deposit still renders beside an undisplayable in-flight row", async () => {
    cached();
    const displayable = pendingActionRow({ ...preparedDeposit(), id: "displayable" }, "unknown");
    const undisplayable = pendingActionRow({ ...preparedDeposit(), id: "undisplayable" }, "unknown");
    undisplayable.summary.amounts = [];
    render(<Surface snapshot={empty} fetchAccountResource={async () => ({ actions: [displayable, undisplayable] })} />);
    const hero = await page().findByLabelText("Savings balance");
    expect(within(hero).getByText("$1.00")).toBeTruthy();
    expect(within(hero).getByText("Pending")).toBeTruthy();
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
    expect(page().queryByRole("dialog")).toBeNull();
  });
  test("a confirmed deposit whose receipt is newer than the balance block stays pending after reload", async () => {
    cached();
    const snapshot = { ...empty, block: { ...empty.block, timestamp: String(Date.parse("2026-09-10T12:00:00.000Z") / 1000) } };
    const confirmed = { ...pendingActionRow(preparedDeposit(), "confirmed", "2026-09-10T12:05:00.000Z"), confirmedAt: "2026-09-10T12:01:00.000Z" };
    render(<Surface snapshot={snapshot} fetchAccountResource={async () => ({ actions: [confirmed] })} />);
    const hero = await page().findByLabelText("Savings balance");
    expect(within(hero).getByText("$1.00")).toBeTruthy();
    expect(within(hero).getByText("Pending")).toBeTruthy();
    expect(within(page().getByRole("region", { name: "Your savings" })).getByText("Gauntlet USDC Prime")).toBeTruthy();
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
  });
  test("a confirmed deposit without a receipt block time stays pending even when consent predates the balance block", async () => {
    cached();
    const snapshot = { ...empty, block: { ...empty.block, timestamp: String(Date.parse("2026-09-11T12:00:00.000Z") / 1000) } };
    const confirmed = { ...pendingActionRow(preparedDeposit(), "confirmed"), confirmedAt: "2026-09-10T12:01:00.000Z" };
    render(<Surface snapshot={snapshot} fetchAccountResource={async () => ({ actions: [confirmed] })} />);
    const hero = await page().findByLabelText("Savings balance");
    expect(within(hero).getByText("$1.00")).toBeTruthy();
    expect(within(hero).getByText("Pending")).toBeTruthy();
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
  });
  test("a confirmed deposit whose receipt predates the balance block does not hide first use", async () => {
    cached();
    const snapshot = { ...empty, block: { ...empty.block, timestamp: String(Date.parse("2026-09-11T12:00:00.000Z") / 1000) } };
    const confirmed = { ...pendingActionRow(preparedDeposit(), "confirmed", "2026-09-10T12:05:00.000Z"), confirmedAt: "2026-09-10T12:01:00.000Z" };
    render(<Surface snapshot={snapshot} fetchAccountResource={async () => ({ actions: [confirmed] })} />);
    await page().findByRole("button", { name: "Start saving" });
    expect(page().queryByLabelText("Savings balance")).toBeNull();
    expect(page().queryByRole("region", { name: "Your savings" })).toBeNull();
  });
  test("a partial later snapshot cannot retire a confirmed deposit and open first use", async () => {
    cached();
    const snapshot = { ...buildBalancesSnapshotFixture({ registry: {
      ...cash,
      "morpho-gauntlet-usdc": { balance: ready("1000000000000000000"), underlyingBalance: unavailableBalance, value: { status: "unavailable" } },
    } }), coverage: { registry: "partial" as const, catalog: "complete" as const },
    block: { ...empty.block, timestamp: String(Date.parse("2026-09-11T12:00:00.000Z") / 1000) } };
    const confirmed = { ...pendingActionRow(preparedDeposit(), "confirmed", "2026-09-10T12:05:00.000Z"), confirmedAt: "2026-09-10T12:01:00.000Z" };
    render(<Route initialFlow="save-deposit" snapshot={snapshot} fetchAccountResource={async (path) =>
      path === "/api/actions" ? { actions: [confirmed] } : { version: 1, usdcReserveBaseUnits: "100000" }} />);
    await waitFor(() => expect(page().queryByRole("dialog", { name: "Deposit" })).toBeNull());
    expect(preparedInputs).toEqual([]);
  });
  test("a pending deposit cannot mask unreadable vault positions", async () => {
    cached();
    const unreadable = {
      ...empty,
      holdings: empty.holdings.map((holding) => holding.kind === "vault-share"
        ? { ...holding, balance: unavailableBalance, underlyingBalance: unavailableBalance, value: { status: "unavailable" as const } }
        : holding),
      coverage: { ...empty.coverage, registry: "partial" as const },
    };
    const actions = Promise.withResolvers<{ actions: unknown[] }>();
    render(<Surface snapshot={unreadable} fetchAccountResource={async () => actions.promise} />);
    await act(async () => actions.resolve({ actions: [pendingActionRow(preparedDeposit())] }));
    const hero = page().getByLabelText("Savings balance");
    expect(within(hero).getByText("Some savings are unavailable")).toBeTruthy();
    expect(within(hero).getByText("Unavailable")).toBeTruthy();
    expect(within(hero).queryByText("Pending")).toBeNull();
    expect(within(hero).queryByText("$1.00")).toBeNull();
    const savings = page().getByRole("region", { name: "Your savings" });
    const unreadableRow = within(savings).getByText("Gauntlet USDC Prime").closest("li");
    expect(unreadableRow?.textContent).toContain("Unavailable");
    expect(unreadableRow?.textContent).not.toContain("Pending");
  });
  test("a pending deposit cannot mask a failed balance", async () => {
    cached();
    const actions = Promise.withResolvers<{ actions: unknown[] }>();
    render(<Surface snapshot={empty} status="failed" fetchAccountResource={async () => actions.promise} />);
    await act(async () => actions.resolve({ actions: [pendingActionRow(preparedDeposit())] }));
    const hero = page().getByLabelText("Balance unavailable");
    expect(within(hero).getByText("Unavailable")).toBeTruthy();
    expect(within(hero).getByText("Couldn't load your balance. Check your connection.")).toBeTruthy();
    expect(within(hero).queryByText("Pending")).toBeNull();
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
  });
  test("another owner's pending action cannot hide this account's first-use intro", async () => {
    cached();
    render(<Surface snapshot={empty} fetchAccountResource={async () => ({
      actions: [pendingActionRow({ ...preparedDeposit(), id: "other-deposit", owner: { ...preparedDeposit().owner, subject: "other-saver" } }),
        { ...pendingActionRow(preparedDeposit()), owner: { ...preparedDeposit().owner, chainId: 1 } }],
    })} />);
    await page().findByRole("button", { name: "Start saving" });
    expect(page().queryByRole("region", { name: "Your savings" })).toBeNull();
  });
  test("loading or failed action history holds the intro and blocks first use", async () => {
    cached();
    const pending = Promise.withResolvers<{ actions: unknown[] }>();
    const view = render(<Surface snapshot={empty} fetchAccountResource={async () => pending.promise} />);
    expect(page().getByText("Loading savings")).toBeTruthy();
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
    await act(async () => pending.resolve({ actions: [] }));
    await page().findByRole("button", { name: "Start saving" });
    view.unmount();
    getHomeQueryClient().clear();
    cached();
    let fail = true;
    render(<Surface snapshot={empty} fetchAccountResource={async () => {
      if (fail) throw new Error("Actions unavailable");
      return { actions: [] };
    }} />);
    await page().findByText("Couldn't check your deposits");
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
    fail = false;
    fireEvent.click(page().getByRole("button", { name: "Try again" }));
    await page().findByRole("button", { name: "Start saving" });
  });
  test("switching accounts closes the first-use picker without preparing", async () => {
    cached();
    const view = render(<Surface snapshot={empty} />);
    fireEvent.click(page().getByRole("button", { name: "Start saving" }));
    await page().findByRole("dialog", { name: "Choose where to save" });
    view.rerender(<Surface snapshot={empty} owner={{ ...session, user: { subject: "other-saver" } }} />);
    await waitFor(() => expect(Boolean(page().queryByRole("dialog"))).toBe(false));
    expect(page().getByRole("button", { name: "Start saving" })).toBeTruthy();
    expect(preparedInputs).toEqual([]);
  });
  test("first submitted deposit remains pending until funded, then clears on account switch", async () => {
    cached();
    const prepare = async () => preparedDeposit();
    const execute: CashExperienceProps["executeMoneyAction"] = async (action) => ({ id: action.id, status: "submitted" });
    const view = render(<Surface snapshot={empty} onPrepare={prepare} onExecute={execute} />);
    fireEvent.click(page().getByRole("button", { name: "Start saving" }));
    fireEvent.click(within(await page().findByRole("dialog", { name: "Choose where to save" })).getByRole("button", { name: /Gauntlet USDC Prime/, description: "Deposit to Gauntlet USDC Prime" }));
    const dialog = await page().findByRole("dialog", { name: "Deposit" });
    fireEvent.change(await within(dialog).findByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit $1.00" }));
    await waitFor(() => expect(within(page().getByLabelText("Savings balance")).getByText("$1.00")).toBeTruthy());
    fireEvent.click(page().getByRole("button", { name: "Done" }));
    await waitFor(() => expect(page().getByRole("region", { name: "Your savings" })).toBeTruthy());
    const pendingSavings = page().getByRole("region", { name: "Your savings" });
    expect(within(pendingSavings).getByText("Pending")).toBeTruthy();
    expect(within(pendingSavings).getByText("Gauntlet USDC Prime")).toBeTruthy();
    expect(within(pendingSavings).queryByRole("button", { name: /Gauntlet/ })).toBeNull();
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
    view.rerender(<Surface snapshot={held} onPrepare={prepare} onExecute={execute} />);
    expect(page().getByRole("region", { name: "Your savings" })).toBeTruthy();
    expect(page().getByText("Steakhouse USDC")).toBeTruthy();
    view.rerender(<Surface snapshot={empty} owner={{ ...session, user: { subject: "other-saver" } }} />);
    expect(page().getByRole("button", { name: "Start saving" })).toBeTruthy();
  });
  const submitFirstDeposit = async (status: "rejected" | "submitted", fetchAccountResource?: CashExperienceProps["fetchAccountResource"], onSubmit?: () => void) => {
    cached();
    const view = render(<Surface snapshot={empty} onPrepare={async () => preparedDeposit()} onExecute={async (action) => { onSubmit?.(); return { id: action.id, status }; }} fetchAccountResource={fetchAccountResource} />);
    const opener = await page().findByRole("button", { name: "Start saving" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(within(await page().findByRole("dialog", { name: "Choose where to save" })).getByRole("button", { name: /Gauntlet USDC Prime/, description: "Deposit to Gauntlet USDC Prime" }));
    const dialog = await page().findByRole("dialog", { name: "Deposit" });
    fireEvent.change(await within(dialog).findByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit $1.00" }));
    return view;
  };
  test("a local action and the same pending server row count only once", async () => {
    let serverPending = false;
    const view = await submitFirstDeposit("submitted", async () => ({ actions: serverPending ? [pendingActionRow(preparedDeposit())] : [] }), () => { serverPending = true; });
    await act(async () => { await getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey(dataOwnerKey(session), "actions") }); });
    fireEvent.click(await page().findByRole("button", { name: "Done" }));
    const hero = page().getByLabelText("Savings balance");
    expect(within(hero).getByText("$1.00")).toBeTruthy();
    expect(within(page().getByRole("region", { name: "Your savings" })).getByText("$1.00")).toBeTruthy();
    view.unmount();
  });
  test("a rejected first deposit keeps the intro rather than showing a pending deposit", async () => {
    await submitFirstDeposit("rejected");
    await page().findByText("The wallet request was rejected.");
    expect(page().queryByLabelText("Savings balance")).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Close deposit dialog" }));
    await waitFor(() => expect(Boolean(page().queryByRole("dialog"))).toBe(false));
    expect(page().getByRole("button", { name: "Start saving" })).toBeTruthy();
  });
  test("a later failed action releases the pending first deposit", async () => {
    cached();
    let actionStatus: "idle" | "pending" | "failed" = "idle";
    const fetchAccountResource: NonNullable<CashExperienceProps["fetchAccountResource"]> = async () => ({
      actions: actionStatus === "idle" ? [] : [pendingActionRow(preparedDeposit(), actionStatus)],
    });
    render(<Surface snapshot={empty} onPrepare={async () => preparedDeposit()}
      onExecute={async (action) => { actionStatus = "pending"; return { id: action.id, status: "submitted" }; }} fetchAccountResource={fetchAccountResource} />);
    await page().findByRole("button", { name: "Start saving" });
    fireEvent.click(page().getByRole("button", { name: "Start saving" }));
    fireEvent.click(within(await page().findByRole("dialog", { name: "Choose where to save" })).getByRole("button", { name: /Gauntlet USDC Prime/, description: "Deposit to Gauntlet USDC Prime" }));
    const dialog = await page().findByRole("dialog", { name: "Deposit" });
    fireEvent.change(await within(dialog).findByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit $1.00" }));
    await waitFor(() => expect(within(page().getByLabelText("Savings balance")).getByText("$1.00")).toBeTruthy());
    fireEvent.click(await page().findByRole("button", { name: "Done" }));
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    expect(within(page().getByRole("region", { name: "Your savings" })).getByText("Pending")).toBeTruthy();
    actionStatus = "failed";
    await act(async () => {
      await getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey(dataOwnerKey(session), "actions") });
    });
    await waitFor(() => expect(page().getByRole("alert").textContent).toContain("Your deposit didn't go through. Try again."));
    expect(page().queryByLabelText("Savings balance")).toBeNull();
    expect(page().getByRole("button", { name: "Start saving" })).toBeTruthy();
    expect(page().queryByRole("dialog", { name: "Choose where to save" })).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Start saving" }));
    expect(page().queryByRole("alert")).toBeNull();
  }, 15_000);
  test("a rehydrated pending deposit that later fails shows the warning after reload", async () => {
    cached();
    let actionStatus: "pending" | "failed" = "pending";
    const fetchAccountResource: NonNullable<CashExperienceProps["fetchAccountResource"]> = async () => ({
      actions: [pendingActionRow(preparedDeposit(), actionStatus)],
    });
    render(<Surface snapshot={empty} fetchAccountResource={fetchAccountResource} />);
    const hero = await page().findByLabelText("Savings balance");
    expect(within(hero).getByText("$1.00")).toBeTruthy();
    expect(within(hero).getByText("Pending")).toBeTruthy();
    expect(page().queryByRole("button", { name: "Start saving" })).toBeNull();
    actionStatus = "failed";
    await act(async () => {
      await getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey(dataOwnerKey(session), "actions") });
    });
    await waitFor(() => expect(page().getByRole("alert").textContent).toContain("Your deposit didn't go through. Try again."));
    expect(page().queryByLabelText("Savings balance")).toBeNull();
    expect(page().getByRole("button", { name: "Start saving" })).toBeTruthy();
  });
  test("account switching clears a pending first-deposit marker", async () => {
    const view = await submitFirstDeposit("submitted");
    await waitFor(() => expect(within(page().getByLabelText("Savings balance")).getByText("$1.00")).toBeTruthy());
    view.rerender(<Surface snapshot={empty} owner={{ ...session, user: { subject: "other-saver" } }} />);
    await waitFor(() => expect(page().getByRole("button", { name: "Start saving" })).toBeTruthy());
    expect(page().queryByRole("alert")).toBeNull();
  });
  test("switching account provider on the same wallet clears a pending first-deposit marker", async () => {
    const view = await submitFirstDeposit("submitted");
    await waitFor(() => expect(within(page().getByLabelText("Savings balance")).getByText("$1.00")).toBeTruthy());
    view.rerender(<Surface snapshot={empty} owner={{ ...session, accountProvider: "base-account" }} />);
    await waitFor(() => expect(page().getByRole("button", { name: "Start saving" })).toBeTruthy());
    expect(page().queryByLabelText("Savings balance")).toBeNull();
  });
  test("a verified session without a wallet shows unavailable balances without an ineffective retry", async () => {
    const view = render(<AccountWalletContext.Provider value={walletWithoutAccount}><main><AuthenticatedCashExperience view="cash" onOpenSavings={noop} pendingCashout={null} /></main></AccountWalletContext.Provider>);
    expect(await view.findByLabelText("Balance unavailable")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(view.queryByRole("button", { name: "Add money" })).toBeNull();
  });
  test("does not offer management without a verified session", async () => {
    cached();
    render(<main><CashExperience view="savings" snapshot={held} balanceStatus="ready" session={null} now={now} onOpenSavings={noop} onAddMoney={noop} onRetryBalances={noop} prepareMoneyAction={prepareMoneyAction} executeMoneyAction={executeMoneyAction} /></main>);
    const positions = await page().findByRole("region", { name: "Your savings" });
    expect(within(positions).queryByRole("button", { name: /Manage/ })).toBeNull();
    expect(page().queryByRole("dialog")).toBeNull();
    expect(page().queryByRole("button", { name: "Deposit more" })).toBeNull();
    expect(page().queryByRole("button", { name: "Withdraw" })).toBeNull();
  });
  test("a rate outage does not block withdrawal from a known vault", async () => {
    cached({ ...metadata, candidates: [] });
    render(<Surface snapshot={single} />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    const dialog = await page().findByRole("dialog", { name: "Gauntlet USDC Prime" });
    expect((within(dialog).getByRole("button", { name: "Withdraw" }) as HTMLButtonElement).disabled).toBe(false);
  });
  test("a single held position opens its management tray", async () => {
    cached();
    const steakhouseOnly = buildBalancesSnapshotFixture({ registry: { ...cash,
      "morpho-re7-usdc": { balance: ready("800000000000000000000"), underlyingBalance: ready("800000000"), value: priced("USD", "80000") },
    } });
    render(<Surface snapshot={steakhouseOnly} />);
    fireEvent.click(await page().findByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" }));
    const dialog = await page().findByRole("dialog", { name: "Steakhouse USDC" });
    expect(within(dialog).getByText("Saved")).toBeTruthy();
    expect(within(dialog).getByRole("img", { name: "$800.00" })).toBeTruthy();
    expect(within(dialog).getByText("3.85% APY · variable")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Deposit more" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Withdraw" })).toBeTruthy();
  });
  test("Deposit more is pinned to the selected vault", async () => {
    cached();
    render(<Surface snapshot={held} />);
    fireEvent.click(await page().findByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" }));
    await page().findByRole("dialog", { name: "Steakhouse USDC" });
    fireEvent.click(await page().findByRole("button", { name: "Deposit more" }));
    const amount = await page().findByRole("textbox", { name: "Amount" });
    fireEvent.change(amount, { target: { value: "2.25" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(preparedInputs).toEqual([{ kind: "deposit", vaultAddress: STEAKHOUSE, amountBaseUnits: "2250000" }]));
  });
  test("Withdraw targets the selected position", async () => {
    cached();
    render(<Surface snapshot={held} />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    fireEvent.click(within(await page().findByRole("dialog", { name: "Gauntlet USDC Prime" })).getByRole("button", { name: "Withdraw" }));
    fireEvent.change(await page().findByRole("textbox", { name: "Amount" }), { target: { value: "4.50" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(preparedInputs).toEqual([{ kind: "withdraw", vaultAddress: GAUNTLET, amountBaseUnits: "4500000" }]));
  });
  test("withdraw Max uses the available limit rather than the position value", async () => {
    cached();
    const limited = buildBalancesSnapshotFixture({ registry: { ...cash,
      "morpho-steakhouse-usdc": {
        balance: ready("100000000000000000000"), underlyingBalance: ready("100000000"),
        withdrawableBalance: ready("40000000"), value: priced("USD", "10000"),
      },
    } });
    render(<Route initialFlow="save-withdraw" snapshot={limited} />);
    const dialog = within(await page().findByRole("dialog", { name: "Withdraw" }));
    expect(dialog.getByText("$40.00 available")).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Max" }));
    expect((dialog.getByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("40");
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(preparedInputs).toEqual([{ kind: "withdraw", vaultAddress: GAUNTLET, amountBaseUnits: "40000000" }]));
  });

  test("withdraw blocks an amount above the withdrawal limit", async () => {
    cached();
    const limited = buildBalancesSnapshotFixture({ registry: { ...cash,
      "morpho-steakhouse-usdc": {
        balance: ready("100000000000000000000"), underlyingBalance: ready("100000000"),
        withdrawableBalance: ready("40000000"), value: priced("USD", "10000"),
      },
    } });
    render(<Route initialFlow="save-withdraw" snapshot={limited} />);
    const dialog = within(await page().findByRole("dialog", { name: "Withdraw" }));
    fireEvent.change(dialog.getByRole("textbox", { name: "Amount" }), { target: { value: "41" } });
    expect(dialog.getByText("Only $40.00 available")).toBeTruthy();
    expect((dialog.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
    expect(preparedInputs).toEqual([]);
  });

  test.each(["unavailable", "absent"])("withdraw with %s limit keeps the sheet open and labels the position saved", async (state) => {
    cached();
    const fallback = buildBalancesSnapshotFixture({ registry: { ...cash,
      "morpho-steakhouse-usdc": {
        balance: ready("100000000000000000000"), underlyingBalance: ready("100000000"),
        withdrawableBalance: unavailableBalance, value: priced("USD", "10000"),
      },
    } });
    if (state === "absent") delete fallback.holdings.find((holding) => holding.id === "morpho-steakhouse-usdc")!.withdrawableBalance;
    render(<Route initialFlow="save-withdraw" snapshot={fallback} />);
    const dialog = within(await page().findByRole("dialog", { name: "Withdraw" }));
    expect(dialog.getByText("$100.00 saved")).toBeTruthy();
    expect(dialog.queryByText("$100.00 available")).toBeNull();
    fireEvent.click(dialog.getByRole("button", { name: "Max" }));
    expect((dialog.getByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("100");
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(preparedInputs).toEqual([{ kind: "withdraw", vaultAddress: GAUNTLET, amountBaseUnits: "100000000" }]));
  });

  test("a held position with a zero withdrawal limit shows nothing available", async () => {
    cached();
    const limited = buildBalancesSnapshotFixture({ registry: { ...cash,
      "morpho-steakhouse-usdc": {
        balance: ready("100000000000000000000"), underlyingBalance: ready("100000000"),
        withdrawableBalance: ready("0"), value: priced("USD", "10000"),
      },
    } });
    render(<Route initialFlow="save-withdraw" snapshot={limited} />);
    const dialog = within(await page().findByRole("dialog", { name: "Withdraw" }));
    expect(dialog.getByText("Nothing available to withdraw right now.")).toBeTruthy();
    expect(dialog.getByText("$0.00 available")).toBeTruthy();
    expect((dialog.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("verifying an account preserves the inbound savings flow", async () => {
    cached();
    render(<SignInRoute initialFlow="save-deposit" snapshot={held} />);
    fireEvent.click(page().getByRole("button", { name: "Verify account" }));
    await page().findByRole("dialog", { name: "Deposit" });
  });

  test("a position refreshed to zero shows nothing saved instead of unavailable", async () => {
    cached();
    const zeroVault = buildBalancesSnapshotFixture({ registry: { ...cash,
      "morpho-steakhouse-usdc": { balance: ready("0"), underlyingBalance: ready("0"), value: priced("USD", "0") },
    } });
    const view = render(<Surface snapshot={single} />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    const tray = await page().findByRole("dialog", { name: "Gauntlet USDC Prime" });
    expect((within(tray).getByRole("button", { name: "Withdraw" }) as HTMLButtonElement).disabled).toBe(false);
    view.rerender(<Surface snapshot={zeroVault} />);
    await waitFor(() => expect(within(tray).queryByText("Nothing saved to withdraw.")).toBeTruthy());
    expect(within(tray).queryByText("Unavailable")).toBeNull();
    expect((within(tray).getByRole("button", { name: "Withdraw" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("a vault missing from a complete snapshot is absent, not unreadable", () => {
    const snapshot = buildBalancesSnapshotFixture();
    const without = { ...snapshot, holdings: snapshot.holdings.filter((holding) => holding.contractAddress?.toLowerCase() !== GAUNTLET.toLowerCase()) };
    const management = savingsManagement({ address: GAUNTLET, snapshot: without, metadata: null, nowMs: NOW, regionId: "GLOBAL", actionsAvailable: true, usdcBaseUnits: null, usdcUnavailable: false });
    expect(management.absent).toBe(true);
    expect(management.savedBaseUnits).toBe("0");
    expect(management.unreadable).toBe(false);
    expect(management.withdraw.reason).toBe("Nothing saved to withdraw.");
  });
  test("a vault missing from a partial snapshot stays unavailable", () => {
    const snapshot = buildBalancesSnapshotFixture({ coverage: { registry: "partial" } });
    const without = { ...snapshot, holdings: snapshot.holdings.filter((holding) => holding.contractAddress?.toLowerCase() !== GAUNTLET.toLowerCase()) };
    const management = savingsManagement({ address: GAUNTLET, snapshot: without, metadata: null, nowMs: NOW, regionId: "GLOBAL", actionsAvailable: true, usdcBaseUnits: null, usdcUnavailable: false });
    expect(management.absent).toBe(false);
    expect(management.savedBaseUnits).toBeNull();
    expect(management.withdraw.reason).toBe("Couldn't check this balance.");
  });
  test("an owner switch clears the routed save flow before remounting it", async () => {
    cached();
    const view = render(<RoutedAuthenticatedOwnerSurface active={session} />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit more" }));
    await page().findByRole("textbox", { name: "Amount" });
    view.rerender(<RoutedAuthenticatedOwnerSurface active={sessionB} />);
    await waitFor(() => expect(page().queryByRole("textbox", { name: "Amount" })).toBeNull());
    expect(routeCalls.filter((call) => call === "clear:replace")).toHaveLength(1);
    view.rerender(<RoutedAuthenticatedOwnerSurface active={session} />);
    await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" });
    expect(page().queryByRole("dialog", { name: "Deposit" })).toBeNull();
  });
  test("an owner switch clears a still-pending routed flow once until routing acknowledges it", async () => {
    cached();
    const view = render(<RoutedAuthenticatedOwnerSurface active={session} deferClear />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit more" }));
    await page().findByRole("textbox", { name: "Amount" });
    view.rerender(<RoutedAuthenticatedOwnerSurface active={sessionB} deferClear />);
    await waitFor(() => expect(routeCalls.filter((call) => call === "clear:replace")).toHaveLength(1));
    expect(page().queryByRole("textbox", { name: "Amount" })).toBeNull();
    view.rerender(<RoutedAuthenticatedOwnerSurface active={sessionB} deferClear />);
    expect(routeCalls.filter((call) => call === "clear:replace")).toHaveLength(1);
    view.rerender(<RoutedAuthenticatedOwnerSurface active={session} deferClear />);
    expect(routeCalls.filter((call) => call === "clear:replace")).toHaveLength(1);
    expect(page().queryByRole("textbox", { name: "Amount" })).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Acknowledge routed flow" }));
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit more" }));
    await page().findByRole("textbox", { name: "Amount" });
    view.rerender(<RoutedAuthenticatedOwnerSurface active={sessionB} deferClear />);
    await waitFor(() => expect(routeCalls.filter((call) => call === "clear:replace")).toHaveLength(2));
  });
  test("signing out and back in does not reopen the previous owner's routed save flow", async () => {
    cached();
    const view = render(<RoutedAuthenticatedOwnerSurface active={session} deferClear />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit more" }));
    await page().findByRole("textbox", { name: "Amount" });
    view.rerender(<RoutedAuthenticatedOwnerSurface active={null} deferClear />);
    await waitFor(() => expect(routeCalls.filter((call) => call === "clear:replace")).toHaveLength(1));
    view.rerender(<RoutedAuthenticatedOwnerSurface active={session} deferClear />);
    await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" });
    expect(page().queryByRole("textbox", { name: "Amount" })).toBeNull();
    expect(page().queryByRole("dialog", { name: "Deposit" })).toBeNull();
    expect(routeCalls.filter((call) => call === "clear:replace")).toHaveLength(1);
  });
  test("signing out and in as another owner does not reopen the previous owner's routed save flow", async () => {
    cached();
    const view = render(<RoutedAuthenticatedOwnerSurface active={session} deferClear />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit more" }));
    await page().findByRole("textbox", { name: "Amount" });
    view.rerender(<RoutedAuthenticatedOwnerSurface active={null} deferClear />);
    await waitFor(() => expect(routeCalls.filter((call) => call === "clear:replace")).toHaveLength(1));
    view.rerender(<RoutedAuthenticatedOwnerSurface active={sessionB} deferClear />);
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
    expect(page().queryByRole("textbox", { name: "Amount" })).toBeNull();
    expect(routeCalls.filter((call) => call === "clear:replace")).toHaveLength(1);
  });
  test("a traversal that lands on a stale routed flow releases Save for the signed-back-in owner", async () => {
    cached();
    const view = render(<RoutedAuthenticatedOwnerSurface active={session} deferClear />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit more" }));
    await page().findByRole("textbox", { name: "Amount" });
    view.rerender(<RoutedAuthenticatedOwnerSurface active={null} deferClear />);
    await waitFor(() => expect(routeCalls.filter((call) => call === "clear:replace")).toHaveLength(1));
    view.rerender(<RoutedAuthenticatedOwnerSurface active={session} deferClear />);
    await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" });
    fireEvent.click(page().getByRole("button", { name: "Land a stale routed flow" }));
    await waitFor(() => expect(page().queryByRole("dialog", { name: "Deposit" })).toBeNull());
    expect(page().queryByRole("textbox", { name: "Amount" })).toBeNull();
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit more" }));
    await page().findByRole("textbox", { name: "Amount" });
  });
  test("a selected vault and its data do not follow A to B to A", async () => {
    cached();
    const view = render(<AuthenticatedOwnerSurface active={session} />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    await page().findByRole("dialog", { name: "Gauntlet USDC Prime" });
    view.rerender(<AuthenticatedOwnerSurface active={sessionB} />);
    await waitFor(() => expect(page().queryByRole("dialog", { name: "Gauntlet USDC Prime" })).toBeNull());
    expect(page().queryByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" })).toBeNull();
    view.rerender(<AuthenticatedOwnerSurface active={session} />);
    await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" });
    expect(page().queryByRole("dialog", { name: "Gauntlet USDC Prime" })).toBeNull();
  });
  test("a selected vault is fresh after sign-out and signing back in", async () => {
    cached();
    const view = render(<AuthenticatedOwnerSurface active={session} />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    await page().findByRole("dialog", { name: "Gauntlet USDC Prime" });
    view.rerender(<AuthenticatedOwnerSurface active={null} />);
    await waitFor(() => expect(page().queryByRole("dialog", { name: "Gauntlet USDC Prime" })).toBeNull());
    view.rerender(<AuthenticatedOwnerSurface active={session} />);
    await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" });
    expect(page().queryByRole("dialog", { name: "Gauntlet USDC Prime" })).toBeNull();
  });
  test("an account change clears the selected tray instead of reopening it for the new owner", async () => {
    cached();
    render(<OwnerSwitchSurface snapshot={single} />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    await page().findByRole("dialog", { name: "Gauntlet USDC Prime" });
    fireEvent.click(page().getByText("Switch verified account"));
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
  });

  test("Back returns to the tray and X exits the journey", async () => {
    cached();
    render(<Route initialFlow={null} snapshot={single} />);
    const row = await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" });
    row.focus();
    fireEvent.click(row);
    await page().findByRole("dialog", { name: "Gauntlet USDC Prime" });
    fireEvent.click(await page().findByRole("button", { name: "Deposit more" }));
    await page().findByRole("textbox", { name: "Amount" });
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    expect(await page().findByRole("dialog", { name: "Gauntlet USDC Prime" })).toBeTruthy();
    expect(routeCalls).toEqual(["push:save-deposit", "clear:undefined"]);
    fireEvent.click(page().getByRole("button", { name: "Close Gauntlet USDC Prime details" }));
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
    expect(document.activeElement === row).toBe(true);
  }, 60_000);
  test("close and reopen resets the draft and keeps the correct vault", async () => {
    cached();
    render(<Surface snapshot={held} onPrepare={async (_kind, input) => { preparedInputs.push(input); return preparedDeposit(); }} />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    await page().findByRole("dialog", { name: "Gauntlet USDC Prime" });
    await page().findByText("Saved");
    fireEvent.click(await page().findByRole("button", { name: "Deposit more" }));
    fireEvent.change(await page().findByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await page().findByRole("dialog", { name: "Confirm" });
    fireEvent.click(page().getAllByRole("button", { name: "Back" }).at(-1)!);
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    fireEvent.click(page().getByRole("button", { name: "Close Gauntlet USDC Prime details" }));
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
    fireEvent.click(page().getByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" }));
    await page().findByText("Saved");
    fireEvent.click(page().getByRole("button", { name: "Deposit more" }));
    const amount = await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 }) as HTMLInputElement;
    expect(amount.value).toBe("");
    fireEvent.change(amount, { target: { value: "2" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(preparedInputs).toEqual([
      { kind: "deposit", vaultAddress: GAUNTLET, amountBaseUnits: "1000000" },
      { kind: "deposit", vaultAddress: STEAKHOUSE, amountBaseUnits: "2000000" },
    ]);
  }, 60_000);
  test("modal Back keeps the selected vault for a browser Forward", async () => {
    cached();
    render(<Route initialFlow={null} snapshot={held} />);
    fireEvent.click(await page().findByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit more" }));
    fireEvent.change(await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 }), { target: { value: "2" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(preparedInputs).toEqual([{ kind: "deposit", vaultAddress: STEAKHOUSE, amountBaseUnits: "2000000" }]));
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await waitFor(() => expect(page().queryByRole("textbox", { name: "Amount" })).toBeNull());
    fireEvent.click(page().getByRole("button", { name: "Browser Forward", hidden: true }));
    fireEvent.change(await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 }), { target: { value: "3" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(preparedInputs.at(-1)).toEqual({ kind: "deposit", vaultAddress: STEAKHOUSE, amountBaseUnits: "3000000" }));
  }, 20_000);
  test("modal Back keeps the selected position for a browser Forward withdrawal", async () => {
    cached();
    render(<Route initialFlow={null} snapshot={held} />);
    fireEvent.click(await page().findByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" }));
    fireEvent.click(await page().findByRole("button", { name: "Withdraw" }));
    fireEvent.change(await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 }), { target: { value: "1" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(preparedInputs).toEqual([{ kind: "withdraw", vaultAddress: STEAKHOUSE, amountBaseUnits: "1000000" }]));
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await waitFor(() => expect(page().queryByRole("textbox", { name: "Amount" })).toBeNull());
    fireEvent.click(page().getByRole("button", { name: "Browser Forward", hidden: true }));
    fireEvent.change(await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 }), { target: { value: "2" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(preparedInputs.at(-1)).toEqual({ kind: "withdraw", vaultAddress: STEAKHOUSE, amountBaseUnits: "2000000" }));
  }, 20_000);
  test("switching actions after modal Back targets the switched vault", async () => {
    cached();
    render(<Route initialFlow={null} snapshot={held} />);
    fireEvent.click(await page().findByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit more" }));
    await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 });
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await waitFor(() => expect(page().queryByRole("textbox", { name: "Amount" })).toBeNull());
    fireEvent.click(page().getByRole("button", { name: "Withdraw" }));
    fireEvent.change(await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 }), { target: { value: "1" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(preparedInputs).toEqual([{ kind: "withdraw", vaultAddress: STEAKHOUSE, amountBaseUnits: "1000000" }]));
  }, 20_000);
  test("closing the tray after modal Back leaves Forward an ordinary inbound flow", async () => {
    cached();
    render(<Route initialFlow={null} snapshot={held} />);
    fireEvent.click(await page().findByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit more" }));
    await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 });
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await waitFor(() => expect(page().queryByRole("textbox", { name: "Amount" })).toBeNull());
    fireEvent.click(page().getByRole("button", { name: "Close Steakhouse USDC details" }));
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
    fireEvent.click(page().getByRole("button", { name: "Browser Forward", hidden: true }));
    fireEvent.change(await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 }), { target: { value: "1" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(preparedInputs).toEqual([{ kind: "deposit", vaultAddress: GAUNTLET, amountBaseUnits: "1000000" }]));
  }, 60_000);
  test("an unavailable balance after modal Back never reopens the money step", async () => {
    cached();
    const view = render(<Route initialFlow={null} snapshot={held} />);
    fireEvent.click(await page().findByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit more" }));
    await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 });
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await waitFor(() => expect(page().queryByRole("textbox", { name: "Amount" })).toBeNull());
    view.rerender(<Route initialFlow={null} snapshot={held} status="failed" />);
    await waitFor(() => expect(page().queryByRole("textbox", { name: "Amount" })).toBeNull());
    const tray = await page().findByRole("dialog", { name: "Steakhouse USDC" });
    expect((within(tray).getByRole("button", { name: "Deposit more" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(tray).getByRole("button", { name: "Withdraw" }) as HTMLButtonElement).disabled).toBe(true);
  }, 20_000);
  test("Back from the amount step restores focus to the chosen action", async () => {
    cached();
    render(<Surface snapshot={held} />);
    fireEvent.click(await page().findByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" }));
    fireEvent.click(await page().findByRole("button", { name: "Withdraw" }));
    await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 });
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await waitFor(() => expect(document.activeElement).toBe(page().getByRole("button", { name: "Withdraw" })));
  }, 20_000);
  test("a tray opened without a chosen action focuses the saved balance", async () => {
    cached();
    render(<Surface snapshot={single} />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    const hero = (await page().findByRole("img", { name: "$800.00" })).closest("p");
    await waitFor(() => expect(document.activeElement).toBe(hero));
  }, 20_000);
  test("Back restores focus to the most recently chosen action", async () => {
    cached();
    render(<Surface snapshot={held} />);
    fireEvent.click(await page().findByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit more" }));
    await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 });
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await waitFor(() => expect(document.activeElement).toBe(page().getByRole("button", { name: "Deposit more" })));
    fireEvent.click(page().getByRole("button", { name: "Withdraw" }));
    await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 });
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await waitFor(() => expect(document.activeElement).toBe(page().getByRole("button", { name: "Withdraw" })));
  }, 20_000);
  test("an unlisted held position permits withdrawal", async () => {
    cached({ ...metadata, candidates: [metadata.candidates[1]!] });
    render(<Surface snapshot={single} />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    const dialog = await page().findByRole("dialog", { name: "Gauntlet USDC Prime" });
    expect((within(dialog).getByRole("button", { name: "Deposit more" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByText("Deposits are paused for this vault.")).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Withdraw" }) as HTMLButtonElement).disabled).toBe(false);
  });
  test("an unreadable held position shows an honest withdrawal reason", async () => {
    cached();
    const unreadable = buildBalancesSnapshotFixture({ registry: { ...cash,
      "morpho-steakhouse-usdc": { balance: unavailableBalance, underlyingBalance: unavailableBalance, value: { status: "unavailable" } },
    } });
    render(<Surface snapshot={unreadable} />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    const dialog = await page().findByRole("dialog", { name: "Gauntlet USDC Prime" });
    expect(within(dialog).getByText("Unavailable")).toBeTruthy();
    expect(dialog.textContent).not.toContain("$0.00");
    expect((within(dialog).getByRole("button", { name: "Withdraw" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByText("Couldn't check this balance.")).toBeTruthy();
  });
  test("zero vault liquidity is informational and withdrawal remains enabled", async () => {
    cached({ ...metadata, candidates: [{ ...metadata.candidates[0]!, liquidityRaw: "0" }, metadata.candidates[1]!] });
    render(<Surface snapshot={single} />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    const dialog = await page().findByRole("dialog", { name: "Gauntlet USDC Prime" });
    expect(within(dialog).getByText("No liquidity available to withdraw right now.")).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Withdraw" }) as HTMLButtonElement).disabled).toBe(false);
  });
  test("adds only savings growth and reconciles a new authoritative snapshot once", async () => {
    cached();
    let clock = NOW;
    const getNow = () => clock;
    const first = { ...held, block: { ...held.block, timestamp: String(Math.floor((NOW - 120_000) / 1000)) } };
    const observed = buildBalancesSnapshotFixture({ registry: { ...cash,
      "morpho-steakhouse-usdc": { balance: ready("801000000000000000000"), underlyingBalance: ready("801000000"), value: priced("USD", "80100") },
      "morpho-re7-usdc": { balance: ready("84000000000000000000"), underlyingBalance: ready("84000000"), value: priced("USD", "8400") },
    } });
    const next = { ...observed, block: { ...observed.block, number: "35123457", hash: `0x${"b".repeat(64)}`, timestamp: String(Math.floor(NOW / 1000)) } } as BalancesSnapshot;
    const view = render(<MoneyMotionProvider reducedMotion={false}><Surface view="cash" snapshot={first} nowFn={getNow} /></MoneyMotionProvider>);
    const balance = () => page().getByLabelText("Cash balance").querySelector<HTMLElement>("[role=img]")?.getAttribute("aria-label");
    expect(balance()).toBe("$1,117.00");
    clock += 15_000;
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => expect(balance()).toMatch(/^\$1,117\.\d{6}$/));
    view.rerender(<MoneyMotionProvider reducedMotion={false}><Surface view="cash" snapshot={next} nowFn={getNow} /></MoneyMotionProvider>);
    await waitFor(() => expect(balance()).toBe("$1,119.00"));
  });
  test("reduced motion holds the authoritative balance without animating", async () => {
    cached();
    let clock = NOW;
    const getNow = () => clock;
    const first = { ...held, block: { ...held.block, timestamp: String(Math.floor((NOW - 120_000) / 1000)) } };
    render(<MoneyMotionProvider reducedMotion><Surface view="cash" snapshot={first} nowFn={getNow} /></MoneyMotionProvider>);
    const balance = () => page().getByLabelText("Cash balance").querySelector<HTMLElement>("[role=img]");
    expect(balance()?.getAttribute("aria-label")).toBe("$1,117.00");
    clock += 120_000;
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(balance()?.getAttribute("aria-label")).toBe("$1,117.00");
    expect(balance()?.getAttribute("data-animated")).toBe("false");
  });
  test.each(["local", "pending", "unknown"] as const)("a %s deposit permits a second deposit and both remain pending", async (source) => {
    cached();
    const first = preparedDeposit();
    const second = preparedDeposit("cash-deposit-2", "2000000");
    const prepared: unknown[] = [];
    const executed: PreparedMoneyAction[] = [];
    render(<Route initialFlow={null} snapshot={empty}
      onPrepare={async (_endpoint, input) => { prepared.push(input); return source === "local" && prepared.length === 1 ? first : second; }}
      onExecute={async (action) => { executed.push(action); return { id: action.id, status: "submitted" }; }}
      fetchAccountResource={async (path) => path === "/api/actions"
        ? { actions: source === "local" ? [] : [pendingActionRow(first, source)] }
        : { version: 1, usdcReserveBaseUnits: "100000" }} />);
    if (source === "local") {
      fireEvent.click(await page().findByRole("button", { name: "Start saving" }));
      fireEvent.click(within(await page().findByRole("dialog", { name: "Choose where to save" })).getByRole("button", { description: "Deposit to Gauntlet USDC Prime" }));
      await confirmDeposit("1");
      await finishDeposit();
    }
    const hero = await page().findByLabelText("Savings balance");
    await waitFor(() => expect(within(hero).getByText("$1.00")).toBeTruthy());
    expect(within(hero).getByText("Pending")).toBeTruthy();
    await openMoreWaysDeposit();
    await confirmDeposit("2");
    expect(prepared.at(-1)).toEqual({ kind: "deposit", vaultAddress: GAUNTLET, amountBaseUnits: "2000000" });
    expect(executed.at(-1)).toEqual(second);
    await finishDeposit();
    expect(within(page().getByLabelText("Savings balance")).getByText("$3.00")).toBeTruthy();
    const savings = page().getByRole("region", { name: "Your savings" });
    expect(within(savings).getByText("$3.00")).toBeTruthy();
    expect(within(savings).getByText("Pending")).toBeTruthy();
  });
  test("an older local deposit failing removes only it and preserves the newer pending journey", async () => {
    cached();
    const first = preparedDeposit();
    const second = preparedDeposit("cash-deposit-2", "2000000");
    let prepares = 0;
    let failed = false;
    const prepare: CashExperienceProps["prepareMoneyAction"] = async () => ++prepares === 1 ? first : second;
    const execute: CashExperienceProps["executeMoneyAction"] = async (action) => ({ id: action.id, status: "submitted" });
    const resource: NonNullable<CashExperienceProps["fetchAccountResource"]> = async (path) => path === "/api/actions"
      ? { actions: failed ? [pendingActionRow(first, "failed")] : [] }
      : { version: 1, usdcReserveBaseUnits: "100000" };
    const view = render(<Route initialFlow={null} snapshot={empty} onPrepare={prepare} onExecute={execute} fetchAccountResource={resource} />);
    fireEvent.click(await page().findByRole("button", { name: "Start saving" }));
    fireEvent.click(within(await page().findByRole("dialog", { name: "Choose where to save" })).getByRole("button", { description: "Deposit to Gauntlet USDC Prime" }));
    await confirmDeposit("1");
    await finishDeposit();
    await openMoreWaysDeposit();
    await confirmDeposit("2");
    failed = true;
    await act(async () => { await getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey(dataOwnerKey(session), "actions") }); });
    expect(page().getByRole("button", { name: "Done" })).toBeTruthy();
    view.rerender(<Route initialFlow={null} snapshot={empty} status="failed" onPrepare={prepare} onExecute={execute} fetchAccountResource={resource} />);
    expect(page().getByRole("button", { name: "Done" })).toBeTruthy();
    view.rerender(<Route initialFlow={null} snapshot={empty} onPrepare={prepare} onExecute={execute} fetchAccountResource={resource} />);
    await finishDeposit();
    expect(page().getByRole("alert").textContent).toContain("Your deposit didn't go through. Try again.");
    const savings = page().getByRole("region", { name: "Your savings" });
    expect(within(savings).getByText("$2.00")).toBeTruthy();
    expect(within(savings).getByText("Pending")).toBeTruthy();
    expect(within(savings).queryByText("$3.00")).toBeNull();
  });
  test("a receipt-backed retirement clears only its local deposit marker", async () => {
    cached();
    const first = preparedDeposit();
    const second = preparedDeposit("cash-deposit-2", "2000000");
    let prepares = 0;
    let rows: unknown[] = [];
    const prepare: CashExperienceProps["prepareMoneyAction"] = async () => ++prepares === 1 ? first : second;
    const execute: CashExperienceProps["executeMoneyAction"] = async (action) => ({ id: action.id, status: "submitted" });
    const resource: NonNullable<CashExperienceProps["fetchAccountResource"]> = async (path) => path === "/api/actions"
      ? { actions: rows } : { version: 1, usdcReserveBaseUnits: "100000" };
    const view = render(<Surface snapshot={empty} onPrepare={prepare} onExecute={execute} fetchAccountResource={resource} />);
    fireEvent.click(await page().findByRole("button", { name: "Start saving" }));
    fireEvent.click(within(await page().findByRole("dialog", { name: "Choose where to save" })).getByRole("button", { description: "Deposit to Gauntlet USDC Prime" }));
    await confirmDeposit("1");
    await finishDeposit();
    await openMoreWaysDeposit();
    await confirmDeposit("2");
    await finishDeposit();
    rows = [pendingActionRow(first, "confirmed", "2026-09-10T11:55:00.000Z")];
    const settled = { ...empty, block: { ...empty.block, timestamp: String(Date.parse("2026-09-10T12:00:00.000Z") / 1000) } };
    view.rerender(<Surface snapshot={settled} onPrepare={prepare} onExecute={execute} fetchAccountResource={resource} />);
    await act(async () => { await getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey(dataOwnerKey(session), "actions") }); });
    await waitFor(() => expect(within(page().getByLabelText("Savings balance")).getByText("$2.00")).toBeTruthy());
    rows = [];
    await act(async () => { await getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey(dataOwnerKey(session), "actions") }); });
    expect(within(page().getByLabelText("Savings balance")).getByText("$2.00")).toBeTruthy();
  });
  test("a server-settled first deposit clears the local marker so Start saving opens again", async () => {
    cached();
    let serverRows: unknown[] = [];
    const execute: CashExperienceProps["executeMoneyAction"] = async (action) => ({ id: action.id, status: "submitted" });
    const view = render(<Route initialFlow={null} snapshot={empty} onPrepare={async () => preparedDeposit()}
      onExecute={execute} fetchAccountResource={async () => ({ actions: serverRows })} />);
    fireEvent.click(await page().findByRole("button", { name: "Start saving" }));
    fireEvent.click(within(await page().findByRole("dialog", { name: "Choose where to save" })).getByRole("button", { name: /Gauntlet USDC Prime/, description: "Deposit to Gauntlet USDC Prime" }));
    const dialog = await page().findByRole("dialog", { name: "Deposit" });
    fireEvent.change(await within(dialog).findByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit $1.00" }));
    fireEvent.click(await page().findByRole("button", { name: "Done" }));
    await waitFor(() => expect(Boolean(page().queryByRole("dialog"))).toBe(false));
    serverRows = [pendingActionRow({ ...preparedDeposit(), id: "cash-deposit-1" }, "confirmed", "2026-09-10T11:55:00.000Z")];
    const settled = { ...empty, block: { ...empty.block, timestamp: String(Date.parse("2026-09-10T12:00:00.000Z") / 1000) } };
    view.rerender(<Route initialFlow={null} snapshot={settled} onPrepare={async () => preparedDeposit()}
      onExecute={execute} fetchAccountResource={async () => ({ actions: serverRows })} />);
    await act(async () => { await getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey(dataOwnerKey(session), "actions") }); });
    expect(await page().findByRole("button", { name: "Start saving" })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Browser Forward", hidden: true }));
    const amount = await page().findByRole("dialog", { name: "Deposit" });
    expect(await within(amount).findByRole("textbox", { name: "Amount" })).toBeTruthy();
    expect(page().queryByText("Pending")).toBeNull();
    expect(preparedInputs).toEqual([]);
  });
  test("a history refresh leaves the picker and its focus in place", async () => {
    cached();
    const fresh = Promise.withResolvers<{ actions: unknown[] }>();
    let reads = 0;
    render(<Route initialFlow={null} snapshot={empty} fetchAccountResource={async (path) => {
      if (path !== "/api/actions") return { version: 1, usdcReserveBaseUnits: "100000" };
      reads += 1;
      return reads === 1 ? { actions: [] } : fresh.promise;
    }} />);
    const opener = await page().findByRole("button", { name: "Start saving" });
    opener.focus();
    fireEvent.click(opener);
    await page().findByRole("dialog", { name: "Choose where to save" });
    const focused = document.activeElement;
    await act(async () => { void getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey(dataOwnerKey(session), "actions") }); });
    await waitFor(() => expect(reads).toBe(2));
    await act(async () => fresh.resolve({ actions: [pendingActionRow({ ...preparedDeposit(), id: "other-tab-deposit" }, "pending")] }));
    expect(page().getByRole("dialog", { name: "Choose where to save" })).toBeTruthy();
    expect(document.activeElement).toBe(focused);
    expect(preparedInputs).toEqual([]);
  });
});


test("Cash preserves the savings anchor on unrelated renders and invalidates owner and freshness", async () => {
  const growth = await import("@/client/savings/use-estimated-growth");
  const anchor = spyOn(growth, "createSavingsGrowthAnchor");
  try {
    cached();
    const view = render(<Surface view="cash" snapshot={single} />);
    const initialCalls = anchor.mock.calls.length;
    expect(initialCalls).toBeGreaterThan(0);
    view.rerender(<Surface view="cash" snapshot={single} onAddMoney={() => {}} />);
    expect(anchor.mock.calls.length).toBe(initialCalls);
    const replacementOwner = { ...session, user: { subject: "replacement-owner" } };
    view.rerender(<Surface view="cash" snapshot={single} owner={replacementOwner} />);
    const replacedCalls = anchor.mock.calls.length;
    expect(replacedCalls).toBeGreaterThan(initialCalls);
    view.rerender(<Surface view="cash" snapshot={single} owner={replacementOwner} stale />);
    expect(anchor.mock.calls.length).toBeGreaterThan(replacedCalls);
  } finally { anchor.mockRestore(); }
});
