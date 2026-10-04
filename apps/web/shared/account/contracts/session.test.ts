import { expect, test } from "bun:test";
import { getAddress } from "viem";
import { parseSession } from "./session";
import { parseNativeBaseSession } from "./base-verify";

const address = getAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
const session = {
  version: 1 as const,
  user: { subject: "owner" },
  smartAccount: { address, chainId: 8453 },
  accountProvider: "base-account" as const,
};

test("session contracts require versions and fail closed for malformed owners", () => {
  for (const parser of [parseSession, parseNativeBaseSession]) {
    const { smartAccount, ...owner } = parser(session) ?? {};
    const { address: parsedAddress, ...account } = smartAccount ?? {};
    expect(owner).toEqual({ version: 1, user: { subject: "owner" }, accountProvider: "base-account" });
    expect(account).toEqual({ chainId: 8453 });
    expect(parsedAddress?.toString()).toBe("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
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
  const { smartAccount, ...owner } = parseSession({
    ...session, extra: true, user: { subject: "owner", email: "ignored" },
  }) ?? {};
  const { address: parsedAddress, ...account } = smartAccount ?? {};
  expect(owner).toEqual({ version: 1, user: { subject: "owner" }, accountProvider: "base-account" });
  expect(account).toEqual({ chainId: 8453 });
  expect(parsedAddress?.toString()).toBe("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
});
