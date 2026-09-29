import { balancesSnapshot } from "../fixtures/balances";
import { FIXED_NOW } from "../fixtures/fixed-time";
import { cryptoAssets, memeAssets } from "../../../config/invest-assets";
import { MARKET_PRICES_VERSION, type MarketPricesResponse } from "../../../shared/invest/contracts/market-prices";
import { MARKET_PRICE_HISTORY_VERSION, type MarketPriceHistoryResponse } from "../../../shared/invest/contracts/market-price-history";
import { VERIFIED_MORPHO_MARKETS } from "../../../shared/morpho-markets/config";
import { buyRouteForToken } from "../../../shared/trading/assets";
import { preparedSendFixtureAction } from "../fixtures/api";
import { COUNTRY_PREFERENCE_VERSION } from "../../../shared/account/contracts/country-preference";
import { cashoutFixtureAction, cashoutFixtureProgress, cashoutFixtureWithdraw } from "./cashout-fixture";
import {
  actionsBody,
  basenameProfileBody,
  fundingProvidersBody,
  cardsBody,
  borrowOverviewBody,
  sessionBody,
  tradeAvailabilityBody,
  savingsVaultsBody,
} from "../fixtures/bodies";
import type { TradeDirection } from "../../../shared/trading/contract";
import type { ActivityOrdersResponse } from "../../../shared/activity/contract-orders";
import { assetResolutionFixture, nonTrendingAddress, searchFixture } from "./search-fixtures";
import { BASE_USDC_PAYMASTER_ADDRESS } from "../../../shared/money-actions/network-fee";

const recentRecipient = "0x2211d1d0020daea8039e46cf1367962070d77da9";
const syntheticUsdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const syntheticBtc = "0x2222222222222222222222222222222222222222" as const;
export const syntheticDegen = "0x3333333333333333333333333333333333333333" as const;
export const degenAssetId = `base:${syntheticDegen}` as const;

export function activityOrdersFixture(): ActivityOrdersResponse {
  const createdAt = new Date(FIXED_NOW - 600_000).toISOString();
  const updatedAt = new Date(FIXED_NOW).toISOString();
  const funding = {
    kind: "funding" as const, region: "US", providerId: "coinbase", providerName: "Coinbase",
    paymentMethodLabel: "Debit card", instruction: "embed" as const, resumable: false,
    fiatAmount: "25.00", fiatCurrency: "USD", asset: { id: "usdc", symbol: "USDC", decimals: 6 },
    tokenAmountAtomic: "25000000", sandbox: false, expiresAt: new Date(FIXED_NOW + 3600_000).toISOString(),
    clearableAt: null, transactionHash: null, logIndex: null, createdAt, updatedAt,
  };
  return { version: 1, owner: { subject: sessionBody.user.subject, accountProvider: "cdp-embedded" }, orders: [
    { ...funding, id: "fixture-funding-pending", status: "waiting-customer", stage: "awaiting-payment", resumable: true },
    { ...funding, id: "fixture-funding-processing", status: "waiting-provider", stage: "provider-processing", instruction: null,
      fiatAmount: "40.00", tokenAmountAtomic: "40000000", updatedAt: new Date(FIXED_NOW - 120_000).toISOString() },
    { ...funding, id: "fixture-funding-received", status: "confirmed", stage: "received", instruction: null,
      updatedAt: new Date(FIXED_NOW - 300_000).toISOString() },
    { ...funding, id: "fixture-funding-ambiguous", status: "ambiguous", stage: "unconfirmed", instruction: null,
      fiatAmount: "30.00", tokenAmountAtomic: "30000000", clearableAt: createdAt },
    { kind: "cash-out", id: cashoutFixtureAction.id, orderId: cashoutFixtureProgress.depositId,
      region: "US", providerId: "peer", providerName: "Peer", platform: "cashapp", platformLabel: "Cash App",
      status: "waiting-provider", state: "awaiting-buyer", decimals: 6, amountAtomic: "50000000", filledAtomic: "0",
      returnedAtomic: "0", remainingAtomic: "50000000", withdrawable: true, settledAt: null, createdAt, updatedAt },
  ] };
}

