import { describe, expect, test } from "bun:test";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { ACTIVITY_CONTRACT_VERSION, parseActivityPage } from "@/shared/activity/contract";
import { balancesSnapshotFixture } from "@/shared/balances/fixtures";
import { parseBorrowOverview } from "@/shared/borrowing/contract";
import { isRecord } from "@/shared/guards";
import { borrowOverviewBody } from "@/tests/browser/fixtures/bodies";
import { queryScopes } from "./scopes";

const ownerKey = dataOwnerKey({
  user: { subject: "subject-a" },
  smartAccount: { address: balancesSnapshotFixture.owner.address, chainId: 8453 },
  accountProvider: "cdp-embedded",
});

const fundingOrder = { id: "order-1", providerId: "provider-1", state: "confirmed", fiatAmount: "10", providerStatus: null, instructions: null };
const fullFundingOrder = {
  ...fundingOrder, region: "US", assetId: "base:usdc", paymentMethod: "ach",
  quote: { providerQuoteId: "provider-quote", fiatAmount: "10", tokenAmountAtomic: "10000000", fees: [{ label: "Fee", amount: "0.50", currency: "USD" }], feesKnown: true, expiresAt: "2099-01-01T00:00:00.000Z" },
  quoteToken: "signed-quote", sandbox: false, expectedTokenAmountAtomic: "10000000",
  fees: [{ label: "Fee", amount: "0.50", currency: "USD" }], expiresAt: null,
  transactionHash: `0x${"aB".repeat(32)}`, createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z",
};

const activityWindowEnd = "2026-09-07T12:00:00.000Z";
const activityWallet = "0x1111111111111111111111111111111111111111" as const;

function parsedActivityPage() {
  return parseActivityPage({
    version: ACTIVITY_CONTRACT_VERSION,
    walletAddress: activityWallet,
    chainId: 8453,
    window: { from: "2026-08-07T12:00:00.000Z", to: activityWindowEnd },
    currency: "USD",
    transfers: [{
      id: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913:event-1",
      logId: "event-1",
      chainId: 8453,
      assetId: "usdc",
      tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      tokenImageUrl: null,
      walletAddress: activityWallet,
      fromAddress: "0x2222222222222222222222222222222222222222",
      toAddress: activityWallet,
      direction: "incoming",
      amountBaseUnits: "1000001",
      blockNumber: "20",
      blockHash: `0x${"b".repeat(64)}`,
      transactionHash: `0x${"d".repeat(64)}`,
      logIndex: "2",
      blockTimestamp: "2026-09-07T11:00:00.000Z",
      valuation: { status: "unpriced", currency: "USD", reason: "no-recent-close" },
    }],
    nextCursor: null,
    source: {
      provider: "cdp-sql", cached: false, stale: false,
      executionTimestamp: "2026-09-07T11:59:00.000Z", executionTimeMs: 2, fetchedAt: activityWindowEnd,
    },
  }, {
    user: { subject: "subject-a" },
    smartAccount: { address: activityWallet, chainId: 8453 },
    accountProvider: "cdp-embedded",
  }, activityWindowEnd, "USD");
}

const tradeToken = {
  assetId: "usdc",
  address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  symbol: "USDC",
  decimals: 6,
};

const validEntries = [
  { scope: "balances", data: balancesSnapshotFixture, parts: ["US"] },
  { scope: "funding-open-order", data: { order: null } },
  { scope: "funding-open-order", data: { order: fundingOrder } },
  { scope: "funding-order", data: fundingOrder, parts: [fundingOrder.id] },
  { scope: "funding-provider-customers", data: { customers: [] }, parts: ["US"] },
  { scope: "funding-providers", data: { providers: [] }, parts: ["US"] },
  { scope: "stock-trade-eligibility", data: { version: 1, buy: "eligible", sell: "eligible" } },
  { scope: "trade-availability", data: { version: 2, status: "unavailable", reason: "asset-unsupported" } },
] as const;

