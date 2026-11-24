import { expect, test } from "bun:test";
import { requireAddress } from "@/shared/chain/hex";
import type { MoneyActionOwner, PreparedMoneyAction } from "@/shared/money-actions/types";
import { moneyConfirmFacts } from "./confirm-facts";

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
