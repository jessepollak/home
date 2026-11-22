import { expect, test } from "bun:test";
import { requireAddress } from "@/shared/chain/hex";
import type { MoneyActionOwner, PreparedMoneyAction } from "@/shared/money-actions/types";
import { moneyConfirmFacts, type MoneyConfirmFacts } from "./confirm-facts";
import type { MoneyConfirmSummary } from "./confirm-summary";

const owner = {
  subject: "confirm-facts-owner",
  address: "0x1111111111111111111111111111111111111111",
  chainId: 8453,
  accountProvider: "cdp-embedded",
} satisfies MoneyActionOwner;
const network = { name: "Base", chainId: 8453 } as const;
const fee = { payment: "native" } as const;
const contract = requireAddress(owner.address);

const savingsDeposit = {
  id: "confirm-facts-savings-deposit",
  kind: "savings-deposit",
  title: "Deposit USDC",
  calls: [],
  amounts: [],
  warnings: [],
  createdAt: "2026-09-23T00:00:00.000Z",
  expiresAt: "2099-09-23T00:00:00.000Z",
  owner,
  metadata: {
    product: "savings",
    operation: "deposit",
    vaultAddress: contract,
    vaultName: "Savings",
    network,
    feeWad: "0",
    limitBaseUnits: "5000000",
    previewSharesBaseUnits: "4900000000000000000",
    minimumSharesBaseUnits: "4895100000000000000",
    shareDecimals: 18,
    exchangeConstraint: "deposit-minimum-shares-or-revert",
    discoveryRate: { status: "unavailable", netApy: null, fetchedAt: null, stateAsOf: null },
    source: { blockNumber: "1", blockHash: `0x${"11".repeat(32)}`, blockTimestamp: "1789041780" },
  },
} satisfies PreparedMoneyAction;

type Assert<Condition extends true> = Condition;
type Is<Value, Target> = [Value] extends [Target] ? true : false;
type Lacks<Value, Target> = Is<Value, Target> extends true ? false : true;
type Facts = { owner: typeof owner; network: typeof network; fee: typeof fee };
type Summary = Parameters<typeof MoneyConfirmSummary>[0];
type SummaryFacts = Facts & { kind: "send" };

test("rejects confirmation facts that omit a required fact", () => {
  const rejected: readonly [
    Assert<Lacks<{ owner: typeof owner; network: typeof network; kind: "send" }, MoneyConfirmFacts>>,
    Assert<Lacks<{ owner: typeof owner; fee: typeof fee; kind: "send" }, MoneyConfirmFacts>>,
    Assert<Lacks<{ network: typeof network; fee: typeof fee; kind: "send" }, MoneyConfirmFacts>>,
    Assert<Lacks<Facts & { kind: "trade" }, MoneyConfirmFacts>>,
    Assert<Lacks<Facts & { kind: "savings-deposit" }, MoneyConfirmFacts>>,
    Assert<Lacks<Facts & { kind: "send"; slippage: { maxBps: number } }, MoneyConfirmFacts>>,
    Assert<Lacks<{ owner: typeof owner; network: { name: "Base"; chainId: 1 }; fee: typeof fee; kind: "send" }, MoneyConfirmFacts>>,
    Assert<Lacks<{ owner: typeof owner; network: { name: "Ethereum"; chainId: 8453 }; fee: typeof fee; kind: "send" }, MoneyConfirmFacts>>,
    Assert<Lacks<{ owner: typeof owner; network: { chainId: 8453 }; fee: typeof fee; kind: "send" }, MoneyConfirmFacts>>,
    Assert<Lacks<{ owner: typeof owner; network: { name: "Base" }; fee: typeof fee; kind: "send" }, MoneyConfirmFacts>>,
    Assert<Lacks<Facts & { kind: "deposit" }, MoneyConfirmFacts>>,
  ] = [true, true, true, true, true, true, true, true, true, true, true];
  expect(rejected).toEqual([true, true, true, true, true, true, true, true, true, true, true]);
});

test("accepts complete confirmation facts", () => {
  const accepted: readonly [
    Assert<Is<Facts & { kind: "send" }, MoneyConfirmFacts>>,
    Assert<Is<Facts & { kind: "savings-deposit"; slippage: { maxBps: number } }, MoneyConfirmFacts>>,
    Assert<Is<Facts & { kind: "trade"; slippage: { maxBps: number } }, MoneyConfirmFacts>>,
  ] = [true, true, true];
  expect(accepted).toEqual([true, true, true]);
});

test("requires facts on the confirmation summary", () => {
  const summary: readonly [
    Assert<Lacks<{ amount: string; lead: string; rows: readonly [] }, Summary>>,
    Assert<Is<{ amount: string; lead: string; rows: readonly []; facts: SummaryFacts }, Summary>>,
  ] = [true, true];
  expect(summary).toEqual([true, true]);
});

