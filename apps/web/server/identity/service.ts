import "server-only";

import { randomBytes } from "node:crypto";
import { resolveCustomer } from "@/server/customers/resolve";
import { emitServerEvent } from "@/server/observability/log";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { IDENTITY_CONSENT_VERSION, type IdentityVerificationSessionRequest, type IdentityVerificationStatus } from "@/shared/identity/contract";
import { identityUnavailableStatus, mapIdentityStatus } from "@/shared/identity/status";
import { approvedAtLevel, createRuntimeIdentityStore, decidedReviewStates, finalAtLevel, isOlderReview, type IdentityEvent, type IdentityRecord, type IdentityStore, type IdentityUpdate } from "./store";
import { readIdentityConfig, readIdentitySupportUrl, SumsubClient, type Applicant, type IdentityConfig } from "./sumsub";

export class IdentityConflict extends Error {
  constructor(readonly status: IdentityVerificationStatus, readonly consentRequired = false) { super("identity-conflict"); }
}
export class IdentityRateLimited extends Error {
  constructor(readonly retryAfter: number) { super("identity-rate-limited"); }
}
export class IdentityConfigurationError extends Error { constructor() { super("identity-configuration-unavailable"); } }

export class IdentityService {
  constructor(private readonly deps: { store: IdentityStore; config: IdentityConfig | null; supportUrl?: string | null; provider: Pick<SumsubClient, "create" | "get" | "byExternalId" | "moveToLevel" | "token" | "link"> | null; now: () => string; randomId: () => string }) {}
  private get supportUrl() { return this.deps.supportUrl ?? this.deps.config?.supportUrl ?? null; }
  private status(row: IdentityRecord | null, restricted = false) {
    const level = this.deps.config?.level ?? null;
    const needsConsent = !row || row.lifecycle === "removed" || row.consentVersion !== IDENTITY_CONSENT_VERSION || row.consentedLevel !== level;
    return mapIdentityStatus(row ? { ...row, restricted } : restricted ? { applicantId: null, levelName: null, reviewState: "not-submitted", retryReason: null, lifecycle: "active", approvedAt: null, restricted: true } : null, level, this.supportUrl, needsConsent);
  }
  private async limit(customerId: string) {
    const retryAfter = await this.deps.store.consumeRequest(customerId, this.deps.now(), 600_000, 10);
    if (retryAfter !== null) throw new IdentityRateLimited(retryAfter);
  }
  async getIdentityVerificationStatus(customerId: string | null): Promise<IdentityVerificationStatus> {
    const { config, store } = this.deps;
    if (!config) return this.status(null);
    if (!customerId) return this.status(null);
    try {
      let row = await store.active(customerId, config.providerEnv);
      const restricted = await store.restriction(customerId, config.providerEnv);
      if (row?.applicantId && row.lifecycle !== "removed" && !restricted) {
        const interval = approvedAtLevel(row, config.level) ? 86_400_000 : 300_000;
        const lastTouch = Math.max(...[row.reconciledAt, row.reconcileAttemptedAt].filter((value): value is string => value !== null).map(Date.parse));
        const claimed = Date.parse(this.deps.now()) - lastTouch >= interval ? await store.claimReconcile(row, this.deps.now()) : null;
        if (claimed) {
          try { row = (await this.reconcile(claimed, "reconcile")).row; }
          catch {
            await store.markReconcileAttempt(row.id, this.deps.now()).catch(() => undefined);
            return this.status(row, restricted);
          }
        }
      }
      return this.status(row, restricted || await store.restriction(customerId, config.providerEnv));
    } catch { return identityUnavailableStatus(this.supportUrl); }
  }
  async getIdentityApproval(customerId: string): Promise<{ approved: boolean; level: string | null; approvedAt: string | null }> {
    const { config, store } = this.deps;
    if (!config) return { approved: false, level: null, approvedAt: null };
    try {
      const row = await store.active(customerId, config.providerEnv);
      const approved = !!row && approvedAtLevel(row, config.level) && !(await store.restriction(customerId, config.providerEnv));
      return { approved, level: row?.levelName ?? null, approvedAt: approved ? row?.approvedAt ?? null : null };
    } catch { return { approved: false, level: null, approvedAt: null }; }
  }
  async startIdentityVerificationSession(customerId: string, request: IdentityVerificationSessionRequest): Promise<{ token: string; status: IdentityVerificationStatus }> {
    const { store, config, provider } = this.deps;
    if (!config || !provider) throw new IdentityConfigurationError();
    await this.limit(customerId);
    let row = await store.active(customerId, config.providerEnv);
    const restricted = await store.restriction(customerId, config.providerEnv);
    let status = this.status(row, restricted);
    if (restricted || !["not-started", "in-progress", "retry", "reset", "removed", "level-changed"].includes(status.state)) throw new IdentityConflict(status);
    if (status.consentRequired && request.consent !== true) throw new IdentityConflict(status, true);
    if (!row || row.lifecycle === "removed") row = await store.reserve({ customerId, env: config.providerEnv, externalUserId: this.deps.randomId(), level: config.level, consentVersion: IDENTITY_CONSENT_VERSION, locale: request.locale, at: this.deps.now() });
    else if (status.consentRequired && request.consent) {
      const next = await store.recordConsent(row, { version: IDENTITY_CONSENT_VERSION, level: config.level, locale: request.locale, at: this.deps.now() });
      if (!next) throw new Error("identity-cas-conflict");
      row = next;
    }
    if (!row.applicantId) {
      let applicant = await provider.byExternalId(row.externalUserId);
      if (!applicant) {
        try { applicant = await provider.create(row.externalUserId); }
        catch {
          applicant = await provider.byExternalId(row.externalUserId);
          if (!applicant) {
            try { applicant = await provider.create(row.externalUserId); }
            catch { applicant = await provider.byExternalId(row.externalUserId); }
          }
          if (!applicant) throw new Error("identity-create-unconfirmed");
        }
      }
      if (applicant.externalUserId !== row.externalUserId || applicant.deleted) throw new Error("identity-applicant-mismatch");
      const adopted = await store.apply(row, { applicantId: applicant.id, levelName: applicant.levelName }, { source: "session", configuredLevel: config.level }, this.deps.now());
      if (!adopted) {
        row = await store.active(customerId, config.providerEnv);
        if (!row || row.applicantId !== applicant.id) throw new Error("identity-cas-conflict");
      } else row = adopted;
    }
    if (row.applicantId && row.levelName && row.levelName !== config.level) row = await this.moveLevel(row);
    else {
      const readback = await provider.get(row.applicantId ?? "");
      if (!readback || readback.deleted || readback.id !== row.applicantId || readback.externalUserId !== row.externalUserId) throw new Error("identity-readback-mismatch");
      row = (await this.applyReadback(row, readback, null, false, "session")).row;
    }
    status = this.status(row, await store.restriction(customerId, config.providerEnv));
    if (!["in-progress", "retry", "reset", "level-changed"].includes(status.state)) throw new IdentityConflict(status);
    return { token: await provider.token(row.externalUserId), status };
  }
  async createIdentityVerificationLink(customerId: string): Promise<string> {
    const { store, config, provider } = this.deps;
    if (!config || !provider) throw new IdentityConfigurationError();
    await this.limit(customerId);
    let row = await store.active(customerId, config.providerEnv);
    let status = this.status(row, await store.restriction(customerId, config.providerEnv));
    if (!row?.applicantId || status.consentRequired || !["in-progress", "retry", "reset", "level-changed"].includes(status.state)) throw new IdentityConflict(status, !!row?.applicantId && status.consentRequired);
    if (row.levelName && row.levelName !== config.level) row = await this.moveLevel(row);
    status = this.status(row, await store.restriction(customerId, config.providerEnv));
    if (!["in-progress", "retry", "reset"].includes(status.state)) throw new IdentityConflict(status);
    return provider.link(row.externalUserId);
  }
  private async moveLevel(row: IdentityRecord): Promise<IdentityRecord> {
    const { config, provider } = this.deps;
    if (!config || !provider || !row.applicantId) throw new IdentityConfigurationError();
    const current = await provider.get(row.applicantId);
    if (!current || current.deleted || current.id !== row.applicantId || current.externalUserId !== row.externalUserId) throw new Error("identity-readback-mismatch");
    row = (await this.applyReadback(row, current, null, false, "session")).row;
    if (row.levelName === config.level || !row.levelName || !row.applicantId) return row;
    await provider.moveToLevel(row.applicantId);
    const readback = await provider.get(row.applicantId!);
    if (!readback || readback.deleted || readback.id !== row.applicantId || readback.externalUserId !== row.externalUserId) throw new Error("identity-readback-mismatch");
    if (readback.levelName !== config.level) throw new Error("identity-level-mismatch");
    return (await this.applyReadback(row, readback, null, false, "session")).row;
  }
  async reconcile(row: IdentityRecord, source: IdentityEvent["source"] = "reconcile") {
    const provider = this.deps.provider;
    if (!provider) throw new IdentityConfigurationError();
    const applicant = row.applicantId ? await provider.get(row.applicantId) : await provider.byExternalId(row.externalUserId);
    if (!applicant) {
      emitServerEvent("identity-reconcile", { route: "/api/identity/reconcile", code: "IDENTITY_RECONCILE_MISSING", outcome: "ignored", rowId: row.id });
      await this.deps.store.markReconcileAttempt(row.id, this.deps.now());
      return { row, stale: false };
    }
    return this.applyReadback(row, applicant, null, false, source);
  }
  async reconcileStale(limit = 50): Promise<{ processed: number; failed: number }> {
    const { config, store } = this.deps;
    if (!config) throw new IdentityConfigurationError();
    const startedAt = Date.now();
    const before = new Date(Date.parse(this.deps.now()) - 300_000).toISOString();
    const rows = await store.staleActive(config.providerEnv, Math.min(limit, 50), before, config.level);
    let next = 0;
    let processed = 0;
    let failed = 0;
    const worker = async () => {
      while (next < rows.length && Date.now() - startedAt < 20_000) {
        const row = rows[next++]!;
        let claimed: IdentityRecord | null = null;
        try { claimed = await store.claimReconcile(row, this.deps.now()); } catch { failed++; processed++; continue; }
        if (!claimed) continue;
        processed++;
        try { await this.reconcile(claimed); } catch {
          failed++;
          emitServerEvent("identity-reconcile", { route: "/api/identity/reconcile", code: "IDENTITY_RECONCILE_FAILED", outcome: "unavailable", rowId: row.id });
          await store.markReconcileAttempt(row.id, this.deps.now()).catch(() => undefined);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(rows.length, 5) }, () => worker()));
    return { processed, failed };
  }
  async applyReadback(row: IdentityRecord, applicant: Applicant | null, eventAt: string | null, reset: boolean, source: IdentityEvent["source"] = "webhook", levelChanged = false): Promise<{ row: IdentityRecord; stale: boolean }> {
    const { store, provider, config } = this.deps;
    if (!config) throw new IdentityConfigurationError();
    for (let attempt = 0; attempt < 3; attempt++) {
      if (applicant && (applicant.externalUserId !== row.externalUserId || (row.applicantId && applicant.id !== row.applicantId))) throw new Error("identity-applicant-mismatch");
      if (!applicant && row.lifecycle === "removed") return { row, stale: false };
      const movedToConfiguredLevel = !!applicant && row.levelName !== config.level && applicant.levelName === config.level;
      const recordsMove = movedToConfiguredLevel || levelChanged && applicant?.levelName === config.level;
      if (applicant && !recordsMove && isOlderReview(applicant, row)) return { row, stale: true };
      const keepMarkers = !movedToConfiguredLevel && !!applicant && isOlderReview(applicant, row);
      const lifecycle = !applicant ? "removed" : applicant.deleted ? "deactivated" : reset && applicant.reviewState === "not-submitted" ? "reset" : row.lifecycle === "reset" && applicant.reviewState === "not-submitted" ? "reset" : "active";
      const moveRevealedDecided = recordsMove && decidedReviewStates.has(applicant!.reviewState);
      const computedMovedAt = !recordsMove ? null : moveRevealedDecided ? applicant!.reviewCreatedAt ?? (applicant!.attemptCount === null ? "1970-01-01T00:00:00.000Z" : null) : applicant!.reviewCreatedAt !== null ? new Date(Date.parse(applicant!.reviewCreatedAt) - 1).toISOString() : row.reviewCreatedAt ?? "1970-01-01T00:00:00.000Z";
      const computedMovedAttemptCount = !recordsMove ? null : moveRevealedDecided ? applicant!.attemptCount : applicant!.attemptCount !== null ? applicant!.attemptCount - 1 : row.attemptCount;
      const levelMovedAt = recordsMove && computedMovedAt !== null && (row.levelMovedAt === null || computedMovedAt > row.levelMovedAt) ? computedMovedAt : row.levelMovedAt;
      const levelMovedAttemptCount = recordsMove && computedMovedAttemptCount !== null && (row.levelMovedAttemptCount === null || computedMovedAttemptCount > row.levelMovedAttemptCount) ? computedMovedAttemptCount : row.levelMovedAttemptCount;
      const reviewAfterMove = !moveRevealedDecided && (levelMovedAt === null && levelMovedAttemptCount === null || !!applicant && (
        applicant.reviewCreatedAt !== null && levelMovedAt !== null && applicant.reviewCreatedAt > levelMovedAt ||
        applicant.attemptCount !== null && levelMovedAttemptCount !== null && applicant.attemptCount > levelMovedAttemptCount ||
        (levelMovedAt !== null || levelMovedAttemptCount !== null) && applicant.reviewCreatedAt === null && applicant.attemptCount === null && (row.reviewState === "pending" || row.reviewState === "manual-review" || decidedReviewStates.has(row.reviewState))
      ));
      const staleDecision = !!applicant && decidedReviewStates.has(applicant.reviewState) && applicant.levelName === config.level && !reviewAfterMove;
      const reviewState = staleDecision ? finalAtLevel(row, config.level) ? "final" : "not-submitted" : applicant?.reviewState ?? "not-submitted";
      const patch: IdentityUpdate = !applicant
        ? { applicantId: null, levelName: null, reviewState, retryReason: null, lifecycle, approvedAt: null, reconciledAt: this.deps.now() }
        : { applicantId: applicant.id, levelName: applicant.levelName, reviewState, retryReason: reviewState === "retry" ? applicant.retryReason : null, lifecycle, approvedAt: reviewState === "approved" ? applicant.reviewDate ?? eventAt ?? row.approvedAt : null, attemptCount: keepMarkers ? row.attemptCount : applicant.attemptCount ?? row.attemptCount, reviewId: keepMarkers ? row.reviewId : applicant.reviewId ?? row.reviewId, reviewCreatedAt: keepMarkers ? row.reviewCreatedAt : applicant.reviewCreatedAt ?? row.reviewCreatedAt, ...(recordsMove ? { levelMovedAt, levelMovedAttemptCount } : {}), reconciledAt: this.deps.now() };
      if (source === "webhook" && (Object.keys(patch) as (keyof IdentityUpdate)[]).every((key) => key === "reconciledAt" || row[key] === patch[key])) patch.reconciledAt = row.reconciledAt;
      const announcementDrift = row.approvalAnnounced !== (approvedAtLevel(row, config.level) && !(await store.restriction(row.customerId, row.providerEnv)));
      const unchanged = (Object.keys(patch) as (keyof IdentityUpdate)[]).every((key) => row[key] === patch[key]);
      if (unchanged && !announcementDrift) return { row, stale: false };
      if (source !== "webhook" && !announcementDrift && (Object.keys(patch) as (keyof IdentityUpdate)[]).every((key) => key === "reconciledAt" || row[key] === patch[key])) {
        const reconciled = await store.markReconciled(row, patch.reconciledAt!);
        if (!reconciled) await store.markReconcileAttempt(row.id, patch.reconciledAt!);
        return { row: reconciled ?? row, stale: false };
      }
      const next = await store.apply(row, patch, { source, configuredLevel: config.level, rawReviewStatus: applicant?.reviewStatus, rawReviewAnswer: applicant?.reviewAnswer, rawRejectType: applicant?.rejectType }, this.deps.now());
      if (next) return { row: next, stale: false };
      const refreshed = await store.active(row.customerId, row.providerEnv);
      if (!refreshed || refreshed.externalUserId !== row.externalUserId || !provider) throw new Error("identity-cas-conflict");
      const rereadId = applicant?.id ?? refreshed.applicantId;
      const reread = rereadId ? await provider.get(rereadId) : null;
      if (applicant && !reread) throw new Error("identity-cas-conflict");
      applicant = reread; row = refreshed;
    }
    throw new Error("identity-cas-conflict");
  }
}
const unavailable = async (): Promise<never> => { throw new IdentityConfigurationError(); };
const unavailableStore: IdentityStore = { active: unavailable, byExternalId: unavailable, restriction: unavailable, reserve: unavailable, recordConsent: unavailable, apply: unavailable, staleActive: unavailable, claimReconcile: unavailable, markReconciled: unavailable, markReconcileAttempt: unavailable, consumeRequest: unavailable, releaseRestriction: unavailable };
let runtime: IdentityService | null = null;
export function getIdentityService(): IdentityService {
  runtime ??= (() => {
    const store = createRuntimeIdentityStore();
    const config = store ? readIdentityConfig() : null;
    return new IdentityService({ store: store ?? unavailableStore, config, supportUrl: readIdentitySupportUrl(), provider: config ? new SumsubClient(config) : null, now: () => new Date().toISOString(), randomId: () => `home-${randomBytes(16).toString("hex")}` });
  })();
  return runtime;
}
export async function readIdentityVerificationStatus(session: VerifiedAccountSession) {
  const service = getIdentityService();
  try {
    const customer = await resolveCustomer(session, { create: false });
    return service.getIdentityVerificationStatus(customer?.id ?? null);
  } catch {
    return identityUnavailableStatus(readIdentitySupportUrl());
  }
}
/** @public card gating (#821) */
export async function getIdentityApproval(customerId: string, _requirement: "configured-level"): Promise<{ approved: boolean; level: string | null; approvedAt: string | null }> {
  return getIdentityService().getIdentityApproval(customerId);
}
export async function startIdentityVerificationSession(session: VerifiedAccountSession, request: IdentityVerificationSessionRequest) {
  if (!createRuntimeIdentityStore() || !readIdentityConfig()) throw new IdentityConfigurationError();
  const customer = await resolveCustomer(session, { create: true });
  if (!customer) throw new IdentityConfigurationError();
  return getIdentityService().startIdentityVerificationSession(customer.id, request);
}
export async function createIdentityVerificationLink(session: VerifiedAccountSession) {
  if (!createRuntimeIdentityStore() || !readIdentityConfig()) throw new IdentityConfigurationError();
  const customer = await resolveCustomer(session, { create: false });
  if (!customer) throw new IdentityConflict(await getIdentityService().getIdentityVerificationStatus(null));
  return getIdentityService().createIdentityVerificationLink(customer.id);
}
/** @public recipient sharing seam for #639 */
export { shareIdentityApproval } from "./share";
