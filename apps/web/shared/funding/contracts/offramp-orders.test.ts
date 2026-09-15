import { describe, expect, test } from "bun:test";
import { OFFRAMP_ORDERS_VERSION, readCashoutOrders } from "./offramp-orders";

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
  test("parses the versioned UI projection with an unavailable observed handle", () => {
    expect(readCashoutOrders({ version: OFFRAMP_ORDERS_VERSION, orders: [order] })).toEqual([order]);
  });

  test("rejects the wrong version and strips non-contract fields", () => {
    expect(readCashoutOrders({ version: 1, orders: [order] })).toEqual([]);
    expect(readCashoutOrders({ version: OFFRAMP_ORDERS_VERSION, orders: [{ ...order, owner: "secret", payeeHash: "0xhash" }] })[0]).not.toHaveProperty("owner");
    expect(readCashoutOrders({ version: OFFRAMP_ORDERS_VERSION, orders: [{ ...order, canonicalHandle: undefined }] })).toEqual([]);
  });
});
