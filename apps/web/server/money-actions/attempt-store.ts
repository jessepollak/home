import { createHash } from "node:crypto";
import type { MoneyActionOperationStatus, MoneyActionOwner, PreparedMoneyAction } from "@/shared/money-actions/types";
import {
  ATTEMPT_COMMAND_CONTRACT_VERSION,
  COMPATIBILITY_ACTION_REVISION,
  mayRecordProviderEvidence,
  type AttemptVersion,
  type ClaimDispatch,
  type ClaimDispatchResult,
  type DispatchVersion,
  type ExecutionAttempt,
  type PreparedActionRevision,
  type ProviderEvidence,
  type ReconcileAttempt,
  type ReconcileAttemptResult,
  type ReconciliationResult,
  type RecordProviderEvidence,
  type RecordProviderEvidenceResult,
  type RecordedProviderEvidence,
  type ReleaseAdmission,
  type ReleaseAdmissionResult,
} from "./attempt-commands";
import type {
  MoneyActionStore,
  StoredMoneyActionOperation,
  VerifiedMoneyActionExecution,
} from "./store";

/** Production persistence contract. Implementations arrive only after the contract barrier. */
export const ATTEMPT_STORE_CONTRACT_VERSION = 1 as const;

export const ATTEMPT_STORE_VERSION_RULES = Object.freeze({
  commandContractVersion: ATTEMPT_COMMAND_CONTRACT_VERSION,
  compatibilityActionRevision: COMPATIBILITY_ACTION_REVISION,
  initialAttemptVersion: 1,
  initialDispatchVersion: 1,
  attemptIdentityAuthority: "store" as const,
  duplicateFactChangesAttemptVersion: false,
  newFactIncrementsAttemptVersionBy: 1,
  dispatchVersionIsStableForAttempt: true,
} as const);

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

/** The durable reviewed action. Raw sensitive calldata is never part of this value. */
export type DurableAttemptAction = PreparedActionRevision;

/** Best-effort process-local dispatch material. It is not restored from attempt persistence. */
export type TransientSensitiveActionPayload = Readonly<{
  action: PreparedActionRevision;
  expiresAt: string;
}>;

export type IssueAttemptAction = Readonly<{
  durableAction: DurableAttemptAction;
  transientSensitivePayload?: TransientSensitiveActionPayload;
}>;

export type AttemptActionSnapshot = DeepReadonly<{
  action: DurableAttemptAction;
  sensitivePayloadStorage: "not-sensitive" | "transient-only";
}>;

export type AttemptSnapshot = DeepReadonly<ExecutionAttempt>;

export type AttemptStoreSnapshot = DeepReadonly<{
  action: AttemptActionSnapshot;
  attempts: readonly AttemptSnapshot[];
}>;

export type AttemptIdentity =
  | Readonly<{ source: "store-generated"; attemptId: string; sequence: number }>
  | Readonly<{ source: "legacy-deterministic"; attemptId: string; sequence: number }>;

export type LegacyReference<Value extends string> = Readonly<{
  value: Value;
  provenance: "legacy-unknown";
}>;

export type LegacyCompatibilityEnvelope = DeepReadonly<{
  source: "money_action_operations";
  provenance: {
    status: "legacy-unknown";
    references: "legacy-unknown";
    dispatch: "legacy-unknown";
  };
  action: PreparedMoneyAction;
  status: MoneyActionOperationStatus;
  attemptCount: number;
  claimedAt?: string;
  abandonedAt?: string;
  references: {
    submissionId?: LegacyReference<string>;
    transactionHash?: LegacyReference<`0x${string}`>;
    userOperationHash?: LegacyReference<`0x${string}`>;
  };
  verifiedExecutionKey?: {
    value: string;
    provenance: "legacy-verified-execution-key";
  };
  createdAt: string;
  updatedAt: string;
  mappedAttempt?: AttemptIdentity;
  dispatchEligibility: "prepared-eligible" | "non-dispatchable";
  submissionCertainty: "not-asserted";
  contradictions: readonly LegacyContradiction[];
}>;

