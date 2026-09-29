import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { CashExperience } from "@/client/cash/cash-experience";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { MoneyMotionProvider } from "@/components/money-ticker";
import { buildBalancesSnapshotFixture, priced, pricedCash, ready } from "@/shared/balances/fixtures";
import { BASE_USDC_PAYMASTER_ADDRESS } from "@/shared/money-actions/network-fee";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";
import { cashConversionCurrencies } from "@/shared/trading/cash-conversion";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import type { TradeActionParams } from "@/shared/trading/contract";
import { pinClock } from "@/tests/helpers/pin-clock";

const session: VerifiedAccountSession = { user: { subject: "storybook-cash-convert" }, smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 }, accountProvider: "cdp-embedded" };
const usd = cashConversionCurrencies.find((currency) => currency.code === "USD")!;
const eur = cashConversionCurrencies.find((currency) => currency.code === "EUR")!;
const idr = cashConversionCurrencies.find((currency) => currency.code === "IDR")!;
const held = buildBalancesSnapshotFixture({ registry: {
  usdc: { balance: ready("234000000"), value: priced("USD", "23400"), cashValue: pricedCash("USD", "23400") },
  eurc: { balance: ready("15000000"), value: priced("USD", "1700"), cashValue: pricedCash("EUR", "1500") },
  idrx: { balance: ready("190000000"), value: priced("USD", "11700"), cashValue: pricedCash("IDR", "190000000", 2) },
} });
const zero = buildBalancesSnapshotFixture({ registry: { usdc: { balance: ready("0"), value: priced("USD", "0"), cashValue: pricedCash("USD", "0") } } });
const now = "2026-09-10T12:00:00.000Z";
const NOW = Date.parse(now);
const candidate: MorphoVaultCandidate = { version: "v1", vaultAddress: MORPHO_V1_CANDIDATE_ADDRESSES[0]!, name: "Gauntlet USDC Prime", symbol: "USDC vault", listed: true, chainId: 8453,
  asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 }, curatorAddress: null, grossApy: 0.045, netApy: 0.041, feeRate: 0.1, totalAssetsRaw: "1250000000000", liquidityRaw: "850000000000", stateAsOf: now, blockNumber: "51026404",
  source: { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt: now } };
const metadata: MorphoVaultsResult = { version: "v1", chainId: 8453, asset: candidate.asset, candidates: [candidate], source: candidate.source, stale: false };

type Scenario = "eur" | "idr" | "eur-row" | "save" | "empty" | "unavailable" | "no-route" | "expiry" | "back";
function tradeAction(request: TradeActionParams, expired: boolean, owner: VerifiedAccountSession): PreparedMoneyAction {
  const traded = request.assetId === eur.tradeAssetId ? eur : idr;
  const buy = request.direction === "buy";
  const asset = { id: traded.tradeAssetId, address: traded.address, symbol: traded.symbol, decimals: traded.decimals };
  const cash = { id: "usdc", address: usd.address, symbol: usd.symbol, decimals: 6 };
  const from = buy ? cash : asset;
  const to = buy ? asset : cash;
  const spend = request.amountBaseUnits === "all" ? "15000000" : request.amountBaseUnits;
  const received = "2000000";
  const expiresAt = new Date(NOW + (expired ? -1000 : 120_000)).toISOString();
  return { id: `synthetic-cash-${traded.code}-${request.direction}`, kind: "trade", title: "Convert", owner: { subject: owner.user.subject, address: owner.smartAccount!.address, chainId: 8453, accountProvider: owner.accountProvider },
    createdAt: new Date(NOW).toISOString(), expiresAt, calls: [], warnings: [], signing: { signer: "base-account", typedData: {} } as PreparedMoneyAction["signing"],
    networkFee: { payment: "usdc", token: usd.address, paymaster: BASE_USDC_PAYMASTER_ADDRESS, maxFeeBaseUnits: "20000", decimals: 6 },
    amounts: [{ assetId: from.id, symbol: from.symbol, decimals: from.decimals, amountBaseUnits: spend, direction: "spend" }, { assetId: to.id, symbol: to.symbol, decimals: to.decimals, amountBaseUnits: received, direction: "receive", estimated: true }],
    metadata: { product: "trade", provider: "cdp-swaps", direction: request.direction, network: { name: "Base", chainId: 8453 }, assetId: asset.id, assetName: traded.name,
      fromAsset: from, toAsset: to, fromAmountBaseUnits: spend, expectedToAmountBaseUnits: received, minimumToAmountBaseUnits: "1980000", slippageBps: 100, fees: [], approval: "permit2-exact",
      quoteBlockNumber: "123", quotedAt: new Date(NOW).toISOString(), permitDeadline: String(Math.floor(Date.parse(expiresAt) / 1000) + 30), executionDeadline: String(Math.floor(Date.parse(expiresAt) / 1000) + 30) },
  };
}
function Surface({ scenario }: { scenario: Scenario }) {
  const [added, setAdded] = useState(false);
  const owner = { ...session, user: { subject: `${session.user.subject}-${scenario}` } };
  return <PresentationRegionProvider regionId="US"><MoneyMotionProvider><main className="mx-auto max-w-xl py-8">
    <CashExperience view="cash" session={owner} snapshot={scenario === "empty" ? zero : held} balanceStatus="ready" onOpenSavings={() => undefined}
      onAddMoney={() => setAdded(true)} now={() => Date.parse(now)} fetchVaults={async () => metadata}
      fetchAccountResource={async (path) => {
        if (path === "/api/actions") return { actions: [] };
        if (!path.includes("/api/trades")) return { version: 1, usdcReserveBaseUnits: "20000" };
        const assetId = new URL(path, "https://example.test").searchParams.get("assetId");
        const currency = cashConversionCurrencies.find((entry) => entry.tradeAssetId === assetId);
        if (!currency) throw new Error("Unexpected synthetic asset");
        return scenario === "unavailable" && currency.code === "EUR" ? { version: 2, status: "unavailable", reason: "asset-unsupported" }
          : { version: 2, status: "available", token: { assetId, address: currency.address.toLowerCase(), symbol: currency.symbol, decimals: currency.decimals }, buy: "available", balanceBaseUnits: "15000000" };
      }}
      prepareMoneyAction={async (_endpoint, input) => {
        if (scenario === "no-route") throw { code: "TRADE_ROUTE_UNAVAILABLE" };
        return tradeAction(input as TradeActionParams, scenario === "expiry", owner);
      }} executeMoneyAction={async (action) => ({ id: action.id, status: "rejected" })} />
    {added ? <p role="status">Add money opened</p> : null}
  </main></MoneyMotionProvider></PresentationRegionProvider>;
}

