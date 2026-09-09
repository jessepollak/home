import { describe, expect, test } from "bun:test";
import { formatAddress, isAddress } from "./address";

describe("formatAddress", () => {
  test("condenses a 20-byte address to first6…last6", () => {
    expect(formatAddress("0x12a4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaac19fab")).toBe(
      "0x12a4…c19fab",
    );
    expect(formatAddress("0x1111111111111111111111111111111111111111")).toBe(
      "0x1111…111111",
    );
  });

  test("trims surrounding space and leaves non-addresses unchanged", () => {
    expect(formatAddress("  0x2222222222222222222222222222222222222222  ")).toBe(
      "0x2222…222222",
    );
    expect(formatAddress("0x1234")).toBe("0x1234");
    expect(formatAddress("not-an-address")).toBe("not-an-address");
  });

  test("isAddress requires a 20-byte hex value", () => {
    expect(isAddress("0x2222222222222222222222222222222222222222")).toBe(true);
    expect(isAddress("0x1234")).toBe(false);
    expect(isAddress("")).toBe(false);
  });
});
