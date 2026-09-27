import { describe, expect, test } from "bun:test";
import { classifyProviderRefusal } from "./provider-refusal";
import { tradePreparationResponse } from "./prepare";
import { TradePreparationError } from "./permit2";

const buy = "The token you're trying to buy isn't authorized for this swap.";
const sell = "The token you're trying to sell isn't authorized for this swap.";
const body = (errorMessage: string) => ({ errorType: "invalid_request", errorMessage });

describe("provider refusal", () => {
  test("maps a not-routed failure to public-safe response data", () => {
    expect(tradePreparationResponse(new TradePreparationError("token-not-routed"))).toEqual({
      code: "TRADE_NOT_ROUTED", message: "This asset can't be traded in Home yet.", status: 422,
    });
  });
  test.each([buy, sell, buy.replaceAll("'", "’"), sell.replaceAll("'", "’")])("classifies only the token authorization refusal: %s", (message) => {
    expect(classifyProviderRefusal(400, body(message))).toBe("token-not-routed");
  });
  test.each([
    [400, body("Invalid amount"), "route-unavailable"],
    [404, { errorType: "not_found", errorMessage: buy }, "route-unavailable"],
    [400, body("The token you're trying to buy isn't authorized for this swap. Extra"), "route-unavailable"],
    [422, { errorType: "invalid_request", errorMessage: "below threshold" }, "below-minimum"],
  ] as const)("classifies a CDP refusal without leaking provider text", (status, response, reason) => {
    expect(classifyProviderRefusal(status, response)).toBe(reason);
  });
  test.each([
    [403, body(buy)], [500, body(sell)],
    [400, null], [400, "error"], [400, { errorType: "invalid_request" }],

  ])("does not classify non-CDP or outage errors: %s", (status, response) => {
    expect(classifyProviderRefusal(status as number, response)).toBeNull();
  });
});
