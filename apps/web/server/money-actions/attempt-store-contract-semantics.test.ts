import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import type { TransferReceiptStatus } from "@/server/money-actions/receipt";
import {
  compatibilityActionRevision,
  homeProviderRequestKey,
  type ClaimDispatch,
  type ExecutionAttempt,
  type RecordProviderEvidence,
} from "./attempt-commands";
import {
  ATTEMPT_STORE_CONTRACT_VERSION,
  ATTEMPT_STORE_VERSION_RULES,
  attemptStoreError,
  createTrustedVerifiedObservation,
  legacyAttemptId,
  legacyCompatibilityEnvelope,
  sameAttemptFact,
  snapshotAttemptAction,
  snapshotExecutionAttempt,
  validateClaimDispatch,
  validateIssueAttemptAction,
  validateRecordProviderEvidence,
  type AttemptStoreResourceFactory,
  type MoneyActionAttemptStore,
} from "./attempt-store";

const OWNER = {
  subject: "subject-a",
  address: "0x1111111111111111111111111111111111111111",
  chainId: 8453,
  accountProvider: "cdp-embedded",
} as const;
const BASE_OWNER = {
  ...OWNER,
  accountProvider: "base-account",
} as const;

function preparedAction(overrides: Partial<PreparedMoneyAction> = {}): PreparedMoneyAction {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    reviewHash: "a".repeat(64),
    owner: OWNER,
    kind: "save-deposit",
    title: "Deposit USDC",
    calls: [{ to: "0x3333333333333333333333333333333333333333", data: "0x1234", value: "0" }],
    amounts: [{
      assetId: "base:usdc",
      symbol: "USDC",
      decimals: 6,
      amountBaseUnits: "1000000",
      direction: "spend",
    }],
    warnings: [],
    createdAt: "2026-09-11T01:00:00.000Z",
    expiresAt: "2026-09-11T01:10:00.000Z",
    ...overrides,
  };
}

function confirmedReceipt(input: {
  transactionHash: `0x${string}`;
  verifiedExecution: NonNullable<Extract<TransferReceiptStatus, { status: "confirmed" }>["verifiedExecution"]>;
}): Extract<TransferReceiptStatus, { status: "confirmed" }> {
  return {
    status: "confirmed",
    transactionHash: input.transactionHash,
    blockNumber: "123",
    success: true,
    verifiedExecution: input.verifiedExecution,
  };
}

function executionAttempt(): ExecutionAttempt {
  return {
    attemptId: "attempt-generated-by-store",
    sequence: 1,
    actionId: preparedAction().id,
    actionRevision: 1,
    owner: OWNER,
    provider: "cdp-embedded",
    createdAt: "2026-09-11T01:01:00.000Z",
    dispatch: { phase: "authorized", version: 1 },
    providerRequestKey: homeProviderRequestKey({ provider: "cdp-embedded", actionId: preparedAction().id }),
    evidence: [],
    reconciliation: { kind: "authorized-no-evidence" },
    ownerResolution: { kind: "active" },
    admission: { state: "blocking" },
    attemptVersion: 1,
  };
}

test("exports the canonical v1 store and resource factory types without activating an adapter", () => {
  const acceptsStore = (store: MoneyActionAttemptStore) => void store;
  const acceptsFactory = (factory: AttemptStoreResourceFactory) => void factory;
  expect(typeof acceptsStore).toBe("function");
  expect(typeof acceptsFactory).toBe("function");
  expect(ATTEMPT_STORE_CONTRACT_VERSION).toBe(1);
});

test("validates v1 claim fields and keeps action/provider/request-key bindings exact", () => {
  const action = preparedAction();
  const command: ClaimDispatch = {
    owner: OWNER,
    actionId: action.id,
    reviewHash: action.reviewHash,
    expectedActionRevision: 1,
    provider: "cdp-embedded",
    providerRequestKey: homeProviderRequestKey({ provider: "cdp-embedded", actionId: action.id }),
  };
  expect(validateClaimDispatch(command)).toEqual({ ok: true });
  expect(validateClaimDispatch({
    ...command,
    providerRequestKey: { ...command.providerRequestKey, value: "other-action" },
  })).toEqual({ ok: false, reason: "invalid-command" });
  expect(validateClaimDispatch({ ...command, expectedActionRevision: 2 })).toEqual({
    ok: false,
    reason: "invalid-command",
  });
});

