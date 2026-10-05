import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { waitForReady } from "@/tests/helpers/story-readiness";
import { CashExperience } from "@/client/cash/cash-experience";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { MoneyMotionProvider } from "@/components/money-ticker";
import { buildBalancesSnapshotFixture, priced, pricedCash, ready, requiredLocalCashAsset, unavailableBalance } from "@/shared/balances/fixtures";
import type { BalancesSnapshot } from "@/shared/balances/types";
import { BASE_USDC_PAYMASTER_ADDRESS } from "@/shared/money-actions/network-fee";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";
import { CASH_CONVERSION_UNAVAILABLE_REASON, cashConversionCurrencies } from "@/shared/trading/cash-conversion";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import type { TradeActionParams } from "@/shared/trading/contract";
import { pinClock } from "@/tests/helpers/pin-clock";

const session: VerifiedAccountSession = { user: { subject: "storybook-cash-convert" }, smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 }, accountProvider: "cdp-embedded" };
const usd = cashConversionCurrencies.find((currency) => currency.code === "USD")!;
const held = buildBalancesSnapshotFixture({ registry: {
  usdc: { balance: ready("234000000"), value: priced("USD", "23400"), cashValue: pricedCash("USD", "23400") },
  eurc: { balance: ready("15000000"), value: priced("USD", "1700"), cashValue: pricedCash("EUR", "1500") },
  idrx: { balance: ready("190000000"), value: priced("USD", "11700"), cashValue: pricedCash("IDR", "190000000", 2) },
  [requiredLocalCashAsset("ARS").id]: { balance: ready("123450000000000000000"), value: priced("USD", "12000"), cashValue: pricedCash("ARS", "12345") },
  [requiredLocalCashAsset("BRL").id]: { balance: ready("23450000000000000000"), value: priced("USD", "5000"), cashValue: pricedCash("BRL", "2345") },
  [requiredLocalCashAsset("COP").id]: { balance: ready("1234560000000000000000"), value: priced("USD", "3000"), cashValue: pricedCash("COP", "123456") },
} });
const zero = buildBalancesSnapshotFixture({ registry: { usdc: { balance: ready("0"), value: priced("USD", "0"), cashValue: pricedCash("USD", "0") } } });
const zeroUsdWithEur = buildBalancesSnapshotFixture({ registry: {
  usdc: { balance: ready("0"), value: priced("USD", "0"), cashValue: pricedCash("USD", "0") },
  eurc: { balance: ready("15000000"), value: priced("USD", "1700"), cashValue: pricedCash("EUR", "1500") },
} });
const now = "2026-09-10T12:00:00.000Z";
const NOW = Date.parse(now);
const candidate: MorphoVaultCandidate = { version: "v1", vaultAddress: MORPHO_V1_CANDIDATE_ADDRESSES[0]!, name: "Gauntlet USDC Prime", symbol: "USDC vault", listed: true, chainId: 8453,
  asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 }, curatorAddress: null, grossApy: 0.045, netApy: 0.041, feeRate: 0.1, totalAssetsRaw: "1250000000000", liquidityRaw: "850000000000", stateAsOf: now, blockNumber: "51026404",
  source: { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt: now } };
const metadata: MorphoVaultsResult = { version: "v1", chainId: 8453, asset: candidate.asset, candidates: [candidate], source: candidate.source, stale: false };
const prepared: unknown[] = [];
let fundingOpenedWithDialog = false;

