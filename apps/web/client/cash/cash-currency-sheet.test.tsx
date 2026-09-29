import "@/client/account/dom-test-harness";

import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { BASE_USDC_PAYMASTER_ADDRESS } from "@/shared/money-actions/network-fee";
import type { TradeActionParams } from "@/shared/trading/contract";
import { useState } from "react";
import { getHomeQueryClient } from "@/client/query/query-client";
import { ownerQueryKey } from "@/client/query/query-client";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { tradeAvailabilityScope } from "@/client/query/after-action";
import { buildBalancesSnapshotFixture, priced, pricedCash, ready, unavailableBalance } from "@/shared/balances/fixtures";
import { cashConversionCurrencies } from "@/shared/trading/cash-conversion";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";
import type { MorphoVaultCandidate } from "@/shared/savings/types";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { CashCurrencySheet } = await import("./cash-currency-sheet");
await Promise.all([import("@/client/trading/trade-money-dialog"), import("@/client/savings/savings-actions")]);
const NOW = Date.parse("2026-09-28T12:00:00.000Z");

const session: VerifiedAccountSession = { user: { subject: "cash-convert-test" }, smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 }, accountProvider: "cdp-embedded" };
const snapshot = buildBalancesSnapshotFixture({ registry: {
  usdc: { balance: ready("234000000"), value: priced("USD", "23400"), cashValue: pricedCash("USD", "23400") },
  eurc: { balance: ready("15000000"), value: priced("USD", "1700"), cashValue: pricedCash("EUR", "1500") },
} });
const fetchAccountResource = async (path: string) => {
  if (path.includes("network-fee")) return { version: 1, usdcReserveBaseUnits: "20000" };
  const assetId = new URL(path, "https://example.test").searchParams.get("assetId");
  const currency = cashConversionCurrencies.find((item) => item.tradeAssetId === assetId);
  if (!currency) throw new Error("Unexpected route");
  return { version: 2, status: "available", token: { assetId, address: currency.address, symbol: currency.symbol, decimals: currency.decimals }, buy: "available", balanceBaseUnits: "15000000" };
};
const calls: Array<{ endpoint: string; input: unknown }> = [];
const prepare = async (endpoint: string, input: unknown): Promise<PreparedMoneyAction> => { calls.push({ endpoint, input }); throw { code: "TRADE_ROUTE_UNAVAILABLE" }; };
const noop = () => undefined;
function Surface({ source = "USD", kind = "convert", data = snapshot, resource = fetchAccountResource, best = null, balanceStale = false, depositEntryBlocked = false, historyBlocked = false, onSaveEntry = noop, prepareAction = prepare, executeAction = async () => ({ id: "fixture", status: "rejected" as const }) }: { source?: "USD" | "EUR"; kind?: "convert" | "currency"; data?: typeof snapshot; resource?: (path: string) => Promise<unknown>; best?: MorphoVaultCandidate | null; balanceStale?: boolean; depositEntryBlocked?: boolean; historyBlocked?: boolean; onSaveEntry?: () => void; prepareAction?: AccountWalletClient["prepareMoneyAction"]; executeAction?: AccountWalletClient["executeMoneyAction"] }) {
  const [open, setOpen] = useState(true);
  return <><button onClick={() => setOpen(true)}>Reopen</button><CashCurrencySheet open={open} entry={{ kind, source }} session={session} snapshot={data} best={best} balanceStale={balanceStale}
    depositEntryBlocked={depositEntryBlocked} historyBlocked={historyBlocked} onSaveEntry={onSaveEntry} fetchAccountResource={resource} prepareMoneyAction={prepareAction} executeMoneyAction={executeAction}
    onCancel={() => setOpen(false)} onClosed={noop} onAddMoney={noop} onConfirmed={noop} /></>;
}
function preparedTrade(request: TradeActionParams): PreparedMoneyAction {
  const euro = cashConversionCurrencies.find((currency) => currency.code === "EUR")!;
  const dollar = cashConversionCurrencies.find((currency) => currency.code === "USD")!;
  const from = { id: "usdc", address: dollar.address, symbol: dollar.symbol, decimals: dollar.decimals };
  const to = { id: euro.tradeAssetId, address: euro.address, symbol: euro.symbol, decimals: euro.decimals };
  const expiresAt = new Date(NOW + 120_000).toISOString();
  return { id: "cash-trade-1", kind: "trade", title: "Convert", owner: { subject: session.user.subject, address: session.smartAccount!.address, chainId: 8453, accountProvider: session.accountProvider },
    createdAt: new Date(NOW).toISOString(), expiresAt, calls: [], warnings: [], signing: { signer: "base-account", typedData: {} } as PreparedMoneyAction["signing"],
    networkFee: { payment: "usdc", token: dollar.address, paymaster: BASE_USDC_PAYMASTER_ADDRESS, maxFeeBaseUnits: "20000", decimals: 6 },
    amounts: [{ assetId: from.id, symbol: from.symbol, decimals: from.decimals, amountBaseUnits: request.amountBaseUnits, direction: "spend" },
      { assetId: to.id, symbol: to.symbol, decimals: to.decimals, amountBaseUnits: "2000000", direction: "receive", estimated: true }],
    metadata: { product: "trade", provider: "cdp-swaps", direction: "buy", network: { name: "Base", chainId: 8453 }, assetId: to.id, assetName: "Euro", fromAsset: from, toAsset: to,
      fromAmountBaseUnits: request.amountBaseUnits, expectedToAmountBaseUnits: "2000000", minimumToAmountBaseUnits: "1980000", slippageBps: 100, fees: [], approval: "permit2-exact",
      quoteBlockNumber: "123", quotedAt: new Date(NOW).toISOString(), permitDeadline: String(Math.floor(Date.parse(expiresAt) / 1000) + 30), executionDeadline: String(Math.floor(Date.parse(expiresAt) / 1000) + 30) },
  };
}

