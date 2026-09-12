// Soft Pass locks (non-negotiable):
// - #175: no new send after `sendUserOperation` has been invoked and thrown
// - #175: no GET-by-idempotency-key recovery (the key is not a locator)
// - #176: Home action UUID ≠ provider evidence
// - #176: no preallocated `submissionId` before the provider returns a handle
// - #176: EIP-5792 `5720` ≠ `rejected` and is not proof of non-submission
// The client does not yet import this module; follow-up C will wire
// `cdp-money-action-execution.ts` to these classifications or delete the module.

import type { ProviderHandle } from "@/shared/money-actions/provider-handle";

export type NotSubmittedReason =
  | "prepare-failed"
  | "preflight-failed"
  | "claim-lost-cas"
  | "before-dispatch-throw"
  | "user-reject-4001"
  | "cdp-auth-rejected-before-accept";

export type AmbiguousReason =
  | "send-user-operation-threw"
  | "wallet-send-calls-entered"
  | "transport-timeout"
  | "lost-response"
  | "cdp-already-exists-in-flight"
  | "cdp-idempotency-error"
  | "eip-5720-duplicate-id"
  | "lookup-failure"
  | "unknown";

export type SubmissionCertainty =
  | { classification: "not-submitted"; reason: NotSubmittedReason }
  | { classification: "ambiguous"; reason: AmbiguousReason }
  | { classification: "submitted"; handle: ProviderHandle };

export type CdpSendInvocationEvent =
  | { stage: "not-invoked"; cause: "before-call-throw" | "auth-invalid-unfunded-probe" }
  | { stage: "invoked-then-threw"; errorType?: "already_exists" | "idempotency_error" | "unknown" }
  | { stage: "returned"; userOperationHash: `0x${string}` };

export type Eip5792SendInvocationEvent =
  | { stage: "not-invoked"; cause: "before-dispatch-throw" }
  | { stage: "returned"; submissionId: string }
  | { stage: "provider-error"; code: number | string }
  | { stage: "invoked-then-threw"; cause: "timeout" | "disconnect" | "unknown" };

export type Eip5792LookupEvent = { code: number | string };

export function classifyCdpSendInvocation(event: CdpSendInvocationEvent): SubmissionCertainty {
  if (event.stage === "not-invoked") {
    return {
      classification: "not-submitted",
      reason: event.cause === "auth-invalid-unfunded-probe"
        ? "cdp-auth-rejected-before-accept"
        : "before-dispatch-throw",
    };
  }
  if (event.stage === "returned") {
    return {
      classification: "submitted",
      handle: { kind: "user-operation-hash", provider: "cdp-embedded", value: event.userOperationHash },
    };
  }
  if (event.errorType === "already_exists") {
    return { classification: "ambiguous", reason: "cdp-already-exists-in-flight" };
  }
  if (event.errorType === "idempotency_error") {
    return { classification: "ambiguous", reason: "cdp-idempotency-error" };
  }
  return { classification: "ambiguous", reason: "send-user-operation-threw" };
}

export function classifyEip5792SendInvocation(event: Eip5792SendInvocationEvent): SubmissionCertainty {
  if (event.stage === "not-invoked") {
    return { classification: "not-submitted", reason: "before-dispatch-throw" };
  }
  if (event.stage === "returned") {
    return {
      classification: "submitted",
      handle: { kind: "submission-id", provider: "base-account", value: event.submissionId },
    };
  }
  if (event.stage === "provider-error") {
    const code = Number(event.code);
    if (code === 4001) return { classification: "not-submitted", reason: "user-reject-4001" };
    if (code === 5720) return { classification: "ambiguous", reason: "eip-5720-duplicate-id" };
    return { classification: "ambiguous", reason: "wallet-send-calls-entered" };
  }
  if (event.cause === "timeout") return { classification: "ambiguous", reason: "transport-timeout" };
  return { classification: "ambiguous", reason: "wallet-send-calls-entered" };
}

export function classifyEip5792Lookup(event: Eip5792LookupEvent): {
  classification: "lookup-failure";
  notSubmitted: false;
  reason: AmbiguousReason;
} {
  return Number(event.code) === 5720
    ? { classification: "lookup-failure", notSubmitted: false, reason: "eip-5720-duplicate-id" }
    : { classification: "lookup-failure", notSubmitted: false, reason: "lookup-failure" };
}
