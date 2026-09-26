import "server-only";

import { randomUUID } from "node:crypto";
import { getSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { emitServerEvent } from "@/server/observability/log";
import type { IdentityFacts } from "@/shared/identity/status";
import type { ProviderEnv } from "./sumsub";

export type IdentityRecord = IdentityFacts & {
  id: string; customerId: string; providerEnv: ProviderEnv; externalUserId: string;
  attemptCount: number | null; reviewId: string | null; reviewCreatedAt: string | null;
  levelMovedAt: string | null; levelMovedAttemptCount: number | null;
  consentVersion: string; consentedLevel: string; consentLocale: string | null;
  consentedAt: string; reconciledAt: string | null; reconcileAttemptedAt: string | null;
  supersededAt: string | null; approvalAnnounced: boolean; version: number;
};
export type IdentityUpdate = Partial<Pick<IdentityRecord, "applicantId" | "levelName" | "reviewState" | "retryReason" | "lifecycle" | "approvedAt" | "attemptCount" | "reviewId" | "reviewCreatedAt" | "levelMovedAt" | "levelMovedAttemptCount" | "reconciledAt">>;
export type IdentityEvent = { source: "webhook" | "reconcile" | "session"; configuredLevel: string; rawReviewStatus?: string | null; rawReviewAnswer?: string | null; rawRejectType?: string | null };
export type ReserveInput = { customerId: string; env: ProviderEnv; externalUserId: string; level: string; consentVersion: string; locale?: string | null; at: string };
export type ConsentInput = { version: string; level: string; locale?: string | null; at: string };
export interface IdentityStore {
  active(customerId: string, env: ProviderEnv): Promise<IdentityRecord | null>;
  byExternalId(id: string): Promise<IdentityRecord | null>;
  restriction(customerId: string, env: ProviderEnv): Promise<boolean>;
  reserve(input: ReserveInput): Promise<IdentityRecord>;
  recordConsent(row: IdentityRecord, input: ConsentInput): Promise<IdentityRecord | null>;
  apply(row: IdentityRecord, patch: IdentityUpdate, event: IdentityEvent, at: string): Promise<IdentityRecord | null>;
  staleActive(env: ProviderEnv, limit: number, before: string, configuredLevel: string): Promise<IdentityRecord[]>;
  claimReconcile(row: IdentityRecord, at: string): Promise<IdentityRecord | null>;
  markReconciled(row: IdentityRecord, at: string): Promise<IdentityRecord | null>;
  markReconcileAttempt(id: string, at: string): Promise<void>;
  consumeRequest(customerId: string, at: string, windowMs: number, max: number): Promise<number | null>;
  releaseRestriction(id: string, releasedBy: string, at: string, configuredLevel: string): Promise<boolean>;
}
export const decidedReviewStates: ReadonlySet<IdentityRecord["reviewState"]> = new Set<IdentityRecord["reviewState"]>(["approved", "retry", "final", "duplicate"]);
export function isOlderReview(applicant: Pick<IdentityRecord, "attemptCount" | "reviewCreatedAt" | "reviewState">, row: Pick<IdentityRecord, "attemptCount" | "reviewCreatedAt">): boolean {
  if (applicant.attemptCount === null && applicant.reviewCreatedAt === null) return decidedReviewStates.has(applicant.reviewState) && (row.attemptCount !== null || row.reviewCreatedAt !== null);
  if (applicant.attemptCount !== null && row.attemptCount !== null && applicant.attemptCount !== row.attemptCount) return applicant.attemptCount < row.attemptCount;
  return applicant.reviewCreatedAt !== null && row.reviewCreatedAt !== null && applicant.reviewCreatedAt < row.reviewCreatedAt;
}
export function finalAtLevel(row: Pick<IdentityRecord, "reviewState" | "levelName">, level: string): boolean {
  return row.reviewState === "final" && row.levelName === level;
}
export function isNewFinalReview(before: Pick<IdentityRecord, "reviewState" | "levelName" | "attemptCount" | "reviewId" | "reviewCreatedAt">, after: Pick<IdentityRecord, "reviewState" | "levelName" | "attemptCount" | "reviewId" | "reviewCreatedAt">, level: string): boolean {
  if (!finalAtLevel(after, level)) return false;
  if (!finalAtLevel(before, level)) return true;
  return after.attemptCount !== null && before.attemptCount !== null && after.attemptCount > before.attemptCount ||
    after.reviewCreatedAt !== null && before.reviewCreatedAt !== null && after.reviewCreatedAt > before.reviewCreatedAt ||
    after.reviewId !== null && before.reviewId !== null && after.reviewId !== before.reviewId;
}
export function approvedAtLevel(row: IdentityRecord, level: string): boolean {
  return row.lifecycle === "active" && row.reviewState === "approved" && row.levelName === level;
}

/** @public unit-test-only identity store */
export class MemoryIdentityStore implements IdentityStore {
  private rows = new Map<string, IdentityRecord>();
  private restrictions = new Map<string, { id: string; released: boolean }>();
  private requests = new Map<string, number[]>();
  readonly events: Array<{ rowId: string; event: IdentityEvent; approved: boolean }> = [];
  readonly approvalEvents: Array<{ rowId: string; approved: boolean }> = [];
  private key(id: string, env: ProviderEnv) { return `${id}:${env}`; }
  async active(id: string, env: ProviderEnv) { const row = [...this.rows.values()].find((item) => item.customerId === id && item.providerEnv === env && !item.supersededAt); return row ? structuredClone(row) : null; }
  async byExternalId(id: string) { const row = [...this.rows.values()].find((item) => item.externalUserId === id); return row ? structuredClone(row) : null; }
  async restriction(id: string, env: ProviderEnv) { const row = this.restrictions.get(this.key(id, env)); return !!row && !row.released; }
  async reserve(input: ReserveInput) {
    let existing = await this.active(input.customerId, input.env);
    if (existing && existing.lifecycle !== "removed") return existing;
    if (existing) { this.rows.set(existing.id, { ...existing, supersededAt: input.at }); existing = null; }
    if ([...this.rows.values()].some((row) => row.externalUserId === input.externalUserId)) throw new Error("identity-duplicate-external-id");
    const row: IdentityRecord = { id: randomUUID(), customerId: input.customerId, providerEnv: input.env, externalUserId: input.externalUserId, applicantId: null, levelName: null, reviewState: "not-submitted", retryReason: null, lifecycle: "active", approvedAt: null, restricted: false, attemptCount: null, reviewId: null, reviewCreatedAt: null, levelMovedAt: null, levelMovedAttemptCount: null, consentVersion: input.consentVersion, consentLocale: input.locale ?? null, consentedLevel: input.level, consentedAt: input.at, reconciledAt: null, reconcileAttemptedAt: null, supersededAt: null, approvalAnnounced: false, version: 0 };
    this.rows.set(row.id, row);
    return structuredClone(row);
  }
  async recordConsent(row: IdentityRecord, input: ConsentInput) {
    const current = this.rows.get(row.id);
    if (!current || current.version !== row.version || current.supersededAt) return null;
    const next = { ...current, consentVersion: input.version, consentLocale: input.locale ?? null, consentedLevel: input.level, consentedAt: input.at, version: current.version + 1 };
    this.rows.set(row.id, next); return structuredClone(next);
  }
  async apply(row: IdentityRecord, patch: IdentityUpdate, event: IdentityEvent, _at: string) {
    const current = this.rows.get(row.id);
    if (!current || current.version !== row.version || current.supersededAt) return null;
    if (patch.applicantId && [...this.rows.values()].some((other) => other.id !== row.id && other.applicantId === patch.applicantId)) throw new Error("identity-duplicate-applicant");
    const next = { ...current, ...patch, version: current.version + 1 };
    const restrictedBefore = await this.restriction(row.customerId, row.providerEnv);
    const created = isNewFinalReview(current, next, event.configuredLevel) && !restrictedBefore;
    if (created) this.restrictions.set(this.key(row.customerId, row.providerEnv), { id: randomUUID(), released: false });
    const approvedBefore = current.approvalAnnounced;
    const approvedAfter = approvedAtLevel(next, event.configuredLevel) && !(restrictedBefore || created);
    next.approvalAnnounced = approvedAfter;
    this.rows.set(row.id, next);
    this.events.push({ rowId: row.id, event, approved: approvedAfter });
    if (approvedBefore !== approvedAfter) this.approvalEvents.push({ rowId: row.id, approved: approvedAfter });
    return structuredClone(next);
  }
  async staleActive(env: ProviderEnv, limit: number, before: string, configuredLevel: string) {
    const lastTouch = (row: IdentityRecord) => Math.max(...[row.reconciledAt, row.reconcileAttemptedAt].filter((value): value is string => value !== null).map(Date.parse));
    return [...this.rows.values()].filter((row) => row.providerEnv === env && !row.supersededAt && row.lifecycle !== "removed" && (row.reviewState !== "final" || this.restrictions.get(this.key(row.customerId, row.providerEnv))?.released !== false) && lastTouch(row) < Date.parse(before) - (approvedAtLevel(row, configuredLevel) ? 23 * 60 * 60 * 1000 + 55 * 60 * 1000 : 0)).sort((a, b) => lastTouch(a) - lastTouch(b)).slice(0, limit).map((row) => structuredClone(row));
  }
  async claimReconcile(row: IdentityRecord, at: string) {
    const current = this.rows.get(row.id);
    if (!current || current.supersededAt || current.reconciledAt !== row.reconciledAt || current.reconcileAttemptedAt !== row.reconcileAttemptedAt) return null;
    const next = { ...current, reconcileAttemptedAt: at };
    this.rows.set(row.id, next);
    return structuredClone(next);
  }
  async markReconciled(row: IdentityRecord, at: string) {
    const current = this.rows.get(row.id);
    if (!current || current.version !== row.version || current.supersededAt) return null;
    const next = { ...current, reconciledAt: at };
    this.rows.set(row.id, next);
    return structuredClone(next);
  }
  async markReconcileAttempt(id: string, at: string) {
    const row = this.rows.get(id);
    if (row && !row.supersededAt) this.rows.set(id, { ...row, reconcileAttemptedAt: at });
  }
  async consumeRequest(customerId: string, at: string, windowMs: number, max: number) {
    const now = Date.parse(at);
    const times = (this.requests.get(customerId) ?? []).filter((time) => time > now - windowMs).sort((a, b) => a - b);
    if (times.length >= max) { this.requests.set(customerId, times); return Math.max(1, Math.ceil((times[0]! + windowMs - now) / 1000)); }
    this.requests.set(customerId, [...times, now].sort((a, b) => a - b));
    return null;
  }
  async releaseRestriction(id: string, releasedBy: string, _at: string, configuredLevel: string) {
    if (!releasedBy || releasedBy.length > 200) return false;
    for (const [key, restriction] of this.restrictions) if (restriction.id === id && !restriction.released) {
      this.restrictions.set(key, { ...restriction, released: true });
      const row = [...this.rows.values()].find((item) => this.key(item.customerId, item.providerEnv) === key && !item.supersededAt);
      if (row && !row.approvalAnnounced && approvedAtLevel(row, configuredLevel) && !(await this.restriction(row.customerId, row.providerEnv))) {
        this.rows.set(row.id, { ...row, approvalAnnounced: true });
        this.approvalEvents.push({ rowId: row.id, approved: true });
      }
      emitServerEvent("identity-approval", { route: "/api/identity/restrictions", code: "IDENTITY_RESTRICTION_RELEASED", outcome: "ok", rowId: id });
      return true;
    }
    return false;
  }
}

const columns: Record<keyof IdentityUpdate, string> = { applicantId: "applicant_id", levelName: "level_name", reviewState: "review_state", retryReason: "retry_reason", lifecycle: "lifecycle", approvedAt: "approved_at", attemptCount: "attempt_count", reviewId: "review_id", reviewCreatedAt: "review_created_at", levelMovedAt: "level_moved_at", levelMovedAttemptCount: "level_moved_attempt_count", reconciledAt: "reconciled_at" };
export class PostgresIdentityStore implements IdentityStore {
  constructor(private sql: SqlExecutor) {}
  async active(id: string, env: ProviderEnv) { return this.one("SELECT * FROM identity_verifications WHERE customer_id=$1 AND provider='sumsub' AND provider_env=$2 AND superseded_at IS NULL", [id, env]); }
  async byExternalId(id: string) { return this.one("SELECT * FROM identity_verifications WHERE external_user_id=$1", [id]); }
  async restriction(id: string, env: ProviderEnv) { return (await this.sql.query("SELECT id FROM customer_restrictions WHERE customer_id=$1 AND provider_env=$2 AND kind='identity-final-rejection' AND released_at IS NULL", [id, env])).rows.length > 0; }
  async reserve(input: ReserveInput) {
    return this.sql.transaction(async (tx) => {
      const old = (await tx.query("SELECT * FROM identity_verifications WHERE customer_id=$1 AND provider_env=$2 AND superseded_at IS NULL FOR UPDATE", [input.customerId, input.env])).rows[0];
      if (old && old.lifecycle !== "removed") return fromRow(old);
      if (old) await tx.query("UPDATE identity_verifications SET superseded_at=$2,updated_at=$2 WHERE id=$1", [old.id, input.at]);
      const inserted = await tx.query(`INSERT INTO identity_verifications (id,customer_id,provider,provider_env,external_user_id,consent_version,consent_locale,consented_level,consented_at,created_at,updated_at)
        VALUES (gen_random_uuid(),$1,'sumsub',$2,$3,$4,$5,$6,$7,$7,$7)
        ON CONFLICT (customer_id,provider,provider_env) WHERE superseded_at IS NULL DO NOTHING RETURNING *`, [input.customerId, input.env, input.externalUserId, input.consentVersion, input.locale ?? null, input.level, input.at]);
      const row = inserted.rows[0] ?? (await tx.query("SELECT * FROM identity_verifications WHERE customer_id=$1 AND provider_env=$2 AND superseded_at IS NULL", [input.customerId, input.env])).rows[0];
      if (!row) throw new Error("identity-reserve-failed");
      return fromRow(row);
    });
  }
  async recordConsent(row: IdentityRecord, input: ConsentInput) { return this.one("UPDATE identity_verifications SET consent_version=$3,consented_level=$4,consent_locale=$5,consented_at=$6,updated_at=$6,version=version+1 WHERE id=$1 AND version=$2 AND superseded_at IS NULL RETURNING *", [row.id, row.version, input.version, input.level, input.locale ?? null, input.at]); }
  async apply(row: IdentityRecord, patch: IdentityUpdate, event: IdentityEvent, at: string) {
    return this.sql.transaction(async (tx) => {
      const keys = Object.keys(patch) as (keyof IdentityUpdate)[];
      const values: unknown[] = [row.id, row.version];
      const sets = keys.map((key) => { values.push(patch[key]); return `${columns[key]}=$${values.length}`; });
      values.push(at);
      const result = await tx.query(`UPDATE identity_verifications SET ${sets.join(", ")}${sets.length ? ", " : ""}version=version+1,updated_at=$${values.length} WHERE id=$1 AND version=$2 AND superseded_at IS NULL RETURNING *`, values);
      if (!result.rows[0]) return null;
      const next = fromRow(result.rows[0]);
      const restrictedBefore = (await tx.query("SELECT id FROM customer_restrictions WHERE customer_id=$1 AND provider_env=$2 AND kind='identity-final-rejection' AND released_at IS NULL FOR UPDATE", [next.customerId, next.providerEnv])).rows.length > 0;
      const created = isNewFinalReview(row, next, event.configuredLevel) && !restrictedBefore;
      if (created) await tx.query(`INSERT INTO customer_restrictions (id,customer_id,kind,provider_env,source_verification_id,created_at) VALUES (gen_random_uuid(),$1,'identity-final-rejection',$2,$3,$4) ON CONFLICT (customer_id,kind,provider_env) WHERE released_at IS NULL DO NOTHING`, [next.customerId, next.providerEnv, next.id, at]);
      const restrictedAfter = restrictedBefore || created;
      const approvedBefore = next.approvalAnnounced;
      const approvedAfter = approvedAtLevel(next, event.configuredLevel) && !restrictedAfter;
      if (approvedBefore !== approvedAfter) { await tx.query("UPDATE identity_verifications SET approval_announced=$2 WHERE id=$1", [next.id, approvedAfter]); next.approvalAnnounced = approvedAfter; }
      const raw = (value: string | null | undefined) => typeof value === "string" && /^[A-Za-z]{1,32}$/.test(value) ? value : null;
      await tx.query(`INSERT INTO identity_verification_events (id,verification_id,customer_id,source,review_state,lifecycle,level_name,approved,raw_review_status,raw_review_answer,raw_reject_type,attempt_count,review_id,review_created_at,consent_version)
        VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [next.id, next.customerId, event.source, next.reviewState, next.lifecycle, next.levelName, approvedAfter, raw(event.rawReviewStatus), raw(event.rawReviewAnswer), raw(event.rawRejectType), next.attemptCount, next.reviewId, next.reviewCreatedAt, next.consentVersion]);
      if (approvedBefore !== approvedAfter) await tx.query(`INSERT INTO operator_events (id,customer_id,name,occurred_at,source,sandbox,props,idempotency_key) VALUES (gen_random_uuid(),$1,'identity.approval_changed',$2,'live',$3,$4::jsonb,$5) ON CONFLICT (idempotency_key) DO NOTHING`, [next.customerId, at, next.providerEnv === "sandbox", JSON.stringify({ approved: String(approvedAfter), level: event.configuredLevel, providerEnv: next.providerEnv }), `identity:${next.id}:${next.version}`]);
      return next;
    });
  }
  async staleActive(env: ProviderEnv, limit: number, before: string, configuredLevel: string) { const result = await this.sql.query("SELECT * FROM identity_verifications WHERE provider_env=$1 AND superseded_at IS NULL AND lifecycle<>'removed' AND (review_state<>'final' OR NOT EXISTS (SELECT 1 FROM customer_restrictions r WHERE r.customer_id=identity_verifications.customer_id AND r.provider_env=identity_verifications.provider_env AND r.kind='identity-final-rejection' AND r.released_at IS NULL)) AND (GREATEST(reconciled_at,reconcile_attempted_at) IS NULL OR GREATEST(reconciled_at,reconcile_attempted_at)<CASE WHEN review_state='approved' AND lifecycle='active' AND level_name=$4 THEN $2::timestamptz - interval '23 hours 55 minutes' ELSE $2::timestamptz END) ORDER BY GREATEST(reconciled_at,reconcile_attempted_at) NULLS FIRST LIMIT $3", [env, before, limit, configuredLevel]); return result.rows.map(fromRow); }
  async claimReconcile(row: IdentityRecord, at: string) { return this.one("UPDATE identity_verifications SET reconcile_attempted_at=$4 WHERE id=$1 AND superseded_at IS NULL AND reconciled_at IS NOT DISTINCT FROM $2::timestamptz AND reconcile_attempted_at IS NOT DISTINCT FROM $3::timestamptz RETURNING *", [row.id, row.reconciledAt, row.reconcileAttemptedAt, at]); }
  async markReconciled(row: IdentityRecord, at: string) { return this.one("UPDATE identity_verifications SET reconciled_at=$3 WHERE id=$1 AND version=$2 AND superseded_at IS NULL RETURNING *", [row.id, row.version, at]); }
  async markReconcileAttempt(id: string, at: string) { await this.sql.query("UPDATE identity_verifications SET reconcile_attempted_at=$2 WHERE id=$1 AND superseded_at IS NULL", [id, at]); }
  async consumeRequest(customerId: string, at: string, windowMs: number, max: number) {
    return this.sql.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('identity-request:' || $1, 0))", [customerId]);
      await tx.query("DELETE FROM identity_request_limits WHERE customer_id=$1 AND requested_at <= $2::timestamptz - $3::bigint * interval '1 millisecond'", [customerId, at, windowMs]);
      const requests = await tx.query<{ requested_at: Date }>("SELECT requested_at FROM identity_request_limits WHERE customer_id=$1 ORDER BY requested_at", [customerId]);
      if (requests.rows.length >= max) return Math.max(1, Math.ceil((new Date(requests.rows[0]!.requested_at).getTime() + windowMs - Date.parse(at)) / 1000));
      await tx.query("INSERT INTO identity_request_limits (customer_id,requested_at) VALUES ($1,$2)", [customerId, at]);
      return null;
    });
  }
  async releaseRestriction(id: string, releasedBy: string, at: string, configuredLevel: string) {
    const released = await this.sql.transaction(async (tx) => {
      const found = await tx.query("SELECT customer_id,provider_env FROM customer_restrictions WHERE id=$1 AND released_at IS NULL", [id]);
      if (!found.rows.length) return false;
      const restriction = found.rows[0] as { customer_id: string; provider_env: ProviderEnv };
      const active = await tx.query("SELECT * FROM identity_verifications WHERE customer_id=$1 AND provider_env=$2 AND superseded_at IS NULL FOR UPDATE", [restriction.customer_id, restriction.provider_env]);
      const result = await tx.query("UPDATE customer_restrictions SET released_at=$2,released_by=$3 WHERE id=$1 AND released_at IS NULL RETURNING id", [id, at, releasedBy]);
      if (!result.rows.length) return false;
      const other = await tx.query("SELECT id FROM customer_restrictions WHERE customer_id=$1 AND provider_env=$2 AND kind='identity-final-rejection' AND released_at IS NULL", [restriction.customer_id, restriction.provider_env]);
      const current = active.rows[0] ? fromRow(active.rows[0]) : null;
      if (current && !current.approvalAnnounced && !other.rows.length && approvedAtLevel(current, configuredLevel)) {
        await tx.query("UPDATE identity_verifications SET approval_announced=true WHERE id=$1", [current.id]);
        await tx.query(`INSERT INTO operator_events (id,customer_id,name,occurred_at,source,sandbox,props,idempotency_key) VALUES (gen_random_uuid(),$1,'identity.approval_changed',$2,'live',$3,$4::jsonb,$5) ON CONFLICT (idempotency_key) DO NOTHING`, [restriction.customer_id, at, restriction.provider_env === "sandbox", JSON.stringify({ approved: "true", level: configuredLevel, providerEnv: restriction.provider_env }), `identity-restriction-release:${id}`]);
      }
      return true;
    });
    if (released) emitServerEvent("identity-approval", { route: "/api/identity/restrictions", code: "IDENTITY_RESTRICTION_RELEASED", outcome: "ok", rowId: id });
    return released;
  }
  private async one(query: string, values: unknown[]) { const result = await this.sql.query(query, values); return result.rows[0] ? fromRow(result.rows[0]) : null; }
}
export function createRuntimeIdentityStore(env: Readonly<Record<string, string | undefined>> = process.env): IdentityStore | null {
  return env.DATABASE_URL?.trim() ? new PostgresIdentityStore(getSqlExecutor(env)) : null;
}
function date(value: unknown): string | null { return value == null ? null : (value instanceof Date ? value : new Date(String(value))).toISOString(); }
function fromRow(row: Record<string, unknown>): IdentityRecord {
  return { id: String(row.id), customerId: String(row.customer_id), providerEnv: String(row.provider_env) as ProviderEnv, externalUserId: String(row.external_user_id), applicantId: row.applicant_id == null ? null : String(row.applicant_id), levelName: row.level_name == null ? null : String(row.level_name), reviewState: String(row.review_state) as IdentityRecord["reviewState"], retryReason: row.retry_reason == null ? null : row.retry_reason as IdentityRecord["retryReason"], lifecycle: String(row.lifecycle) as IdentityRecord["lifecycle"], approvedAt: date(row.approved_at), restricted: false, attemptCount: row.attempt_count == null ? null : Number(row.attempt_count), reviewId: row.review_id == null ? null : String(row.review_id), reviewCreatedAt: date(row.review_created_at), levelMovedAt: date(row.level_moved_at), levelMovedAttemptCount: row.level_moved_attempt_count == null ? null : Number(row.level_moved_attempt_count), consentVersion: String(row.consent_version), consentLocale: row.consent_locale == null ? null : String(row.consent_locale), consentedLevel: String(row.consented_level), consentedAt: date(row.consented_at)!, reconciledAt: date(row.reconciled_at), reconcileAttemptedAt: date(row.reconcile_attempted_at), supersededAt: date(row.superseded_at), approvalAnnounced: row.approval_announced === true, version: Number(row.version) };
}