export function tradePrepareFixture(direction: TradeDirection, asset: "bitcoin" | "degen" = "bitcoin", fullSell = false) {
  const buy = direction === "buy";
  const selected = asset === "degen"
    ? { id: degenAssetId, name: "DEGEN", symbol: "DEGEN", decimals: 18, address: syntheticDegen }
    : { id: "cbbtc", name: "Bitcoin", symbol: "cbBTC", decimals: 8, address: syntheticBtc };
  const token = { id: selected.id, symbol: selected.symbol, decimals: selected.decimals, address: selected.address };
  const cash = { id: "usdc", symbol: "USDC", decimals: 6, address: syntheticUsdc };
  const from = buy ? cash : token;
  const to = buy ? token : cash;
  const spend = buy ? "1000000" : asset === "degen" ? fullSell ? "123000000000000000000" : "500000000000000000" : "50000";
  const receive = buy ? asset === "degen" ? "120000000000000000000" : "1400" : "35000000";
  const expiresAt = new Date(FIXED_NOW + 110_000).toISOString();
  const owner = { subject: sessionBody.user.subject, address: sessionBody.smartAccount.address, chainId: 8453, accountProvider: "cdp-embedded" };
  return {
    id: `synthetic-trade-${direction}-${asset}`, owner, kind: "trade", title: `${buy ? "Buy" : "Sell"} ${selected.name}`,
    createdAt: new Date(FIXED_NOW).toISOString(), expiresAt,
    calls: [{ to: syntheticUsdc, data: `0x095ea7b3${BASE_USDC_PAYMASTER_ADDRESS.slice(2).toLowerCase().padStart(64, "0")}${BigInt(20_000).toString(16).padStart(64, "0")}`, value: "0" }],
    amounts: [
      { assetId: from.id, symbol: from.symbol, decimals: from.decimals, amountBaseUnits: spend, direction: "spend" },
      { assetId: to.id, symbol: to.symbol, decimals: to.decimals, amountBaseUnits: receive, direction: "receive", estimated: true },
    ],
    warnings: [],
    networkFee: { payment: "usdc", token: syntheticUsdc, paymaster: BASE_USDC_PAYMASTER_ADDRESS, maxFeeBaseUnits: "20000", decimals: 6 },
    signing: { signer: "cdp-embedded", evmAccount: owner.address, typedData: { domain: {}, types: {}, primaryType: "CoinbaseSmartWalletMessage", message: {} } },
    metadata: {
      product: "trade", provider: "cdp-swaps", direction, network: { name: "Base", chainId: 8453 },
      assetId: selected.id, assetName: selected.name,
      fromAsset: from, toAsset: to, fromAmountBaseUnits: spend, expectedToAmountBaseUnits: receive,
      minimumToAmountBaseUnits: (BigInt(receive) * BigInt(99) / BigInt(100)).toString(), slippageBps: 100,
      fees: [], approval: "permit2-exact", quoteBlockNumber: "12345678",
      quotedAt: new Date(FIXED_NOW).toISOString(), permitDeadline: String(Math.floor(Date.parse(expiresAt) / 1000) + 30),
      executionDeadline: String(Math.floor(Date.parse(expiresAt) / 1000) + 30),
    },
  };
}

const chainlink = { sourceLabel: "Chainlink", sourceUrl: "https://docs.chain.link/data-feeds/tokenized-equity-feeds/coinbase" };
const cryptoPrices: Record<string, string> = {
  cbbtc: "$60,000.00", cbxrp: "$2.41", cbdoge: "$0.21", cbltc: "$88.10",
  cbada: "$0.72", cbhype: "$38.20", cbzec: "$54.30", cbmega: "$0.62",
};

export function marketPricesFixture(now = new Date(FIXED_NOW)): MarketPricesResponse {
  const checkedAt = now.toISOString();
  const asOf = new Date(now.getTime() - 30_000).toISOString();
  const lastClose = new Date(now.getTime() - 14 * 3600_000).toISOString();
  return {
    version: MARKET_PRICES_VERSION, provider: "codex", fetchedAt: checkedAt,
    markets: {
      stock: { status: "ready", snapshots: [
        { assetId: "nvdac", displayPrice: "$180.24", asOf: lastClose, ...chainlink, session: "closed", checkedAt },
        { assetId: "msftc", displayPrice: "$512.40", asOf, ...chainlink, session: "open", checkedAt },
        { assetId: "metac", displayPrice: "—", asOf: lastClose, ...chainlink, session: "paused", checkedAt },
        { assetId: "aaplc", displayPrice: "—", asOf: lastClose, ...chainlink, session: "stale", checkedAt },
      ] },
      crypto: { status: "ready", snapshots: cryptoAssets.map((asset) => ({
        assetId: asset.id, displayPrice: cryptoPrices[asset.id] ?? "$1.00", asOf, sourceLabel: "Codex", changeLabel: "+1.2%",
      })) },
      meme: { status: "ready", snapshots: memeAssets.map((asset) => ({
        assetId: asset.id, displayPrice: "$0.0042", asOf, sourceLabel: "Codex", changeLabel: "-0.8%",
      })) },
    },
  };
}

export function priceHistoryFixture(assetId: string, now = new Date(FIXED_NOW)): MarketPriceHistoryResponse {
  const points = Array.from({ length: 24 }, (_, index) => ({
    time: new Date(now.getTime() - (23 - index) * 7 * 3600_000).toISOString(),
    value: (176 + Math.sin(index / 3) * 4 + index * 0.2).toFixed(2),
  }));
  return {
    version: MARKET_PRICE_HISTORY_VERSION, provider: "codex", assetId: assetId as MarketPriceHistoryResponse["assetId"],
    range: "1W", currency: "USD", fetchedAt: now.toISOString(), status: "ready", points,
  };
}

