/**
 * Versioned attempt-aware money dispatch commands.
 *
 * Locked by Phase 2 §3 (#181) from Soft Pass matrices #175 (CDP) and #176 (EIP-5792).
 * Types + pure classification only. No additive attempt schema (Phase 3) and no HTTP
 * handlers. Current claim/submission routes stay the compatibility projection.
 *
 * Soft Pass locks (non-negotiable):
 * - #175: no new send after `sendUserOperation` has been invoked and thrown
 * - #175: no GET-by-idempotency-key recovery (the key is not a locator)
 * - #176: Home action UUID ≠ provider evidence
 * - #176: no preallocated `submissionId` before the provider returns a handle
 * - #176: EIP-5792 `5720` ≠ `rejected` and is not proof of non-submission
 *
 * Coord #110 / #134: ordinary recover must not terminalize `unknown → expired`.
 * `ReleaseAdmission` is Home policy, not an execution outcome.
 *
 * Sources stay on the issue comments; this module encodes the locked answers.
 */

import type { AccountProvider } from "@/shared/account/session-types";
import type { ProviderHandle } from "@/shared/money-actions/provider-handle";
import type { MoneyActionOwner, PreparedMoneyAction } from "@/shared/money-actions/types";

export type { ProviderHandle } from "@/shared/money-actions/provider-handle";

export const ATTEMPT_COMMAND_CONTRACT_VERSION = 1 as const;

/** Compatibility revision until Phase 3 stores additive action revisions. */
export const COMPATIBILITY_ACTION_REVISION = 1 as const;

export type AttemptCommandContractVersion = typeof ATTEMPT_COMMAND_CONTRACT_VERSION;

export type PreparedActionRevision = PreparedMoneyAction & {
  readonly revision: typeof COMPATIBILITY_ACTION_REVISION;
};

export type DispatchVersion = number;
export type AttemptVersion = number;

export type DispatchPhase =
  | { phase: "unclaimed" }
  | { phase: "authorized"; version: DispatchVersion }
  | { phase: "request-entered"; version: DispatchVersion }
  | { phase: "evidence-recorded"; version: DispatchVersion }
  | { phase: "closed"; version: DispatchVersion };

/**
 * Home-minted correlation sent to a provider. Typically `PreparedMoneyAction.id`.
 *
 * #175: CDP `X-Idempotency-Key` is wiring for a retry of the same SDK call, not a
 * GET locator. There is no get-by-key API.
 * #176: EIP-5792 request `id` is a uniqueness / correlation hint, not replay and
 * not a `wallet_getCallsStatus` locator on the current Base path.
 */
export type HomeProviderRequestKey = {
  readonly kind: "home-correlation";
  readonly role: "cdp-idempotency-header" | "eip-5792-request-id";
  readonly value: string;
  readonly homeActionId: string;
};

export type ProviderEvidence =
  | ProviderHandle
  | { kind: "transaction-hash"; chainId: 8453; value: `0x${string}` }
  | {
      kind: "provider-status";
      handle: ProviderHandle;
      observedAt: string;
      payload: "pending" | "dropped" | "confirmed" | "failed" | "unavailable";
    };

export type EvidenceProvenance =
  | { source: "provider-return"; observedAt: string }
  | { source: "provider-status-lookup"; observedAt: string; locator: ProviderHandle }
  | { source: "verified-receipt"; observedAt: string };

export type RecordedProviderEvidence = {
  evidence: ProviderEvidence;
  provenance: EvidenceProvenance;
  recordedAt: string;
};

export type OwnerResolution =
  | { kind: "active" }
  | { kind: "abandoned"; at: string; reason: "owner-request" | "policy-timeout" };

export type Admission =
  | { state: "blocking" }
  | { state: "released"; at: string; policyVersion: string };