type Scenario = "eur" | "idr" | "eur-row" | "save" | "zero-save" | "empty" | "unavailable" | "no-route" | "expiry" | "back";
function tradeAction(request: TradeActionParams, expired: boolean, owner: VerifiedAccountSession): PreparedMoneyAction {
  const traded = cashConversionCurrencies.find((currency) => currency.tradeAssetId === request.assetId && currency.code !== "USD");
  if (!traded) throw new Error("Unexpected conversion identity");
  const buy = request.direction === "buy";
  const asset = { id: traded.tradeAssetId, address: traded.address, symbol: traded.symbol, decimals: traded.decimals };
  const cash = { id: "usdc", address: usd.address, symbol: usd.symbol, decimals: 6 };
  const from = buy ? cash : asset;
  const to = buy ? asset : cash;
  const spend = request.amountBaseUnits === "all" ? "15000000" : request.amountBaseUnits;
  const received = (BigInt(2) * BigInt(10) ** BigInt(to.decimals)).toString();
  const expiresAt = new Date(NOW + (expired ? -1000 : 120_000)).toISOString();
  return { id: `synthetic-cash-${traded.code}-${request.direction}`, kind: "trade", title: "Convert", owner: { subject: owner.user.subject, address: owner.smartAccount!.address, chainId: 8453, accountProvider: owner.accountProvider },
    createdAt: new Date(NOW).toISOString(), expiresAt, calls: [], warnings: [], signing: { signer: "base-account", typedData: {} } as PreparedMoneyAction["signing"],
    networkFee: { payment: "usdc", token: usd.address, paymaster: BASE_USDC_PAYMASTER_ADDRESS, maxFeeBaseUnits: "20000", decimals: 6 },
    amounts: [{ assetId: from.id, symbol: from.symbol, decimals: from.decimals, amountBaseUnits: spend, direction: "spend" }, { assetId: to.id, symbol: to.symbol, decimals: to.decimals, amountBaseUnits: received, direction: "receive", estimated: true }],
    metadata: { product: "trade", provider: "cdp-swaps", direction: request.direction, network: { name: "Base", chainId: 8453 }, assetId: asset.id, assetName: traded.name,
      fromAsset: from, toAsset: to, fromAmountBaseUnits: spend, expectedToAmountBaseUnits: received, minimumToAmountBaseUnits: (BigInt(received) * BigInt(99) / BigInt(100)).toString(), slippageBps: 100, fees: [], approval: "permit2-exact",
      quoteBlockNumber: "123", quotedAt: new Date(NOW).toISOString(), permitDeadline: String(Math.floor(Date.parse(expiresAt) / 1000) + 30), executionDeadline: String(Math.floor(Date.parse(expiresAt) / 1000) + 30) },
  };
}
function Surface({ scenario, snapshot, balanceStale = false }: { scenario: Scenario; snapshot?: BalancesSnapshot; balanceStale?: boolean }) {
  const [added, setAdded] = useState(false);
  const owner = { ...session, user: { subject: `${session.user.subject}-${scenario}` } };
  return <PresentationRegionProvider regionId="US"><MoneyMotionProvider><main className="mx-auto max-w-xl py-8">
    <CashExperience view="cash" session={owner} snapshot={snapshot ?? (scenario === "empty" ? zero : scenario === "zero-save" ? zeroUsdWithEur : held)} balanceStatus="ready" balanceStale={balanceStale} onOpenSavings={() => undefined}
      onAddMoney={() => { fundingOpenedWithDialog = document.querySelector('[role="dialog"][data-open]') !== null; setAdded(true); }} now={() => Date.parse(now)} fetchVaults={async () => metadata}
      fetchAccountResource={async (path) => {
        if (path === "/api/actions") return { version: 1, truncated: false, actions: [] };
        if (!path.includes("/api/trades")) return { version: 1, usdcReserveBaseUnits: "20000" };
        const assetId = new URL(path, "https://example.test").searchParams.get("assetId");
        const currency = cashConversionCurrencies.find((entry) => entry.tradeAssetId === assetId);
        if (!currency) throw new Error("Unexpected synthetic asset");
        return scenario === "unavailable" && currency.code === "EUR" ? { version: 2, status: "unavailable", reason: "asset-unsupported" }
          : { version: 2, status: "available", token: { assetId, address: currency.address.toLowerCase(), symbol: currency.symbol, decimals: currency.decimals }, buy: "available", balanceBaseUnits: "15000000" };
      }}
      prepareMoneyAction={async (_endpoint, input) => {
        prepared.push(input);
        if (scenario === "no-route") throw { code: "TRADE_ROUTE_UNAVAILABLE" };
        return tradeAction(input as TradeActionParams, scenario === "expiry", owner);
      }} executeMoneyAction={async (action) => ({ id: action.id, status: "rejected" })} />
    {added ? <p role="status">Add money opened</p> : null}
  </main></MoneyMotionProvider></PresentationRegionProvider>;
}

