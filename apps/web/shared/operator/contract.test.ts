import { expect, test } from "bun:test";
import { getAddress } from "viem";
import { parseOperatorSessionResponse } from "./contract";

test("administrator session canonicalizes valid checksum and rejects malformed addresses", () => {
  const address = getAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  expect(String(parseOperatorSessionResponse({ version: 1, operator: { address } })?.operator.address)).toBe(address.toLowerCase());
  for (const bad of [address.replace("A", "a"), "0x1234", "0xnothex"]) {
    expect(parseOperatorSessionResponse({ version: 1, operator: { address: bad } })).toBeNull();
  }
});
