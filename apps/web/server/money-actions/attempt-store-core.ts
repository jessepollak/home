import { randomUUID } from "node:crypto";
import type { MoneyActionOwner, PreparedMoneyAction } from "@/shared/money-actions/types";
import {
  compatibilityActionRevision,
  conflictingEvidenceDecision,
  projectClaimDisposition,
  type ClaimDispatch,
  type ClaimDispatchResult,
  type ExecutionAttempt,
  type ProviderEvidence,
  type ReconcileAttempt,
  type ReconcileAttemptResult,
  type RecordedProviderEvidence,
  type RecordProviderEvidence,
  type RecordProviderEvidenceResult,
  type ReleaseAdmission,
  type ReleaseAdmissionResult,
} from "./attempt-commands";
import {
  attemptStoreError,
  attemptStoreSuccess,
  legacyCompatibilityEnvelope,
  revalidateTrustedVerifiedObservation,
  sameAttemptFact,
  snapshotAttemptAction,
  validateClaimDispatch,
  validateIssueAttemptAction,
  validateReconcileAttempt,
  validateRecordProviderEvidence,
  validateReleaseAdmission,
  type AttemptActionSnapshot,
  type AttemptStoreOutcome,
  type AttemptStoreSnapshot,
  type ImportLegacyOperationResult,
  type IssueAttemptAction,
  type IssueAttemptActionResult,
  type LegacyCompatibilityEnvelope,
  type MoneyActionAttemptStore,
  type TrustedVerifiedObservation,
} from "./attempt-store";
import type {
  MoneyActionClaim,
  MoneyActionIssueStoreOptions,
  MoneyActionListScope,
  MoneyActionStatusConstraints,
  MoneyActionStore,
  StoredMoneyActionOperation,
} from "./store";
import { sameMoneyActionOwner } from "./store";

export type PersistedAttemptState = {
  action: AttemptActionSnapshot;
  attempts: ExecutionAttempt[];
  evidenceWrites?: Record<string, { attemptId: string; evidence: ProviderEvidence }>;
  legacyEvidenceReservations?: string[];
  importedLegacy?: LegacyCompatibilityEnvelope;
  verifiedExecutionKey?: string;
};

export type AttemptOperationRecord = {
  operation: StoredMoneyActionOperation;
  verifiedExecutionKey?: string;
};

export interface AttemptStoreTransaction {
  getOperationById(actionId: string): Promise<AttemptOperationRecord | null>;
  insertOperation(record: AttemptOperationRecord): Promise<boolean>;
  saveOperation(record: AttemptOperationRecord): Promise<void>;
  getState(actionId: string): Promise<PersistedAttemptState | null>;
  saveState(actionId: string, state: PersistedAttemptState): Promise<void>;
  findEvidenceOwner(evidenceKey: string): Promise<string | null>;
  findLegacyEvidenceOwner(owner: MoneyActionOwner, evidence: ProviderEvidence): Promise<string | null>;
  findVerifiedExecutionOwner(executionKey: string): Promise<string | null>;
}

export interface AttemptStorePersistence {
  init(): Promise<void>;
  transaction<Result>(run: (transaction: AttemptStoreTransaction) => Promise<Result>): Promise<Result>;
  dispose(): Promise<void>;
}

export class AttemptPersistenceConflict extends Error {
  readonly kind: "evidence" | "verified-execution";

  constructor(kind: "evidence" | "verified-execution") {
    super(`attempt persistence ${kind} conflict`);
    this.name = "AttemptPersistenceConflict";
    this.kind = kind;
  }
}

type LifecycleState = "created" | "initialized" | "disposed";

/** Shared command kernel. Persistence adapters provide the transaction/locking boundary. */
export class PersistentMoneyActionAttemptStore implements MoneyActionAttemptStore {
  private lifecycle: LifecycleState = "created";
  private readonly sensitiveActions = new Map<string, { action: PreparedMoneyAction; expiresAt: string }>();
  private readonly legacy: MoneyActionStore;
  private readonly persistence: AttemptStorePersistence;

  constructor(legacy: MoneyActionStore, persistence: AttemptStorePersistence) {
    this.legacy = legacy;
    this.persistence = persistence;
  }

  async init(): Promise<void> {
    if (this.lifecycle === "disposed") throw new Error("attempt-store resource is disposed");
    if (this.lifecycle === "initialized") return;
    await this.persistence.init();
    this.lifecycle = "initialized";
  }

  async dispose(): Promise<void> {
    if (this.lifecycle === "disposed") return;
    this.lifecycle = "disposed";
    this.sensitiveActions.clear();
    await this.persistence.dispose();
  }

  async issue(action: PreparedMoneyAction, options?: MoneyActionIssueStoreOptions): Promise<"issued" | "existing"> {
    this.assertLegacyAvailable();
    return this.legacy.issue(action, options);
  }

  async claim(owner: MoneyActionOwner, id: string, reviewHash: string, now: string): Promise<MoneyActionClaim | null> {
    this.assertLegacyAvailable();
    return this.legacy.claim(owner, id, reviewHash, now);
  }

  async get(owner: MoneyActionOwner, id: string): Promise<StoredMoneyActionOperation | null> {
    this.assertLegacyAvailable();
    return this.legacy.get(owner, id);
  }