const best: MorphoVaultCandidate = { version: "v1", vaultAddress: MORPHO_V1_CANDIDATE_ADDRESSES[0]!, name: "Gauntlet USDC Prime", symbol: "USDC vault", listed: true, chainId: 8453,
  asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 }, curatorAddress: null, grossApy: 0.045, netApy: 0.04, feeRate: 0.1, totalAssetsRaw: "10000000", liquidityRaw: "10000000", stateAsOf: "2026-09-10T12:00:00.000Z", blockNumber: "1",
  source: { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt: "2026-09-10T12:00:00.000Z" } };

function preparedDeposit(amountBaseUnits: string): PreparedMoneyAction {
  const dollar = cashConversionCurrencies.find((currency) => currency.code === "USD")!;
  return { id: "cash-deposit-1", kind: "savings-deposit", title: "Deposit USDC", owner: { subject: session.user.subject, address: session.smartAccount!.address, chainId: 8453, accountProvider: session.accountProvider },
    createdAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 120_000).toISOString(), calls: [], warnings: [],
    amounts: [
      { assetId: "usdc", symbol: dollar.symbol, decimals: dollar.decimals, amountBaseUnits, direction: "spend" },
      { assetId: "vault", symbol: "vault shares", decimals: 18, amountBaseUnits: "1000000000000000000", direction: "receive", estimated: true },
    ],
    metadata: { product: "savings", operation: "deposit", vaultAddress: best.vaultAddress, vaultName: best.name, network: { name: "Base", chainId: 8453 },
      feeWad: "100000000000000000", limitBaseUnits: "250000000", previewSharesBaseUnits: "1000000000000000000", shareDecimals: 18, minimumSharesBaseUnits: "1000000000000000000",
      exchangeConstraint: "deposit-minimum-shares-or-revert",
      discoveryRate: { status: "current", netApy: "0.041", fetchedAt: "2026-09-10T12:00:00.000Z", stateAsOf: "2026-09-10T12:00:00.000Z" },
      source: { blockNumber: "51026404", blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: "1789041840" } },
  };
}

function SaveGateSurface({ blocked, onArm, onPrepare, onExecute }: { blocked: boolean; onArm: () => void; onPrepare: AccountWalletClient["prepareMoneyAction"]; onExecute: AccountWalletClient["executeMoneyAction"] }) {
  return <Surface source="USD" kind="currency" best={best} historyBlocked={blocked} onSaveEntry={onArm} prepareAction={onPrepare} executeAction={onExecute} />;
}

beforeEach(() => setSystemTime(new Date(NOW)));
afterEach(() => { setSystemTime(); cleanup(); getHomeQueryClient().clear(); calls.length = 0; });