export type ReconciliationResult =
  | { kind: "unexecuted" }
  | { kind: "authorized-no-evidence" }
  | { kind: "ambiguous" }
  | { kind: "pending"; handle: ProviderHandle }
  | { kind: "confirmed"; transactionHash: `0x${string}`; verifiedExecution: true }
  | { kind: "failed"; transactionHash?: `0x${string}`; verifiedExecution: true }
  | { kind: "rejected"; reason: Extract<NotSubmittedReason, "user-reject-4001" | "before-dispatch-throw"> };

export type ExecutionAttempt = {
  attemptId: string;
  sequence: number;
  actionId: string;
  actionRevision: number;
  owner: MoneyActionOwner;
  provider: AccountProvider;
  createdAt: string;
  dispatch: DispatchPhase;
  providerRequestKey: HomeProviderRequestKey;
  evidence: readonly RecordedProviderEvidence[];
  reconciliation: ReconciliationResult;
  ownerResolution: OwnerResolution;
  admission: Admission;
  attemptVersion: AttemptVersion;
};

export type ClaimDispatch = {
  owner: MoneyActionOwner;
  actionId: string;
  reviewHash: string;
  expectedActionRevision: number;
  provider: AccountProvider;
  providerRequestKey: HomeProviderRequestKey;
};

export type ClaimDispatchResult =
  | {
      disposition: "dispatch";
      action: PreparedActionRevision;
      attempt: ExecutionAttempt;
      dispatchVersion: DispatchVersion;
      authorization: "first-wallet-dispatch";
    }
  | {
      disposition: "recover";
      action: PreparedActionRevision;
      attempt: ExecutionAttempt;
      authorization: "none";
    }
  | {
      disposition: "terminal";
      action: PreparedActionRevision;
      attempt?: ExecutionAttempt;
      result: ReconciliationResult;
      authorization: "none";
    };

/**
 * Append-only evidence write. Repeating the same fact is success; a different
 * value for the same slot fails closed. Client reports are leads until the
 * server verifies owner, chain, sender, calls/effects, and provider relationship.
 *
 * `writeIdempotencyKey` is Home's evidence-upload retry key. It is not the CDP
 * send idempotency key and must not be used as a GET locator (#175).
 */
export type RecordProviderEvidence = {
  owner: MoneyActionOwner;
  actionId: string;
  attemptId: string;
  dispatchVersion: DispatchVersion;
  evidence: ProviderEvidence;
  provenance: EvidenceProvenance;
  writeIdempotencyKey: string;
};

export type RecordEvidenceRejection =
  | "owner-mismatch"
  | "version-mismatch"
  | "preallocated-locator"
  | "home-correlation-as-evidence"
  | "missing-provider-return"
  | "conflicting-evidence"
  | "unsupported-locator";

export type RecordProviderEvidenceResult =
  | { disposition: "recorded"; evidence: RecordedProviderEvidence }
  | { disposition: "duplicate"; evidence: RecordedProviderEvidence }
  | { disposition: "conflict"; slot: ProviderEvidence["kind"]; existing: RecordedProviderEvidence }
  | { disposition: "rejected"; reason: RecordEvidenceRejection };

/**
 * Pure read / projection command. Never claims and never invokes a wallet
 * submit API. May append stronger verified evidence and advance monotonically.
 * Must not expire an ambiguous attempt (#110 / #134).
 */
export type ReconcileAttempt = {
  owner: MoneyActionOwner;
  actionId: string;
  attemptId: string;
  expectedAttemptVersion: AttemptVersion;
  lookup: ReconcileLookup;
};

export type ReconcileLookup =
  | { kind: "recorded-user-operation-hash"; userOperationHash: `0x${string}` }
  | { kind: "recorded-submission-id"; submissionId: string }
  | { kind: "recorded-transaction-hash"; transactionHash: `0x${string}` }
  | { kind: "none"; reason: "reference-free-ambiguous" };

export type ForbiddenReconcileLookup =
  | { kind: "cdp-get-by-idempotency-key" }
  | { kind: "eip-5792-get-by-action-uuid" }
  | { kind: "prove-by-resubmit" };

