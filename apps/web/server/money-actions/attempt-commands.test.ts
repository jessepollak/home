import { describe, expect, test } from "bun:test";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import {
  ATTEMPT_COMMAND_CONTRACT_VERSION,
  ATTEMPT_IMPLEMENTATION_TICKETS,
  COMPATIBILITY_ACTION_REVISION,
  canProduceAuthorized,
  claimAuthorization,
  classifyCdpSendInvocation,
  classifyEip5792Lookup,
  classifyEip5792SendInvocation,
  classifySameKeyDifferentPayload,
  compatibilityActionRevision,
  conflictingEvidenceDecision,
  cdpRecoveryMethods,
  eip5792RecoveryMethods,
  homeProviderRequestKey,
  isForbiddenReconcileLookup,
  mayAuthorizeNewSend,
  mayRecordProviderEvidence,
  ordinaryRecoverLeavesUnknown,
  projectClaimDisposition,
  providerRequestKeyAsEvidence,
  reconcileCapabilities,
  reconcileLookupForAttempt,
  releaseAdmissionPreservesExecution,
  type ClaimDispatch,
  type ClaimDispatchResult,
  type ExecutionAttempt,
  type ReconcileAttempt,
  type RecordProviderEvidence,
  type ReleaseAdmission,
} from "./attempt-commands";

const OWNER = {
  subject: "subject-a",
  address: "0x1111111111111111111111111111111111111111",
  chainId: 8453,
  accountProvider: "cdp-embedded",
} as const;
const ACTION_ID = "11111111-1111-4111-8111-111111111111";
const REVIEW_HASH = "a".repeat(64);
const USER_OP_HASH = `0x${"b".repeat(64)}` as const;
const UPPER_USER_OP_HASH = `0x${"B".repeat(64)}` as const;
const OTHER_USER_OP_HASH = `0x${"c".repeat(64)}` as const;
const TRANSACTION_HASH = `0x${"d".repeat(64)}` as const;
const UPPER_TRANSACTION_HASH = `0x${"D".repeat(64)}` as const;
const SUBMISSION_ID = "0xfixture-call-bundle";

function action(): PreparedMoneyAction {
  return {
    id: ACTION_ID,
    reviewHash: REVIEW_HASH,
    owner: OWNER,
    kind: "send",
    title: "Send USDC",
    calls: [{ to: "0x2222222222222222222222222222222222222222", data: "0x", value: "0" }],
    amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1", direction: "spend" }],
    warnings: [],
    createdAt: "2026-09-10T05:00:00.000Z",
    expiresAt: "2026-09-10T05:10:00.000Z",
  };
}

function attempt(overrides: Partial<ExecutionAttempt> = {}): ExecutionAttempt {
  return {
    attemptId: "attempt-1",
    sequence: 1,
    actionId: ACTION_ID,
    actionRevision: COMPATIBILITY_ACTION_REVISION,
    owner: OWNER,
    provider: "cdp-embedded",
    createdAt: "2026-09-10T05:01:00.000Z",
    dispatch: { phase: "authorized", version: 1 },
    providerRequestKey: homeProviderRequestKey({ provider: "cdp-embedded", actionId: ACTION_ID }),
    evidence: [],
    reconciliation: { kind: "authorized-no-evidence" },
    ownerResolution: { kind: "active" },
    admission: { state: "blocking" },
    attemptVersion: 1,
    ...overrides,
  };
}

