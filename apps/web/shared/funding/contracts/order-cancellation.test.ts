import { expect, test } from "bun:test";
import { FUNDING_ORDER_CANCELLATION_VERSION, parseCancelFundingOrderRequest, readCancelFundingOrderResponse } from "./order-cancellation";

const order = { id: "order", providerId: "fixture", state: "abandoned", fiatAmount: "10", providerStatus: "PENDING", instructions: null };

test("cancellation request accepts exactly version 1", () => {
  expect(parseCancelFundingOrderRequest({ version: FUNDING_ORDER_CANCELLATION_VERSION })).toEqual({ version: 1 });
  for (const invalid of [null, [], {}, { version: 2 }, { version: "1" }, { version: 1, reason: "owner" }]) {
    expect(parseCancelFundingOrderRequest(invalid)).toBeNull();
  }
});

test("cancellation response requires a valid abandoned order and optional valid reason", () => {
  for (const abandonReason of [undefined, null, "owner", "timed-out"] as const) {
    const body = { version: 1 as const, order: { ...order, ...(abandonReason === undefined ? {} : { abandonReason }) } };
    expect(readCancelFundingOrderResponse(body)).toEqual(body);
  }
  for (const invalid of [null, {}, { version: 2, order }, { version: 1, order: { ...order, state: "cancelled" } }, { version: 1, order: { ...order, abandonReason: "provider" } }, { version: 1, order: { ...order, fiatAmount: "invalid" } }]) {
    expect(readCancelFundingOrderResponse(invalid)).toBeNull();
  }
});