export type ReconcileAttemptResult =
  | { kind: "unchanged"; attempt: ExecutionAttempt }
  | { kind: "appended-evidence"; attempt: ExecutionAttempt; evidence: RecordedProviderEvidence }
  | { kind: "projected"; attempt: ExecutionAttempt; result: ReconciliationResult }
  | { kind: "conflict"; reason: "owner-mismatch" | "version-mismatch" | "conflicting-evidence" };

export type ReconcileCapabilities = {
  mayClaim: false;
  mayInvokeWalletSubmit: false;
  mayAuthorizeDispatch: false;
  mayAppendStrongerEvidence: true;
  mayAdvanceProjectionMonotonically: true;
  mayExpireUnknown: false;
};

/**
 * Owner / policy command that unblocks a new Home flow. Independent of
 * reconciliation. Late evidence remains attachable. Must not assert onchain
 * non-submission (#110 / #134).
 */
export type ReleaseAdmission = {
  owner: MoneyActionOwner;
  actionId: string;
  attemptId: string;
  policyVersion: string;
  reason: "owner-request" | "policy-timeout";
};

export type ReleaseAdmissionResult = {
  admission: Extract<Admission, { state: "released" }>;
  ownerResolution: Extract<OwnerResolution, { kind: "abandoned" }>;
  execution: ReconciliationResult;
  lateEvidence: "accepted";
};

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

export type SupportLabel = "supported" | "docs-claim" | "tested" | "unknown" | "unsupported";

export type CdpRecoveryMethod =
  | { method: "get-user-operation-by-hash"; support: "supported"; requires: "recorded-user-operation-hash" }
  | { method: "get-by-idempotency-key"; support: "unsupported"; source: "#175" }
  | { method: "same-key-replay"; support: "docs-claim"; source: "#175"; live: "untested" };

export type Eip5792RecoveryMethod =
  | { method: "get-calls-status-by-returned-id"; support: "supported"; requires: "recorded-submission-id" }
  | { method: "get-calls-status-by-action-uuid"; support: "unsupported"; source: "#176"; tested: "coinbase-rpc-rejects-uuid" }
  | { method: "echoed-request-id-as-locator"; support: "unknown"; source: "#176" };

export type CdpSendInvocationEvent =
  | { stage: "not-invoked"; cause: "before-call-throw" | "auth-invalid-unfunded-probe" }
  | { stage: "invoked-then-threw"; errorType?: "already_exists" | "idempotency_error" | "unknown" }
  | { stage: "returned"; userOperationHash: `0x${string}` };

export type Eip5792SendInvocationEvent =
  | { stage: "not-invoked"; cause: "before-dispatch-throw" }
  | { stage: "returned"; submissionId: string }
  | { stage: "provider-error"; code: number | string }
  | { stage: "invoked-then-threw"; cause: "timeout" | "disconnect" | "unknown" };

export type Eip5792LookupEvent = {
  code: number | string;
};

export type CommandKind = "ClaimDispatch" | "RecordProviderEvidence" | "ReconcileAttempt" | "ReleaseAdmission";

export type AttemptImplementationTicket = {
  key:
    | "provider-handle-journal"
    | "attempt-persistence"
    | "admission-release-late-evidence"
    | "provider-recovery-where-proven"
    | "store-fault-gates";
  title: string;
  phase: 3 | 4;
  proposedOwner: "hank";
  proposedLane: "backend";
  coord?: readonly ("#110" | "#134")[];
  sources?: readonly ("#175" | "#176" | "#181")[];
  mustNot: readonly string[];
};