export type LegacyContradiction =
  | "negative-attempt-count"
  | "prepared-with-attempt-facts"
  | "attempt-without-claimed-at"
  | "reference-without-attempt"
  | "submitted-status-without-reference"
  | "verified-key-without-terminal-status";

export type VerifiedEvidenceBinding = Readonly<{
  evidence: RecordedProviderEvidence;
  /** The apply transaction must find this exact fact still attached to this attempt. */
  comparison: "exact-recorded-fact";
}>;

/** Durable lead used to acquire verification; distinct from the reserved execution identity. */
export type VerifiedObservationLookup =
  | Readonly<{ kind: "transaction-hash"; chainId: 8453; value: `0x${string}` }>
  | Readonly<{ kind: "user-operation-hash"; provider: "cdp-embedded"; value: `0x${string}` }>
  | Readonly<{ kind: "submission-id"; provider: "base-account"; value: string }>;

const trustedVerifiedObservation = Symbol("trusted-verified-money-action-observation");

/**
 * Server-internal input created only after provider/receipt verification outside the
 * store transaction. Applying it must recheck owner/provider/action/attempt, both
 * versions, the exact evidence and verification lookup, their binding, and the
 * verified execution identity in one transaction. For U in T, reserve U—not T.
 */
export type TrustedVerifiedObservation = DeepReadonly<{
  [trustedVerifiedObservation]: true;
  owner: MoneyActionOwner;
  actionId: string;
  attemptId: string;
  expectedAttemptVersion: AttemptVersion;
  expectedDispatchVersion: DispatchVersion;
  expectedEvidence: VerifiedEvidenceBinding;
  /** Exact durable lead used by the external verifier; it must match expectedEvidence. */
  verificationLookup: VerifiedObservationLookup;
  verifiedExecution: VerifiedMoneyActionExecution;
  result: Extract<ReconciliationResult, { kind: "confirmed" | "failed" }>;
  observedAt: string;
  /** The apply transaction must revalidate this binding after version/evidence locks. */
  applicationRecheck: "owner-provider-action-attempt-versions-exact-evidence-lookup-execution-result";
}>;

export type TrustedVerifiedObservationInput = Omit<
  TrustedVerifiedObservation,
  typeof trustedVerifiedObservation | "applicationRecheck"
>;

export type AttemptStoreErrorCode = typeof ATTEMPT_STORE_ERROR_CODES[number];

export const ATTEMPT_STORE_ERROR_CODES = Object.freeze([
  "invalid-command",
  "not-found",
  "owner-mismatch",
  "action-revision-mismatch",
  "attempt-version-mismatch",
  "dispatch-version-mismatch",
  "sensitive-payload-unavailable",
  "conflicting-evidence",
  "verified-execution-conflict",
  "legacy-contradiction",
  "resource-not-initialized",
  "resource-disposed",
] as const);

export type AttemptStoreErrorOutcome = DeepReadonly<{
  ok: false;
  dispatchAuthority: "none";
  error: {
    code: AttemptStoreErrorCode;
    retryable: boolean;
  };
}>;

export type AttemptStoreSuccess<Value> = DeepReadonly<{
  ok: true;
  value: Value;
}>;

export type AttemptStoreOutcome<Value> = AttemptStoreSuccess<Value> | AttemptStoreErrorOutcome;

export type IssueAttemptActionResult = Readonly<{
  disposition: "issued" | "existing";
  action: AttemptActionSnapshot;
}>;

export type ImportLegacyOperationResult = Readonly<{
  disposition: "imported" | "existing";
  operation: LegacyCompatibilityEnvelope;
}>;

/**
 * Additive attempt API plus the unchanged legacy facade. The legacy operation row
 * remains the compatibility lock/CAS anchor while both entry points coexist.
 */