test("allows only digest-verified calldata substitution in a transient sensitive overlay", () => {
  const data = "0xfeed" as const;
  const dataHash = createHash("sha256").update(data).digest("hex");
  const sensitive = compatibilityActionRevision(preparedAction({
    sensitivePayload: true,
    calls: [{
      to: "0x3333333333333333333333333333333333333333",
      data,
      dataHash,
      value: "7",
    }],
  }));
  const durable = {
    ...sensitive,
    calls: sensitive.calls.map((call) => ({ ...call, data: "0x" as const })),
  };
  const input = {
    durableAction: durable,
    transientSensitivePayload: { action: sensitive, expiresAt: sensitive.expiresAt },
  } as const;
  expect(validateIssueAttemptAction(input)).toEqual({ ok: true });
  const snapshot = snapshotAttemptAction(input);
  expect(snapshot).toMatchObject({
    action: { calls: [{ data: "0x", dataHash, value: "7" }] },
    sensitivePayloadStorage: "transient-only",
  });
  expect(JSON.stringify(snapshot)).not.toContain(data);

  const alteredRecipient = {
    ...sensitive,
    calls: [{ ...sensitive.calls[0]!, to: "0x4444444444444444444444444444444444444444" as const }],
  };
  const alteredValue = {
    ...sensitive,
    calls: [{ ...sensitive.calls[0]!, value: "8" }],
  };
  const alteredCalldata = {
    ...sensitive,
    calls: [{ ...sensitive.calls[0]!, data: "0xbeef" as const }],
  };
  const copiedWrongDigest = "c".repeat(64);
  const alteredDigest = {
    durableAction: {
      ...durable,
      calls: [{ ...durable.calls[0]!, dataHash: copiedWrongDigest }],
    },
    transientSensitivePayload: {
      action: {
        ...sensitive,
        calls: [{ ...sensitive.calls[0]!, dataHash: copiedWrongDigest }],
      },
      expiresAt: sensitive.expiresAt,
    },
  };

  for (const action of [alteredRecipient, alteredValue, alteredCalldata]) {
    expect(validateIssueAttemptAction({
      ...input,
      transientSensitivePayload: { action, expiresAt: sensitive.expiresAt },
    })).toEqual({ ok: false, reason: "invalid-command" });
  }
  expect(validateIssueAttemptAction(alteredDigest)).toEqual({ ok: false, reason: "invalid-command" });
  expect(validateIssueAttemptAction({ ...input, durableAction: sensitive })).toEqual({
    ok: false,
    reason: "invalid-command",
  });
});

test("returns owner-scoped action and attempt values as defensive immutable snapshots", () => {
  const action = compatibilityActionRevision(preparedAction());
  const actionSnapshot = snapshotAttemptAction({ durableAction: action });
  const attempt = executionAttempt();
  const attemptSnapshot = snapshotExecutionAttempt(attempt);

  action.calls[0]!.data = "0xbeef";
  attempt.owner.subject = "mutated";
  expect(actionSnapshot.action.calls[0]?.data).toBe("0x1234");
  expect(attemptSnapshot.owner.subject).toBe("subject-a");
  expect(Object.isFrozen(actionSnapshot)).toBe(true);
  expect(Object.isFrozen(actionSnapshot.action.calls)).toBe(true);
  expect(Object.isFrozen(attemptSnapshot.owner)).toBe(true);
  expect(() => {
    (actionSnapshot.action as { title: string }).title = "changed";
  }).toThrow();
});