/** Hunter files these as #159 §4 after Soft Pass on this contract. */
export const ATTEMPT_IMPLEMENTATION_TICKETS: readonly AttemptImplementationTicket[] = [
  {
    key: "provider-handle-journal",
    title: "Retained provider-handle journal + idempotent evidence-upload retry",
    phase: 3,
    proposedOwner: "hank",
    proposedLane: "backend",
    sources: ["#181"],
    mustNot: ["new-send-after-throw", "get-by-idempotency-key"],
  },
  {
    key: "attempt-persistence",
    title: "Additive attempt / evidence / reconciliation persistence (Memory, SQLite, Postgres)",
    phase: 3,
    proposedOwner: "hank",
    proposedLane: "backend",
    sources: ["#181"],
    mustNot: ["schema-without-all-three-stores", "backfill-reference-free-as-unsubmitted"],
  },
  {
    key: "admission-release-late-evidence",
    title: "Owner abandonment / admission release that still accepts late evidence",
    phase: 4,
    proposedOwner: "hank",
    proposedLane: "backend",
    coord: ["#110", "#134"],
    sources: ["#181"],
    mustNot: ["unknown-to-expired-on-recover"],
  },
  {
    key: "provider-recovery-where-proven",
    title: "Provider-specific recovery only where Soft Pass matrices prove it safe",
    phase: 3,
    proposedOwner: "hank",
    proposedLane: "backend",
    sources: ["#175", "#176", "#181"],
    mustNot: ["get-by-key", "uuid-as-preallocated-submission-id", "5720-as-rejected", "prove-by-resubmit"],
  },
  {
    key: "store-fault-gates",
    title: "Real SQLite / Postgres race and fault-injection gates",
    phase: 3,
    proposedOwner: "hank",
    proposedLane: "backend",
    sources: ["#181"],
    mustNot: ["funded-ci", "mock-only-recovery-proof"],
  },
];

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ACTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function homeProviderRequestKey(input: {
  provider: AccountProvider;
  actionId: string;
}): HomeProviderRequestKey {
  return {
    kind: "home-correlation",
    role: input.provider === "cdp-embedded" ? "cdp-idempotency-header" : "eip-5792-request-id",
    value: input.actionId,
    homeActionId: input.actionId,
  };
}

export function compatibilityActionRevision(action: PreparedMoneyAction): PreparedActionRevision {
  return { ...action, revision: COMPATIBILITY_ACTION_REVISION };
}

export function canProduceAuthorized(source: CommandKind): source is "ClaimDispatch" {
  return source === "ClaimDispatch";
}

export function reconcileCapabilities(): ReconcileCapabilities {
  return {
    mayClaim: false,
    mayInvokeWalletSubmit: false,
    mayAuthorizeDispatch: false,
    mayAppendStrongerEvidence: true,
    mayAdvanceProjectionMonotonically: true,
    mayExpireUnknown: false,
  };
}

export function projectClaimDisposition(
  attempt: ExecutionAttempt | undefined,
): ClaimDispatchResult["disposition"] {
  if (!attempt || attempt.dispatch.phase === "unclaimed") return "dispatch";
  if (
    attempt.reconciliation.kind === "confirmed" ||
    attempt.reconciliation.kind === "failed" ||
    attempt.reconciliation.kind === "rejected" ||
    attempt.dispatch.phase === "closed"
  ) {
    return "terminal";
  }
  return "recover";
}

export function claimAuthorization(
  disposition: ClaimDispatchResult["disposition"],
): ClaimDispatchResult["authorization"] {
  return disposition === "dispatch" ? "first-wallet-dispatch" : "none";
}

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
  const code = Number(event.code);
  if (code === 5720) {
    return { classification: "lookup-failure", notSubmitted: false, reason: "eip-5720-duplicate-id" };
  }
  return { classification: "lookup-failure", notSubmitted: false, reason: "lookup-failure" };
}

export function mayAuthorizeNewSend(certainty: SubmissionCertainty): boolean {
  return certainty.classification === "not-submitted";
}

export function providerRequestKeyAsEvidence(key: HomeProviderRequestKey): {
  ok: false;
  reason: "home-correlation-is-not-provider-evidence";
} {
  void key;
  return { ok: false, reason: "home-correlation-is-not-provider-evidence" };
}