  async list(owner: MoneyActionOwner, limit: number, scope?: MoneyActionListScope): Promise<StoredMoneyActionOperation[]> {
    this.assertLegacyAvailable();
    return this.legacy.list(owner, limit, scope);
  }

  async recordSubmission(
    owner: MoneyActionOwner,
    id: string,
    reference: { submissionId?: string; transactionHash?: `0x${string}`; userOperationHash?: `0x${string}` },
    now: string,
  ): Promise<StoredMoneyActionOperation | null> {
    this.assertLegacyAvailable();
    return this.legacy.recordSubmission(owner, id, reference, now);
  }

  async updateStatus(
    owner: MoneyActionOwner,
    id: string,
    status: StoredMoneyActionOperation["status"],
    now: string,
    constraints?: MoneyActionStatusConstraints,
  ): Promise<StoredMoneyActionOperation | null> {
    this.assertLegacyAvailable();
    return this.legacy.updateStatus(owner, id, status, now, constraints);
  }

  async releaseAdmission(owner: MoneyActionOwner, id: string, now: string): Promise<StoredMoneyActionOperation | null> {
    this.assertLegacyAvailable();
    return this.legacy.releaseAdmission(owner, id, now);
  }

  async issueAttemptAction(input: IssueAttemptAction): Promise<AttemptStoreOutcome<IssueAttemptActionResult>> {
    const unavailable = this.unavailableOutcome<IssueAttemptActionResult>();
    if (unavailable) return unavailable;
    if (!validateIssueAttemptAction(input).ok) return attemptStoreError("invalid-command");
    const actionSnapshot = snapshotAttemptAction(input);
    const operation = operationFromAction(input.durableAction);
    try {
      const outcome = await this.persistence.transaction(async (tx) => {
        const existingRecord = await tx.getOperationById(input.durableAction.id);
        const existingState = await tx.getState(input.durableAction.id);
        if (existingRecord) {
          if (!sameAction(existingRecord.operation.action, stripRevision(input.durableAction))) {
            return attemptStoreError("action-revision-mismatch");
          }
          const state = synchronizeLegacyState(existingState, existingRecord);
          if (!state || !sameAction(state.action.action, input.durableAction)) {
            return attemptStoreError("action-revision-mismatch");
          }
          if (state !== existingState) await tx.saveState(input.durableAction.id, state);
          return attemptStoreSuccess({ disposition: "existing" as const, action: state.action });
        }
        const state: PersistedAttemptState = { action: clone(actionSnapshot), attempts: [] };
        if (!await tx.insertOperation({ operation })) {
          const winner = await tx.getOperationById(input.durableAction.id);
          if (!winner || !sameAction(winner.operation.action, stripRevision(input.durableAction))) {
            return attemptStoreError("action-revision-mismatch");
          }
          const winnerState = synchronizeLegacyState(await tx.getState(input.durableAction.id), winner);
          if (!winnerState || !sameAction(winnerState.action.action, input.durableAction)) {
            return attemptStoreError("action-revision-mismatch");
          }
          await tx.saveState(input.durableAction.id, winnerState);
          return attemptStoreSuccess({ disposition: "existing" as const, action: winnerState.action });
        }
        await tx.saveState(input.durableAction.id, state);
        return attemptStoreSuccess({ disposition: "issued" as const, action: state.action });
      });
      if (outcome.ok && input.transientSensitivePayload) {
        this.installSensitiveAction(input.durableAction.id, input.transientSensitivePayload);
      }
      return outcome;
    } catch (error) {
      return persistenceError<IssueAttemptActionResult>(error);
    }
  }

  async getAttemptStoreSnapshot(
    owner: MoneyActionOwner,
    actionId: string,
  ): Promise<AttemptStoreOutcome<AttemptStoreSnapshot>> {
    const unavailable = this.unavailableOutcome<AttemptStoreSnapshot>();
    if (unavailable) return unavailable;
    return this.persistence.transaction(async (tx) => {
      const record = await tx.getOperationById(actionId);
      if (!record) return attemptStoreError("not-found");
      if (!sameMoneyActionOwner(record.operation.action.owner, owner)) return attemptStoreError("owner-mismatch");
      const existing = await tx.getState(actionId);
      const state = synchronizeLegacyState(existing, record);
      if (!state) return attemptStoreError("not-found");
      if (state !== existing) await tx.saveState(actionId, state);
      return attemptStoreSuccess({ action: state.action, attempts: state.attempts });
    });
  }

