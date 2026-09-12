import { describe, expect, test } from "bun:test";
import {
  classifyCdpSendInvocation,
  classifyEip5792Lookup,
  classifyEip5792SendInvocation,
} from "./provider-submission-contract";

const USER_OPERATION_HASH = `0x${"b".repeat(64)}` as const;

describe("provider submission contract", () => {
  test("CDP invoke-then-throw and provider idempotency errors remain ambiguous", () => {
    expect(classifyCdpSendInvocation({ stage: "invoked-then-threw" })).toEqual({
      classification: "ambiguous",
      reason: "send-user-operation-threw",
    });
    expect(classifyCdpSendInvocation({ stage: "invoked-then-threw", errorType: "already_exists" })).toEqual({
      classification: "ambiguous",
      reason: "cdp-already-exists-in-flight",
    });
    expect(classifyCdpSendInvocation({ stage: "invoked-then-threw", errorType: "idempotency_error" })).toEqual({
      classification: "ambiguous",
      reason: "cdp-idempotency-error",
    });
  });

  test("CDP distinguishes not-invoked from a returned provider handle", () => {
    expect(classifyCdpSendInvocation({ stage: "not-invoked", cause: "before-call-throw" })).toEqual({
      classification: "not-submitted",
      reason: "before-dispatch-throw",
    });
    expect(classifyCdpSendInvocation({ stage: "not-invoked", cause: "auth-invalid-unfunded-probe" })).toEqual({
      classification: "not-submitted",
      reason: "cdp-auth-rejected-before-accept",
    });
    expect(classifyCdpSendInvocation({ stage: "returned", userOperationHash: USER_OPERATION_HASH })).toEqual({
      classification: "submitted",
      handle: { kind: "user-operation-hash", provider: "cdp-embedded", value: USER_OPERATION_HASH },
    });
  });

  test("EIP-5792 user rejection is not submitted while 5720 and entered calls are ambiguous", () => {
    expect(classifyEip5792SendInvocation({ stage: "provider-error", code: 4001 })).toEqual({
      classification: "not-submitted",
      reason: "user-reject-4001",
    });
    expect(classifyEip5792SendInvocation({ stage: "provider-error", code: 5720 })).toEqual({
      classification: "ambiguous",
      reason: "eip-5720-duplicate-id",
    });
    expect(classifyEip5792SendInvocation({ stage: "not-invoked", cause: "before-dispatch-throw" })).toEqual({
      classification: "not-submitted",
      reason: "before-dispatch-throw",
    });
    expect(classifyEip5792SendInvocation({ stage: "invoked-then-threw", cause: "timeout" })).toEqual({
      classification: "ambiguous",
      reason: "transport-timeout",
    });
    expect(classifyEip5792SendInvocation({ stage: "returned", submissionId: "CallBundle-AbC123" })).toEqual({
      classification: "submitted",
      handle: { kind: "submission-id", provider: "base-account", value: "CallBundle-AbC123" },
    });
  });

  test("EIP-5792 lookup failures never prove non-submission", () => {
    for (const code of [5720, 5730, 4200, -32602]) {
      expect(classifyEip5792Lookup({ code }).notSubmitted).toBe(false);
    }
    expect(classifyEip5792Lookup({ code: 5720 })).toEqual({
      classification: "lookup-failure",
      notSubmitted: false,
      reason: "eip-5720-duplicate-id",
    });
  });
});