test("preserves legacy truth losslessly without inventing verification or non-submission", () => {
  const operation = {
    action: preparedAction(),
    status: "unknown" as const,
    attemptCount: 3,
    claimedAt: "2026-09-11T01:01:00.000Z",
    abandonedAt: "2026-09-11T01:05:00.000Z",
    submissionId: "0xAbCd-provider-ID",
    transactionHash: `0x${"c".repeat(64)}` as const,
    userOperationHash: `0x${"d".repeat(64)}` as const,
    createdAt: "2026-09-11T01:00:00.000Z",
    updatedAt: "2026-09-11T01:06:00.000Z",
  };
  const envelope = legacyCompatibilityEnvelope(operation);

  expect(envelope).toMatchObject({
    provenance: {
      status: "legacy-unknown",
      references: "legacy-unknown",
      dispatch: "legacy-unknown",
    },
    status: "unknown",
    attemptCount: 3,
    claimedAt: operation.claimedAt,
    abandonedAt: operation.abandonedAt,
    references: {
      submissionId: { value: operation.submissionId, provenance: "legacy-unknown" },
      transactionHash: { value: operation.transactionHash, provenance: "legacy-unknown" },
      userOperationHash: { value: operation.userOperationHash, provenance: "legacy-unknown" },
    },
    mappedAttempt: {
      source: "legacy-deterministic",
      attemptId: legacyAttemptId(operation.action.id, 3),
      sequence: 3,
    },
    dispatchEligibility: "non-dispatchable",
    submissionCertainty: "not-asserted",
  });
  expect(envelope.verifiedExecutionKey).toBeUndefined();
  expect(envelope.contradictions).toEqual([]);
});

test("keeps reference-free claimed and contradictory legacy rows non-dispatchable", () => {
  const referenceFree = legacyCompatibilityEnvelope({
    action: preparedAction(),
    status: "submitting",
    attemptCount: 1,
    claimedAt: "2026-09-11T01:01:00.000Z",
    createdAt: "2026-09-11T01:00:00.000Z",
    updatedAt: "2026-09-11T01:01:00.000Z",
  });
  expect(referenceFree.dispatchEligibility).toBe("non-dispatchable");
  expect(referenceFree.submissionCertainty).toBe("not-asserted");
  expect(referenceFree.contradictions).toEqual([]);

  const contradictory = legacyCompatibilityEnvelope({
    action: preparedAction(),
    status: "prepared",
    attemptCount: 0,
    submissionId: "provider-returned-id",
    createdAt: "2026-09-11T01:00:00.000Z",
    updatedAt: "2026-09-11T01:01:00.000Z",
  });
  expect(contradictory.dispatchEligibility).toBe("non-dispatchable");
  expect(contradictory.contradictions).toEqual([
    "prepared-with-attempt-facts",
    "reference-without-attempt",
  ]);
});

test("treats abandonment and verified execution keys as historical attempt indicators", () => {
  const base = {
    action: preparedAction(),
    status: "prepared" as const,
    attemptCount: 0,
    createdAt: "2026-09-11T01:00:00.000Z",
    updatedAt: "2026-09-11T01:02:00.000Z",
  };
  const verifiedExecutionKey = `8453:transaction:0x${"c".repeat(64)}`;
  const cases = [
    {
      envelope: legacyCompatibilityEnvelope({
        ...base,
        abandonedAt: "2026-09-11T01:01:00.000Z",
      }),
      contradictions: ["prepared-with-attempt-facts"],
    },
    {
      envelope: legacyCompatibilityEnvelope(base, { verifiedExecutionKey }),
      contradictions: ["prepared-with-attempt-facts", "verified-key-without-terminal-status"],
    },
    {
      envelope: legacyCompatibilityEnvelope({
        ...base,
        abandonedAt: "2026-09-11T01:01:00.000Z",
      }, { verifiedExecutionKey }),
      contradictions: ["prepared-with-attempt-facts", "verified-key-without-terminal-status"],
    },
  ] as const;

  for (const { envelope, contradictions } of cases) {
    expect(envelope.dispatchEligibility).toBe("non-dispatchable");
    expect(envelope.mappedAttempt).toEqual({
      source: "legacy-deterministic",
      attemptId: legacyAttemptId(base.action.id, 1),
      sequence: 1,
    });
    expect(envelope.submissionCertainty).toBe("not-asserted");
    expect(envelope.contradictions).toEqual(contradictions);
  }
});

