import { isSupportUrl, type IdentityRetryReason, type IdentityVerificationStatus } from "./contract";

export type IdentityFacts = {
  applicantId: string | null;
  levelName: string | null;
  reviewState: "not-submitted" | "pending" | "manual-review" | "approved" | "retry" | "final" | "duplicate";
  retryReason: IdentityRetryReason | null;
  lifecycle: "active" | "reset" | "deactivated" | "removed";
  approvedAt: string | null;
  restricted: boolean;
};

export function mapIdentityStatus(facts: IdentityFacts | null, configuredLevel: string | null, support: string | null = null, needsConsent = !facts || facts.lifecycle === "removed"): IdentityVerificationStatus {
  const supportUrl = isSupportUrl(support) ? support : null;
  const status = (state: IdentityVerificationStatus["state"], category: IdentityVerificationStatus["category"], action: IdentityVerificationStatus["action"], verifiedAt: string | null = null, retryReason: IdentityRetryReason | null = null): IdentityVerificationStatus => ({ state, category, action, verifiedAt, retryReason, supportUrl, consentRequired: needsConsent && (action === "start" || action === "continue") });
  if (!configuredLevel) return status("configuration-unavailable", "configuration-unavailable", "none");
  if (facts?.lifecycle === "deactivated") return status("blocked", "verification-rejected", "contact-support");
  if (facts?.restricted) return status("rejected", "verification-rejected", "contact-support");
  if (!facts) return status("not-started", "verification-required", "start");
  if (facts.lifecycle === "removed") return status("removed", "verification-required", "start");
  if (facts.levelName && facts.levelName !== configuredLevel) return status("level-changed", "verification-required", "continue");
  if (facts.reviewState === "final" && !facts.levelName) return status("pending", "verification-pending", "wait");
  if (facts.reviewState === "final") return status("rejected", "verification-rejected", "contact-support");
  if (facts.reviewState === "duplicate") return status("duplicate-person", "verification-rejected", "link-account");
  if (facts.lifecycle === "reset") return status("reset", "verification-required", "continue");
  if (facts.reviewState === "approved" && !facts.levelName) return status("pending", "verification-pending", "wait");
  if (facts.reviewState === "approved") return status("verified", "available", "none", facts.approvedAt);
  if (facts.reviewState === "not-submitted") return status("in-progress", "verification-required", "continue");
  if (facts.reviewState === "manual-review") return status("manual-review", "verification-pending", "wait");
  if (facts.reviewState === "retry") return status("retry", "verification-rejected", "continue", null, facts.retryReason);
  return status("pending", "verification-pending", "wait");
}

export function identityUnavailableStatus(support: string | null = null): IdentityVerificationStatus {
  return { state: "temporarily-unavailable", category: "temporarily-unavailable", action: "retry", verifiedAt: null, retryReason: null, supportUrl: isSupportUrl(support) ? support : null, consentRequired: false };
}
