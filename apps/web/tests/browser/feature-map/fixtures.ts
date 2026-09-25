import { balancesSnapshot } from "../fixtures/balances";
import { preparedSendFixtureAction } from "../fixtures/api";
import { COUNTRY_PREFERENCE_VERSION } from "../../../shared/account/contracts/country-preference";
import { cashoutFixtureAction, cashoutFixtureWithdraw } from "./cashout-fixture";
import {
  actionsBody,
  basenameProfileBody,
  fundingProvidersBody,
  borrowOverviewBody,
  sessionBody,
} from "../fixtures/bodies";
import type { TradeDirection } from "../../../shared/trading/contract";

const recentRecipient = "0x2211d1d0020daea8039e46cf1367962070d77da9";
const syntheticUsdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const syntheticBtc = "0x2222222222222222222222222222222222222222" as const;

export function tradePrepareFixture(direction: TradeDirection) {
  const buy = direction === "buy";
  const from = buy
    ? { id: "usdc", symbol: "USDC", decimals: 6, address: syntheticUsdc }
    : { id: "cbbtc", symbol: "cbBTC", decimals: 8, address: syntheticBtc };
  const to = buy
    ? { id: "cbbtc", symbol: "cbBTC", decimals: 8, address: syntheticBtc }
    : { id: "usdc", symbol: "USDC", decimals: 6, address: syntheticUsdc };
  const spend = buy ? "1000000" : "50000";
  const receive = buy ? "1400" : "35000000";
  const expiresAt = new Date(Date.now() + 110_000).toISOString();
  const owner = { subject: sessionBody.user.subject, address: sessionBody.smartAccount.address, chainId: 8453, accountProvider: "cdp-embedded" };
  return {
    id: `synthetic-trade-${direction}`, owner, kind: "trade", title: buy ? "Buy Bitcoin" : "Sell Bitcoin",
    createdAt: new Date().toISOString(), expiresAt,
    calls: [{ to: syntheticUsdc, data: "0x", value: "0" }],
    amounts: [
      { assetId: from.id, symbol: from.symbol, decimals: from.decimals, amountBaseUnits: spend, direction: "spend" },
      { assetId: to.id, symbol: to.symbol, decimals: to.decimals, amountBaseUnits: receive, direction: "receive", estimated: true },
    ],
    warnings: [],
    signing: { signer: "cdp-embedded", evmAccount: owner.address, typedData: { domain: {}, types: {}, primaryType: "CoinbaseSmartWalletMessage", message: {} } },
    metadata: {
      product: "trade", provider: "cdp-swaps", direction, network: { name: "Base", chainId: 8453 },
      fromAsset: from, toAsset: to, fromAmountBaseUnits: spend, expectedToAmountBaseUnits: receive,
      minimumToAmountBaseUnits: buy ? "1386" : "34650000", slippageBps: 100,
      fees: [], approval: "permit2-exact", quoteBlockNumber: "12345678",
      quotedAt: new Date().toISOString(), permitDeadline: String(Math.floor(Date.parse(expiresAt) / 1000) + 30),
      executionDeadline: String(Math.floor(Date.parse(expiresAt) / 1000) + 30),
    },
  };
}

export function fixtureRoutes() {
  const balances = balancesSnapshot("US");
  const borrowOverview = borrowOverviewBody();
  const prepared = preparedSendFixtureAction(recentRecipient);
  return [
    ["**/api/session", sessionBody],
    ["**/api/account/country-preference", { version: COUNTRY_PREFERENCE_VERSION, regionId: null }],
    ["**/api/balances**", {
      ...balances,
      holdings: balances.holdings.map((holding) => ({ ...holding, imageUrl: undefined })),
    }],
    ["**/api/actions", { actions: [...actionsBody.actions, cashoutFixtureAction] }],
    ["**/api/actions/prepare", prepared],
    ["**/api/trades", { version: 1, status: "available" }],
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
    ["**/api/activity**", {}],
    ["**/api/borrow", borrowOverview],
    ...borrowOverview.opportunities.flatMap((entry) => entry.availability.status === "available"
      ? [[`**/api/borrow/markets/${entry.market.id}`, entry.availability.snapshot] as const]
      : []),
    ["**/api/client-performance", { ok: true }],
    ["**/api/funding/providers**", fundingProvidersBody],
    ["**/api/transfers/recipient-name**", { version: 1, name: "example.base.eth", address: recentRecipient }],
    ["**/api/transfers/recent-recipients**", {
      version: 1, recipients: [{ address: recentRecipient, name: "example.base.eth" }],
    }],
    ["**/api/basename-profile**", basenameProfileBody],
  ] as const;
}

export function requiresSignedInFixture(surfaceId: string): boolean {
  return !new Set(["landing", "sign-in", "access-gate", "coverage", "dev-ui"]).has(surfaceId);
}
