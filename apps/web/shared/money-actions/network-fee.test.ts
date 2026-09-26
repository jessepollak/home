import { expect, test } from "bun:test";
import { NETWORK_FEE_ETH_UNFUNDED_MESSAGE, networkFeeErrorMessage } from "./network-fee";

test("maps only network fee errors to actionable fee messages", () => {
  expect(networkFeeErrorMessage({ code: "NETWORK_FEE_UNFUNDED", serverMessage: NETWORK_FEE_ETH_UNFUNDED_MESSAGE })).toBe("Add ETH to cover this account's network fee.");
  expect(networkFeeErrorMessage({ code: "NETWORK_FEE_UNFUNDED", serverMessage: "Different copy" })).toBe("Add USDC to cover the network fee.");
  expect(networkFeeErrorMessage({ code: "NETWORK_FEE_UNFUNDED" })).toBe("Add USDC to cover the network fee.");
  expect(networkFeeErrorMessage({ code: "NETWORK_FEE_UNAVAILABLE", serverMessage: "Fee service is down." })).toBe("Fee service is down.");
  expect(networkFeeErrorMessage({ code: "NETWORK_FEE_UNAVAILABLE", serverMessage: 502 })).toBe("The network fee could not be checked. Try again.");
  expect(networkFeeErrorMessage({ code: "NETWORK_FEE_UNAVAILABLE" })).toBe("The network fee could not be checked. Try again.");
  expect(networkFeeErrorMessage({ code: "CASHOUT_UNAVAILABLE", serverMessage: "Not a fee error" })).toBeNull();
  expect(networkFeeErrorMessage(null)).toBeNull();
  expect(networkFeeErrorMessage(new Error("no code"))).toBeNull();
});