export interface MoneyActionAttemptStore extends MoneyActionStore {
  issueAttemptAction(
    input: IssueAttemptAction,
  ): Promise<AttemptStoreOutcome<IssueAttemptActionResult>>;
  getAttemptStoreSnapshot(
    owner: MoneyActionOwner,
    actionId: string,
  ): Promise<AttemptStoreOutcome<AttemptStoreSnapshot>>;
  claimDispatch(
    command: ClaimDispatch,
    now: string,
  ): Promise<AttemptStoreOutcome<ClaimDispatchResult>>;
  recordProviderEvidence(
    command: RecordProviderEvidence,
    now: string,
  ): Promise<AttemptStoreOutcome<RecordProviderEvidenceResult>>;
  reconcileAttempt(
    command: ReconcileAttempt,
  ): Promise<AttemptStoreOutcome<ReconcileAttemptResult>>;
  applyVerifiedObservation(
    observation: TrustedVerifiedObservation,
  ): Promise<AttemptStoreOutcome<ReconcileAttemptResult>>;
  releaseAttemptAdmission(
    command: ReleaseAdmission,
    now: string,
  ): Promise<AttemptStoreOutcome<ReleaseAdmissionResult>>;
  importLegacyOperation(
    operation: LegacyCompatibilityEnvelope,
  ): Promise<AttemptStoreOutcome<ImportLegacyOperationResult>>;
}

export type AttemptStoreResourceOptions =
  | Readonly<{ backend: "memory" }>
  | Readonly<{ backend: "postgres"; connectionString: string; schema: string }>;

export interface AttemptStoreResource {
  readonly store: MoneyActionAttemptStore;
  init(): Promise<void>;
  dispose(): Promise<void>;
}

export type AttemptStoreResourceFactory = (
  options: AttemptStoreResourceOptions,
) => AttemptStoreResource;

export type AttemptStoreValidation =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: "invalid-command" }>;

export function validateIssueAttemptAction(input: IssueAttemptAction): AttemptStoreValidation {
  const { durableAction, transientSensitivePayload } = input;
  if (!validPreparedRevision(durableAction)) return invalidCommand();
  if (!durableAction.sensitivePayload) {
    return transientSensitivePayload ? invalidCommand() : VALID;
  }
  if (durableAction.calls.some((call) => call.data !== "0x" || !validDigest(call.dataHash))) {
    return invalidCommand();
  }
  if (!transientSensitivePayload) return VALID;
  const transient = transientSensitivePayload.action;
  if (
    !validPreparedRevision(transient) ||
    !transient.sensitivePayload ||
    !sameSanitizedSensitiveAction(durableAction, transient) ||
    transient.calls.some((call, index) =>
      call.data === "0x" ||
      call.dataHash !== durableAction.calls[index]?.dataHash ||
      createHash("sha256").update(call.data).digest("hex") !== call.dataHash
    ) ||
    !validTimestamp(transientSensitivePayload.expiresAt) ||
    Date.parse(transientSensitivePayload.expiresAt) > Date.parse(durableAction.expiresAt)
  ) {
    return invalidCommand();
  }
  return VALID;
}

export function validateClaimDispatch(command: ClaimDispatch): AttemptStoreValidation {
  if (
    !validOwner(command.owner) ||
    !nonEmpty(command.actionId) ||
    !validDigest(command.reviewHash) ||
    command.expectedActionRevision !== COMPATIBILITY_ACTION_REVISION ||
    command.provider !== command.owner.accountProvider ||
    command.providerRequestKey.kind !== "home-correlation" ||
    command.providerRequestKey.homeActionId !== command.actionId ||
    command.providerRequestKey.value !== command.actionId ||
    command.providerRequestKey.role !== (
      command.provider === "cdp-embedded" ? "cdp-idempotency-header" : "eip-5792-request-id"
    )
  ) return invalidCommand();
  return VALID;
}

