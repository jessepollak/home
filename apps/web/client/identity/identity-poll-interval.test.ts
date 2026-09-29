import { describe, expect, test } from "bun:test";
import type { IdentityVerificationState, IdentityVerificationStatus } from "@/shared/identity/contract";
import { hostedReturnRearmsPolling, identityPollInterval } from "./use-identity-verification-status";

function status(state: IdentityVerificationState): IdentityVerificationStatus {
  return { state, category: "verification-required", action: "start", verifiedAt: null, retryReason: null, supportUrl: null, consentRequired: false };
}

const submittedAt = 1_000_000;

describe("identity status polling", () => {
  test.each(["pending", "manual-review"] as const)("%s polls without a submission", (state) => {
    expect(identityPollInterval(status(state), null, submittedAt)).toBeGreaterThan(0);
  });
  test.each(["in-progress", "retry", "reset", "level-changed", "temporarily-unavailable"] as const)("%s polls after the SDK reports a submission", (state) => {
    expect(identityPollInterval(status(state), null, submittedAt)).toBe(false);
    expect(identityPollInterval(status(state), submittedAt, submittedAt + 60_000)).toBeGreaterThan(0);
  });
  test("submission polling stops after its window", () => {
    expect(identityPollInterval(status("in-progress"), submittedAt, submittedAt + 15 * 60_000)).toBe(false);
  });
  test.each(["not-started", "verified", "rejected", "blocked", "removed", "configuration-unavailable"] as const)("%s never polls", (state) => {
    expect(identityPollInterval(status(state), submittedAt, submittedAt + 1)).toBe(false);
  });
  test("a return re-arms polling while a hosted submission could still await its decision", () => {
    expect(hostedReturnRearmsPolling(null, submittedAt)).toBe(false);
    expect(hostedReturnRearmsPolling(submittedAt, submittedAt + 29 * 60_000)).toBe(true);
    expect(hostedReturnRearmsPolling(submittedAt, submittedAt + 44 * 60_000)).toBe(true);
    expect(hostedReturnRearmsPolling(submittedAt, submittedAt + 45 * 60_000)).toBe(false);
  });
  test("no data never polls", () => {
    expect(identityPollInterval(undefined, submittedAt, submittedAt + 1)).toBe(false);
  });
});
