import { describe, expect, it } from "bun:test";
import { getAddress } from "viem";
import { parseAddress, parseHash32 } from "./hex";

const address = "0xabcdef0123456789abcdef0123456789abcdef01";
const checksummed = getAddress(address);

describe("parseAddress", () => {
  it("lowercases valid checksummed addresses and leaves lowercase addresses unchanged", () => {
    expect(checksummed).not.toBe(address);
    expect<string | null>(parseAddress(checksummed)).toBe(address);
    expect<string | null>(parseAddress(address)).toBe(address);
  });

  it("rejects bad checksums and malformed addresses", () => {
    const badChecksum = checksummed.replace(/[A-F]/, (letter) => letter.toLowerCase());
    expect(badChecksum).not.toBe(checksummed);
    for (const value of [
      `0x${"ABCDEF01".repeat(5)}`,
      badChecksum,
      `0x${"a".repeat(39)}`,
      `0x${"a".repeat(41)}`,
      "a".repeat(40),
      `0x${"g".repeat(40)}`,
      42,
      null,
    ]) {
      expect(parseAddress(value)).toBeNull();
    }
  });
});

describe("parseHash32", () => {
  it("lowercases mixed-case 32-byte hashes", () => {
    const mixedCase = `0x${"aB".repeat(32)}`;
    expect<string | null>(parseHash32(mixedCase)).toBe(mixedCase.toLowerCase());
  });

  it("rejects malformed hashes and addresses", () => {
    for (const value of [
      `0x${"a".repeat(63)}`,
      `0x${"a".repeat(65)}`,
      `0x${"g".repeat(64)}`,
      `0x${"a".repeat(40)}`,
      "a".repeat(64),
      42,
    ]) {
      expect(parseHash32(value)).toBeNull();
    }
  });
});
