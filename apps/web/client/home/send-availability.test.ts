import { describe, expect, test } from "bun:test";
import {
  PORTFOLIO_NATIVE_ASSET_KEY,
  PORTFOLIO_USDC_ASSET_KEY,
  investPortfolioAssets,
  verifiedLocalCashAssets,
} from "@/config/portfolio-assets";
import type { HomeAssetBalanceItem } from "./home-types";
import { deriveSendAvailability } from "./send-availability";

const cbBtc = investPortfolioAssets.find((asset) => asset.id === "cbbtc")!;

const cases: Array<{
  name: string;
  items: HomeAssetBalanceItem[];
  expectedIds: string[];
  expectedLabels: string[];
}> = [
  {
    name: "returns positive catalog holdings in Balances order",
    items: [
      { id: "usd", assetKey: PORTFOLIO_USDC_ASSET_KEY, group: "cash", name: "US dollar", currencyCode: "USD", displayBalance: "$12.34" },
      { id: "btc", assetKey: cbBtc.assetKey, group: "asset", name: "Bitcoin", detail: "cbBTC", displayBalance: "$60.00", displayContext: "0.0010 cbBTC" },
      { id: "eth", assetKey: PORTFOLIO_NATIVE_ASSET_KEY, group: "asset", name: "Ethereum", displayBalance: "$20", displayContext: "0.01 ETH" },
    ],
    expectedIds: ["usdc", "cbbtc", "eth"],
    expectedLabels: ["$12.34", "0.0010 cbBTC", "0.01 ETH"],
  },
  {
    name: "includes configured local cash and excludes zero balances",
    items: [
      { id: "eur", assetKey: verifiedLocalCashAssets.EUR.assetKey, group: "cash", name: "Euro", currencyCode: "EUR", displayBalance: "€10.00" },
      { id: "idr", assetKey: verifiedLocalCashAssets.IDR.assetKey, group: "cash", name: "Rupiah", currencyCode: "IDR", displayBalance: "Rp 0.00" },
    ],
    expectedIds: ["eurc"],
    expectedLabels: ["€10.00"],
  },
  {
    name: "excludes unavailable, unknown, and recognized-only assets",
    items: [
      { id: "usd", assetKey: PORTFOLIO_USDC_ASSET_KEY, group: "cash", name: "US dollar", currencyCode: "USD", displayBalance: "—" },
      { id: "unknown", assetKey: "eip155:8453/erc20:0x9999999999999999999999999999999999999999", group: "asset", name: "Unknown", displayBalance: "1 UNK" },
      { id: "recognized", assetKey: cbBtc.assetKey, group: "asset", name: "Recognized", displayBalance: "1 cbBTC", recognized: true },
      { id: "errored", assetKey: PORTFOLIO_NATIVE_ASSET_KEY, group: "asset", name: "Ethereum", displayBalance: "1 ETH", tone: "error" },
    ],
    expectedIds: [],
    expectedLabels: [],
  },
];

describe("deriveSendAvailability", () => {
  for (const entry of cases) {
    test(entry.name, () => {
      const availability = deriveSendAvailability(entry.items);
      expect(availability.map((asset) => asset.id)).toEqual(entry.expectedIds);
      expect(availability.map((asset) => asset.balanceLabel)).toEqual(entry.expectedLabels);
    });
  }
});
