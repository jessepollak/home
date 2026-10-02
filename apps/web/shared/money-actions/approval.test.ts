import { expect, test } from "bun:test";
import { getAddress } from "viem";
import { decodeMoneyActionApproval } from "./approval";
import type { MoneyActionCall } from "./types";

test("approval calldata canonicalizes checksummed token and spender and rejects invalid token", () => {
  const token = getAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  const spender = getAddress("0x940181a94a35a4569e4529a3cdfb74e38fd98631");
  const data = `0x095ea7b3${"0".repeat(24)}${spender.slice(2)}${"0".repeat(63)}1` as const;
  const call: MoneyActionCall = { to: token, data, value: "0", approval: { assetId: "token", spender } };
  const decoded = decodeMoneyActionApproval(call);
  expect(String(decoded?.token)).toBe(token.toLowerCase());
  expect(String(decoded?.spender)).toBe(spender.toLowerCase());
  expect(decodeMoneyActionApproval({ ...call, to: token.replace("A", "a") as `0x${string}` })).toBeNull();
  expect(decodeMoneyActionApproval({ ...call, data: "0x095ea7b3" })).toBeNull();
  const upperData = `0x095ea7b3${"0".repeat(24)}${spender.slice(2).toUpperCase()}${"0".repeat(63)}1` as const;
  expect(String(decodeMoneyActionApproval({ ...call, data: upperData })?.spender)).toBe(spender.toLowerCase());
});
