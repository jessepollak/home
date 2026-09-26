import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { formatExactPresentationTokenAmount, formatFiatAmount } from "@/shared/formatting/money";

export const fixtureCash = "1000.00";
export const fixtureHolding = "0.01234567";
export const fixtureMaxNetworkFee = "0.05";
export const fixtureNow = "2026-09-10T12:04:00.000Z";
export const fixtureChartEnd = "2026-09-10T12:00:00.000Z";
export const fixtureValidUntil = "2026-09-10T12:04:30.000Z";

export type TradeQuote = {
  action: PreparedMoneyAction;
  side: "buy" | "sell";
  all: boolean;
  minimum: string;
  rate: string;
  lead: string;
  maxSlippage: string;
  result: { confirmedReceive: string; networkFeePaid: string; holding: string };
};

function quote(id: string, side: "buy" | "sell", amount: string, minimum: string, rate: string, lead: string, result: TradeQuote["result"]): TradeQuote {
  return {
    side, all: side === "sell" && amount === fixtureHolding, minimum, rate, lead, result,
    maxSlippage: "0.5%",
    action: {
      id: `fixture-${id}`, quoteId: `fixture-${id}-quote`, kind: "trade", title: `${side === "buy" ? "Buy" : "Sell"} Bitcoin`,
      createdAt: fixtureNow, expiresAt: "2099-09-10T12:04:30.000Z", calls: [], warnings: [],
      amounts: [
        { assetId: side === "buy" ? "fixture-usdc" : "fixture-cbbtc", symbol: side === "buy" ? "USDC" : "cbBTC", decimals: side === "buy" ? 6 : 8, amountBaseUnits: side === "buy" ? "250000000" : amount === fixtureHolding ? "1234567" : "500000", direction: "spend" },
        { assetId: side === "buy" ? "fixture-cbbtc" : "fixture-usdc", symbol: side === "buy" ? "cbBTC" : "USDC", decimals: side === "buy" ? 8 : 6, amountBaseUnits: side === "buy" ? "228125" : amount === fixtureHolding ? "1350490000" : "546950000", direction: "receive", estimated: true },
      ],
      networkFee: { payment: "usdc", token: "0x1111111111111111111111111111111111111111", paymaster: "0x2222222222222222222222222222222222222222", maxFeeBaseUnits: "50000", decimals: 6 },
      owner: { subject: "fixture-owner", address: "0x3333333333333333333333333333333333333333", chainId: 8453, accountProvider: "cdp-embedded" },
    },
  };
}

export const buyQuote = quote("buy", "buy", "250", "0.00226984 cbBTC", "1 cbBTC = 109,589.04 USDC", "Buy Bitcoin", { confirmedReceive: "0.00228190 cbBTC", networkFeePaid: "0.03 USDC", holding: "0.01462757" });
export const sellPartialQuote = quote("sell-partial", "sell", "0.005", "544.21 USDC", "1 cbBTC = 109,390.00 USDC", "Sell Bitcoin", { confirmedReceive: "547.10 USDC", networkFeePaid: "0.03 USDC", holding: "0.00734567" });
export const sellMaxQuote = quote("sell-max", "sell", fixtureHolding, "1,343.73 USDC", "1 cbBTC = 109,390.00 USDC", "Sell all your Bitcoin", { confirmedReceive: "1,350.82 USDC", networkFeePaid: "0.03 USDC", holding: "0" });
export const expiredQuote: TradeQuote = { ...buyQuote, action: { ...buyQuote.action, id: "fixture-expired", quoteId: "fixture-expired-quote", expiresAt: "2020-09-10T12:04:30.000Z" } };
export const refreshedQuote: TradeQuote = { ...buyQuote, action: { ...buyQuote.action, id: "fixture-buy-refreshed", quoteId: "fixture-buy-refreshed-quote" } };
export function quoteAmount(quote: TradeQuote, direction: "spend" | "receive") {
  const amount = quote.action.amounts.find((entry) => entry.direction === direction);
  return amount ? formatExactPresentationTokenAmount(amount.amountBaseUnits, amount.decimals, amount.symbol) : "—";
}

export function quoteSpendLabel(quote: TradeQuote) {
  if (quote.side === "sell") return quoteAmount(quote, "spend");
  const amount = quote.action.amounts.find((entry) => entry.direction === "spend");
  return amount ? formatFiatAmount(BigInt(amount.amountBaseUnits), amount.decimals, "USD") : "—";
}

export function quoteFiatReceive(quote: TradeQuote) {
  const amount = quote.action.amounts.find((entry) => entry.direction === "receive" && entry.symbol === "USDC");
  return amount ? formatFiatAmount(BigInt(amount.amountBaseUnits), amount.decimals, "USD") : "—";
}