test("preserves a legacy verified execution key exactly but does not infer one from terminal status", () => {
  const terminal = {
    action: preparedAction(),
    status: "confirmed" as const,
    attemptCount: 1,
    claimedAt: "2026-09-11T01:01:00.000Z",
    transactionHash: `0x${"c".repeat(64)}` as const,
    createdAt: "2026-09-11T01:00:00.000Z",
    updatedAt: "2026-09-11T01:02:00.000Z",
  };
  expect(legacyCompatibilityEnvelope(terminal).verifiedExecutionKey).toBeUndefined();
  expect(legacyCompatibilityEnvelope(terminal, {
    verifiedExecutionKey: `8453:transaction:0x${"c".repeat(64)}`,
  }).verifiedExecutionKey).toEqual({
    value: `8453:transaction:0x${"c".repeat(64)}`,
    provenance: "legacy-verified-execution-key",
  });
});

test("locks action, attempt, and dispatch version semantics to the v1 command fields", () => {
  expect(ATTEMPT_STORE_VERSION_RULES).toEqual({
    commandContractVersion: 1,
    compatibilityActionRevision: 1,
    initialAttemptVersion: 1,
    initialDispatchVersion: 1,
    attemptIdentityAuthority: "store",
    duplicateFactChangesAttemptVersion: false,
    newFactIncrementsAttemptVersionBy: 1,
    dispatchVersionIsStableForAttempt: true,
  });
  expect(Object.isFrozen(ATTEMPT_STORE_VERSION_RULES)).toBe(true);
  expect(() => legacyAttemptId(preparedAction().id, 0)).toThrow("invalid-legacy-attempt-identity");
});

test("uses same-fact idempotence for canonical hashes and byte-exact opaque handles", () => {
  const upperHash = `0x${"A".repeat(64)}` as const;
  const lowerHash = upperHash.toLowerCase() as `0x${string}`;
  expect(sameAttemptFact(
    { kind: "transaction-hash", chainId: 8453, value: upperHash },
    { kind: "transaction-hash", chainId: 8453, value: lowerHash },
  )).toBe(true);
  expect(sameAttemptFact(
    { kind: "submission-id", provider: "base-account", value: "Opaque-ID" },
    { kind: "submission-id", provider: "base-account", value: "opaque-id" },
  )).toBe(false);
});

test("rejects invalid evidence commands before a store can mutate or authorize dispatch", () => {
  const command: RecordProviderEvidence = {
    owner: OWNER,
    actionId: preparedAction().id,
    attemptId: "attempt-1",
    dispatchVersion: 1,
    evidence: {
      kind: "user-operation-hash",
      provider: "cdp-embedded",
      value: `0x${"d".repeat(64)}`,
    },
    provenance: { source: "provider-return", observedAt: "2026-09-11T01:02:00.000Z" },
    writeIdempotencyKey: "upload-1",
  };
  expect(validateRecordProviderEvidence(command)).toEqual({ ok: true });
  expect(validateRecordProviderEvidence({ ...command, dispatchVersion: 0 })).toEqual({
    ok: false,
    reason: "invalid-command",
  });
});