export function validateRecordProviderEvidence(command: RecordProviderEvidence): AttemptStoreValidation {
  const handle = command.evidence.kind === "provider-status"
    ? command.evidence.handle
    : command.evidence.kind === "transaction-hash"
      ? undefined
      : command.evidence;
  if (
    !validOwner(command.owner) ||
    !nonEmpty(command.actionId) ||
    !nonEmpty(command.attemptId) ||
    !validVersion(command.dispatchVersion) ||
    !nonEmpty(command.writeIdempotencyKey) ||
    !validTimestamp(command.provenance.observedAt) ||
    (handle !== undefined && handle.provider !== command.owner.accountProvider) ||
    !mayRecordProviderEvidence({
      homeActionId: command.actionId,
      evidence: command.evidence,
      provenance: command.provenance,
    }).ok
  ) return invalidCommand();
  return VALID;
}

export function validateReconcileAttempt(command: ReconcileAttempt): AttemptStoreValidation {
  if (
    !validOwner(command.owner) ||
    !nonEmpty(command.actionId) ||
    !nonEmpty(command.attemptId) ||
    !validVersion(command.expectedAttemptVersion) ||
    !validReconcileLookup(command)
  ) return invalidCommand();
  return VALID;
}

export function validateReleaseAdmission(command: ReleaseAdmission): AttemptStoreValidation {
  if (
    !validOwner(command.owner) ||
    !nonEmpty(command.actionId) ||
    !nonEmpty(command.attemptId) ||
    !nonEmpty(command.policyVersion)
  ) return invalidCommand();
  return VALID;
}

export function snapshotAttemptAction(input: IssueAttemptAction): AttemptActionSnapshot {
  if (!validateIssueAttemptAction(input).ok) throw new Error("invalid-attempt-action");
  return immutableSnapshot({
    action: input.durableAction,
    sensitivePayloadStorage: input.durableAction.sensitivePayload ? "transient-only" : "not-sensitive",
  });
}

export function snapshotExecutionAttempt(attempt: ExecutionAttempt): AttemptSnapshot {
  return immutableSnapshot(attempt);
}

/** Deterministic only for migration; production claims must generate opaque IDs in-store. */
export function legacyAttemptId(actionId: string, sequence: number): string {
  if (!nonEmpty(actionId) || !validVersion(sequence)) throw new Error("invalid-legacy-attempt-identity");
  return `legacy:${actionId}:${sequence}`;
}

export function legacyCompatibilityEnvelope(
  operation: StoredMoneyActionOperation,
  options: Readonly<{ verifiedExecutionKey?: string }> = {},
): LegacyCompatibilityEnvelope {
  const contradictions: LegacyContradiction[] = [];
  const hasReference = Boolean(
    operation.submissionId || operation.transactionHash || operation.userOperationHash,
  );
  const hasAttemptFacts = operation.attemptCount > 0 ||
    Boolean(operation.claimedAt) ||
    Boolean(operation.abandonedAt) ||
    Boolean(options.verifiedExecutionKey) ||
    hasReference;
  if (!Number.isSafeInteger(operation.attemptCount) || operation.attemptCount < 0) {
    contradictions.push("negative-attempt-count");
  }
  if (operation.status === "prepared" && hasAttemptFacts) {
    contradictions.push("prepared-with-attempt-facts");
  }
  if (operation.attemptCount > 0 && !operation.claimedAt) {
    contradictions.push("attempt-without-claimed-at");
  }
  if (hasReference && operation.attemptCount < 1) {
    contradictions.push("reference-without-attempt");
  }
  if (["submitted", "included"].includes(operation.status) && !hasReference) {
    contradictions.push("submitted-status-without-reference");
  }
  if (options.verifiedExecutionKey && !["confirmed", "failed"].includes(operation.status)) {
    contradictions.push("verified-key-without-terminal-status");
  }

  const claimedByStatus = !["prepared", "expired"].includes(operation.status);
  const hasMappedAttempt = hasAttemptFacts || claimedByStatus;
  const sequence = Math.max(1, operation.attemptCount);
  const preparedEligible = operation.status === "prepared" && !hasAttemptFacts && contradictions.length === 0;

  return immutableSnapshot({
    source: "money_action_operations" as const,
    provenance: {
      status: "legacy-unknown" as const,
      references: "legacy-unknown" as const,
      dispatch: "legacy-unknown" as const,
    },
    action: operation.action,
    status: operation.status,
    attemptCount: operation.attemptCount,
    ...(operation.claimedAt ? { claimedAt: operation.claimedAt } : {}),
    ...(operation.abandonedAt ? { abandonedAt: operation.abandonedAt } : {}),
    references: {
      ...(operation.submissionId
        ? { submissionId: { value: operation.submissionId, provenance: "legacy-unknown" as const } }
        : {}),
      ...(operation.transactionHash
        ? { transactionHash: { value: operation.transactionHash, provenance: "legacy-unknown" as const } }
        : {}),
      ...(operation.userOperationHash
        ? { userOperationHash: { value: operation.userOperationHash, provenance: "legacy-unknown" as const } }
        : {}),
    },
    ...(options.verifiedExecutionKey
      ? {
          verifiedExecutionKey: {
            value: options.verifiedExecutionKey,
            provenance: "legacy-verified-execution-key" as const,
          },
        }
      : {}),
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    ...(hasMappedAttempt
      ? {
          mappedAttempt: {
            source: "legacy-deterministic" as const,
            attemptId: legacyAttemptId(operation.action.id, sequence),
            sequence,
          },
        }
      : {}),
    dispatchEligibility: preparedEligible ? "prepared-eligible" as const : "non-dispatchable" as const,
    submissionCertainty: "not-asserted" as const,
    contradictions,
  });
}

