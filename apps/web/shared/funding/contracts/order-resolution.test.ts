import { describe, expect, test } from "bun:test";
import {
  FUNDING_ORDER_RESOLUTION_VERSION,
  parseResolveFundingOrderRequest,
  readResolveFundingOrderResponse,
} from "./order-resolution";

const order = {
  id: "11111111-1111-4111-8111-111111111111",
  providerId: "idrx",
  state: "cancelled",
  fiatAmount: "20000",
  providerStatus: null,
  instructions: null,
};

describe("funding order resolution contract", () => {
  test("accepts only the versioned empty resolution command", () => {
    expect(FUNDING_ORDER_RESOLUTION_VERSION).toBe(1);
    expect(parseResolveFundingOrderRequest({ version: 1 })).toEqual({ version: 1 });
    expect(parseResolveFundingOrderRequest({})).toBeNull();
    expect(parseResolveFundingOrderRequest({ version: 2 })).toBeNull();
    expect(parseResolveFundingOrderRequest({
      version: 1,
      state: "cancelled",
    })).toBeNull();
  });

  test("reads only a versioned order response", () => {
    expect(readResolveFundingOrderResponse({ version: 1, order })).toEqual({ version: 1, order });
    expect(readResolveFundingOrderResponse({ version: 2, order })).toBeNull();
    expect(readResolveFundingOrderResponse({
      version: 1,
      order: { id: order.id },
    })).toBeNull();
  });
});