test("derives confirmation facts from a prepared action", () => {
  const send: PreparedMoneyAction = {
    id: "confirm-facts-send",
    kind: "send",
    title: "Send USDC",
    calls: [],
    amounts: [],
    warnings: [],
    createdAt: "2026-09-23T00:00:00.000Z",
    expiresAt: "2099-09-23T00:00:00.000Z",
    owner,
  };
  const sendFacts = moneyConfirmFacts(send);
  expect(sendFacts).toEqual({ owner, network: { name: "Base", chainId: 8453 }, fee: { payment: "native" }, kind: "send" });
  expect(sendFacts?.owner).toBe(owner);
  expect(moneyConfirmFacts({ ...send, networkFee: { payment: "usdc", token: contract, paymaster: contract, maxFeeBaseUnits: "20000", decimals: 6 } }))
    .toMatchObject({ fee: { payment: "usdc", maxFeeBaseUnits: "20000" } });

  const metadata = {
    product: "trade",
    provider: "cdp-swaps",
    direction: "buy",
    network,
    assetId: "eth",
    assetName: "Ether",
    fromAsset: { id: "usdc", symbol: "USDC", decimals: 6, address: contract },
    toAsset: { id: "eth", symbol: "ETH", decimals: 18, address: contract },
    fromAmountBaseUnits: "25000000",
    expectedToAmountBaseUnits: "10000000000000000",
    minimumToAmountBaseUnits: "9900000000000000",
    slippageBps: 100,
    fees: [],
    approval: "permit2-exact",
    quoteBlockNumber: "1",
    quotedAt: send.createdAt,
    permitDeadline: send.expiresAt,
    executionDeadline: send.expiresAt,
  } satisfies NonNullable<PreparedMoneyAction["metadata"]>;
  const trade: PreparedMoneyAction = { ...send, id: "confirm-facts-trade", kind: "trade", networkFee: fee, metadata };
  expect(moneyConfirmFacts(trade)).toEqual({ owner, network: { name: "Base", chainId: 8453 }, fee, kind: "trade", slippage: { maxBps: 100 } });
  expect(moneyConfirmFacts({
    ...trade,
    metadata: {
      product: "savings",
      operation: "deposit",
      vaultAddress: contract,
      vaultName: "Savings",
      network,
      feeWad: "0",
      limitBaseUnits: "25000000",
      previewSharesBaseUnits: "25000000",
      shareDecimals: 6,
      exchangeConstraint: "deposit-minimum-shares-or-revert",
      discoveryRate: { status: "unavailable", netApy: null, fetchedAt: null, stateAsOf: null },
      source: { blockNumber: "1", blockHash: "0x1111111111111111111111111111111111111111111111111111111111111111", blockTimestamp: send.createdAt },
    },
  }))
    .toBeNull();
  expect(moneyConfirmFacts({ ...trade, metadata: { ...metadata, slippageBps: Number.NaN } })).toBeNull();
});

test.each([
  ["4895100000000000000", 10],
  ["4900000000000000000", 0],
  ["4899999999999999999", 1],
])("derives the savings deposit ceiling for minimum %s", (minimumSharesBaseUnits, maxBps) => {
  expect(moneyConfirmFacts({
    ...savingsDeposit,
    metadata: { ...savingsDeposit.metadata, minimumSharesBaseUnits },
  })).toEqual({ owner, network, fee, kind: "savings-deposit", slippage: { maxBps } });
});

test.each([
  { minimumSharesBaseUnits: "4900000000000000001" },
  { minimumSharesBaseUnits: "0" },
  { minimumSharesBaseUnits: undefined },
  { minimumSharesBaseUnits: "1.5" },
  { minimumSharesBaseUnits: "-1" },
  { minimumSharesBaseUnits: "0x10" },
  { previewSharesBaseUnits: "0" },
  { previewSharesBaseUnits: "1e19" },
  { previewSharesBaseUnits: "" },
  { exchangeConstraint: "deposit-preview-no-minimum-shares" as const },
  { operation: "withdraw" as const },
])("rejects savings deposits with invalid execution bounds: %j", (metadata) => {
  expect(moneyConfirmFacts({
    ...savingsDeposit,
    metadata: { ...savingsDeposit.metadata, ...metadata },
  })).toBeNull();
});

test("requires savings deposit metadata without adding slippage to sends", () => {
  expect(moneyConfirmFacts({ ...savingsDeposit, metadata: undefined })).toBeNull();
  expect(moneyConfirmFacts({ ...savingsDeposit, kind: "send" })).toEqual({ owner, network, fee, kind: "send" });
});
