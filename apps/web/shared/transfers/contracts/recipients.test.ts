import { describe, expect, test } from "bun:test";
import {
  readRecentTransferRecipientsResponse,
  readTransferRecipientNameResponse,
} from "./recipients";

describe("readTransferRecipientNameResponse", () => {
  test("reads a versioned resolution and normalizes it", () => {
    expect(readTransferRecipientNameResponse({
      version: 1,
      name: "EXAMPLE.BASE.ETH",
      address: "0x2211D1D0020DAEA8039E46CF1367962070D77DA9",
    })).toEqual({
      name: "example.base.eth",
      address: "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9",
    });
  });

  test.each([
    [{ version: 2, name: "example.base.eth", address: "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9" }, "version"],
    [{ name: "example.base.eth", address: "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9" }, "missing version"],
    [{ version: 1, name: "example", address: "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9" }, "invalid name"],
    [{ version: 1, name: "example.base.eth", address: "0x0000000000000000000000000000000000000000" }, "zero address"],
    [{ version: 1, name: "example.base.eth", address: "not-an-address" }, "invalid address"],
    [null, "null"],
    ["example.base.eth", "string"],
  ])("refuses %p (%s)", (value) => {
    expect(readTransferRecipientNameResponse(value)).toBeNull();
  });
});

describe("readRecentTransferRecipientsResponse", () => {
  test("keeps labelled and address-only recipients in order", () => {
    expect(readRecentTransferRecipientsResponse({
      version: 1,
      recipients: [
        { address: "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9", name: "EXAMPLE.BASE.ETH" },
        { address: "0x2222222222222222222222222222222222222222", name: null },
      ],
    })).toEqual([
      { address: "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9", name: "example.base.eth" },
      { address: "0x2222222222222222222222222222222222222222", name: null },
    ]);
  });

  test("deduplicates and bounds a valid response", () => {
    expect(readRecentTransferRecipientsResponse({
      version: 1,
      recipients: [
        { address: "0x2211d1d0020daea8039e46cf1367962070d77da9", name: "example.base.eth" },
        { address: "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9", name: null },
        { address: "0x2222222222222222222222222222222222222222", name: null },
        { address: "0x3333333333333333333333333333333333333333", name: null },
        { address: "0x4444444444444444444444444444444444444444", name: null },
      ],
    })).toEqual([
      { address: "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9", name: "example.base.eth" },
      { address: "0x2222222222222222222222222222222222222222", name: null },
      { address: "0x3333333333333333333333333333333333333333", name: null },
    ]);
  });

  test("drops entries that are not usable recipients", () => {
    expect(readRecentTransferRecipientsResponse({
      version: 1,
      recipients: [
        { address: "0x2222222222222222222222222222222222222222", name: "not-a-name" },
        { address: "0x0000000000000000000000000000000000000000", name: null },
        { address: "0x3333333333333333333333333333333333333333" },
        "0x4444444444444444444444444444444444444444",
      ],
    })).toEqual([
      { address: "0x2222222222222222222222222222222222222222", name: null },
      { address: "0x3333333333333333333333333333333333333333", name: null },
    ]);
  });

  test.each([
    [{ version: 2, recipients: [] }, "version"],
    [{ recipients: [] }, "missing version"],
    [{ version: 1 }, "missing list"],
    [{ version: 1, recipients: {} }, "invalid list"],
    [null, "null"],
  ])("returns nothing for %p (%s)", (value) => {
    expect(readRecentTransferRecipientsResponse(value)).toEqual([]);
  });
});