describe("restored owner cache scope guards", () => {
  test("every persisted owner scope rejects malformed containers", () => {
    const ownerScopes = Object.entries(queryScopes).filter(([, policy]) =>
      policy.audience === "owner" && policy.persistence === "owner");
    expect(ownerScopes).toHaveLength(10);
    for (const [scope, policy] of ownerScopes) {
      if (policy.audience !== "owner" || policy.persistence !== "owner") continue;
      expect(typeof policy.validateRestored).toBe("function");
      const entry = { ownerKey, queryKey: [ownerKey, scope, "US"] };
      for (const data of [null, "text", 42, [], {}]) {
        expect(policy.validateRestored(data, entry)).toBeNull();
      }
    }
  });

  test("accepts representative live-compatible values", () => {
    for (const { scope, data, ...rest } of validEntries) {
      const policy = queryScopes[scope];
      const trusted = policy.validateRestored(data, { ownerKey, queryKey: [ownerKey, scope, ...("parts" in rest ? rest.parts : [])] });
      expect(trusted?.data).toEqual(data);
    }
  });

  test("rejects a balances snapshot bound to another owner or unsupported region", () => {
    const policy = queryScopes.balances;
    const otherOwner = dataOwnerKey({
      user: { subject: "subject-a" },
      smartAccount: { address: "0x2222222222222222222222222222222222222222", chainId: 8453 },
      accountProvider: "cdp-embedded",
    });
    expect(policy.validateRestored(balancesSnapshotFixture, { ownerKey: otherOwner, queryKey: [otherOwner, "balances", "US"] })).toBeNull();
    expect(policy.validateRestored(balancesSnapshotFixture, { ownerKey, queryKey: [ownerKey, "balances", "unknown"] })).toBeNull();
  });

  test("restores the parser's activity pages and rejects a malformed member or overlap", () => {
    const policy = queryScopes.activity;
    const entry = { ownerKey, queryKey: [ownerKey, "activity", activityWindowEnd, "USD"] };
    const page = parsedActivityPage();
    expect(policy.validateRestored({ pages: [page], pageParams: [null] }, entry)?.data)
      .toEqual({ pages: [page], pageParams: [null] });
    const malformed = { pages: [{ ...page, transfers: [{ ...page.transfers[0], transactionHash: null }] }], pageParams: [null] };
    expect(policy.validateRestored(malformed, entry)).toBeNull();
    const foreign = { pages: [{ ...page, walletAddress: "0x2222222222222222222222222222222222222222" }], pageParams: [null] };
    expect(policy.validateRestored(foreign, entry)).toBeNull();
    const repaired = policy.validateRestored({ pages: [{ ...page, transfers: [{ ...page.transfers[0], valuation: null }] }], pageParams: [null] }, entry);
    const restoredData = repaired?.data;
    const restoredTransfer = isRecord(restoredData) && Array.isArray(restoredData.pages) && isRecord(restoredData.pages[0]) &&
      Array.isArray(restoredData.pages[0].transfers) ? restoredData.pages[0].transfers[0] : null;
    expect(isRecord(restoredTransfer) && isRecord(restoredTransfer.valuation)).toBe(true);
    const overlap = { pages: [page, { ...page, transfers: [{ ...page.transfers[0], amountBaseUnits: "2000000" }], nextCursor: null }], pageParams: [null, null] };
    expect(policy.validateRestored(overlap, entry)).toBeNull();
    expect(policy.validateRestored({ pages: [page], pageParams: [{ bad: true }] }, entry)).toBeNull();
  });

  test("rejects activity pages after a terminal cursor while accepting a valid cursor chain", () => {
    const policy = queryScopes.activity;
    const entry = { ownerKey, queryKey: [ownerKey, "activity", activityWindowEnd, "USD"] };
    const terminal = parsedActivityPage();
    const extra = { ...terminal, transfers: [] };
    expect(policy.validateRestored({ pages: [terminal, extra], pageParams: [null, null] }, entry)).toBeNull();

    const first = { ...terminal, nextCursor: "next-page" };
    expect(policy.validateRestored({ pages: [first, terminal, extra], pageParams: [null, "next-page", null] }, entry)).toBeNull();
    expect(policy.validateRestored({ pages: [first, extra], pageParams: [null, "next-page"] }, entry)?.data)
      .toEqual({ pages: [first, extra], pageParams: [null, "next-page"] });
  });


  test("rejects a trade-availability response bound to another asset", () => {
    const policy = queryScopes["trade-availability"];
    const response = { version: 2, status: "available", token: tradeToken, buy: "available", balanceBaseUnits: "100000" };
    expect(policy.validateRestored(response, { ownerKey, queryKey: [ownerKey, "trade-availability", "usdc"] })?.data).toEqual(response);
    expect(policy.validateRestored(response, { ownerKey, queryKey: [ownerKey, "trade-availability", "cbbtc"] })).toBeNull();
  });

  test("accepts a full funding order in both restored scopes and preserves region binding", () => {
    const orderEntry = { ownerKey, queryKey: [ownerKey, "funding-order", fundingOrder.id] };
    const openEntry = { ownerKey, queryKey: [ownerKey, "funding-open-order", "US"] };
    expect(queryScopes["funding-order"].validateRestored(fullFundingOrder, orderEntry)?.data).toEqual(fullFundingOrder);
    expect(queryScopes["funding-open-order"].validateRestored({ order: fullFundingOrder }, openEntry)?.data).toEqual({ order: fullFundingOrder });
    expect(queryScopes["funding-open-order"].validateRestored({ order: { ...fullFundingOrder, region: "AR" } }, openEntry)).toBeNull();
  });

  test.each([
    ["id", { id: null }],
    ["providerId", { providerId: 1 }],
    ["region", { region: 7 }],
    ["assetId", { assetId: 123 }],
    ["paymentMethod", { paymentMethod: 5 }],
    ["state", { state: {} }],
    ["fiatAmount", { fiatAmount: "not-money" }],
    ["quote", { quote: {} }],
    ["quote provider id", { quote: { ...fullFundingOrder.quote, providerQuoteId: null } }],
    ["undefined quote provider id", { quote: { ...fullFundingOrder.quote, providerQuoteId: undefined } }],
    ["quote fee certainty", { quote: { ...fullFundingOrder.quote, feesKnown: "true" } }],
    ["undefined quote fee certainty", { quote: { ...fullFundingOrder.quote, feesKnown: undefined } }],
    ["quote fiat amount", { quote: { ...fullFundingOrder.quote, fiatAmount: 10 } }],
    ["quote token amount", { quote: { ...fullFundingOrder.quote, tokenAmountAtomic: null } }],
    ["quote expiry", { quote: { ...fullFundingOrder.quote, expiresAt: null } }],
    ["quote fees", { quote: { ...fullFundingOrder.quote, fees: "oops" } }],
    ["quote fee", { quote: { ...fullFundingOrder.quote, fees: [{ label: "Fee", amount: 1, currency: "USD" }] } }],
    ["quoteToken", { quoteToken: 1 }],
    ["sandbox", { sandbox: "false" }],
    ["expectedTokenAmountAtomic", { expectedTokenAmountAtomic: "1.5" }],
    ["non-canonical atomic amount", { expectedTokenAmountAtomic: "01" }],
    ["fees", { fees: "oops" }],
    ["fee label", { fees: [{ label: 1, amount: "0.50", currency: "USD" }] }],
    ["fee amount", { fees: [{ label: "Fee", amount: 1, currency: "USD" }] }],
    ["fee currency", { fees: [{ label: "Fee", amount: "0.50", currency: null }] }],
    ["non-decimal fee amount", { fees: [{ label: "Fee", amount: "not-money", currency: "USD" }] }],
    ["expiresAt", { expiresAt: 1 }],
    ["providerStatus", { providerStatus: undefined }],
    ["instructions", { instructions: {} }],
    ["sensitive instructions", { instructions: { kind: "redirect", url: "https://provider.example/pay" } }],
    ["transactionHash", { transactionHash: `0x${"g".repeat(64)}` }],
    ["short transactionHash", { transactionHash: "0x123" }],
    ["createdAt", { createdAt: null }],
    ["updatedAt", { updatedAt: 7 }],
  ])("rejects malformed funding %s in both restored scopes", (_field, override) => {
    const order = { ...fullFundingOrder, ...override };
    expect(queryScopes["funding-order"].validateRestored(order, { ownerKey, queryKey: [ownerKey, "funding-order", fundingOrder.id] })).toBeNull();
    expect(queryScopes["funding-open-order"].validateRestored({ order }, { ownerKey, queryKey: [ownerKey, "funding-open-order", "US"] })).toBeNull();
  });

  test.each(["region", "assetId", "paymentMethod", "quote", "quoteToken", "sandbox", "expectedTokenAmountAtomic", "fees", "expiresAt", "transactionHash", "createdAt", "updatedAt"])("accepts undefined optional funding %s in both restored scopes", (field) => {
    const order = { ...fullFundingOrder, [field]: undefined };
    expect(queryScopes["funding-order"].validateRestored(order, { ownerKey, queryKey: [ownerKey, "funding-order", fundingOrder.id] })?.data).toEqual(order);
    expect(queryScopes["funding-open-order"].validateRestored({ order }, { ownerKey, queryKey: [ownerKey, "funding-open-order", "US"] })?.data).toEqual({ order });
  });

  test("rejects a funding order whose presenter fields are wrong-shaped", () => {
    const policy = queryScopes["funding-order"];
    const orderEntry = { ownerKey, queryKey: [ownerKey, "funding-order", fundingOrder.id] };
    expect(policy.validateRestored(fundingOrder, orderEntry)).not.toBeNull();
    expect(policy.validateRestored({ ...fundingOrder, fees: "bad" }, orderEntry)).toBeNull();
    expect(policy.validateRestored({ ...fundingOrder, fees: [{ label: "Fee", amount: "not-money", currency: "USD" }] }, orderEntry)).toBeNull();
    expect(policy.validateRestored({ ...fundingOrder, expectedTokenAmountAtomic: "1.5" }, orderEntry)).toBeNull();
    expect(policy.validateRestored({ ...fundingOrder, fees: [{ label: "Fee", amount: "0.50", currency: "USD" }] }, orderEntry)).not.toBeNull();
    expect(policy.validateRestored({ ...fundingOrder, fiatAmount: "not-money" }, orderEntry)).toBeNull();
    expect(queryScopes["funding-open-order"].validateRestored({ order: { ...fundingOrder, fiatAmount: "1.2.3" } }, { ownerKey, queryKey: [ownerKey, "funding-open-order", "US"] })).toBeNull();
    expect(policy.validateRestored({ ...fundingOrder, instructions: { kind: "redirect", url: "https://provider.example/pay" } }, orderEntry)).toBeNull();
    expect(policy.validateRestored(fundingOrder, { ownerKey, queryKey: [ownerKey, "funding-order", "other-order"] })).toBeNull();
    expect(queryScopes["funding-open-order"].validateRestored({ order: { ...fundingOrder, instructions: { kind: "redirect", url: "https://provider.example/pay" } } }, { ownerKey, queryKey: [ownerKey, "funding-open-order", "US"] })).toBeNull();
    const customer = { providerId: "provider-1", region: "AR", state: "verified", verificationStartedAt: null, updatedAt: "2026-09-15T12:00:00.000Z" };
    expect(queryScopes["funding-provider-customers"].validateRestored({ customers: [customer] }, { ownerKey, queryKey: [ownerKey, "funding-provider-customers", "US"] })).toBeNull();
    expect(queryScopes["funding-provider-customers"].validateRestored({ customers: [customer] }, { ownerKey, queryKey: [ownerKey, "funding-provider-customers", "AR"] })?.data).toEqual({ customers: [customer] });
  });

  test("accepts the borrow overview and market snapshot the live reads store", () => {
    const policy = queryScopes.borrow;
    const overviewEntry = { ownerKey, queryKey: [ownerKey, "borrow", "overview"] };
    const wire = borrowOverviewBody({ openMarketId: null });
    const overview = parseBorrowOverview(wire, wire.owner.address)!;
    expect(policy.validateRestored(wire, overviewEntry)?.data).toEqual(overview);
    expect(policy.validateRestored(overview, overviewEntry)?.data).toEqual(overview);
    expect(policy.validateRestored({ ...overview, opportunities: [] }, overviewEntry)).toBeNull();
    for (const queryKey of [
      [ownerKey, "borrow"],
      [ownerKey, "borrow", "detail", "market-1"],
      [ownerKey, "borrow", "overview", "extra"],
      [ownerKey, "borrow-market", "overview"],
    ]) expect(policy.validateRestored(overview, { ownerKey, queryKey })).toBeNull();
    const available = overview.opportunities.flatMap((opportunity) =>
      opportunity.availability.status === "available" ? [opportunity.availability.snapshot] : []);
    expect(available.length).toBeGreaterThan(0);
    const marketPolicy = queryScopes["borrow-market"];
    const detailEntry = { ownerKey, queryKey: [ownerKey, "borrow-market", available[0]?.market.id] };
    expect(marketPolicy.validateRestored(available[0], detailEntry)?.data).toEqual(available[0]);
    expect(marketPolicy.validateRestored({ ...available[0], walletAddress: "0x2222222222222222222222222222222222222222" }, detailEntry)).toBeNull();
    expect(marketPolicy.validateRestored(available[1], detailEntry)).toBeNull();
    expect(marketPolicy.validateRestored(overview, detailEntry)).toBeNull();
    expect(policy.validateRestored(available[0], detailEntry)).toBeNull();
    for (const queryKey of [
      [ownerKey, "borrow-market"],
      [ownerKey, "borrow-market", "other-market"],
      [ownerKey, "borrow-market", available[0]?.market.id, "extra"],
      [ownerKey, "borrow", "detail", available[0]?.market.id],
      [ownerKey, "borrow", "overview"],
    ]) expect(marketPolicy.validateRestored(available[0], { ownerKey, queryKey })).toBeNull();
  });
});