test("brands trusted verified observations with exact evidence and both version rechecks", () => {
  const transactionHash = `0x${"C".repeat(64)}` as const;
  const evidence = {
    evidence: { kind: "transaction-hash" as const, chainId: 8453 as const, value: transactionHash },
    provenance: { source: "verified-receipt" as const, observedAt: "2026-09-11T01:03:00.000Z" },
    recordedAt: "2026-09-11T01:03:00.000Z",
  };
  const receipt = confirmedReceipt({
    transactionHash,
    verifiedExecution: { chainId: 8453, kind: "transaction", hash: transactionHash },
  });
  const observation = createTrustedVerifiedObservation({
    owner: OWNER,
    actionId: preparedAction().id,
    attemptId: "attempt-1",
    expectedAttemptVersion: 2,
    expectedDispatchVersion: 1,
    expectedEvidence: { evidence, comparison: "exact-recorded-fact" },
    verificationLookup: { kind: "transaction-hash", chainId: 8453, value: transactionHash },
    verifiedExecution: receipt.verifiedExecution!,
    result: { kind: "confirmed", transactionHash: receipt.transactionHash, verifiedExecution: true },
    observedAt: "2026-09-11T01:04:00.000Z",
  });
  expect(observation).toMatchObject({
    expectedAttemptVersion: 2,
    expectedDispatchVersion: 1,
    expectedEvidence: { comparison: "exact-recorded-fact", evidence },
    verificationLookup: { kind: "transaction-hash", chainId: 8453, value: transactionHash.toLowerCase() },
    verifiedExecution: { hash: transactionHash.toLowerCase() },
    result: { transactionHash: transactionHash.toLowerCase() },
    applicationRecheck: "owner-provider-action-attempt-versions-exact-evidence-lookup-execution-result",
  });
  expect(Object.isFrozen(observation.expectedEvidence.evidence)).toBe(true);
});

test("rejects unrelated transaction evidence, execution identities, and results", () => {
  const evidenceHash = `0x${"a".repeat(64)}` as const;
  const executionHash = `0x${"b".repeat(64)}` as const;
  const resultHash = `0x${"c".repeat(64)}` as const;
  const evidence = {
    evidence: { kind: "transaction-hash" as const, chainId: 8453 as const, value: evidenceHash },
    provenance: { source: "verified-receipt" as const, observedAt: "2026-09-11T01:03:00.000Z" },
    recordedAt: "2026-09-11T01:03:00.000Z",
  };
  const base = {
    owner: OWNER,
    actionId: preparedAction().id,
    attemptId: "attempt-1",
    expectedAttemptVersion: 2,
    expectedDispatchVersion: 1,
    expectedEvidence: { evidence, comparison: "exact-recorded-fact" as const },
    verificationLookup: { kind: "transaction-hash" as const, chainId: 8453 as const, value: evidenceHash },
    observedAt: "2026-09-11T01:04:00.000Z",
  };
  const mismatches = [
    {
      verifiedExecution: { chainId: 8453 as const, kind: "transaction" as const, hash: evidenceHash },
      result: { kind: "confirmed" as const, transactionHash: resultHash, verifiedExecution: true as const },
    },
    {
      verifiedExecution: { chainId: 8453 as const, kind: "transaction" as const, hash: executionHash },
      result: { kind: "confirmed" as const, transactionHash: evidenceHash, verifiedExecution: true as const },
    },
    {
      verifiedExecution: { chainId: 8453 as const, kind: "transaction" as const, hash: executionHash },
      result: { kind: "confirmed" as const, transactionHash: resultHash, verifiedExecution: true as const },
    },
  ];

  for (const mismatch of mismatches) {
    expect(() => createTrustedVerifiedObservation({ ...base, ...mismatch })).toThrow(
      "invalid-trusted-verified-observation",
    );
  }
});

test("binds exact user-operation U while allowing its verified containing transaction T", () => {
  const userOperationHash = `0x${"d".repeat(64)}` as const;
  const otherUserOperationHash = `0x${"e".repeat(64)}` as const;
  const transactionHash = `0x${"f".repeat(64)}` as const;
  const evidence = {
    evidence: {
      kind: "user-operation-hash" as const,
      provider: "cdp-embedded" as const,
      value: userOperationHash,
    },
    provenance: { source: "provider-return" as const, observedAt: "2026-09-11T01:03:00.000Z" },
    recordedAt: "2026-09-11T01:03:00.000Z",
  };
  const base = {
    owner: OWNER,
    actionId: preparedAction().id,
    attemptId: "attempt-1",
    expectedAttemptVersion: 2,
    expectedDispatchVersion: 1,
    expectedEvidence: { evidence, comparison: "exact-recorded-fact" as const },
    verificationLookup: {
      kind: "user-operation-hash" as const,
      provider: "cdp-embedded" as const,
      value: userOperationHash,
    },
    result: { kind: "confirmed" as const, transactionHash, verifiedExecution: true as const },
    observedAt: "2026-09-11T01:04:00.000Z",
  };

  expect(createTrustedVerifiedObservation({
    ...base,
    verifiedExecution: { chainId: 8453, kind: "user-operation", hash: userOperationHash },
  })).toMatchObject({
    expectedEvidence: { evidence: { evidence: { value: userOperationHash } } },
    verificationLookup: { kind: "user-operation-hash", provider: "cdp-embedded", value: userOperationHash },
    verifiedExecution: { kind: "user-operation", hash: userOperationHash },
    result: { transactionHash },
  });
  expect(() => createTrustedVerifiedObservation({
    ...base,
    verifiedExecution: { chainId: 8453, kind: "user-operation", hash: otherUserOperationHash },
  })).toThrow("invalid-trusted-verified-observation");
  expect(() => createTrustedVerifiedObservation({
    ...base,
    verifiedExecution: { chainId: 8453, kind: "transaction", hash: transactionHash },
  })).toThrow("invalid-trusted-verified-observation");
});

