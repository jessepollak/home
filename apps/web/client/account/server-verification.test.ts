import { describe, expect, test } from "bun:test";
import {
  isServerVerified,
  isSessionSettling,
  type ServerVerifiedAccount,
} from "./cdp-client";
import type { VerifiedAccountSession } from "./session-client";

const session: VerifiedAccountSession = {
  user: { subject: "subject-a" },
  smartAccount: {
    address: "0x1111111111111111111111111111111111111111",
    chainId: 8453,
  },
  accountProvider: "cdp-embedded",
};

const provisionalAccount = {
  status: "verified",
  verification: "provisional",
  session,
} as const;

// @ts-expect-error A provisional account cannot satisfy a server-verified gate.
const rejectedServerAccount: ServerVerifiedAccount = provisionalAccount;
void rejectedServerAccount;

describe("server account verification", () => {
  test("settles only after server verification or a terminal session state", () => {
    expect(isSessionSettling({ status: "restoring", verification: null })).toBe(true);
    expect(isSessionSettling({ status: "validating", verification: "provisional" })).toBe(true);
    expect(isSessionSettling(provisionalAccount)).toBe(true);
    expect(isSessionSettling({ status: "verified", verification: null })).toBe(true);
    expect(isSessionSettling({ status: "verified", verification: "server" })).toBe(false);
    for (const status of ["signed-out", "signout-error", "signing-out", "unavailable"] as const) {
      expect(isSessionSettling({ status, verification: null })).toBe(false);
    }
  });

  test("requires status, verification source, and session", () => {
    expect(isServerVerified(provisionalAccount)).toBe(false);
    expect(isServerVerified({
      status: "validating",
      verification: "server",
      session,
    })).toBe(false);
    expect(isServerVerified({
      status: "verified",
      verification: "server",
      session,
    })).toBe(true);
    expect(isServerVerified({
      status: "verified",
      verification: "server",
      session: null,
    })).toBe(false);
  });
});
