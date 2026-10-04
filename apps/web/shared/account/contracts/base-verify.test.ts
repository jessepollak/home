import { expect, test } from "bun:test";
import { getAddress } from "viem";
import { parseNativeBaseSession } from "./base-verify";

test("native Base session canonicalizes valid checksum and rejects invalid addresses", () => {
  const address = getAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  const input = { version: 1, user: { subject: "owner" }, smartAccount: { address, chainId: 8453 }, accountProvider: "base-account" };
  expect(String(parseNativeBaseSession(input)?.smartAccount.address)).toBe(address.toLowerCase());
  for (const bad of [address.replace("A", "a"), "0x1234", "0xnothex"]) {
    expect(parseNativeBaseSession({ ...input, smartAccount: { ...input.smartAccount, address: bad } })).toBeNull();
  }
});
