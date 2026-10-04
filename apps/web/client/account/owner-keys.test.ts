import { expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  countryPreferenceOwnerKey,
  nativeBaseOwnerKey,
  savingsGrowthOwnerKey,
  savingsJourneyOwnerKey,
  supportOwnerKey,
} from "./owner-keys";

const smartAccount: NonNullable<VerifiedAccountSession["smartAccount"]> = { address: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD", chainId: 8453 };

const baseSession: VerifiedAccountSession = {
  user: { subject: "base-subject" },
  smartAccount,
  accountProvider: "base-account",
};

test("native Base key keeps the exact address bytes and rejects other providers", () => {
  expect(nativeBaseOwnerKey(baseSession)).toBe("base-subject\u00000xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD\u00008453");
  expect(() => nativeBaseOwnerKey({ ...baseSession, accountProvider: "cdp-embedded" })).toThrow("Native Base authentication failed.");
  expect(() => nativeBaseOwnerKey({ ...baseSession, smartAccount: null })).toThrow("Native Base authentication failed.");
});

test("savings identity handles sessions without a smart account and keeps provider distinct", () => {
  expect(savingsJourneyOwnerKey({ ...baseSession, smartAccount: null })).toBe("base-subject\u0000\u0000\u0000base-account");
  expect(savingsJourneyOwnerKey(baseSession)).toBe("base-subject\u00000xabcdefabcdefabcdefabcdefabcdefabcdefabcd\u00008453\u0000base-account");
  expect(savingsGrowthOwnerKey("base-subject", smartAccount.address)).toBe("base-subject:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
});

test("the preference scope keeps its existing owner-part ordering", () => {
  expect(countryPreferenceOwnerKey({ ownerKey: "wallet", session: baseSession })).toBe("wallet\u0000base-account\u0000base-subject");
  expect(countryPreferenceOwnerKey({ ownerKey: null, session: baseSession })).toBeNull();
});

test("the support scope follows the server-verified customer and changes with the owner", () => {
  const verified = { status: "verified", verification: "server", session: baseSession };
  expect(supportOwnerKey(verified)).toBe("base-account\u0000base-subject");
  expect(supportOwnerKey({ ...verified, session: { ...baseSession, smartAccount: null } })).toBe("base-account\u0000base-subject");
  expect(supportOwnerKey({ ...verified, session: { ...baseSession, user: { subject: "other-subject" } } })).toBe("base-account\u0000other-subject");
  expect(supportOwnerKey({ ...verified, session: { ...baseSession, accountProvider: "cdp-embedded" } })).toBe("cdp-embedded\u0000base-subject");
  expect(supportOwnerKey({ ...verified, verification: "provisional" })).toBeNull();
  expect(supportOwnerKey({ ...verified, status: "validating" })).toBeNull();
  expect(supportOwnerKey({ ...verified, session: null })).toBeNull();
});