export function cdpRecoveryMethods(): readonly CdpRecoveryMethod[] {
  return [
    { method: "get-user-operation-by-hash", support: "supported", requires: "recorded-user-operation-hash" },
    { method: "get-by-idempotency-key", support: "unsupported", source: "#175" },
    { method: "same-key-replay", support: "docs-claim", source: "#175", live: "untested" },
  ];
}

export function eip5792RecoveryMethods(): readonly Eip5792RecoveryMethod[] {
  return [
    { method: "get-calls-status-by-returned-id", support: "supported", requires: "recorded-submission-id" },
    {
      method: "get-calls-status-by-action-uuid",
      support: "unsupported",
      source: "#176",
      tested: "coinbase-rpc-rejects-uuid",
    },
    { method: "echoed-request-id-as-locator", support: "unknown", source: "#176" },
  ];
}

export function reconcileLookupForAttempt(attempt: Pick<ExecutionAttempt, "evidence" | "providerRequestKey">): ReconcileLookup {
  let strongest: ReconcileLookup = { kind: "none", reason: "reference-free-ambiguous" };

  for (const recorded of attempt.evidence) {
    const { evidence } = recorded;
    if (evidence.kind === "transaction-hash") {
      return { kind: "recorded-transaction-hash", transactionHash: evidence.value };
    }
    if (evidence.kind === "user-operation-hash") {
      strongest = { kind: "recorded-user-operation-hash", userOperationHash: evidence.value };
      continue;
    }
    if (evidence.kind === "submission-id" && strongest.kind === "none") {
      strongest = { kind: "recorded-submission-id", submissionId: evidence.value };
      continue;
    }
    if (evidence.kind === "provider-status") {
      if (evidence.handle.kind === "user-operation-hash") {
        strongest = { kind: "recorded-user-operation-hash", userOperationHash: evidence.handle.value };
      } else if (strongest.kind === "none") {
        strongest = { kind: "recorded-submission-id", submissionId: evidence.handle.value };
      }
    }
  }
  return strongest;
}

export function isForbiddenReconcileLookup(value: { kind: string }): value is ForbiddenReconcileLookup {
  return (
    value.kind === "cdp-get-by-idempotency-key" ||
    value.kind === "eip-5792-get-by-action-uuid" ||
    value.kind === "prove-by-resubmit"
  );
}

export function mayRecordProviderEvidence(input: {
  homeActionId: string;
  evidence: ProviderEvidence;
  provenance: EvidenceProvenance | { source: "preallocated-action-uuid" } | { source: "home-correlation-only" };
}): { ok: true } | { ok: false; reason: RecordEvidenceRejection } {
  if (input.provenance.source === "preallocated-action-uuid") {
    return { ok: false, reason: "preallocated-locator" };
  }
  if (input.provenance.source === "home-correlation-only") {
    return { ok: false, reason: "home-correlation-as-evidence" };
  }

  const handle = input.evidence.kind === "provider-status"
    ? input.evidence.handle
    : input.evidence.kind === "transaction-hash"
    ? undefined
    : input.evidence;

  if (input.evidence.kind === "provider-status" && input.provenance.source !== "provider-status-lookup") {
    return { ok: false, reason: "missing-provider-return" };
  }
  if (
    handle &&
    input.provenance.source === "provider-status-lookup" &&
    !sameProviderHandle(handle, input.provenance.locator)
  ) {
    return { ok: false, reason: "unsupported-locator" };
  }
  if (handle?.kind === "submission-id") {
    if (input.provenance.source !== "provider-return" && input.provenance.source !== "provider-status-lookup") {
      return { ok: false, reason: "missing-provider-return" };
    }
    if (
      input.provenance.source === "provider-status-lookup" &&
      ACTION_ID_PATTERN.test(handle.value) &&
      handle.value.toLowerCase() === input.homeActionId.toLowerCase()
    ) {
      return { ok: false, reason: "unsupported-locator" };
    }
  }
  if (handle?.kind === "user-operation-hash" && !HASH_PATTERN.test(handle.value)) {
    return { ok: false, reason: "unsupported-locator" };
  }
  if (input.evidence.kind === "transaction-hash" && !HASH_PATTERN.test(input.evidence.value)) {
    return { ok: false, reason: "unsupported-locator" };
  }
  return { ok: true };
}

