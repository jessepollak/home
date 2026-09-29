import type { ActionListItem } from "../../../shared/actions/contracts/list";
import { cashConversionCurrencies } from "../../../shared/trading/cash-conversion";
import { FIXED_NOW } from "../fixtures/fixed-time";
import { sessionBody } from "../fixtures/bodies";

const usd = cashConversionCurrencies.find((currency) => currency.code === "USD")!;
const eur = cashConversionCurrencies.find((currency) => currency.code === "EUR")!;
const now = new Date(FIXED_NOW).toISOString();
const expiry = new Date(FIXED_NOW + 300_000).toISOString();
const permitDeadline = String(Math.floor((FIXED_NOW + 300_000) / 1000));
const executionDeadline = String(Math.floor((FIXED_NOW + 240_000) / 1000));
const fromAsset = { id: usd.tradeAssetId, address: usd.address, symbol: usd.symbol, decimals: usd.decimals };
const toAsset = { id: eur.tradeAssetId, address: eur.address, symbol: eur.symbol, decimals: eur.decimals };

export const conversionFixtureAction = {
  id: "90100000-0000-4000-8000-000000000003", provider: "cdp-embedded", kind: "trade",
  summary: {
    title: "Convert", amounts: [
      { assetId: usd.tradeAssetId, symbol: usd.symbol, decimals: usd.decimals, amountBaseUnits: "1250000", direction: "spend" },
      { assetId: eur.tradeAssetId, symbol: eur.symbol, decimals: eur.decimals, amountBaseUnits: "1150000", direction: "receive", estimated: true },
    ],
    warnings: [], expiresAt: expiry,
    metadata: {
      product: "trade", provider: "cdp-swaps", direction: "buy", network: { name: "Base", chainId: 8453 },
      assetId: eur.tradeAssetId, assetName: eur.name, fromAsset, toAsset,
      fromAmountBaseUnits: "1250000", expectedToAmountBaseUnits: "1150000", minimumToAmountBaseUnits: "1138500",
      slippageBps: 100, fees: [], approval: "permit2-exact", quoteBlockNumber: "123", quotedAt: now,
      permitDeadline, executionDeadline,
    },
  },
  status: "confirmed", createdAt: now, confirmedAt: now,
  owner: { subject: sessionBody.user.subject, address: sessionBody.smartAccount.address as `0x${string}`, chainId: 8453, accountProvider: "cdp-embedded" },
} satisfies ActionListItem;

export type ConversionPrepareParams = { direction: "buy" | "sell"; amountBaseUnits: string; assetId: string };

export function preparedConversionFixture({ direction, amountBaseUnits, assetId }: ConversionPrepareParams) {
  const local = cashConversionCurrencies.find((currency) => currency.tradeAssetId === assetId && currency.code !== "USD");
  if (!local) throw new Error(`No synthetic cash conversion for ${assetId}`);
  const from = direction === "buy" ? usd : local;
  const to = direction === "buy" ? local : usd;
  const asset = (currency: typeof usd) => ({ id: currency.tradeAssetId, address: currency.address, symbol: currency.symbol, decimals: currency.decimals });
  const expiresAt = new Date(FIXED_NOW + 120_000).toISOString();
  const deadline = String(Math.floor(Date.parse(expiresAt) / 1000) + 30);
  return {
    id: "synthetic-cash-convert", kind: "trade", title: "Convert",
    owner: { subject: sessionBody.user.subject, address: sessionBody.smartAccount.address, chainId: 8453, accountProvider: sessionBody.accountProvider },
    createdAt: new Date(FIXED_NOW).toISOString(), expiresAt, calls: [], warnings: [], signing: { signer: "base-account", typedData: {} },
    amounts: [
      { assetId: from.tradeAssetId, symbol: from.symbol, decimals: from.decimals, amountBaseUnits, direction: "spend" },
      { assetId: to.tradeAssetId, symbol: to.symbol, decimals: to.decimals, amountBaseUnits: "2000000", direction: "receive", estimated: true },
    ],
    metadata: {
      product: "trade", provider: "cdp-swaps", direction, assetId, assetName: local.name, network: { name: "Base", chainId: 8453 },
      fromAsset: asset(from), toAsset: asset(to), fromAmountBaseUnits: amountBaseUnits,
      expectedToAmountBaseUnits: "2000000", minimumToAmountBaseUnits: "1980000", slippageBps: 100,
      fees: [], approval: "permit2-exact", quoteBlockNumber: "123", quotedAt: new Date(FIXED_NOW).toISOString(),
      permitDeadline: deadline, executionDeadline: deadline,
    },
  };
}