describe("attempt command contract v1", () => {
  test("versions the command set and compatibility revision", () => {
    expect(ATTEMPT_COMMAND_CONTRACT_VERSION).toBe(1);
    expect(compatibilityActionRevision(action()).revision).toBe(1);
  });

  test("ClaimDispatch binds owner, reviewed plan, and Home correlation — not a locator", () => {
    const key = homeProviderRequestKey({ provider: "cdp-embedded", actionId: ACTION_ID });
    const command = {
      owner: OWNER,
      actionId: ACTION_ID,
      reviewHash: REVIEW_HASH,
      expectedActionRevision: COMPATIBILITY_ACTION_REVISION,
      provider: "cdp-embedded",
      providerRequestKey: key,
    } satisfies ClaimDispatch;

    expect(key.kind).toBe("home-correlation");
    expect(key.role).toBe("cdp-idempotency-header");
    expect(providerRequestKeyAsEvidence(key)).toEqual({
      ok: false,
      reason: "home-correlation-is-not-provider-evidence",
    });
    expect(command.providerRequestKey.kind).toBe("home-correlation");
  });

  test("only ClaimDispatch can produce authorized(v); recover never grants a new send", () => {
    expect(canProduceAuthorized("ClaimDispatch")).toBe(true);
    expect(canProduceAuthorized("RecordProviderEvidence")).toBe(false);
    expect(canProduceAuthorized("ReconcileAttempt")).toBe(false);
    expect(canProduceAuthorized("ReleaseAdmission")).toBe(false);

    expect(projectClaimDisposition(undefined)).toBe("dispatch");
    expect(claimAuthorization("dispatch")).toBe("first-wallet-dispatch");
    expect(projectClaimDisposition(attempt())).toBe("recover");
    expect(claimAuthorization("recover")).toBe("none");
    expect(projectClaimDisposition(attempt({
      dispatch: { phase: "closed", version: 1 },
      reconciliation: { kind: "confirmed", transactionHash: `0x${"d".repeat(64)}`, verifiedExecution: true },
    }))).toBe("terminal");
    expect(claimAuthorization("terminal")).toBe("none");
  });

  test("CDP: invoke-then-throw is ambiguous and must not authorize a new send (#175)", () => {
    const threw = classifyCdpSendInvocation({ stage: "invoked-then-threw" });
    expect(threw).toEqual({ classification: "ambiguous", reason: "send-user-operation-threw" });
    expect(mayAuthorizeNewSend(threw)).toBe(false);

    expect(classifyCdpSendInvocation({ stage: "invoked-then-threw", errorType: "already_exists" })).toEqual({
      classification: "ambiguous",
      reason: "cdp-already-exists-in-flight",
    });
    expect(classifyCdpSendInvocation({ stage: "invoked-then-threw", errorType: "idempotency_error" })).toEqual({
      classification: "ambiguous",
      reason: "cdp-idempotency-error",
    });
    expect(mayAuthorizeNewSend(classifyCdpSendInvocation({
      stage: "invoked-then-threw",
      errorType: "idempotency_error",
    }))).toBe(false);

    const before = classifyCdpSendInvocation({ stage: "not-invoked", cause: "before-call-throw" });
    expect(before.classification).toBe("not-submitted");
    expect(mayAuthorizeNewSend(before)).toBe(true);

    const returned = classifyCdpSendInvocation({ stage: "returned", userOperationHash: USER_OP_HASH });
    expect(returned).toEqual({
      classification: "submitted",
      handle: { kind: "user-operation-hash", provider: "cdp-embedded", value: USER_OP_HASH },
    });
    expect(mayAuthorizeNewSend(returned)).toBe(false);
  });

  test("CDP: GET-by-idempotency-key is unsupported; reconcile has no such lookup (#175)", () => {
    expect(cdpRecoveryMethods()).toEqual([
      { method: "get-user-operation-by-hash", support: "supported", requires: "recorded-user-operation-hash" },
      { method: "get-by-idempotency-key", support: "unsupported", source: "#175" },
      { method: "same-key-replay", support: "docs-claim", source: "#175", live: "untested" },
    ]);
    expect(isForbiddenReconcileLookup({ kind: "cdp-get-by-idempotency-key" })).toBe(true);
    expect(reconcileLookupForAttempt(attempt())).toEqual({ kind: "none", reason: "reference-free-ambiguous" });
    expect(reconcileLookupForAttempt(attempt({
      evidence: [{
        evidence: { kind: "user-operation-hash", provider: "cdp-embedded", value: USER_OP_HASH },
        provenance: { source: "provider-return", observedAt: "2026-09-10T05:01:02.000Z" },
        recordedAt: "2026-09-10T05:01:02.000Z",
      }],
    }))).toEqual({ kind: "recorded-user-operation-hash", userOperationHash: USER_OP_HASH });
  });

  test("recovery prefers a transaction hash over user-operation or provider submission handles", () => {
    const transactionEvidence = {
      evidence: { kind: "transaction-hash", chainId: 8453, value: TRANSACTION_HASH },
      provenance: { source: "verified-receipt", observedAt: "2026-09-10T05:01:04.000Z" },
      recordedAt: "2026-09-10T05:01:04.000Z",
    } as const;

    expect(reconcileLookupForAttempt(attempt({
      evidence: [
        {
          evidence: { kind: "user-operation-hash", provider: "cdp-embedded", value: USER_OP_HASH },
          provenance: { source: "provider-return", observedAt: "2026-09-10T05:01:02.000Z" },
          recordedAt: "2026-09-10T05:01:02.000Z",
        },
        transactionEvidence,
      ],
    }))).toEqual({ kind: "recorded-transaction-hash", transactionHash: TRANSACTION_HASH });

    expect(reconcileLookupForAttempt(attempt({
      provider: "base-account",
      providerRequestKey: homeProviderRequestKey({ provider: "base-account", actionId: ACTION_ID }),
      evidence: [
        {
          evidence: { kind: "submission-id", provider: "base-account", value: SUBMISSION_ID },
          provenance: { source: "provider-return", observedAt: "2026-09-10T05:01:02.000Z" },
          recordedAt: "2026-09-10T05:01:02.000Z",
        },
        transactionEvidence,
      ],
    }))).toEqual({ kind: "recorded-transaction-hash", transactionHash: TRANSACTION_HASH });
  });

  test("EIP-5792: action UUID is not evidence; preallocated submissionId is rejected (#176)", () => {
    const key = homeProviderRequestKey({ provider: "base-account", actionId: ACTION_ID });
    expect(key.role).toBe("eip-5792-request-id");
    expect(providerRequestKeyAsEvidence(key).ok).toBe(false);

    expect(mayRecordProviderEvidence({
      homeActionId: ACTION_ID,
      evidence: { kind: "submission-id", provider: "base-account", value: ACTION_ID },
      provenance: { source: "preallocated-action-uuid" },
    })).toEqual({ ok: false, reason: "preallocated-locator" });

    expect(mayRecordProviderEvidence({
      homeActionId: ACTION_ID,
      evidence: { kind: "submission-id", provider: "base-account", value: ACTION_ID },
      provenance: { source: "home-correlation-only" },
    })).toEqual({ ok: false, reason: "home-correlation-as-evidence" });

    expect(mayRecordProviderEvidence({
      homeActionId: ACTION_ID,
      evidence: { kind: "submission-id", provider: "base-account", value: ACTION_ID },
      provenance: { source: "provider-status-lookup", observedAt: "2026-09-10T05:01:03.000Z", locator: {
        kind: "submission-id",
        provider: "base-account",
        value: ACTION_ID,
      } },
    })).toEqual({ ok: false, reason: "unsupported-locator" });

    expect(mayRecordProviderEvidence({
      homeActionId: ACTION_ID,
      evidence: { kind: "submission-id", provider: "base-account", value: SUBMISSION_ID },
      provenance: { source: "provider-return", observedAt: "2026-09-10T05:01:02.000Z" },
    })).toEqual({ ok: true });

    expect(mayRecordProviderEvidence({
      homeActionId: ACTION_ID,
      evidence: {
        kind: "provider-status",
        handle: { kind: "submission-id", provider: "base-account", value: ACTION_ID },
        observedAt: "2026-09-10T05:01:03.000Z",
        payload: "pending",
      },
      provenance: { source: "provider-status-lookup", observedAt: "2026-09-10T05:01:03.000Z", locator: {
        kind: "submission-id",
        provider: "base-account",
        value: ACTION_ID,
      } },
    })).toEqual({ ok: false, reason: "unsupported-locator" });

    expect(mayRecordProviderEvidence({
      homeActionId: ACTION_ID,
      evidence: {
        kind: "provider-status",
        handle: { kind: "submission-id", provider: "base-account", value: SUBMISSION_ID },
        observedAt: "2026-09-10T05:01:03.000Z",
        payload: "pending",
      },
      provenance: { source: "provider-status-lookup", observedAt: "2026-09-10T05:01:03.000Z", locator: {
        kind: "submission-id",
        provider: "base-account",
        value: SUBMISSION_ID,
      } },
    })).toEqual({ ok: true });
  });

  test("status-wrapped handles receive the same hash and provenance validation as direct evidence", () => {
    const malformedUserOperationHash = "0xnot-a-user-operation-hash" as `0x${string}`;

    expect(mayRecordProviderEvidence({
      homeActionId: ACTION_ID,
      evidence: { kind: "user-operation-hash", provider: "cdp-embedded", value: USER_OP_HASH },
      provenance: { source: "provider-return", observedAt: "2026-09-10T05:01:02.000Z" },
    })).toEqual({ ok: true });

    expect(mayRecordProviderEvidence({
      homeActionId: ACTION_ID,
      evidence: {
        kind: "provider-status",
        handle: { kind: "user-operation-hash", provider: "cdp-embedded", value: USER_OP_HASH },
        observedAt: "2026-09-10T05:01:03.000Z",
        payload: "pending",
      },
      provenance: { source: "provider-status-lookup", observedAt: "2026-09-10T05:01:03.000Z", locator: {
        kind: "user-operation-hash",
        provider: "cdp-embedded",
        value: USER_OP_HASH,
      } },
    })).toEqual({ ok: true });

    expect(mayRecordProviderEvidence({
      homeActionId: ACTION_ID,
      evidence: {
        kind: "provider-status",
        handle: { kind: "user-operation-hash", provider: "cdp-embedded", value: malformedUserOperationHash },
        observedAt: "2026-09-10T05:01:03.000Z",
        payload: "pending",
      },
      provenance: { source: "provider-status-lookup", observedAt: "2026-09-10T05:01:03.000Z", locator: {
        kind: "user-operation-hash",
        provider: "cdp-embedded",
        value: malformedUserOperationHash,
      } },
    })).toEqual({ ok: false, reason: "unsupported-locator" });

    expect(mayRecordProviderEvidence({
      homeActionId: ACTION_ID,
      evidence: {
        kind: "provider-status",
        handle: { kind: "user-operation-hash", provider: "cdp-embedded", value: USER_OP_HASH },
        observedAt: "2026-09-10T05:01:03.000Z",
        payload: "pending",
      },
      provenance: { source: "provider-return", observedAt: "2026-09-10T05:01:03.000Z" },
    })).toEqual({ ok: false, reason: "missing-provider-return" });
  });

  test("EIP-5792: 5720 is prior-submission / ambiguous, never rejected (#176)", () => {
    const duplicate = classifyEip5792SendInvocation({ stage: "provider-error", code: 5720 });
    expect(duplicate).toEqual({ classification: "ambiguous", reason: "eip-5720-duplicate-id" });
    expect(mayAuthorizeNewSend(duplicate)).toBe(false);

    const userReject = classifyEip5792SendInvocation({ stage: "provider-error", code: 4001 });
    expect(userReject).toEqual({ classification: "not-submitted", reason: "user-reject-4001" });
    expect(mayAuthorizeNewSend(userReject)).toBe(true);

    expect(classifyEip5792SendInvocation({ stage: "not-invoked", cause: "before-dispatch-throw" }).classification)
      .toBe("not-submitted");
    expect(classifyEip5792SendInvocation({ stage: "invoked-then-threw", cause: "timeout" })).toEqual({
      classification: "ambiguous",
      reason: "transport-timeout",
    });

    expect(classifyEip5792Lookup({ code: 5720 })).toEqual({
      classification: "lookup-failure",
      notSubmitted: false,
      reason: "eip-5720-duplicate-id",
    });
    expect(classifyEip5792Lookup({ code: 5730 }).notSubmitted).toBe(false);
    expect(classifyEip5792Lookup({ code: 4200 }).notSubmitted).toBe(false);
    expect(classifyEip5792Lookup({ code: -32602 }).notSubmitted).toBe(false);

    expect(eip5792RecoveryMethods().map((method) => method.method)).toEqual([
      "get-calls-status-by-returned-id",
      "get-calls-status-by-action-uuid",
      "echoed-request-id-as-locator",
    ]);
    expect(isForbiddenReconcileLookup({ kind: "eip-5792-get-by-action-uuid" })).toBe(true);
  });

  test("same provider key + different payload fails closed where supported; otherwise unknown", () => {
    expect(classifySameKeyDifferentPayload({
      provider: "cdp-embedded",
      observed: "cdp-idempotency-error",
    })).toEqual({
      newExecutionIdentity: false,
      provesNonSubmission: false,
      storeDecision: "fail-closed",
      support: "docs-claim",
    });
    expect(classifySameKeyDifferentPayload({
      provider: "base-account",
      observed: "eip-5720",
    })).toEqual({
      newExecutionIdentity: false,
      provesNonSubmission: false,
      storeDecision: "fail-closed",
      support: "docs-claim",
    });
    expect(classifySameKeyDifferentPayload({
      provider: "cdp-embedded",
      observed: "untested",
    })).toEqual({
      newExecutionIdentity: false,
      provesNonSubmission: false,
      storeDecision: "unknown",
      support: "unknown",
    });
  });

  test("provider status observations advance monotonically without changing handle identity", () => {
    const pending = {
      kind: "provider-status",
      handle: { kind: "user-operation-hash", provider: "cdp-embedded", value: USER_OP_HASH },
      observedAt: "2026-09-10T05:01:03.000Z",
      payload: "pending",
    } as const;
    const confirmed = {
      ...pending,
      observedAt: "2026-09-10T05:01:04.000Z",
      payload: "confirmed",
    } as const;

    expect(conflictingEvidenceDecision(pending, confirmed)).toBe("advance");
    expect(conflictingEvidenceDecision(confirmed, pending)).toBe("conflict");
    expect(conflictingEvidenceDecision(pending, {
      ...confirmed,
      handle: { ...confirmed.handle, value: OTHER_USER_OP_HASH },
    })).toBe("conflict");
  });

  test("opaque submission IDs compare exactly while chain hashes use canonical comparison", () => {
    const opaqueSubmission = {
      kind: "submission-id",
      provider: "base-account",
      value: "CallBundle-AbC123",
    } as const;

    expect(conflictingEvidenceDecision(opaqueSubmission, { ...opaqueSubmission })).toBe("duplicate");
    expect(conflictingEvidenceDecision(opaqueSubmission, {
      ...opaqueSubmission,
      value: "callbundle-abc123",
    })).toBe("conflict");
    expect(conflictingEvidenceDecision({
      kind: "provider-status",
      handle: opaqueSubmission,
      observedAt: "2026-09-10T05:01:03.000Z",
      payload: "pending",
    }, {
      kind: "provider-status",
      handle: { ...opaqueSubmission, value: "callbundle-abc123" },
      observedAt: "2026-09-10T05:01:04.000Z",
      payload: "confirmed",
    })).toBe("conflict");

    expect(conflictingEvidenceDecision({
      kind: "user-operation-hash",
      provider: "cdp-embedded",
      value: USER_OP_HASH,
    }, {
      kind: "user-operation-hash",
      provider: "cdp-embedded",
      value: UPPER_USER_OP_HASH,
    })).toBe("duplicate");
    expect(conflictingEvidenceDecision({
      kind: "transaction-hash",
      chainId: 8453,
      value: TRANSACTION_HASH,
    }, {
      kind: "transaction-hash",
      chainId: 8453,
      value: UPPER_TRANSACTION_HASH,
    })).toBe("duplicate");
  });

  test("RecordProviderEvidence is idempotent on the same fact and fails closed on conflict", () => {
    const command = {
      owner: OWNER,
      actionId: ACTION_ID,
      attemptId: "attempt-1",
      dispatchVersion: 1,
      evidence: { kind: "user-operation-hash", provider: "cdp-embedded", value: USER_OP_HASH },
      provenance: { source: "provider-return", observedAt: "2026-09-10T05:01:02.000Z" },
      writeIdempotencyKey: "evidence-upload-1",
    } satisfies RecordProviderEvidence;

    expect(conflictingEvidenceDecision(command.evidence, command.evidence)).toBe("duplicate");
    expect(conflictingEvidenceDecision(command.evidence, {
      kind: "user-operation-hash",
      provider: "cdp-embedded",
      value: OTHER_USER_OP_HASH,
    })).toBe("conflict");
    expect(conflictingEvidenceDecision(command.evidence, {
      kind: "transaction-hash",
      chainId: 8453,
      value: `0x${"d".repeat(64)}`,
    })).toBe("different-slot");
  });

  test("ReconcileAttempt is read-only and cannot expire unknown (#110 / #134)", () => {
    const command = {
      owner: OWNER,
      actionId: ACTION_ID,
      attemptId: "attempt-1",
      expectedAttemptVersion: 1,
      lookup: { kind: "none", reason: "reference-free-ambiguous" },
    } satisfies ReconcileAttempt;
    expect(command.lookup).toEqual({ kind: "none", reason: "reference-free-ambiguous" });

    expect(reconcileCapabilities()).toEqual({
      mayClaim: false,
      mayInvokeWalletSubmit: false,
      mayAuthorizeDispatch: false,
      mayAppendStrongerEvidence: true,
      mayAdvanceProjectionMonotonically: true,
      mayExpireUnknown: false,
    });
    expect(ordinaryRecoverLeavesUnknown({ kind: "ambiguous" })).toEqual({ kind: "ambiguous" });
    expect(ordinaryRecoverLeavesUnknown({ kind: "authorized-no-evidence" })).toEqual({
      kind: "authorized-no-evidence",
    });
    expect(isForbiddenReconcileLookup({ kind: "prove-by-resubmit" })).toBe(true);
  });

  test("ReleaseAdmission is independent of execution and still accepts late evidence", () => {
    const command = {
      owner: OWNER,
      actionId: ACTION_ID,
      attemptId: "attempt-1",
      policyVersion: "admission-1",
      reason: "owner-request",
    } satisfies ReleaseAdmission;
    const released = releaseAdmissionPreservesExecution({ kind: "ambiguous" }, command, "2026-09-10T05:20:00.000Z");

    expect(released.admission.state).toBe("released");
    expect(released.ownerResolution.kind).toBe("abandoned");
    expect(released.execution).toEqual({ kind: "ambiguous" });
    expect(released.lateEvidence).toBe("accepted");
  });

  test("recover / terminal results compile without a dispatch grant", () => {
    const recovered: Extract<ClaimDispatchResult, { disposition: "recover" }> = {
      disposition: "recover",
      action: compatibilityActionRevision(action()),
      attempt: attempt(),
      authorization: "none",
    };
    const terminal: Extract<ClaimDispatchResult, { disposition: "terminal" }> = {
      disposition: "terminal",
      action: compatibilityActionRevision(action()),
      result: { kind: "rejected", reason: "user-reject-4001" },
      authorization: "none",
    };
    expect(recovered.authorization).toBe("none");
    expect(terminal.authorization).toBe("none");
  });

  test("§4 implementation tickets are enumerated for Hunter and forbid Soft Pass regressions", () => {
    expect(ATTEMPT_IMPLEMENTATION_TICKETS.map((ticket) => ticket.key)).toEqual([
      "provider-handle-journal",
      "attempt-persistence",
      "admission-release-late-evidence",
      "provider-recovery-where-proven",
      "store-fault-gates",
    ]);
    const recovery = ATTEMPT_IMPLEMENTATION_TICKETS.find((ticket) => ticket.key === "provider-recovery-where-proven");
    expect(recovery?.mustNot).toEqual([
      "get-by-key",
      "uuid-as-preallocated-submission-id",
      "5720-as-rejected",
      "prove-by-resubmit",
    ]);
    const admission = ATTEMPT_IMPLEMENTATION_TICKETS.find((ticket) => ticket.key === "admission-release-late-evidence");
    expect(admission?.coord).toEqual(["#110", "#134"]);
    expect(admission?.mustNot).toContain("unknown-to-expired-on-recover");
  });
});
