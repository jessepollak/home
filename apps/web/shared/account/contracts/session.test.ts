import { expect, test } from "bun:test";
import { requireAddress } from "@/shared/chain/hex";
import { getAddress } from "viem";
import { SESSION_VERSION, parseSession } from "./session";
import { NATIVE_BASE_VERIFY_VERSION, parseNativeBaseSession } from "./base-verify";

const address = getAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
const session = {
  version: SESSION_VERSION,
  user: { subject: "owner" },
  smartAccount: { address, chainId: 8453 },
  accountProvider: "base-account" as const,
};

test("session contracts require versions and fail closed for malformed owners", () => {
  expect(NATIVE_BASE_VERIFY_VERSION).toBe(1);
  expect(SESSION_VERSION).toBe(1);
  for (const parser of [parseSession, parseNativeBaseSession]) {
    expect(parser(session)).toEqual({ ...session, smartAccount: { address: requireAddress(address), chainId: 8453 } });
    for (const value of [
      null, [], {},
      { user: session.user, smartAccount: session.smartAccount, accountProvider: session.accountProvider },
      { ...session, version: 2 }, { ...session, version: "1" },
      { ...session, user: null }, { ...session, user: {} },
      { ...session, user: { subject: "" } }, { ...session, user: { subject: 123 } },
      { ...session, smartAccount: null }, { ...session, smartAccount: {} },
      { ...session, smartAccount: { ...session.smartAccount, chainId: 1 } },
      ...[address.replace("A", "a"), "0x1234", "0xnothex", null].map((bad) => ({
        ...session, smartAccount: { ...session.smartAccount, address: bad },
      })),
      { ...session, accountProvider: "unknown" },
    ]) expect(parser(value)).toBeNull();
  }
});

test("session and verify preserve their distinct subject and provider rules", () => {
  expect(parseSession({ ...session, user: { subject: "  " } })).toBeNull();
  expect(parseNativeBaseSession({ ...session, user: { subject: "  " } })?.user.subject).toBe("  ");
  expect(parseSession({ ...session, user: { subject: " owner " } })?.user.subject).toBe(" owner ");
  expect(parseSession({ ...session, accountProvider: "cdp-embedded", smartAccount: null })).toEqual({
    ...session, accountProvider: "cdp-embedded", smartAccount: null,
  });
  expect(parseNativeBaseSession({ ...session, accountProvider: "cdp-embedded" })).toBeNull();
  expect(parseSession({ ...session, extra: true, user: { subject: "owner", email: "ignored" } })).toEqual({
    ...session, smartAccount: { address: requireAddress(address), chainId: 8453 },
  });
});
