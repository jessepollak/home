import { describe, expect, test } from "bun:test";
import { OFFRAMP_ORDERS_VERSION, readCashoutOrdersResponse } from "./offramp-orders";

const order = {
  providerId: "peer",
  providerName: "Peer",
  assetId: "base:usdc",
  assetSymbol: "USDC",
  assetDecimals: 6,
  depositId: "0xescrow_7",
  state: "awaiting-buyer",
  platform: "cashapp",
  platformLabel: "Cash App",
  currency: "USD",
  canonicalHandle: null,
  amountAtomic: "2000000",
  remainingAmountAtomic: "2000000",
  nextActions: ["withdraw"] as const,
};

describe("offramp orders contract", () => {
  test("parses owner-scoped recovery evidence and the UI order projection", () => {
    expect(readCashoutOrdersResponse({
      version: OFFRAMP_ORDERS_VERSION,
      recoveryEligible: true,
      orders: [order],
    })).toEqual({ version: OFFRAMP_ORDERS_VERSION, recoveryEligible: true, orders: [order] });
  });

  test("rejects the wrong version or missing evidence and strips non-contract fields", () => {
    expect(readCashoutOrdersResponse({ version: 2, recoveryEligible: true, orders: [order] }).orders).toEqual([]);
    expect(readCashoutOrdersResponse({ version: OFFRAMP_ORDERS_VERSION, orders: [order] }).orders).toEqual([]);
    const parsed = readCashoutOrdersResponse({
      version: OFFRAMP_ORDERS_VERSION,
      recoveryEligible: true,
      orders: [{ ...order, owner: "secret", payeeHash: "0xhash" }],
    });
    expect(parsed.orders[0]).not.toHaveProperty("owner");
    expect(parsed.orders[0]).not.toHaveProperty("payeeHash");
    expect(readCashoutOrdersResponse({
      version: OFFRAMP_ORDERS_VERSION,
      recoveryEligible: true,
      orders: [{ ...order, canonicalHandle: undefined }],
    }).orders).toEqual([]);
  });
});
