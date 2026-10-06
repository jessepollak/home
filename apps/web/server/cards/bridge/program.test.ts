import { expect, test } from "bun:test";
import { bridgeAccountStatus } from "./program";
import { validatedFixture } from "@/tests/cards/fake-bridge";

const customer = validatedFixture();
test.each([
  ["not_started", "verification-required"], ["incomplete", "verification-required"], ["awaiting_questionnaire", "verification-required"],
  ["awaiting_ubo", "verification-required"], ["under_review", "verification-pending"], ["active", "ready"],
  ["rejected", "ineligible"], ["paused", "restricted"], ["offboarded", "ineligible"], ["deposits_restricted", "restricted"],
] as const)("Bridge customer %s maps to %s", (status, expected) => {
  expect(bridgeAccountStatus({ ...customer, status }, customer.stripeCardholderId, "active")).toBe(expected);
});
test.each(["active", "inactive", "blocked"] as const)("Bridge cardholder %s", (status) => {
  expect(bridgeAccountStatus(customer, customer.stripeCardholderId, status)).toBe(status === "active" ? "ready" : "restricted");
});
test.each([
  ["approved", false, false, false, "ready"], ["incomplete", false, false, false, "verification-required"],
  ["revoked", false, false, false, "verification-required"], ["approved", true, false, false, "verification-pending"],
  ["approved", false, true, false, "verification-required"], ["approved", false, false, true, "verification-required"],
] as const)("Bridge endorsement %s pending=%s missing=%s issues=%s", (status, pending, missing, issues, expected) => {
  expect(bridgeAccountStatus({ ...customer, cardsEndorsement: { status, pending, missing, issues } }, customer.stripeCardholderId, "active")).toBe(expected);
});
test("approved without a holder remains pending and holder mismatch fails closed", () => {
  expect(bridgeAccountStatus({ ...customer, stripeCardholderId: null }, null, null)).toBe("verification-pending");
  expect(bridgeAccountStatus(customer, "ich_other", "active")).toBe("unavailable");
});
