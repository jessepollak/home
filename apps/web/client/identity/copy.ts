import type { IdentityRetryReason, IdentityVerificationState } from "@/shared/identity/contract";

export const identityStateCopy: Record<IdentityVerificationState, { id: string; title: string; detail: string; button: string | null }> = {
  "not-started": { id: "identity.status.not-started.title", title: "Not verified", detail: "", button: "Verify identity" },
  "in-progress": { id: "identity.status.in-progress.title", title: "In progress — continue", detail: "Finish verifying your identity with Sumsub.", button: "Continue" },
  pending: { id: "identity.status.pending.title", title: "Checking your details", detail: "We'll update this when the check is complete.", button: null },
  "manual-review": { id: "identity.status.manual-review.title", title: "Under review", detail: "Your details are being reviewed.", button: null },
  verified: { id: "identity.status.verified.title", title: "Verified", detail: "", button: null },
  retry: { id: "identity.status.retry.title", title: "Needs more from you", detail: "Sumsub needs more information.", button: "Continue" },
  blocked: { id: "identity.status.blocked.title", title: "Verification unavailable", detail: "", button: null },
  rejected: { id: "identity.status.rejected.title", title: "Verification could not be approved", detail: "", button: null },
  "duplicate-person": { id: "identity.status.duplicate-person.title", title: "You've verified with another account", detail: "Sign in with the account you verified with. Linking sign-ins is coming soon.", button: null },
  reset: { id: "identity.status.reset.title", title: "In progress — continue", detail: "Sumsub reset your verification. Continue to finish.", button: "Continue" },
  removed: { id: "identity.status.removed.title", title: "Not verified", detail: "Your verification was removed by Sumsub.", button: "Verify again" },
  "level-changed": { id: "identity.status.level-changed.title", title: "In progress — continue", detail: "Verify again to finish.", button: "Continue" },
  "temporarily-unavailable": { id: "identity.status.temporarily-unavailable.title", title: "Temporarily unavailable", detail: "We couldn't check your status right now.", button: "Try again" },
  "configuration-unavailable": { id: "identity.status.configuration-unavailable.title", title: "Identity verification isn't available right now", detail: "", button: null },
};

export const identityRetryCopy: Record<IdentityRetryReason, { id: string; text: string }> = {
  "photo-quality": { id: "identity.retry.photo-quality", text: "Use a clearer photo of your document." },
  "document-incomplete": { id: "identity.retry.document-incomplete", text: "Provide all pages of your document." },
  "document-expired": { id: "identity.retry.document-expired", text: "Use a document that hasn't expired." },
  "document-unsupported": { id: "identity.retry.document-unsupported", text: "Use a supported identity document." },
  selfie: { id: "identity.retry.selfie", text: "Take another selfie." },
  "proof-of-address": { id: "identity.retry.proof-of-address", text: "Provide another proof of address." },
  "proof-of-identity": { id: "identity.retry.proof-of-identity", text: "Provide another proof of identity." },
};