test("accepts verified user-operation U through each exact durable lead while retaining U as execution identity", () => {
  const userOperationHash = `0x${"1".repeat(64)}` as const;
  const transactionHash = `0x${"2".repeat(64)}` as const;
  const submissionId = "Base-Opaque-Submission-ID";
  const observedAt = "2026-09-11T01:04:00.000Z";
  const receipt = confirmedReceipt({
    transactionHash,
    verifiedExecution: { chainId: 8453, kind: "user-operation", hash: userOperationHash },
  });
  const transactionEvidence = {
    evidence: { kind: "transaction-hash" as const, chainId: 8453 as const, value: transactionHash },
    provenance: { source: "verified-receipt" as const, observedAt },
    recordedAt: observedAt,
  };
  const cases = [
    {
      name: "Base submission S to U to T",
      owner: BASE_OWNER,
      evidence: {
        evidence: { kind: "submission-id" as const, provider: "base-account" as const, value: submissionId },
        provenance: { source: "provider-return" as const, observedAt },
        recordedAt: observedAt,
      },
      verificationLookup: { kind: "submission-id" as const, provider: "base-account" as const, value: submissionId },
    },
    {
      name: "Base transaction T to U to T",
      owner: BASE_OWNER,
      evidence: transactionEvidence,
      verificationLookup: { kind: "transaction-hash" as const, chainId: 8453 as const, value: transactionHash },
    },
    {
      name: "CDP transaction T to U to T",
      owner: OWNER,
      evidence: transactionEvidence,
      verificationLookup: { kind: "transaction-hash" as const, chainId: 8453 as const, value: transactionHash },
    },
    {
      name: "CDP user operation U to U to T",
      owner: OWNER,
      evidence: {
        evidence: {
          kind: "user-operation-hash" as const,
          provider: "cdp-embedded" as const,
          value: userOperationHash,
        },
        provenance: { source: "provider-return" as const, observedAt },
        recordedAt: observedAt,
      },
      verificationLookup: {
        kind: "user-operation-hash" as const,
        provider: "cdp-embedded" as const,
        value: userOperationHash,
      },
    },
  ];

  for (const item of cases) {
    const observation = createTrustedVerifiedObservation({
      owner: item.owner,
      actionId: preparedAction().id,
      attemptId: "attempt-1",
      expectedAttemptVersion: 2,
      expectedDispatchVersion: 1,
      expectedEvidence: { evidence: item.evidence, comparison: "exact-recorded-fact" },
      verificationLookup: item.verificationLookup,
      verifiedExecution: receipt.verifiedExecution!,
      result: { kind: "confirmed", transactionHash: receipt.transactionHash, verifiedExecution: true },
      observedAt,
    });
    expect(observation.verifiedExecution, item.name).toEqual({
      chainId: 8453,
      kind: "user-operation",
      hash: userOperationHash,
    });
    expect(observation.result, item.name).toEqual({
      kind: "confirmed",
      transactionHash,
      verifiedExecution: true,
    });
    expect(observation.verificationLookup, item.name).toEqual(item.verificationLookup);
  }
});

