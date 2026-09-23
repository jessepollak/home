import { describe, expect, test } from "bun:test";
import {
  recentSendRecipientAddresses,
  sendRecipientFromWarnings,
} from "./recent-recipients";

const FIRST = "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9";
const SECOND = "0x2222222222222222222222222222222222222222";
const THIRD = "0x3333333333333333333333333333333333333333";
const FOURTH = "0x4444444444444444444444444444444444444444";

function sendAction(recipient: string) {
  return {
    kind: "send",
    summary: { warnings: [`Recipient: ${recipient}`, "Execution target: 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"] },
  };
}

describe("sendRecipientFromWarnings", () => {
  test("reads the server-authored recipient warning case-insensitively", () => {
    expect(sendRecipientFromWarnings([`recipient: 0x2211D1D0020DAEA8039E46CF1367962070D77DA9`])).toBe(FIRST);
    expect(sendRecipientFromWarnings(["Network fee shown by wallet.", `Recipient: ${SECOND}`])).toBe(SECOND);
  });

  test.each([
    [[]],
    [["Recipient: 0x1234"]],
    [["Recipient: not-an-address"]],
    [["Recipient: 0x0000000000000000000000000000000000000000"]],
    [["Recipient:"]],
    [[42, null]],
    [null],
  ])("returns nothing for %p", (warnings) => {
    expect(sendRecipientFromWarnings(warnings)).toBeNull();
  });
});

describe("recentSendRecipientAddresses", () => {
  test("keeps the newest distinct send recipients and skips other kinds", () => {
    expect(recentSendRecipientAddresses([
      sendAction(FIRST),
      { kind: "cash-out", summary: { warnings: [`Recipient: ${FOURTH}`] } },
      sendAction(FIRST.toUpperCase()),
      sendAction(SECOND),
      { kind: "savings-deposit", summary: { warnings: [] } },
      { kind: "send", summary: { warnings: ["Network fee shown by wallet."] } },
      sendAction(THIRD),
    ])).toEqual([FIRST, SECOND, THIRD]);
  });

  test("bounds the list to the requested count", () => {
    expect(recentSendRecipientAddresses([
      sendAction(FIRST),
      sendAction(SECOND),
      sendAction(THIRD),
      sendAction(FOURTH),
    ], 2)).toEqual([FIRST, SECOND]);
  });

  test("tolerates rows without a summary or with a malformed one", () => {
    expect(recentSendRecipientAddresses([
      { kind: "send", summary: null },
      { kind: "send", summary: { warnings: "Recipient: 0x2222222222222222222222222222222222222222" } },
      sendAction(FIRST),
    ])).toEqual([FIRST]);
    expect(recentSendRecipientAddresses([sendAction(FIRST)], 0)).toEqual([]);
  });
});