export function createTrustedVerifiedObservation(
  input: TrustedVerifiedObservationInput,
): TrustedVerifiedObservation {
  const evidenceLookup = verifiedObservationLookup(input);
  if (
    !validOwner(input.owner) ||
    !nonEmpty(input.actionId) ||
    !nonEmpty(input.attemptId) ||
    !validVersion(input.expectedAttemptVersion) ||
    !validVersion(input.expectedDispatchVersion) ||
    input.expectedEvidence.comparison !== "exact-recorded-fact" ||
    input.verifiedExecution.chainId !== input.owner.chainId ||
    !validHash(input.verifiedExecution.hash) ||
    !validTimestamp(input.observedAt) ||
    input.result.verifiedExecution !== true ||
    (input.result.kind === "confirmed" && !validHash(input.result.transactionHash)) ||
    (input.result.kind === "failed" && input.result.transactionHash !== undefined && !validHash(input.result.transactionHash)) ||
    evidenceLookup === null ||
    !sameVerifiedObservationLookup(evidenceLookup, input.verificationLookup) ||
    !verifiedObservationFieldsBind(input, evidenceLookup)
  ) throw new Error("invalid-trusted-verified-observation");

  const cloned = structuredClone(input);
  return deepFreeze({
    ...cloned,
    verifiedExecution: {
      ...cloned.verifiedExecution,
      hash: cloned.verifiedExecution.hash.toLowerCase() as `0x${string}`,
    },
    result: cloned.result.transactionHash
      ? { ...cloned.result, transactionHash: cloned.result.transactionHash.toLowerCase() as `0x${string}` }
      : cloned.result,
    verificationLookup: evidenceLookup,
    applicationRecheck: "owner-provider-action-attempt-versions-exact-evidence-lookup-execution-result" as const,
    [trustedVerifiedObservation]: true as const,
  }) as TrustedVerifiedObservation;
}

