import { expect, test } from "bun:test";
import { identityUnavailableStatus, mapIdentityStatus, type IdentityFacts } from "./status";
import { parseIdentityVerificationSessionRequest, readIdentityVerificationStatus } from "./contract";

const facts: IdentityFacts = { applicantId: "a", levelName: "home-level", reviewState: "not-submitted", retryReason: null, lifecycle: "active", approvedAt: null, restricted: false };
const status = (patch: Partial<IdentityFacts> = {}, level: string | null = "home-level") => mapIdentityStatus({ ...facts, ...patch }, level);
test("Home facts map with configuration, restriction, lifecycle and level precedence", () => {
  expect(status({}, null).state).toBe("configuration-unavailable");
  expect(mapIdentityStatus(null, "home-level")).toMatchObject({ state: "not-started", consentRequired: true });
  expect(status({ restricted: true, reviewState: "approved" }).state).toBe("rejected");
  expect(status({ lifecycle: "removed" }).state).toBe("removed");
  expect(status({ lifecycle: "deactivated", reviewState: "approved" })).toMatchObject({ state: "blocked", category: "verification-rejected", action: "contact-support", consentRequired: false, retryReason: null });
  expect(status({ lifecycle: "deactivated", restricted: true }).state).toBe("blocked");
  expect(mapIdentityStatus({ ...facts, lifecycle: "deactivated" }, "home-level", null, true).consentRequired).toBe(false);
  expect(status({ reviewState: "final" }).state).toBe("rejected");
  expect(status({ reviewState: "duplicate" })).toMatchObject({ state: "duplicate-person", action: "link-account" });
  expect(status({ lifecycle: "reset" }).state).toBe("reset");
  expect(status({ reviewState: "approved", levelName: "old" }).state).toBe("level-changed");
  expect(status({ reviewState: "final", levelName: "old" })).toMatchObject({ state: "level-changed", action: "continue" });
  expect(status({ reviewState: "duplicate", levelName: "old" }).state).toBe("level-changed");
  expect(status({ reviewState: "final", levelName: "old", restricted: true }).state).toBe("rejected");
  expect(status({ reviewState: "final", levelName: null }).state).toBe("pending");
  expect(status({ reviewState: "approved", levelName: null }).state).toBe("pending");
  expect(status({ reviewState: "approved", approvedAt: "2026-04-30T00:00:00.000Z" })).toMatchObject({ state: "verified", verifiedAt: "2026-04-30T00:00:00.000Z" });
  expect(status({ reviewState: "manual-review" }).state).toBe("manual-review");
  expect(status({ reviewState: "pending" }).state).toBe("pending");
  expect(status({ reviewState: "retry", retryReason: "selfie" })).toMatchObject({ state: "retry", retryReason: "selfie" });
  expect(mapIdentityStatus(facts, "home-level", null, true).consentRequired).toBe(true);
  expect(identityUnavailableStatus().state).toBe("temporarily-unavailable");
});
test("locale and required consent field are validated", () => {
  expect(parseIdentityVerificationSessionRequest({ consent: true, locale: "pt-BR" })).toEqual({ consent: true, locale: "pt-BR" });
  for (const locale of ["e", "en--US", "en_XX", "x".repeat(36)]) expect(parseIdentityVerificationSessionRequest({ locale })).toBeNull();
  expect(readIdentityVerificationStatus({ version: 1, status: status() })).not.toBeNull();
  expect(readIdentityVerificationStatus({ version: 1, status: { ...status(), consentRequired: undefined } })).toBeNull();
});
test("a consent-version change asks for consent only where the customer can start or continue", () => {
  const approved = { ...facts, reviewState: "approved" as const, approvedAt: "2026-04-30T00:00:00.000Z" };
  expect(mapIdentityStatus(approved, "home-level", null, true)).toMatchObject({ state: "verified", consentRequired: false });
  expect(mapIdentityStatus({ ...facts, reviewState: "manual-review" }, "home-level", null, true).consentRequired).toBe(false);
  expect(mapIdentityStatus({ ...facts, reviewState: "final" }, "home-level", null, true).consentRequired).toBe(false);
  expect(mapIdentityStatus({ ...facts, reviewState: "retry", retryReason: "selfie" }, "home-level", null, true).consentRequired).toBe(true);
  expect(mapIdentityStatus({ ...approved, levelName: "old" }, "home-level", null, true)).toMatchObject({ state: "level-changed", consentRequired: true });
});
