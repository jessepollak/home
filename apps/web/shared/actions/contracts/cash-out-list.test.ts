import { expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { cashoutFixtureAction } from "@/tests/browser/feature-map/cashout-fixture";
import { parseRecentMoneyActions } from "./list";

const session: VerifiedAccountSession = {
  user: { subject: cashoutFixtureAction.owner.subject },
  smartAccount: { address: cashoutFixtureAction.owner.address as `0x${string}`, chainId: 8453 },
  accountProvider: "cdp-embedded",
};

test("preserves only a valid cash-out projection for the verified account", () => {
  const parsed = parseRecentMoneyActions({ actions: [cashoutFixtureAction] }, session);
  expect(parsed[0]?.cashout?.state).toBe("awaiting-buyer");
  expect(parsed[0]?.cashout?.depositId).toBe("fixture-escrow-1");
  expect(parseRecentMoneyActions({ actions: [{ ...cashoutFixtureAction, cashout: { ...cashoutFixtureAction.cashout, state: "provider-secret" } }] }, session)[0]?.cashout).toBeUndefined();
  expect(parseRecentMoneyActions({ actions: [cashoutFixtureAction] }, { ...session, user: { subject: "different" } })).toEqual([]);
});