export function revalidateTrustedVerifiedObservation(
  observation: TrustedVerifiedObservation,
  context: Readonly<{
    action: DeepReadonly<DurableAttemptAction>;
    attempt: DeepReadonly<ExecutionAttempt>;
    evidence: DeepReadonly<RecordedProviderEvidence>;
  }>,
): boolean {
  const lookup = verifiedObservationLookup(observation);
  return observation[trustedVerifiedObservation] === true &&
    observation.applicationRecheck === "owner-provider-action-attempt-versions-exact-evidence-lookup-execution-result" &&
    observation.expectedEvidence.comparison === "exact-recorded-fact" &&
    validOwner(observation.owner) &&
    validVersion(observation.expectedAttemptVersion) &&
    validVersion(observation.expectedDispatchVersion) &&
    validTimestamp(observation.observedAt) &&
    observation.verifiedExecution.chainId === observation.owner.chainId &&
    validHash(observation.verifiedExecution.hash) &&
    observation.result.verifiedExecution === true &&
    (observation.result.kind !== "confirmed" || validHash(observation.result.transactionHash)) &&
    (observation.result.kind !== "failed" || observation.result.transactionHash === undefined || validHash(observation.result.transactionHash)) &&
    observation.actionId === context.action.id &&
    observation.actionId === context.attempt.actionId &&
    observation.attemptId === context.attempt.attemptId &&
    observation.owner.subject === context.action.owner.subject &&
    observation.owner.address.toLowerCase() === context.action.owner.address.toLowerCase() &&
    observation.owner.chainId === context.action.owner.chainId &&
    observation.owner.accountProvider === context.action.owner.accountProvider &&
    context.attempt.actionRevision === context.action.revision &&
    context.attempt.provider === context.action.owner.accountProvider &&
    stableStringify(observation.expectedEvidence.evidence) === stableStringify(context.evidence) &&
    lookup !== null &&
    sameVerifiedObservationLookup(lookup, observation.verificationLookup) &&
    verifiedObservationFieldsBind(observation, lookup);
}

export function attemptStoreSuccess<Value>(value: Value): AttemptStoreSuccess<Value> {
  return immutableSnapshot({ ok: true as const, value });
}

export function attemptStoreError(
  code: AttemptStoreErrorCode,
  options: Readonly<{ retryable?: boolean }> = {},
): AttemptStoreErrorOutcome {
  return immutableSnapshot({
    ok: false as const,
    dispatchAuthority: "none" as const,
    error: { code, retryable: options.retryable ?? false },
  });
}

export function sameAttemptFact(existing: ProviderEvidence, incoming: ProviderEvidence): boolean {
  if (existing.kind !== incoming.kind) return false;
  if (existing.kind === "submission-id" && incoming.kind === "submission-id") {
    return existing.provider === incoming.provider && existing.value === incoming.value;
  }
  if (existing.kind === "user-operation-hash" && incoming.kind === "user-operation-hash") {
    return existing.provider === incoming.provider && existing.value.toLowerCase() === incoming.value.toLowerCase();
  }
  if (existing.kind === "transaction-hash" && incoming.kind === "transaction-hash") {
    return existing.chainId === incoming.chainId && existing.value.toLowerCase() === incoming.value.toLowerCase();
  }
  if (existing.kind === "provider-status" && incoming.kind === "provider-status") {
    return existing.payload === incoming.payload && sameAttemptFact(existing.handle, incoming.handle);
  }
  return false;
}

const VALID = Object.freeze({ ok: true as const });
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

function invalidCommand(): AttemptStoreValidation {
  return Object.freeze({ ok: false as const, reason: "invalid-command" as const });
}

function validPreparedRevision(action: PreparedActionRevision): boolean {
  return action.revision === COMPATIBILITY_ACTION_REVISION &&
    nonEmpty(action.id) &&
    validDigest(action.reviewHash) &&
    validOwner(action.owner) &&
    validTimestamp(action.createdAt) &&
    validTimestamp(action.expiresAt);
}

function sameSanitizedSensitiveAction(
  durable: PreparedActionRevision,
  transient: PreparedActionRevision,
): boolean {
  const sanitizedTransient = {
    ...transient,
    calls: transient.calls.map((call) => ({ ...call, data: "0x" as const })),
  };
  return stableStringify(durable) === stableStringify(sanitizedTransient);
}