test("top-level Convert lists only cash destinations and prepares exact EUR buy units; route error recovers", async () => {
  const view = render(<Surface />);
  expect(view.getByRole("dialog", { name: "Convert to" })).toBeTruthy();
  expect(view.queryByRole("button", { name: /^US dollar/ })).toBeNull();
  expect(view.queryByRole("button", { name: /Bitcoin|Vault|Invest/ })).toBeNull();
  fireEvent.click(await view.findByRole("button", { name: /^Euro/ }));
  const input = await view.findByRole("textbox", { name: "Amount" });
  fireEvent.input(input, { target: { value: "1.25" } });
  await waitFor(() => expect((view.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(view.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(calls).toEqual([{ endpoint: "trade", input: { version: 3, assetId: "base:0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42", direction: "buy", amountBaseUnits: "1250000" } }]));
  expect(await view.findByText(/Can't convert to Euro right now/)).toBeTruthy();
});

test("refetched destination availability cannot unmount a selected trade", async () => {
  const euro = cashConversionCurrencies.find((currency) => currency.code === "EUR")!;
  let unavailable = false;
  let unavailableFetches = 0;
  const resource = async (path: string) => {
    if (unavailable && new URL(path, "https://example.test").searchParams.get("assetId") === euro.tradeAssetId) {
      unavailableFetches++;
      return { version: 2, status: "unavailable", reason: "asset-unsupported" };
    }
    return fetchAccountResource(path);
  };
  const view = render(<Surface resource={resource} />);
  fireEvent.click(await view.findByRole("button", { name: /^Euro/ }));
  const input = await view.findByRole("textbox", { name: "Amount" }) as HTMLInputElement;
  fireEvent.input(input, { target: { value: "1.25" } });
  unavailable = true;
  await act(async () => { await getHomeQueryClient().refetchQueries(); });
  expect(unavailableFetches).toBeGreaterThan(0);
  expect(view.getByRole("textbox", { name: "Amount" })).toBe(input);
  expect(input.value).toBe("1.25");
  await waitFor(() => expect((view.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(view.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(calls).toEqual([{ endpoint: "trade", input: { version: 3, assetId: euro.tradeAssetId, direction: "buy", amountBaseUnits: "1250000" } }]));
});

test("EUR holding reaches the sole USD sell amount directly after availability resolves", async () => {
  let resolveAvailability!: () => void;
  const availability = new Promise<void>((resolve) => { resolveAvailability = resolve; });
  const resource = async (path: string) => {
    if (path.includes("/api/trades?")) await availability;
    return fetchAccountResource(path);
  };
  const view = render(<Surface source="EUR" kind="currency" resource={resource} />);
  expect(view.getByRole("dialog", { name: "Euro" })).toBeTruthy();
  expect(view.getByText(/€15\.00/)).toBeTruthy();
  expect(view.queryByRole("button", { name: "Save" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: /^Convert$/ }));
  expect(view.queryByRole("dialog", { name: "Convert to" })).toBeNull();
  expect(view.getByRole("dialog", { name: "Convert to US dollar" })).toBeTruthy();
  await act(async () => { resolveAvailability(); });
  expect(await view.findByRole("textbox", { name: "Amount" })).toBeTruthy();
  fireEvent.input(view.getByRole("textbox", { name: "Amount" }), { target: { value: "2" } });
  await waitFor(() => expect((view.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(view.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(calls[0]).toEqual({ endpoint: "trade", input: { version: 3, assetId: "base:0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42", direction: "sell", amountBaseUnits: "2000000" } }));
});

test("sole destination shows unavailable after a non-ready availability result", async () => {
  const euro = cashConversionCurrencies.find((currency) => currency.code === "EUR")!;
  for (const response of [
    { version: 2, status: "unavailable", reason: "asset-unsupported" },
    { version: 2, status: "available", token: { assetId: euro.tradeAssetId, address: "0x1111111111111111111111111111111111111111", symbol: euro.symbol, decimals: euro.decimals }, buy: "available", balanceBaseUnits: "15000000" },
  ]) {
    const view = render(<Surface source="EUR" kind="currency" resource={async (path) => path.includes("/api/trades?") ? response : fetchAccountResource(path)} />);
    fireEvent.click(view.getByRole("button", { name: /^Convert$/ }));
    expect(view.queryByRole("dialog", { name: "Convert to" })).toBeNull();
    expect(await view.findByText("Can't convert this currency right now. Try again later.")).toBeTruthy();
    cleanup(); getHomeQueryClient().clear();
  }
});


test("a failed sole-destination availability check offers Try again", async () => {
  const view = render(<Surface source="EUR" kind="currency" resource={async (path) => {
    if (!path.includes("/api/trades?")) return fetchAccountResource(path);
    throw new Error("availability unavailable");
  }} />);
  fireEvent.click(view.getByRole("button", { name: /^Convert$/ }));
  expect(await view.findByRole("button", { name: "Try again" })).toBeTruthy();
});
test("Save appears on the USD row only with a ready balance and a vault candidate", () => {
  const usd = render(<Surface source="USD" kind="currency" best={best} />);
  expect(usd.getByRole("button", { name: "Save" })).toBeTruthy();
  cleanup();
  const unreadable = buildBalancesSnapshotFixture({ registry: { usdc: { balance: unavailableBalance, value: { status: "unavailable" } } } });
  const noBalance = render(<Surface source="USD" kind="currency" best={best} data={unreadable} />);
  expect(noBalance.queryByRole("button", { name: "Save" })).toBeNull();
  cleanup();
  const euro = render(<Surface source="EUR" kind="currency" best={best} />);
  expect(euro.queryByRole("button", { name: "Save" })).toBeNull();
  cleanup();
  const blocked = render(<Surface source="USD" kind="currency" best={best} depositEntryBlocked />);
  expect(blocked.queryByRole("button", { name: "Save" })).toBeNull();
});

test("the embedded Save arms the host floor and holds its steps while the host reports a blocked history", async () => {
  let arms = 0;
  let prepares = 0;
  let executions = 0;
  const onPrepare: AccountWalletClient["prepareMoneyAction"] = async () => { prepares += 1; return preparedDeposit("1000000"); };
  const onExecute: AccountWalletClient["executeMoneyAction"] = async (action) => { executions += 1; return { id: action.id, status: "submitted" }; };
  const props = { onArm: () => { arms += 1; }, onPrepare, onExecute };
  const view = render(<SaveGateSurface blocked {...props} />);
  fireEvent.click(view.getByRole("button", { name: "Save" }));
  expect(arms).toBe(1);
  fireEvent.input(await view.findByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
  const blocked = (await view.findByRole("button", { name: "Continue" })) as HTMLButtonElement;
  expect(blocked.disabled).toBe(true);
  fireEvent.click(blocked);
  expect(prepares).toBe(0);
  view.rerender(<SaveGateSurface blocked={false} {...props} />);
  await waitFor(() => expect((view.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(view.getByRole("button", { name: "Continue" }));
  expect(await view.findByRole("button", { name: "Deposit $1.00" })).toBeTruthy();
  expect(prepares).toBe(1);
  view.rerender(<SaveGateSurface blocked {...props} />);
  const late = view.getByRole("button", { name: "Deposit $1.00" }) as HTMLButtonElement;
  expect(late.disabled).toBe(true);
  fireEvent.click(late);
  expect(executions).toBe(0);
});

test("Back retains an entered amount for the same destination and clears it for a different one", async () => {
  const view = render(<Surface />);
  fireEvent.click(await view.findByRole("button", { name: /^Euro/ }));
  const amount = await view.findByRole("textbox", { name: "Amount" });
  fireEvent.input(amount, { target: { value: "3.5" } });
  fireEvent.click(view.getByRole("button", { name: "Back" }));
  expect(view.getByText("Selected")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: /^Euro/ }));
  expect((await view.findByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("3.5");
  fireEvent.click(view.getByRole("button", { name: "Back" }));
  fireEvent.click(await view.findByRole("button", { name: /^Rupiah/ }));
  expect((await view.findByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("");
  fireEvent.click(view.getByRole("button", { name: "Close conversion" }));
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
});

test("double confirm executes once; unresolved close and same-entry reopen resumes Retry without preparing again", async () => {
  let preparations = 0;
  let executions = 0;
  let reject!: (error: Error) => void;
  const pending = new Promise<never>((_, fail) => { reject = fail; });
  const view = render(<Surface prepareAction={async (_endpoint, input) => { preparations++; return preparedTrade(input as TradeActionParams); }}
    executeAction={async () => { executions++; return pending; }} />);
  fireEvent.click(await view.findByRole("button", { name: /^Euro/ }));
  fireEvent.input(await view.findByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
  await waitFor(() => expect((view.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(view.getByRole("button", { name: "Continue" }));
  const confirm = await view.findByRole("button", { name: /Convert \$1\.00/ });
  act(() => { fireEvent.click(confirm); fireEvent.click(confirm); });
  expect(executions).toBe(1);
  await act(async () => { reject(new Error("Outcome unresolved")); });
  expect(await view.findByRole("button", { name: "Retry" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Close conversion" }));
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  fireEvent.click(view.getByRole("button", { name: "Reopen", hidden: true }));
  expect(await view.findByRole("button", { name: "Retry" })).toBeTruthy();
  expect(preparations).toBe(1);
  expect(executions).toBe(1);
}, 40_000);


test("a confirmed conversion executes once and closes the sheet", async () => {
  let executions = 0;
  let resolveExecute: ((value: { id: string; status: "confirmed" }) => void) | null = null;
  const view = render(<Surface prepareAction={async (_endpoint, input) => preparedTrade(input as TradeActionParams)}
    executeAction={async () => { executions++; return await new Promise((resolve) => { resolveExecute = resolve; }); }} />);
  fireEvent.click(await view.findByRole("button", { name: /^Euro/ }));
  fireEvent.input(await view.findByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
  await waitFor(() => expect((view.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(view.getByRole("button", { name: "Continue" }));
  fireEvent.click(await view.findByRole("button", { name: /Convert \$1\.00/ }));
  await view.findByText("Waiting for your wallet…");
  expect((view.getByRole("button", { name: "Close conversion" }) as HTMLButtonElement).disabled).toBe(true);
  await waitFor(() => expect(executions).toBe(1));
  resolveExecute!({ id: "cash-trade-1", status: "confirmed" });
  await waitFor(() => expect(Boolean(view.queryByRole("dialog"))).toBe(false), { timeout: 2_000 });
  expect(executions).toBe(1);
}, 40_000);
test("unavailable destination cannot be selected and zero USD balance offers Add money", async () => {
  const view = render(<Surface resource={async (path) => path.includes("60a3e") ? { version: 2, status: "unavailable", reason: "asset-unsupported" } : fetchAccountResource(path)} />);
  await view.findByText("Conversion unavailable");
  expect(view.queryByRole("button", { name: /^Euro/ })).toBeNull();
  cleanup(); getHomeQueryClient().clear();
  const zero = buildBalancesSnapshotFixture({ registry: { usdc: { balance: ready("0"), value: priced("USD", "0"), cashValue: pricedCash("USD", "0") } } });
  const empty = render(<Surface data={zero} />);
  expect(empty.getByText("No US dollars to convert.")).toBeTruthy();
  expect(empty.getByRole("button", { name: "Add money" })).toBeTruthy();
});


test("a failed availability refetch does not start a sole-destination trade from cache", async () => {
  const euro = cashConversionCurrencies.find((currency) => currency.code === "EUR")!;
  const key = ownerQueryKey(dataOwnerKey(session), tradeAvailabilityScope, euro.tradeAssetId);
  getHomeQueryClient().setQueryData(key, { version: 2, status: "available", token: { assetId: euro.tradeAssetId, address: euro.address, symbol: euro.symbol, decimals: euro.decimals }, buy: "available", balanceBaseUnits: "15000000" });
  const view = render(<Surface source="EUR" kind="currency" resource={async (path) => {
    if (path.includes("/api/trades?")) throw new Error("availability unavailable");
    return fetchAccountResource(path);
  }} />);
  await act(async () => { await getHomeQueryClient().invalidateQueries({ queryKey: key }); });
  await waitFor(() => expect(getHomeQueryClient().getQueryCache().find({ queryKey: key })!.state.status).toBe("error"));
  fireEvent.click(view.getByRole("button", { name: /^Convert$/ }));
  expect(await view.findByRole("button", { name: "Try again" })).toBeTruthy();
  expect(view.queryByRole("textbox", { name: "Amount" })).toBeNull();
});
test("stale zero USD balance does not claim an empty wallet", () => {
  const zero = buildBalancesSnapshotFixture({ registry: { usdc: { balance: ready("0"), value: priced("USD", "0"), cashValue: pricedCash("USD", "0") } } });
  const view = render(<Surface data={zero} balanceStale />);
  expect(view.getByText("Balance may be out of date.")).toBeTruthy();
  expect(view.queryByText("No US dollars to convert.")).toBeNull();
  expect(view.queryByRole("button", { name: "Add money" })).toBeNull();
  cleanup(); getHomeQueryClient().clear();
  const detail = render(<Surface kind="currency" data={zero} balanceStale />);
  expect(detail.getByText("Balance may be out of date.")).toBeTruthy();
});
