import "server-only";

import { serverEnvironment } from "@/server/config/env";

import { getSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { envelopeKeyVersion, resolveSecretKeyring, sealSecret, type SecretKeyring } from "@/server/secrets/at-rest";
import { webhookSecretAad } from "./webhook-secret";

export type WebhookCredential =
  | { kind: "envelope"; envelope: string; keyVersion: number }
  | { kind: "legacy-plaintext"; secret: string };
export type WebhookSubscriptionRecord = {
  subscriptionId: string;
  target: string;
  eventType: string;
  createdAt: string;
  credential: WebhookCredential;
};
export type WebhookSubscriptionInsert = Pick<WebhookSubscriptionRecord, "subscriptionId" | "target" | "eventType"> & { secret: string };
export type WebhookCredentialReplacement = { envelope: string; keyVersion: number };
export type WebhookSubscriptionStates = { plaintext: number; notAtActive: number; total: number };

export interface WebhookSubscriptionStore {
  readonly persistent: boolean;
  readonly sealing: boolean;
  insert(record: WebhookSubscriptionInsert): Promise<void>;
  list(): Promise<WebhookSubscriptionRecord[]>;
  listForRotation(activeVersion: number, cursor: string | null, limit: number): Promise<WebhookSubscriptionRecord[]>;
  replaceCredentialIf(subscriptionId: string, expected: WebhookCredential, replacement: WebhookCredentialReplacement): Promise<boolean>;
  countStates(activeVersion: number): Promise<WebhookSubscriptionStates>;
  delete(subscriptionId: string): Promise<number>;
}

function validateReplacement(replacement: WebhookCredentialReplacement): void {
  if (replacement.envelope.length > 8192 || envelopeKeyVersion(replacement.envelope) !== replacement.keyVersion) throw new Error("invalid-webhook-envelope");
}

function fromRow(row: Record<string, unknown>): WebhookSubscriptionRecord {
  return {
    subscriptionId: String(row.subscription_id),
    target: String(row.target),
    eventType: String(row.event_type),
    createdAt: timestamp(row.created_at),
    credential: row.envelope === null
      ? { kind: "legacy-plaintext", secret: String(row.secret) }
      : { kind: "envelope", envelope: String(row.envelope), keyVersion: Number(row.key_version) },
  };
}

export class PostgresWebhookSubscriptionStore implements WebhookSubscriptionStore {
  readonly persistent = true;
  readonly sealing: boolean;
  constructor(private readonly sql: SqlExecutor, private readonly keyring: SecretKeyring | null) {
    this.sealing = keyring !== null;
  }

  async insert(record: WebhookSubscriptionInsert): Promise<void> {
    if (!this.keyring) throw new Error("webhook-secret-keyring-unavailable");
    const envelope = sealSecret(this.keyring, record.secret, webhookSecretAad(record));
    await this.sql.query(
      `INSERT INTO webhook_subscriptions (subscription_id,secret,envelope,key_version,target,event_type)
       VALUES ($1,NULL,$2,$3,$4,$5)
       ON CONFLICT (subscription_id) DO UPDATE SET
         secret=NULL,envelope=EXCLUDED.envelope,key_version=EXCLUDED.key_version,target=EXCLUDED.target,event_type=EXCLUDED.event_type`,
      [record.subscriptionId, envelope, this.keyring.version, record.target, record.eventType],
    );
  }

  async list(): Promise<WebhookSubscriptionRecord[]> {
    const result = await this.sql.query<Record<string, unknown>>(
      "SELECT subscription_id,secret,envelope,key_version,target,event_type,created_at FROM webhook_subscriptions ORDER BY created_at,subscription_id",
    );
    return result.rows.map(fromRow);
  }

  async listForRotation(activeVersion: number, cursor: string | null, limit: number): Promise<WebhookSubscriptionRecord[]> {
    const result = await this.sql.query<Record<string, unknown>>(
      "SELECT subscription_id,secret,envelope,key_version,target,event_type,created_at FROM webhook_subscriptions WHERE ($1::text IS NULL OR subscription_id > $1) AND key_version IS DISTINCT FROM $3 ORDER BY subscription_id LIMIT $2",
      [cursor, limit, activeVersion],
    );
    return result.rows.map(fromRow);
  }

  async replaceCredentialIf(subscriptionId: string, expected: WebhookCredential, replacement: WebhookCredentialReplacement): Promise<boolean> {
    validateReplacement(replacement);
    const result = await this.sql.query(
      `UPDATE webhook_subscriptions SET secret=NULL,envelope=$3,key_version=$4
       WHERE subscription_id=$1 AND ${expected.kind === "envelope" ? "envelope=$2 AND key_version=$5" : "secret=$2 AND envelope IS NULL"} RETURNING subscription_id`,
      expected.kind === "envelope"
        ? [subscriptionId, expected.envelope, replacement.envelope, replacement.keyVersion, expected.keyVersion]
        : [subscriptionId, expected.secret, replacement.envelope, replacement.keyVersion],
    );
    return result.rowCount > 0;
  }

  async countStates(activeVersion: number): Promise<WebhookSubscriptionStates> {
    const result = await this.sql.query<{ plaintext: number; not_at_active: number; total: number }>(
      `SELECT count(*) FILTER (WHERE secret IS NOT NULL)::integer AS plaintext,
       count(*) FILTER (WHERE key_version IS DISTINCT FROM $1)::integer AS not_at_active,
       count(*)::integer AS total FROM webhook_subscriptions`, [activeVersion],
    );
    const row = result.rows[0];
    if (!row) throw new Error("webhook-state-count-unavailable");
    return { plaintext: Number(row.plaintext), notAtActive: Number(row.not_at_active), total: Number(row.total) };
  }

  async delete(subscriptionId: string): Promise<number> {
    return (await this.sql.query("DELETE FROM webhook_subscriptions WHERE subscription_id=$1 RETURNING subscription_id", [subscriptionId])).rowCount;
  }
}

export class MemoryWebhookSubscriptionStore implements WebhookSubscriptionStore {
  readonly persistent = false;
  readonly sealing: boolean;
  constructor(private readonly keyring: SecretKeyring | null, private readonly records = new Map<string, WebhookSubscriptionRecord>()) {
    this.sealing = keyring !== null;
  }

  async insert(record: WebhookSubscriptionInsert): Promise<void> {
    if (!this.keyring) throw new Error("webhook-secret-keyring-unavailable");
    const envelope = sealSecret(this.keyring, record.secret, webhookSecretAad(record));
    this.records.set(record.subscriptionId, {
      subscriptionId: record.subscriptionId, target: record.target, eventType: record.eventType,
      credential: { kind: "envelope", envelope, keyVersion: this.keyring.version },
      createdAt: this.records.get(record.subscriptionId)?.createdAt ?? new Date().toISOString(),
    });
  }

  async list(): Promise<WebhookSubscriptionRecord[]> {
    return [...this.records.values()].map((record) => structuredClone(record));
  }

  async listForRotation(activeVersion: number, cursor: string | null, limit: number): Promise<WebhookSubscriptionRecord[]> {
    return [...this.records.values()].filter((row) => (cursor === null || row.subscriptionId > cursor) &&
      (row.credential.kind !== "envelope" || row.credential.keyVersion !== activeVersion))
      .sort((a, b) => a.subscriptionId.localeCompare(b.subscriptionId)).slice(0, limit).map((row) => structuredClone(row));
  }

  async replaceCredentialIf(subscriptionId: string, expected: WebhookCredential, replacement: WebhookCredentialReplacement): Promise<boolean> {
    validateReplacement(replacement);
    const record = this.records.get(subscriptionId);
    if (!record || record.credential.kind !== expected.kind ||
      (expected.kind === "envelope" && (record.credential.kind !== "envelope" || record.credential.envelope !== expected.envelope || record.credential.keyVersion !== expected.keyVersion)) ||
      (expected.kind === "legacy-plaintext" && (record.credential.kind !== "legacy-plaintext" || record.credential.secret !== expected.secret))) return false;
    record.credential = { kind: "envelope", ...replacement };
    return true;
  }

  async countStates(activeVersion: number): Promise<WebhookSubscriptionStates> {
    const rows = [...this.records.values()];
    return { total: rows.length, plaintext: rows.filter((row) => row.credential.kind === "legacy-plaintext").length,
      notAtActive: rows.filter((row) => row.credential.kind !== "envelope" || row.credential.keyVersion !== activeVersion).length };
  }

  async delete(subscriptionId: string): Promise<number> { return Number(this.records.delete(subscriptionId)); }

  seedLegacyForTests(record: WebhookSubscriptionInsert): void {
    this.records.set(record.subscriptionId, { subscriptionId: record.subscriptionId, target: record.target, eventType: record.eventType,
      credential: { kind: "legacy-plaintext", secret: record.secret }, createdAt: new Date().toISOString() });
  }

  clearForTests(): void { this.records.clear(); }
}

let runtimeStore: WebhookSubscriptionStore | null = null;
export function getWebhookSubscriptionStore(
  env: Readonly<Record<string, string | undefined>> = serverEnvironment(),
): WebhookSubscriptionStore {
  if (runtimeStore) return runtimeStore;
  const resolved = resolveSecretKeyring(env);
  const keyring = resolved.ok ? resolved.keyring : null;
  runtimeStore = env.DATABASE_URL?.trim()
    ? new PostgresWebhookSubscriptionStore(getSqlExecutor(env), keyring)
    : new MemoryWebhookSubscriptionStore(keyring);
  return runtimeStore;
}

function timestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}