const meta = { title: "Journeys/Cash Convert", component: Surface, args: { scenario: "eur" }, beforeEach: () => pinClock(now) } satisfies Meta<typeof Surface>;
export default meta;
type Story = StoryObj<typeof meta>;
const openDestination = async (canvasElement: HTMLElement, target: "Euro" | "Rupiah") => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: /^Convert$/ }));
  const body = within(canvasElement.ownerDocument.body);
  const destination = await waitFor(() => within(body.getByRole("dialog", { name: "Convert to" })).getByRole("button", { name: new RegExp(`^${target}`) }));
  await userEvent.click(destination);
  await body.findByRole("textbox", { name: "Amount" });
};
const review = async (canvasElement: HTMLElement, target: "Euro" | "Rupiah") => {
  await openDestination(canvasElement, target);
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.type(body.getByRole("textbox", { name: "Amount" }), "1");
  await waitFor(() => expect(body.getByRole("button", { name: "Continue" })).toBeEnabled());
  await userEvent.click(body.getByRole("button", { name: "Continue" }));
  await body.findByRole("button", { name: /Convert \$1\.00/ });
  await waitFor(() => expect(body.getByText("You pay")).toBeVisible());
};
export const UsdToEurReview: Story = { play: async ({ canvasElement }) => review(canvasElement, "Euro") };
export const UsdToIdrReview: Story = { args: { scenario: "idr" }, play: async ({ canvasElement }) => review(canvasElement, "Rupiah") };
export const EurRowToUsd: Story = { args: { scenario: "eur-row" }, play: async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: /^Euro/ }));
  const body = within(canvasElement.ownerDocument.body);
  await waitFor(() => expect(body.getByRole("dialog", { name: "Euro" })).toBeVisible());
  await userEvent.click(body.getByRole("button", { name: /^Convert$/ }));
  await body.findByRole("textbox", { name: "Amount" });
} };
export const UsdRowWithSave: Story = { args: { scenario: "save" }, play: async ({ canvasElement }) => {
  await userEvent.click(within(within(canvasElement).getByRole("region", { name: "Currencies" })).getByRole("button", { name: /^US dollar/ }));
  const detail = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "US dollar" });
  await within(detail).findByRole("button", { name: /^Save$/ });
} };
export const EmptyUsdBalance: Story = { args: { scenario: "empty" }, play: async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: /^Convert$/ }));
  const body = within(canvasElement.ownerDocument.body);
  await waitFor(() => expect(within(body.getByRole("dialog", { name: "Convert to" })).getByText("No US dollars to convert.")).toBeVisible());
} };
export const DestinationUnavailable: Story = { args: { scenario: "unavailable" }, play: async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: /^Convert$/ }));
  await waitFor(() => within(within(canvasElement.ownerDocument.body).getByRole("dialog", { name: "Convert to" })).getAllByText("Conversion unavailable"));
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
  await waitFor(() => expect(body.getByText("Selected")).toBeVisible());
  await userEvent.click(body.getByRole("button", { name: "Close conversion" }));
  await waitFor(() => expect(body.queryByRole("dialog")).toBeNull());
} };