test("rejects wrong T, U, provider, or durable verification handle", () => {
  const userOperationHash = `0x${"3".repeat(64)}` as const;
  const otherUserOperationHash = `0x${"4".repeat(64)}` as const;
  const transactionHash = `0x${"5".repeat(64)}` as const;
  const otherTransactionHash = `0x${"6".repeat(64)}` as const;
  const submissionId = "Base-Submission-A";
  const otherSubmissionId = "Base-Submission-B";
  const observedAt = "2026-09-11T01:04:00.000Z";
  const common = {
    actionId: preparedAction().id,
    attemptId: "attempt-1",
    expectedAttemptVersion: 2,
    expectedDispatchVersion: 1,
    observedAt,
  };
  const transactionEvidence = {
    evidence: { kind: "transaction-hash" as const, chainId: 8453 as const, value: transactionHash },
    provenance: { source: "verified-receipt" as const, observedAt },
    recordedAt: observedAt,
  };
  const submissionEvidence = {
    evidence: { kind: "submission-id" as const, provider: "base-account" as const, value: submissionId },
    provenance: { source: "provider-return" as const, observedAt },
    recordedAt: observedAt,
  };
  const userOperationEvidence = {
    evidence: {
      kind: "user-operation-hash" as const,
      provider: "cdp-embedded" as const,
      value: userOperationHash,
    },
    provenance: { source: "provider-return" as const, observedAt },
    recordedAt: observedAt,
  };

  const invalid = [
    {
      ...common,
      owner: BASE_OWNER,
      expectedEvidence: { evidence: transactionEvidence, comparison: "exact-recorded-fact" as const },
      verificationLookup: { kind: "transaction-hash" as const, chainId: 8453 as const, value: transactionHash },
      verifiedExecution: { chainId: 8453 as const, kind: "user-operation" as const, hash: userOperationHash },
      result: { kind: "confirmed" as const, transactionHash: otherTransactionHash, verifiedExecution: true as const },
    },
    {
      ...common,
      owner: OWNER,
      expectedEvidence: { evidence: userOperationEvidence, comparison: "exact-recorded-fact" as const },
      verificationLookup: {
        kind: "user-operation-hash" as const,
        provider: "cdp-embedded" as const,
        value: userOperationHash,
      },
      verifiedExecution: { chainId: 8453 as const, kind: "user-operation" as const, hash: otherUserOperationHash },
      result: { kind: "confirmed" as const, transactionHash, verifiedExecution: true as const },
    },
    {
      ...common,
      owner: OWNER,
      expectedEvidence: { evidence: submissionEvidence, comparison: "exact-recorded-fact" as const },
      verificationLookup: { kind: "submission-id" as const, provider: "base-account" as const, value: submissionId },
      verifiedExecution: { chainId: 8453 as const, kind: "user-operation" as const, hash: userOperationHash },
      result: { kind: "confirmed" as const, transactionHash, verifiedExecution: true as const },
    },
    {
      ...common,
      owner: BASE_OWNER,
      expectedEvidence: { evidence: submissionEvidence, comparison: "exact-recorded-fact" as const },
      verificationLookup: {
        kind: "submission-id" as const,
        provider: "base-account" as const,
        value: otherSubmissionId,
      },
      verifiedExecution: { chainId: 8453 as const, kind: "user-operation" as const, hash: userOperationHash },
      result: { kind: "confirmed" as const, transactionHash, verifiedExecution: true as const },
    },
  ];

  for (const item of invalid) {
    expect(() => createTrustedVerifiedObservation(item)).toThrow("invalid-trusted-verified-observation");
  }
});

test("freezes error outcomes and every error explicitly carries no dispatch authority", () => {
  const outcome = attemptStoreError("attempt-version-mismatch", { retryable: true });
  expect(outcome).toEqual({
    ok: false,
    dispatchAuthority: "none",
    error: { code: "attempt-version-mismatch", retryable: true },
  });
  expect(Object.isFrozen(outcome)).toBe(true);
  expect(Object.isFrozen(outcome.error)).toBe(true);
  expect(() => {
    (outcome.error as { code: string }).code = "not-found";
  }).toThrow();
});
