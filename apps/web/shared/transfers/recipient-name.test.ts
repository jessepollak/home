import { describe, expect, test } from "bun:test";
import {
  normalizeResolvedRecipientAddress,
  normalizeTransferRecipientName,
} from "./recipient-name";

describe("normalizeTransferRecipientName", () => {
  test("normalizes Basenames and ENS names, ignoring case and surrounding space", () => {
    expect(normalizeTransferRecipientName("example.base.eth")).toBe("example.base.eth");
    expect(normalizeTransferRecipientName("  EXAMPLE.BASE.ETH  ")).toBe("example.base.eth");
    expect(normalizeTransferRecipientName("vitalik.eth")).toBe("vitalik.eth");
    expect(normalizeTransferRecipientName("sub.example.base.eth")).toBe("sub.example.base.eth");
  });

  test.each([
    ["", "empty"],
    ["   ", "blank"],
    ["example", "no suffix"],
    ["example.base", "not an eth name"],
    ["ETH", "suffix only"],
    [".eth", "empty label"],
    ["example..base.eth", "empty inner label"],
    ["example.base.eth.", "trailing dot"],
    ["example base.eth", "space inside"],
    ["0x2211d1D0020DAEA8039E46Cf1367962070d77DA9", "address"],
    [`${"a".repeat(256)}.eth`, "over length"],
  ])("refuses %p (%s)", (value) => {
    expect(normalizeTransferRecipientName(value)).toBeNull();
  });

  test("refuses values that are not strings", () => {
    expect(normalizeTransferRecipientName(undefined)).toBeNull();
    expect(normalizeTransferRecipientName(null)).toBeNull();
    expect(normalizeTransferRecipientName({ name: "example.base.eth" })).toBeNull();
  });
});

describe("normalizeResolvedRecipientAddress", () => {
  test("checksums a resolved address and ignores surrounding space", () => {
    expect(normalizeResolvedRecipientAddress("0x2211D1D0020DAEA8039E46CF1367962070D77DA9"))
      .toBe("0x2211d1D0020DAEA8039E46Cf1367962070d77DA9");
    expect(normalizeResolvedRecipientAddress(" 0x2211d1D0020DAEA8039E46Cf1367962070d77DA9 "))
      .toBe("0x2211d1D0020DAEA8039E46Cf1367962070d77DA9");
  });

  test.each([
    "0x0000000000000000000000000000000000000000",
    "0x1234",
    "example.base.eth",
    "",
    42,
    null,
  ])("refuses %p", (value) => {
    expect(normalizeResolvedRecipientAddress(value)).toBeNull();
  });
});