  async claimDispatch(command: ClaimDispatch, now: string): Promise<AttemptStoreOutcome<ClaimDispatchResult>> {
    const unavailable = this.unavailableOutcome<ClaimDispatchResult>();
    if (unavailable) return unavailable;
    if (!validateClaimDispatch(command).ok || !Number.isFinite(Date.parse(now))) {
      return attemptStoreError("invalid-command");
    }
    try {
      return await this.persistence.transaction(async (tx) => {
        const record = await tx.getOperationById(command.actionId);
        if (!record) return attemptStoreError("not-found");
        if (!sameMoneyActionOwner(record.operation.action.owner, command.owner)) return attemptStoreError("owner-mismatch");
        let state = synchronizeLegacyState(await tx.getState(command.actionId), record);
        if (!state) return attemptStoreError("not-found");
        const action = state.action.action;
        if (action.revision !== command.expectedActionRevision) return attemptStoreError("action-revision-mismatch");
        if (action.reviewHash !== command.reviewHash || action.owner.accountProvider !== command.provider) {
          return attemptStoreError("action-revision-mismatch");
        }
        let attempt = state.attempts.at(-1);
        if (!attempt) {
          if (record.operation.status !== "prepared" || state.importedLegacy?.dispatchEligibility === "non-dispatchable") {
            return attemptStoreSuccess({
              disposition: "terminal" as const,
              action: this.dispatchAction(action, now) ?? action,
              result: legacyResult(record.operation),
              authorization: "none" as const,
            });
          }
          if (Date.parse(action.expiresAt) <= Date.parse(now)) {
            const expired = { ...record.operation, status: "expired" as const, updatedAt: now };
            await tx.saveOperation({ ...record, operation: expired });
            return attemptStoreSuccess({
              disposition: "terminal" as const,
              action,
              result: { kind: "unexecuted" as const },
              authorization: "none" as const,
            });
          }
          const dispatchAction = this.dispatchAction(action, now);
          if (!dispatchAction) return attemptStoreError("sensitive-payload-unavailable", { retryable: true });
          attempt = {
            attemptId: randomUUID(),
            sequence: 1,
            actionId: action.id,
            actionRevision: action.revision,
            owner: clone(action.owner),
            provider: command.provider,
            createdAt: now,
            dispatch: { phase: "authorized", version: 1 },
            providerRequestKey: clone(command.providerRequestKey),
            evidence: [],
            reconciliation: { kind: "authorized-no-evidence" },
            ownerResolution: { kind: "active" },
            admission: { state: "blocking" },
            attemptVersion: 1,
          };
          state = { ...state, attempts: [...state.attempts, attempt] };
          const updatedOperation: StoredMoneyActionOperation = {
            ...record.operation,
            status: "submitting",
            attemptCount: record.operation.attemptCount + 1,
            claimedAt: record.operation.claimedAt ?? now,
            updatedAt: now,
          };
          await tx.saveOperation({ ...record, operation: updatedOperation });
          await tx.saveState(command.actionId, state);
          return attemptStoreSuccess({
            disposition: "dispatch" as const,
            action: dispatchAction,
            attempt,
            dispatchVersion: 1,
            authorization: "first-wallet-dispatch" as const,
          });
        }
        if (state !== await tx.getState(command.actionId)) await tx.saveState(command.actionId, state);
        const disposition = projectClaimDisposition(attempt);
        const dispatchAction = this.dispatchAction(action, now) ?? action;
        if (disposition === "terminal") {
          return attemptStoreSuccess({
            disposition,
            action: dispatchAction,
            attempt,
            result: attempt.reconciliation,
            authorization: "none" as const,
          });
        }
        return attemptStoreSuccess({
          disposition: "recover" as const,
          action: dispatchAction,
          attempt,
          authorization: "none" as const,
        });
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async recordProviderEvidence(command: RecordProviderEvidence, now: string): Promise<AttemptStoreOutcome<RecordProviderEvidenceResult>> {
    const unavailable = this.unavailableOutcome<RecordProviderEvidenceResult>();
    if (unavailable) return unavailable;
    if (!validateRecordProviderEvidence(command).ok || !Number.isFinite(Date.parse(now))) {
      return attemptStoreError("invalid-command");
    }
    try {
      return await this.persistence.transaction(async (tx) => {
        const loaded = await loadOwnedAttempt(tx, command.owner, command.actionId, command.attemptId);
        if (!loaded.ok) return loaded.outcome;
        const { record, state, attempt, index } = loaded;
        if (dispatchVersion(attempt) !== command.dispatchVersion) return attemptStoreError("dispatch-version-mismatch");
        const priorWrite = state.evidenceWrites?.[command.writeIdempotencyKey];
        if (priorWrite) {
          const priorEvidence = attempt.evidence.find((item) => sameAttemptFact(item.evidence, priorWrite.evidence));
          if (priorWrite.attemptId === attempt.attemptId && priorEvidence && sameAttemptFact(priorWrite.evidence, command.evidence)) {
            return attemptStoreSuccess({ disposition: "duplicate" as const, evidence: priorEvidence });
          }
          return attemptStoreError("conflicting-evidence");
        }
        const existingFact = attempt.evidence.find((item) => sameAttemptFact(item.evidence, command.evidence));
        if (existingFact) return attemptStoreSuccess({ disposition: "duplicate" as const, evidence: existingFact });
        const sameSlot = attempt.evidence.filter((item) => evidenceSlot(item.evidence) === evidenceSlot(command.evidence));
        const latestInSlot = sameSlot.at(-1);
        if (latestInSlot) {
          const decision = conflictingEvidenceDecision(latestInSlot.evidence, command.evidence);
          if (decision === "duplicate") {
            return attemptStoreSuccess({ disposition: "duplicate" as const, evidence: latestInSlot });
          }
          if (decision !== "advance") {
            return attemptStoreSuccess({
              disposition: "conflict" as const,
              slot: command.evidence.kind,
              existing: latestInSlot,
            });
          }
        }
        if (legacyReferenceConflict(record.operation, command.evidence)) {
          return attemptStoreError("conflicting-evidence");
        }
        const uniqueKey = evidenceUniquenessKey(command.owner, command.evidence);
        if (uniqueKey) {
          const assigned = await tx.findEvidenceOwner(uniqueKey) ??
            await tx.findLegacyEvidenceOwner(command.owner, command.evidence);
          if (assigned && assigned !== command.actionId) return attemptStoreError("conflicting-evidence");
        }
        const evidence: RecordedProviderEvidence = {
          evidence: canonicalEvidence(command.evidence),
          provenance: clone(command.provenance),
          recordedAt: now,
        };
        const nextAttempt: ExecutionAttempt = {
          ...attempt,
          evidence: [...attempt.evidence, evidence],
          dispatch: { phase: "evidence-recorded", version: command.dispatchVersion },
          reconciliation: attempt.reconciliation,
          attemptVersion: attempt.attemptVersion + 1,
        };
        const nextState = {
          ...replaceAttempt(state, index, nextAttempt),
          evidenceWrites: {
            ...state.evidenceWrites,
            [command.writeIdempotencyKey]: { attemptId: attempt.attemptId, evidence: canonicalEvidence(command.evidence) },
          },
        };
        const nextOperation = projectEvidence(record.operation, command.evidence, now);
        await tx.saveOperation({ ...record, operation: nextOperation });
        await tx.saveState(command.actionId, nextState);
        this.sensitiveActions.delete(command.actionId);
        return attemptStoreSuccess({ disposition: "recorded" as const, evidence });
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async reconcileAttempt(command: ReconcileAttempt): Promise<AttemptStoreOutcome<ReconcileAttemptResult>> {
    const unavailable = this.unavailableOutcome<ReconcileAttemptResult>();
    if (unavailable) return unavailable;
    if (!validateReconcileAttempt(command).ok) return attemptStoreError("invalid-command");
    return this.persistence.transaction(async (tx) => {
      const loaded = await loadOwnedAttempt(tx, command.owner, command.actionId, command.attemptId);
      if (!loaded.ok) return loaded.outcome;
      const { state, attempt, index } = loaded;
      if (attempt.attemptVersion !== command.expectedAttemptVersion) return attemptStoreError("attempt-version-mismatch", { retryable: true });
      const projected = projectReconcileLookup(attempt, command);
      if (!projected) return attemptStoreSuccess({ kind: "conflict" as const, reason: "conflicting-evidence" as const });
      if (sameJson(projected, attempt.reconciliation)) return attemptStoreSuccess({ kind: "unchanged" as const, attempt });
      const nextAttempt = { ...attempt, reconciliation: projected, attemptVersion: attempt.attemptVersion + 1 };
      await tx.saveState(command.actionId, replaceAttempt(state, index, nextAttempt));
      return attemptStoreSuccess({ kind: "projected" as const, attempt: nextAttempt, result: projected });
    });
  }

  async applyVerifiedObservation(observation: TrustedVerifiedObservation): Promise<AttemptStoreOutcome<ReconcileAttemptResult>> {
    const unavailable = this.unavailableOutcome<ReconcileAttemptResult>();
    if (unavailable) return unavailable;
    if (observation.applicationRecheck !== "owner-provider-action-attempt-versions-exact-evidence-lookup-execution-result") {
      return attemptStoreError("invalid-command");
    }
    try {
      return await this.persistence.transaction(async (tx) => {
        const loaded = await loadOwnedAttempt(tx, observation.owner, observation.actionId, observation.attemptId);
        if (!loaded.ok) return loaded.outcome;
        const { record, state, attempt, index } = loaded;
        const exactEvidence = attempt.evidence.find((item) => sameJson(item, observation.expectedEvidence.evidence));
        if (!exactEvidence) return attemptStoreError("conflicting-evidence");
        if (!revalidateTrustedVerifiedObservation(observation, {
          action: state.action.action,
          attempt,
          evidence: exactEvidence,
        })) return attemptStoreError("invalid-command");
        if (dispatchVersion(attempt) !== observation.expectedDispatchVersion) return attemptStoreError("dispatch-version-mismatch");
        const executionKey = verifiedExecutionKey(observation.verifiedExecution);
        const lockedLegacyTerminal = legacyVerifiedTerminalKind(record);
        if (lockedLegacyTerminal && observation.result.kind !== lockedLegacyTerminal) {
          return attemptStoreError("verified-execution-conflict");
        }
        const reservedExecutionKey = record.verifiedExecutionKey ?? state.verifiedExecutionKey;
        if (
          (record.verifiedExecutionKey && state.verifiedExecutionKey && record.verifiedExecutionKey !== state.verifiedExecutionKey) ||
          (reservedExecutionKey && reservedExecutionKey !== executionKey)
        ) return attemptStoreError("verified-execution-conflict");
        if (
          sameJson(attempt.reconciliation, observation.result) &&
          reservedExecutionKey === executionKey
        ) {
          return attemptStoreSuccess({ kind: "unchanged" as const, attempt });
        }
        if (isVerifiedTerminal(attempt.reconciliation)) return attemptStoreError("verified-execution-conflict");
        if (attempt.attemptVersion !== observation.expectedAttemptVersion) {
          return attemptStoreError("attempt-version-mismatch", { retryable: true });
        }
        const assigned = await tx.findVerifiedExecutionOwner(executionKey);
        if (assigned && assigned !== observation.actionId) return attemptStoreError("verified-execution-conflict");
        const nextAttempt: ExecutionAttempt = {
          ...attempt,
          reconciliation: clone(observation.result),
          dispatch: { phase: "closed", version: observation.expectedDispatchVersion },
          attemptVersion: attempt.attemptVersion + 1,
        };
        const nextOperation: StoredMoneyActionOperation = {
          ...record.operation,
          status: observation.result.kind,
          ...(observation.result.transactionHash ? { transactionHash: observation.result.transactionHash } : {}),
          updatedAt: observation.observedAt,
        };
        await tx.saveOperation({ operation: nextOperation, verifiedExecutionKey: executionKey });
        await tx.saveState(observation.actionId, {
          ...replaceAttempt(state, index, nextAttempt),
          verifiedExecutionKey: executionKey,
        });
        return attemptStoreSuccess({ kind: "projected" as const, attempt: nextAttempt, result: nextAttempt.reconciliation });
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async releaseAttemptAdmission(command: ReleaseAdmission, now: string): Promise<AttemptStoreOutcome<ReleaseAdmissionResult>> {
    const unavailable = this.unavailableOutcome<ReleaseAdmissionResult>();
    if (unavailable) return unavailable;
    if (!validateReleaseAdmission(command).ok || !Number.isFinite(Date.parse(now))) return attemptStoreError("invalid-command");
    return this.persistence.transaction(async (tx) => {
      const loaded = await loadOwnedAttempt(tx, command.owner, command.actionId, command.attemptId);
      if (!loaded.ok) return loaded.outcome;
      const { record, state, attempt, index } = loaded;
      if (attempt.admission.state === "released") {
        return attemptStoreSuccess({
          admission: attempt.admission,
          ownerResolution: attempt.ownerResolution.kind === "abandoned"
            ? attempt.ownerResolution
            : { kind: "abandoned" as const, at: attempt.admission.at, reason: command.reason },
          execution: attempt.reconciliation,
          lateEvidence: "accepted" as const,
        });
      }
      const admission = { state: "released" as const, at: now, policyVersion: command.policyVersion };
      const ownerResolution = { kind: "abandoned" as const, at: now, reason: command.reason };
      const nextAttempt: ExecutionAttempt = {
        ...attempt,
        admission,
        ownerResolution,
        attemptVersion: attempt.attemptVersion + 1,
      };
      await tx.saveOperation({
        ...record,
        operation: { ...record.operation, abandonedAt: record.operation.abandonedAt ?? now, updatedAt: now },
      });
      await tx.saveState(command.actionId, replaceAttempt(state, index, nextAttempt));
      return attemptStoreSuccess({ admission, ownerResolution, execution: nextAttempt.reconciliation, lateEvidence: "accepted" as const });
    });
  }

  async importLegacyOperation(operation: LegacyCompatibilityEnvelope): Promise<AttemptStoreOutcome<ImportLegacyOperationResult>> {
    const unavailable = this.unavailableOutcome<ImportLegacyOperationResult>();
    if (unavailable) return unavailable;
    if (operation.source !== "money_action_operations") return attemptStoreError("invalid-command");
    try {
      return await this.persistence.transaction(async (tx) => {
        const existing = await tx.getOperationById(operation.action.id);
        if (existing) {
          if (!sameAction(existing.operation.action, operation.action)) return attemptStoreError("action-revision-mismatch");
          const state = synchronizeLegacyState(await tx.getState(operation.action.id), existing);
          if (state) await tx.saveState(operation.action.id, state);
          return attemptStoreSuccess({ disposition: "existing" as const, operation });
        }
        const record = recordFromLegacy(operation);
        const state = stateFromLegacy(record, operation);
        if (!await tx.insertOperation(record)) {
          const winner = await tx.getOperationById(operation.action.id);
          if (!winner || !sameAction(winner.operation.action, operation.action)) {
            return attemptStoreError("action-revision-mismatch");
          }
          return attemptStoreSuccess({ disposition: "existing" as const, operation });
        }
        await tx.saveState(operation.action.id, state);
        return attemptStoreSuccess({ disposition: "imported" as const, operation });
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  private unavailableOutcome<Value>(): AttemptStoreOutcome<Value> | null {
    if (this.lifecycle === "created") return attemptStoreError("resource-not-initialized", { retryable: true });
    if (this.lifecycle === "disposed") return attemptStoreError("resource-disposed");
    return null;
  }

  private assertLegacyAvailable(): void {
    if (this.lifecycle !== "initialized") {
      throw new Error(this.lifecycle === "disposed" ? "attempt-store resource is disposed" : "attempt-store resource is not initialized");
    }
  }

  private installSensitiveAction(id: string, payload: NonNullable<IssueAttemptAction["transientSensitivePayload"]>): void {
    this.sensitiveActions.set(id, { action: stripRevision(payload.action), expiresAt: payload.expiresAt });
    const timer = setTimeout(() => this.sensitiveActions.delete(id), Math.max(0, Date.parse(payload.expiresAt) - Date.now()));
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  }

  private dispatchAction(action: AttemptActionSnapshot["action"], now: string): typeof action | null {
    if (!action.sensitivePayload) return clone(action);
    const sensitive = this.sensitiveActions.get(action.id);
    if (!sensitive || Date.parse(sensitive.expiresAt) <= Date.parse(now)) {
      this.sensitiveActions.delete(action.id);
      return null;
    }
    return compatibilityActionRevision(clone(sensitive.action));
  }
}

async function loadOwnedAttempt(
  tx: AttemptStoreTransaction,
  owner: MoneyActionOwner,
  actionId: string,
  attemptId: string,
): Promise<
  | { ok: true; record: AttemptOperationRecord; state: PersistedAttemptState; attempt: ExecutionAttempt; index: number }
  | { ok: false; outcome: ReturnType<typeof attemptStoreError> }
> {
  const record = await tx.getOperationById(actionId);
  if (!record) return { ok: false, outcome: attemptStoreError("not-found") };
  if (!sameMoneyActionOwner(record.operation.action.owner, owner)) {
    return { ok: false, outcome: attemptStoreError("owner-mismatch") };
  }
  const state = synchronizeLegacyState(await tx.getState(actionId), record);
  if (!state) return { ok: false, outcome: attemptStoreError("not-found") };
  const index = state.attempts.findIndex((candidate) => candidate.attemptId === attemptId);
  if (index < 0) return { ok: false, outcome: attemptStoreError("not-found") };
  return { ok: true, record, state, attempt: state.attempts[index]!, index };
}

export function synchronizeLegacyState(
  state: PersistedAttemptState | null,
  record: AttemptOperationRecord,
): PersistedAttemptState | null {
  if (!state) {
    const envelope = legacyCompatibilityEnvelope(record.operation, {
      ...(record.verifiedExecutionKey ? { verifiedExecutionKey: record.verifiedExecutionKey } : {}),
    });
    return stateFromLegacy(record, envelope);
  }
  if (state.attempts.length === 0) {
    const envelope = legacyCompatibilityEnvelope(record.operation, {
      ...(record.verifiedExecutionKey ? { verifiedExecutionKey: record.verifiedExecutionKey } : {}),
    });
    if (envelope.mappedAttempt) return stateFromLegacy(record, envelope, state.action);
    return withLegacyReservations(state, record.operation);
  }
  const index = state.attempts.length - 1;
  const attempt = state.attempts[index]!;
  let next = attempt;
  if (record.operation.abandonedAt && attempt.admission.state === "blocking") {
    next = {
      ...next,
      admission: { state: "released", at: record.operation.abandonedAt, policyVersion: "legacy-unknown" },
      ownerResolution: { kind: "abandoned", at: record.operation.abandonedAt, reason: "policy-timeout" },
    };
  }
  const lockedLegacyResult = legacyVerifiedTerminalResult(record);
  if (lockedLegacyResult && !sameJson(next.reconciliation, lockedLegacyResult)) {
    next = {
      ...next,
      reconciliation: lockedLegacyResult,
      attemptVersion: next.attemptVersion + 1,
    };
  }
  if (["confirmed", "failed", "expired"].includes(record.operation.status) && next.dispatch.phase !== "closed") {
    next = { ...next, dispatch: { phase: "closed", version: dispatchVersion(next) } };
  } else if (
    ["unknown", "submitted", "included"].includes(record.operation.status) &&
    next.reconciliation.kind === "authorized-no-evidence" &&
    next.evidence.length === 0
  ) {
    next = { ...next, reconciliation: { kind: "ambiguous" } };
  }
  const synchronized = next === attempt ? state : replaceAttempt(state, index, next);
  return withLegacyReservations(synchronized, record.operation);
}

function stateFromLegacy(
  record: AttemptOperationRecord,
  envelope: LegacyCompatibilityEnvelope,
  existingAction?: AttemptActionSnapshot,
): PersistedAttemptState {
  const action = existingAction ?? snapshotAttemptAction({ durableAction: compatibilityActionRevision(record.operation.action) });
  const attempts: ExecutionAttempt[] = [];
  if (envelope.mappedAttempt) {
    const terminal = ["confirmed", "failed", "expired"].includes(envelope.status);
    attempts.push({
      attemptId: envelope.mappedAttempt.attemptId,
      sequence: envelope.mappedAttempt.sequence,
      actionId: envelope.action.id,
      actionRevision: 1,
      owner: clone(envelope.action.owner),
      provider: envelope.action.owner.accountProvider,
      createdAt: envelope.claimedAt ?? envelope.createdAt,
      dispatch: terminal ? { phase: "closed", version: 1 } : { phase: "request-entered", version: 1 },
      providerRequestKey: {
        kind: "home-correlation",
        role: envelope.action.owner.accountProvider === "cdp-embedded" ? "cdp-idempotency-header" : "eip-5792-request-id",
        value: envelope.action.id,
        homeActionId: envelope.action.id,
      },
      evidence: [],
      reconciliation: legacyVerifiedTerminalResult(record) ?? legacyResult(record.operation),
      ownerResolution: envelope.abandonedAt
        ? { kind: "abandoned", at: envelope.abandonedAt, reason: "policy-timeout" }
        : { kind: "active" },
      admission: envelope.abandonedAt
        ? { state: "released", at: envelope.abandonedAt, policyVersion: "legacy-unknown" }
        : { state: "blocking" },
      attemptVersion: 1,
    });
  }
  return {
    action: clone(action),
    attempts,
    legacyEvidenceReservations: legacyEvidenceReservationKeys(record.operation),
    importedLegacy: clone(envelope),
    ...(record.verifiedExecutionKey ? { verifiedExecutionKey: record.verifiedExecutionKey } : {}),
  };
}

function legacyVerifiedTerminalKind(
  record: AttemptOperationRecord,
): "confirmed" | "failed" | null {
  if (!record.verifiedExecutionKey) return null;
  return record.operation.status === "confirmed" || record.operation.status === "failed"
    ? record.operation.status
    : null;
}

function legacyVerifiedTerminalResult(
  record: AttemptOperationRecord,
): Extract<ExecutionAttempt["reconciliation"], { kind: "confirmed" | "failed" }> | null {
  const kind = legacyVerifiedTerminalKind(record);
  if (kind === "failed") {
    return {
      kind,
      ...(record.operation.transactionHash ? { transactionHash: record.operation.transactionHash } : {}),
      verifiedExecution: true,
    };
  }
  if (kind === "confirmed" && record.operation.transactionHash) {
    return { kind, transactionHash: record.operation.transactionHash, verifiedExecution: true };
  }
  return null;
}

function legacyResult(operation: StoredMoneyActionOperation): ExecutionAttempt["reconciliation"] {
  if (operation.status === "prepared" || operation.status === "expired") return { kind: "unexecuted" };
  if (operation.status === "unknown" || operation.status === "submitting") return { kind: "ambiguous" };
  if (operation.submissionId) return {
    kind: "pending",
    handle: { kind: "submission-id", provider: "base-account", value: operation.submissionId },
  };
  if (operation.userOperationHash) return {
    kind: "pending",
    handle: { kind: "user-operation-hash", provider: "cdp-embedded", value: operation.userOperationHash },
  };
  return { kind: "ambiguous" };
}

function recordFromLegacy(envelope: LegacyCompatibilityEnvelope): AttemptOperationRecord {
  return {
    operation: {
      action: mutableAction(envelope.action),
      status: envelope.status,
      attemptCount: envelope.attemptCount,
      ...(envelope.claimedAt ? { claimedAt: envelope.claimedAt } : {}),
      ...(envelope.abandonedAt ? { abandonedAt: envelope.abandonedAt } : {}),
      ...(envelope.references.submissionId ? { submissionId: envelope.references.submissionId.value } : {}),
      ...(envelope.references.transactionHash ? { transactionHash: envelope.references.transactionHash.value } : {}),
      ...(envelope.references.userOperationHash ? { userOperationHash: envelope.references.userOperationHash.value } : {}),
      createdAt: envelope.createdAt,
      updatedAt: envelope.updatedAt,
    },
    ...(envelope.verifiedExecutionKey ? { verifiedExecutionKey: envelope.verifiedExecutionKey.value } : {}),
  };
}

function operationFromAction(action: AttemptActionSnapshot["action"]): StoredMoneyActionOperation {
  return {
    action: stripRevision(action),
    status: "prepared",
    attemptCount: 0,
    createdAt: action.createdAt,
    updatedAt: action.createdAt,
  };
}

function projectEvidence(
  operation: StoredMoneyActionOperation,
  evidence: ProviderEvidence,
  now: string,
): StoredMoneyActionOperation {
  const lead = evidence.kind === "provider-status" ? evidence.handle : evidence;
  return {
    ...operation,
    status: ["submitting", "submitted", "unknown"].includes(operation.status) ? "submitted" : operation.status,
    ...(lead.kind === "submission-id" ? { submissionId: operation.submissionId ?? lead.value } : {}),
    ...(lead.kind === "user-operation-hash" ? { userOperationHash: operation.userOperationHash ?? canonicalHash(lead.value) } : {}),
    ...(lead.kind === "transaction-hash" ? { transactionHash: operation.transactionHash ?? canonicalHash(lead.value) } : {}),
    updatedAt: now,
  };
}

function projectReconcileLookup(attempt: ExecutionAttempt, command: ReconcileAttempt): ExecutionAttempt["reconciliation"] | null {
  if (isVerifiedTerminal(attempt.reconciliation)) return attempt.reconciliation;
  const lookup = command.lookup;
  if (lookup.kind === "none") {
    return attempt.reconciliation.kind === "authorized-no-evidence"
      ? { kind: "ambiguous" }
      : attempt.reconciliation;
  }
  const evidence = attempt.evidence.map((item) => item.evidence.kind === "provider-status" ? item.evidence.handle : item.evidence);
  if (lookup.kind === "recorded-user-operation-hash") {
    const expected = lookup.userOperationHash.toLowerCase();
    const matched = evidence.find((item) => item.kind === "user-operation-hash" && item.value.toLowerCase() === expected);
    if (!matched || matched.kind !== "user-operation-hash") return null;
    return attempt.reconciliation.kind === "pending" ? attempt.reconciliation : { kind: "pending", handle: matched };
  }
  if (lookup.kind === "recorded-submission-id") {
    const expected = lookup.submissionId;
    const matched = evidence.find((item) => item.kind === "submission-id" && item.value === expected);
    if (!matched || matched.kind !== "submission-id") return null;
    return attempt.reconciliation.kind === "pending" ? attempt.reconciliation : { kind: "pending", handle: matched };
  }
  const expected = lookup.transactionHash.toLowerCase();
  const matched = evidence.some((item) => item.kind === "transaction-hash" && item.value.toLowerCase() === expected);
  return matched ? attempt.reconciliation : null;
}

function evidenceSlot(evidence: ProviderEvidence): string {
  if (evidence.kind !== "provider-status") return evidence.kind;
  return `provider-status:${evidenceSlot(evidence.handle)}`;
}

function legacyReferenceConflict(operation: StoredMoneyActionOperation, evidence: ProviderEvidence): boolean {
  if (evidence.kind === "provider-status") {
    if (evidence.handle.kind === "submission-id") {
      return operation.submissionId !== undefined && operation.submissionId !== evidence.handle.value;
    }
    return operation.userOperationHash !== undefined &&
      operation.userOperationHash.toLowerCase() !== evidence.handle.value.toLowerCase();
  }
  if (evidence.kind === "submission-id") return operation.submissionId !== undefined;
  if (evidence.kind === "user-operation-hash") return operation.userOperationHash !== undefined;
  return operation.transactionHash !== undefined;
}

function legacyEvidenceReservationKeys(operation: StoredMoneyActionOperation): string[] {
  const keys: string[] = [];
  if (operation.submissionId) {
    const key = evidenceUniquenessKey(operation.action.owner, {
      kind: "submission-id",
      provider: "base-account",
      value: operation.submissionId,
    });
    if (key) keys.push(key);
  }
  if (operation.userOperationHash) {
    const key = evidenceUniquenessKey(operation.action.owner, {
      kind: "user-operation-hash",
      provider: "cdp-embedded",
      value: operation.userOperationHash,
    });
    if (key) keys.push(key);
  }
  return [...new Set(keys)];
}

function withLegacyReservations(
  state: PersistedAttemptState,
  operation: StoredMoneyActionOperation,
): PersistedAttemptState {
  const reservations = legacyEvidenceReservationKeys(operation);
  if (sameJson(state.legacyEvidenceReservations ?? [], reservations)) return state;
  return { ...state, legacyEvidenceReservations: reservations };
}

function isVerifiedTerminal(result: ExecutionAttempt["reconciliation"]): boolean {
  return result.kind === "confirmed" || result.kind === "failed" || result.kind === "rejected";
}

export function evidenceUniquenessKey(owner: MoneyActionOwner, evidence: ProviderEvidence): string | null {
  const lead = evidence.kind === "provider-status" ? evidence.handle : evidence;
  if (lead.kind === "transaction-hash") return null;
  const value = lead.kind === "user-operation-hash" ? lead.value.toLowerCase() : lead.value;
  return JSON.stringify([
    owner.subject,
    owner.address.toLowerCase(),
    owner.chainId,
    owner.accountProvider,
    lead.provider,
    lead.kind,
    value,
  ]);
}

export function verifiedExecutionKey(execution: { chainId: number; kind: string; hash: string }): string {
  return `${execution.chainId}:${execution.kind}:${execution.hash.toLowerCase()}`;
}

function canonicalEvidence<Evidence extends ProviderEvidence>(evidence: Evidence): Evidence {
  const result = clone(evidence);
  if (result.kind === "transaction-hash" || result.kind === "user-operation-hash") {
    result.value = canonicalHash(result.value) as typeof result.value;
  } else if (result.kind === "provider-status" && result.handle.kind === "user-operation-hash") {
    result.handle.value = canonicalHash(result.handle.value);
  }
  return result;
}

function canonicalHash(value: `0x${string}`): `0x${string}` {
  return value.toLowerCase() as `0x${string}`;
}

function dispatchVersion(attempt: ExecutionAttempt): number {
  return "version" in attempt.dispatch ? attempt.dispatch.version : 1;
}

function replaceAttempt(state: PersistedAttemptState, index: number, attempt: ExecutionAttempt): PersistedAttemptState {
  const attempts = state.attempts.slice();
  attempts[index] = attempt;
  return { ...state, attempts };
}

function stripRevision(action: AttemptActionSnapshot["action"]): PreparedMoneyAction {
  const copy = structuredClone(action) as unknown as PreparedMoneyAction & { revision?: number };
  delete copy.revision;
  return copy;
}

function mutableAction(action: LegacyCompatibilityEnvelope["action"]): PreparedMoneyAction {
  return structuredClone(action) as unknown as PreparedMoneyAction;
}

function sameAction(left: unknown, right: unknown): boolean {
  const normalized = (action: unknown) => {
    const copy = structuredClone(action) as Record<string, unknown>;
    delete copy.revision;
    return copy;
  };
  return sameJson(normalized(left), normalized(right));
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}

function persistenceError<Value>(error: unknown): AttemptStoreOutcome<Value> {
  if (error instanceof AttemptPersistenceConflict) {
    return attemptStoreError(error.kind === "evidence" ? "conflicting-evidence" : "verified-execution-conflict");
  }
  throw error;
}