const meta = { title: "Journeys/Cash Convert", component: Surface, args: { scenario: "eur" }, beforeEach: () => { prepared.length = 0; fundingOpenedWithDialog = false; return pinClock(now); } } satisfies Meta<typeof Surface>;
export default meta;
type Story = StoryObj<typeof meta>;
const openDestination = async (canvasElement: HTMLElement, target: string) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: /^Convert$/ }));
  const body = within(canvasElement.ownerDocument.body);
  const destination = await waitForReady(() => within(body.getByRole("dialog", { name: "Convert to" })).getByRole("button", { name: new RegExp(`^${target}`) }));
  await userEvent.click(destination);
  await body.findByRole("textbox", { name: "Amount" });
};
const review = async (canvasElement: HTMLElement, target: string) => {
  await openDestination(canvasElement, target);
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.type(body.getByRole("textbox", { name: "Amount" }), "1");
  await waitForReady(() => expect(body.getByRole("button", { name: "Continue" })).toBeEnabled());
  await userEvent.click(body.getByRole("button", { name: "Continue" }));
  await body.findByRole("button", { name: /Convert \$1\.00/ });
  await waitForReady(() => expect(body.getByText("You pay")).toBeVisible());
};
export const UsdToEurReview: Story = { play: async ({ canvasElement }) => review(canvasElement, "Euro") };
export const UsdToArsReview: Story = { play: async ({ canvasElement }) => review(canvasElement, "Argentine peso") };
export const UsdToBrlReview: Story = { play: async ({ canvasElement }) => review(canvasElement, "Brazilian real") };
export const UsdToCopReview: Story = { play: async ({ canvasElement }) => review(canvasElement, "Colombian peso") };
export const UsdToIdrReview: Story = { args: { scenario: "idr" }, play: async ({ canvasElement }) => review(canvasElement, "Rupiah") };
export const EurRowToUsd: Story = { args: { scenario: "eur-row" }, play: async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: /^Euro/ }));
  const body = within(canvasElement.ownerDocument.body);
  await waitForReady(() => expect(body.getByRole("dialog", { name: "Euro" })).toBeVisible());
  await userEvent.click(body.getByRole("button", { name: /^Convert$/ }));
  await body.findByRole("textbox", { name: "Amount" });
} };
export const UsdRowWithSave: Story = { args: { scenario: "save" }, play: async ({ canvasElement }) => {
  await userEvent.click(within(within(canvasElement).getByRole("region", { name: "Currencies" })).getByRole("button", { name: /^US dollar/ }));
  const body = within(canvasElement.ownerDocument.body);
  await waitForReady(() => expect(within(body.getByRole("dialog", { name: "US dollar" })).getByRole("button", { name: "Convert" })).toBeVisible());
  const detail = within(body.getByRole("dialog", { name: "US dollar" }));
  await detail.findByRole("button", { name: /^Save$/ });
  await expect(detail.queryByRole("button", { name: "Add money" })).toBeNull();
  await userEvent.click(detail.getByRole("button", { name: "Save" }));
  await body.findByRole("textbox", { name: "Amount" });
  await userEvent.click(body.getByRole("button", { name: "Back" }));
  await waitForReady(() => expect(within(body.getByRole("dialog", { name: "US dollar" })).getByRole("button", { name: "Convert" })).toBeVisible());
} };
export const UsdRowWithoutSaveAtZero: Story = { args: { scenario: "zero-save" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const savings = canvas.getByRole("region", { name: "Savings" });
  await waitForReady(() => expect(savings).not.toHaveAttribute("aria-busy"));
  await expect(within(savings).getByText("Earn up to 4.10% APY")).toBeVisible();
  const usdRow = within(canvas.getByRole("region", { name: "Currencies" })).getByRole("button", { name: /^US dollar/ });
  await expect(within(usdRow).getByRole("img", { name: "$0.00" })).toBeVisible();
  await userEvent.click(usdRow);
  const body = within(canvasElement.ownerDocument.body);
  await waitForReady(() => expect(within(body.getByRole("dialog", { name: "US dollar" })).getByText("Add money to get started")).toBeVisible());
  const detail = within(body.getByRole("dialog", { name: "US dollar" }));
  await expect(detail.queryByRole("img", { name: "$0.00" })).toBeNull();
  await expect(detail.queryByRole("button", { name: "Convert" })).toBeNull();
  await expect(detail.queryByRole("button", { name: "Save" })).toBeNull();
  await expect(prepared).toHaveLength(0);
  await userEvent.click(detail.getByRole("button", { name: "Close currency details" }));
  await waitForReady(() => expect(usdRow).toHaveFocus());
  await userEvent.click(usdRow);
  await waitForReady(() => expect(within(body.getByRole("dialog", { name: "US dollar" })).getByRole("button", { name: "Add money" })).toBeVisible());
  const reopened = within(body.getByRole("dialog", { name: "US dollar" }));
  await userEvent.click(reopened.getByRole("button", { name: "Add money" }));
  await waitForReady(() => expect(body.queryByRole("dialog")).toBeNull());
  await expect(await canvas.findByRole("status")).toHaveTextContent("Add money opened");
  await expect(fundingOpenedWithDialog).toBe(false);
} };
async function assertNoFundingNux(canvasElement: HTMLElement, unavailable = false, stale = false) {
  await userEvent.click(within(within(canvasElement).getByRole("region", { name: "Currencies" })).getByRole("button", { name: /^US dollar/ }));
  const body = within(canvasElement.ownerDocument.body);
  await waitForReady(() => expect(within(body.getByRole("dialog", { name: "US dollar" })).getByRole("button", { name: "Convert" })).toBeVisible());
  const detail = within(body.getByRole("dialog", { name: "US dollar" }));
  await expect(detail.queryByText("Add money to get started")).toBeNull();
  await expect(detail.queryByRole("button", { name: "Add money" })).toBeNull();
  await expect(detail.queryByRole("button", { name: "Save" })).toBeNull();
  if (unavailable) {
    await expect(detail.getByRole("img", { name: "Unavailable" })).toBeVisible();
    await expect(detail.queryByRole("img", { name: "$0.00" })).toBeNull();
  }
  if (stale) await expect(detail.getByText("Balance may be out of date.")).toBeVisible();
  await expect(prepared).toHaveLength(0);
}
export const StaleZeroUsdDetail: Story = { args: { scenario: "zero-save", balanceStale: true }, play: async ({ canvasElement }) => assertNoFundingNux(canvasElement, false, true) };
export const UnavailableUsdDetail: Story = { args: { snapshot: buildBalancesSnapshotFixture({ registry: {
  usdc: { balance: unavailableBalance, value: { status: "unavailable" }, cashValue: { status: "unavailable" } },
  eurc: { balance: ready("15000000"), value: priced("USD", "1700"), cashValue: pricedCash("EUR", "1500") },
} }) }, play: async ({ canvasElement }) => assertNoFundingNux(canvasElement, true) };
export const PartialZeroUsdDetail: Story = { args: { scenario: "zero-save", snapshot: { ...zeroUsdWithEur, coverage: { ...zeroUsdWithEur.coverage, registry: "partial" } } }, play: async ({ canvasElement }) => assertNoFundingNux(canvasElement) };
export const UnpricedZeroUsdDetail: Story = { args: { scenario: "zero-save", snapshot: buildBalancesSnapshotFixture({ registry: {
  usdc: { balance: ready("0"), value: { status: "unpriced", reason: "price-unavailable" }, cashValue: { status: "unpriced", reason: "price-unavailable" } },
  eurc: { balance: ready("15000000"), value: priced("USD", "1700"), cashValue: pricedCash("EUR", "1500") },
} }) }, play: async ({ canvasElement }) => assertNoFundingNux(canvasElement) };
export const EmptyUsdBalance: Story = { args: { scenario: "empty" }, play: async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: /^Convert$/ }));
  const body = within(canvasElement.ownerDocument.body);
  await waitForReady(() => expect(within(body.getByRole("dialog", { name: "Convert to" })).getByText("No US dollars to convert.")).toBeVisible());
} };
export const SearchDestinations: Story = { play: async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: /^Convert$/ }));
  const picker = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Convert to" }));
  await userEvent.type(picker.getByRole("textbox", { name: "Search currencies" }), "real");
  await expect(picker.getByRole("status")).toHaveTextContent("1 results");
  await expect(picker.getAllByRole("listitem")).toHaveLength(1);
  await waitForReady(() => expect(picker.getByText("Brazilian real")).toBeVisible());
  await userEvent.click(picker.getByRole("button", { name: "Clear search" }));
  await expect(picker.getAllByRole("listitem")).toHaveLength(5);
  for (const name of ["Euro", "Rupiah", "Argentine peso", "Brazilian real", "Colombian peso"]) await waitForReady(() => expect(picker.getByText(name)).toBeVisible());
} };
export const NoMatchingDestinations: Story = { play: async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: /^Convert$/ }));
  const picker = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Convert to" }));
  await userEvent.type(picker.getByRole("textbox", { name: "Search currencies" }), "not-a-currency");
  await waitForReady(() => expect(picker.getByText("No currencies found", { exact: true })).toBeVisible());
  await waitForReady(() => expect(picker.getByText("No currencies found for “not-a-currency”.")).toBeVisible());
  await expect(picker.queryByRole("listitem")).toBeNull();
} };
export const LocalDestinations: Story = { play: async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: /^Convert$/ }));
  const body = within(canvasElement.ownerDocument.body);
  const picker = within(await body.findByRole("dialog", { name: "Convert to" }));
  for (const name of ["Argentine peso", "Brazilian real", "Colombian peso"]) {
    const row = picker.getByText(name).closest("li")!;
    await expect(row).not.toHaveTextContent(CASH_CONVERSION_UNAVAILABLE_REASON);
    await waitForReady(() => expect(within(row).getByRole("button")).toBeEnabled());
  }
  await expect(prepared).toHaveLength(0);
} };
export const ArgentinePesoDetail: Story = { play: async ({ canvasElement }) => {
  const row = within(within(canvasElement).getByRole("region", { name: "Currencies" })).getByRole("button", { name: /^Argentine peso/ });
  await userEvent.click(row);
  const detail = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Argentine peso" }));
  await waitForReady(() => expect(detail.getByRole("img", { name: "$123.45" })).toBeVisible());
  await expect(detail.queryByText(CASH_CONVERSION_UNAVAILABLE_REASON)).toBeNull();
  await waitForReady(() => expect(detail.getByRole("button", { name: "Convert" })).toBeEnabled());
} };
export const DestinationUnavailable: Story = { args: { scenario: "unavailable" }, play: async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: /^Convert$/ }));
  await waitForReady(() => within(within(canvasElement.ownerDocument.body).getByRole("dialog", { name: "Convert to" })).getAllByText("Conversion unavailable"));
  await expect(within(canvasElement.ownerDocument.body).queryByRole("button", { name: /^Euro/ })).toBeNull();
} };
export const QuoteNoRoute: Story = { args: { scenario: "no-route" }, play: async ({ canvasElement }) => {
  await openDestination(canvasElement, "Euro");
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.type(body.getByRole("textbox", { name: "Amount" }), "1");
  await userEvent.click(body.getByRole("button", { name: "Continue" }));
  await body.findByText(/Can't convert to Euro right now/);
} };
export const QuoteExpired: Story = { args: { scenario: "expiry" }, play: async ({ canvasElement }) => {
  await openDestination(canvasElement, "Euro");
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.type(body.getByRole("textbox", { name: "Amount" }), "1");
  await userEvent.click(body.getByRole("button", { name: "Continue" }));
  await body.findByRole("button", { name: "Get new quote" });
} };
export const BackAndClose: Story = { args: { scenario: "back" }, play: async ({ canvasElement }) => {
  await openDestination(canvasElement, "Euro");
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.click(body.getByRole("button", { name: "Back" }));
  await waitForReady(() => expect(body.getByText("Selected")).toBeVisible());
  await userEvent.click(body.getByRole("button", { name: "Close conversion" }));
  await waitForReady(() => expect(body.queryByRole("dialog")).toBeNull());
} };
