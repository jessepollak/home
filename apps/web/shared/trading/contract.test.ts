import { expect, test } from "bun:test";
import { getAddress } from "viem";
import { isTradeErrorCode, parseTradeAvailabilityResponse } from "./contract";

test("trade error contract accepts pair unavailability without treating it as invalid input", () => {
  expect(isTradeErrorCode("TRADE_PAIR_UNAVAILABLE")).toBe(true);
  expect(isTradeErrorCode("TRADE_INVALID")).toBe(true);
  expect(isTradeErrorCode("UNKNOWN")).toBe(false);
});

test("trade availability canonicalizes valid checksum and rejects invalid wire token addresses", () => {
  const address = getAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  const input = { version: 2, status: "available", token: { assetId: "usdc", address, symbol: "USDC", decimals: 6 }, buy: "available", balanceBaseUnits: "1" };
  const parsed = parseTradeAvailabilityResponse(input);
  expect(parsed?.status).toBe("available");
  expect(String(parsed?.status === "available" ? parsed.token.address : null)).toBe(address.toLowerCase());
  for (const bad of [address.replace("A", "a"), "0x1234", "0xnothex"]) {
    expect(parseTradeAvailabilityResponse({ ...input, token: { ...input.token, address: bad } })).toBeNull();
  }
});