export function fixtureRoutes() {
  const balances = balancesSnapshot("US", { stocks: true });
  const borrowOverview = borrowOverviewBody();
  const prepared = preparedSendFixtureAction(recentRecipient);
  const assetIds = new Set([
    ...[...cryptoAssets, ...memeAssets].map((asset) => asset.id),
    ...VERIFIED_MORPHO_MARKETS.map((market) => buyRouteForToken({ chainId: market.chainId, address: market.collateralToken.address })).filter((id): id is string => id !== null),
  ]);
  return [
    ["**/api/session", sessionBody],
    ["**/api/account/country-preference", { version: COUNTRY_PREFERENCE_VERSION, regionId: null }],
    ["**/api/invites/link", { version: 1, code: "abcdefghjk" }],
    ["**/api/balances**", {
      ...balances,
      holdings: balances.holdings.map((holding) => ({
        ...holding,
        imageUrl: undefined,
        ...(holding.id === "usdc" ? { unitValue: { currency: "USD", amount: { atoms: "1", scale: 0 } } } : {}),
      })),
    }],
    ["**/api/market-prices", marketPricesFixture()],
    ...["nvdac", "metac"].map((assetId) => [`**/api/market-prices/history?assetId=${assetId}&range=1W`, priceHistoryFixture(assetId)] as const),
    ["**/api/actions", { actions: [...actionsBody.actions, {
      ...cashoutFixtureAction,
      cashout: { ...cashoutFixtureProgress, depositBlockNumber: balances.block.number },
    }] }],
    ["**/api/actions/prepare", prepared],
    ["**/api/trades/stock-eligibility", { version: 1, buy: "restricted", sell: "eligible" }],
    ["**/api/trades?**", { version: 2, status: "unavailable", reason: "asset-unsupported" }],
    ...[...assetIds].map((assetId) => [`**/api/trades?assetId=${encodeURIComponent(assetId)}`, tradeAvailabilityBody(assetId)] as const),
    ["**/api/actions/network-fee", { version: 1, usdcReserveBaseUnits: "20000" }],
    [`**/api/actions/${prepared.id}`, {
      id: prepared.id, kind: prepared.kind,
      summary: { title: prepared.title, networkFee: prepared.networkFee, amounts: prepared.amounts, warnings: prepared.warnings, expiresAt: prepared.expiresAt },
      calls: prepared.calls, expiresAt: prepared.expiresAt,
    }],
    [`**/api/actions/${cashoutFixtureWithdraw.id}`, {
      id: cashoutFixtureWithdraw.id,
      kind: cashoutFixtureWithdraw.kind,
      summary: {
        title: cashoutFixtureWithdraw.title,
        amounts: cashoutFixtureWithdraw.amounts,
        warnings: cashoutFixtureWithdraw.warnings,
        expiresAt: cashoutFixtureWithdraw.expiresAt,
        metadata: cashoutFixtureWithdraw.metadata,
      },
      calls: cashoutFixtureWithdraw.calls,
      expiresAt: cashoutFixtureWithdraw.expiresAt,
    }],
    ["**/api/activity/orders", { version: 1, owner: { subject: sessionBody.user.subject, accountProvider: sessionBody.accountProvider }, orders: [] }],
    ["**/api/activity**", {}],
    ["**/api/savings/vaults", savingsVaultsBody(new Date(FIXED_NOW).toISOString(), new Date(FIXED_NOW).toISOString())],
    ["**/api/borrow", borrowOverview],
    ["**/api/cards", cardsBody()],
    ...borrowOverview.opportunities.flatMap((entry) => entry.availability.status === "available"
      ? [[`**/api/borrow/markets/${entry.market.id}`, entry.availability.snapshot] as const]
      : []),
    ["**/api/client-performance**", { ok: true }],
    ["**/api/funding/providers**", fundingProvidersBody],
    ["**/api/transfers/recipient-name**", { version: 1, name: "example.base.eth", address: recentRecipient }],
    ["**/api/transfers/recent-recipients**", {
      version: 1, recipients: [{ address: recentRecipient, name: "example.base.eth" }],
    }],
    ["**/api/basename-profile**", basenameProfileBody],
    [`**/api/invest/asset?assetId=base%3A${nonTrendingAddress}`, assetResolutionFixture(`base:${nonTrendingAddress}`)],
    ...[...new Set(["BTC", "Bitcoin", "cbBTC", "AAPL", "Apple", "AAPLc", "ORB", "Orbit", nonTrendingAddress, "nothing-found", "partial"].flatMap((query) => [query, query.toLowerCase()]))].map((query) => [`**/api/invest/search?q=${query}`, searchFixture(query)] as const),
  ] as const;
}

export function requiresSignedInFixture(surfaceId: string): boolean {
  return !new Set(["landing", "sign-in", "access-gate", "coverage", "dev-ui"]).has(surfaceId);
}