function verifiedObservationLookup(
  input: TrustedVerifiedObservationInput,
): VerifiedObservationLookup | null {
  const recorded = input.expectedEvidence.evidence;
  if (
    !validTimestamp(recorded.recordedAt) ||
    !validTimestamp(recorded.provenance.observedAt) ||
    !mayRecordProviderEvidence({
      homeActionId: input.actionId,
      evidence: recorded.evidence,
      provenance: recorded.provenance,
    }).ok
  ) return null;

  const evidence = recorded.evidence.kind === "provider-status"
    ? recorded.evidence.handle
    : recorded.evidence;
  if (evidence.kind === "transaction-hash") {
    return evidence.chainId === input.owner.chainId
      ? { ...evidence, value: evidence.value.toLowerCase() as `0x${string}` }
      : null;
  }
  if (evidence.provider !== input.owner.accountProvider) return null;
  return evidence.kind === "user-operation-hash"
    ? { ...evidence, value: evidence.value.toLowerCase() as `0x${string}` }
    : { ...evidence };
}

function sameVerifiedObservationLookup(
  durable: VerifiedObservationLookup,
  verified: VerifiedObservationLookup,
): boolean {
  if (durable.kind !== verified.kind) return false;
  if (durable.kind === "transaction-hash" && verified.kind === "transaction-hash") {
    return durable.chainId === verified.chainId && durable.value.toLowerCase() === verified.value.toLowerCase();
  }
  if (durable.kind === "user-operation-hash" && verified.kind === "user-operation-hash") {
    return durable.provider === verified.provider && durable.value.toLowerCase() === verified.value.toLowerCase();
  }
  if (durable.kind === "submission-id" && verified.kind === "submission-id") {
    return durable.provider === verified.provider && durable.value === verified.value;
  }
  return false;
}

function verifiedObservationFieldsBind(
  input: TrustedVerifiedObservationInput,
  lookup: VerifiedObservationLookup,
): boolean {
  const executionHash = input.verifiedExecution.hash.toLowerCase();
  const resultHash = input.result.transactionHash?.toLowerCase();

  if (input.verifiedExecution.kind === "transaction") {
    if (resultHash === undefined || executionHash !== resultHash) return false;
    if (lookup.kind === "transaction-hash") return lookup.value.toLowerCase() === resultHash;
    return lookup.kind === "submission-id" && input.owner.accountProvider === "base-account";
  }

  if (lookup.kind === "user-operation-hash") {
    return input.owner.accountProvider === "cdp-embedded" &&
      executionHash === lookup.value.toLowerCase();
  }
  if (resultHash === undefined) return false;
  if (lookup.kind === "transaction-hash") return lookup.value.toLowerCase() === resultHash;
  return input.owner.accountProvider === "base-account";
}

function validReconcileLookup(command: ReconcileAttempt): boolean {
  switch (command.lookup.kind) {
    case "recorded-user-operation-hash":
      return validHash(command.lookup.userOperationHash);
    case "recorded-transaction-hash":
      return validHash(command.lookup.transactionHash);
    case "recorded-submission-id":
      return nonEmpty(command.lookup.submissionId) && command.lookup.submissionId !== command.actionId;
    case "none":
      return command.lookup.reason === "reference-free-ambiguous";
  }
}

function validOwner(owner: MoneyActionOwner): boolean {
  return nonEmpty(owner.subject) &&
    /^0x[0-9a-fA-F]{40}$/.test(owner.address) &&
    owner.chainId === 8453 &&
    (owner.accountProvider === "cdp-embedded" || owner.accountProvider === "base-account");
}

function validVersion(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1;
}

function validHash(value: string): boolean {
  return HASH_PATTERN.test(value);
}

function validDigest(value: string | undefined): value is string {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function immutableSnapshot<Value>(value: Value): DeepReadonly<Value> {
  return deepFreeze(structuredClone(value)) as DeepReadonly<Value>;
}

function deepFreeze<Value>(value: Value): Value {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
