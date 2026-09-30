import { expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  countryPreferenceOwnerKey,
  nativeBaseOwnerKey,
  savingsGrowthOwnerKey,
  savingsJourneyOwnerKey,
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