export function classifySameKeyDifferentPayload(input: {
  provider: AccountProvider;
  observed: "cdp-idempotency-error" | "eip-5720" | "untested";
}): {
  newExecutionIdentity: false;
  provesNonSubmission: false;
  storeDecision: "fail-closed" | "unknown";
  support: SupportLabel;
} {
  if (input.provider === "cdp-embedded" && input.observed === "cdp-idempotency-error") {
    return {
      newExecutionIdentity: false,
      provesNonSubmission: false,
      storeDecision: "fail-closed",
      support: "docs-claim",
    };
  }
  if (input.provider === "base-account" && input.observed === "eip-5720") {
    return {
      newExecutionIdentity: false,
      provesNonSubmission: false,
      storeDecision: "fail-closed",
      support: "docs-claim",
    };
  }
  return {
    newExecutionIdentity: false,
    provesNonSubmission: false,
    storeDecision: "unknown",
    support: "unknown",
  };
}

export function ordinaryRecoverLeavesUnknown(from: ReconciliationResult): ReconciliationResult {
  if (from.kind === "ambiguous" || from.kind === "authorized-no-evidence") return from;
  return from;
}

export function releaseAdmissionPreservesExecution(
  execution: ReconciliationResult,
  command: ReleaseAdmission,
  at: string,
): ReleaseAdmissionResult {
  return {
    admission: { state: "released", at, policyVersion: command.policyVersion },
    ownerResolution: { kind: "abandoned", at, reason: command.reason },
    execution,
    lateEvidence: "accepted",
  };
}

type EvidenceConflictDecision = "duplicate" | "advance" | "conflict" | "different-slot";
type ProviderStatusPayload = Extract<ProviderEvidence, { kind: "provider-status" }>['payload'];

const PROVIDER_STATUS_ADVANCES: Readonly<Record<ProviderStatusPayload, readonly ProviderStatusPayload[]>> = {
  unavailable: ["pending", "dropped", "confirmed", "failed"],
  pending: ["dropped", "confirmed", "failed"],
  dropped: [],
  confirmed: [],
  failed: [],
};

function sameProviderHandle(existing: ProviderHandle, incoming: ProviderHandle): boolean {
  if (existing.kind !== incoming.kind || existing.provider !== incoming.provider) return false;
  if (existing.kind === "submission-id" && incoming.kind === "submission-id") {
    return existing.value === incoming.value;
  }
  return existing.value.toLowerCase() === incoming.value.toLowerCase();
}

export function conflictingEvidenceDecision(
  existing: ProviderEvidence,
  incoming: ProviderEvidence,
): EvidenceConflictDecision {
  if (existing.kind !== incoming.kind) return "different-slot";
  if (existing.kind === "provider-status" && incoming.kind === "provider-status") {
    if (!sameProviderHandle(existing.handle, incoming.handle)) return "conflict";
    if (existing.payload === incoming.payload) return "duplicate";
    return PROVIDER_STATUS_ADVANCES[existing.payload].includes(incoming.payload) ? "advance" : "conflict";
  }
  if (existing.kind === "submission-id" && incoming.kind === "submission-id") {
    return existing.provider === incoming.provider && existing.value === incoming.value ? "duplicate" : "conflict";
  }
  if (existing.kind === "user-operation-hash" && incoming.kind === "user-operation-hash") {
    return existing.provider === incoming.provider && existing.value.toLowerCase() === incoming.value.toLowerCase()
      ? "duplicate"
      : "conflict";
  }
  if (existing.kind === "transaction-hash" && incoming.kind === "transaction-hash") {
    return existing.chainId === incoming.chainId && existing.value.toLowerCase() === incoming.value.toLowerCase()
      ? "duplicate"
      : "conflict";
  }
  return "conflict";
}
