import "server-only";

import { getSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { SECRET_ENVELOPE_PATTERN, envelopeKeyVersion } from "@/server/secrets/at-rest";
import type { FundingOrderOwner } from "./store";

export type FundingUserTokenKey = { owner: FundingOrderOwner; providerId: string; region: string; sandbox: boolean };
export type FundingUserTokenRow = { destination: string; envelope: string; keyVersion: number; returnedAt: string; updatedAt: string };
type Put = Omit<FundingUserTokenRow, "keyVersion">;
type Cursor = FundingUserTokenKey;
export interface FundingProviderUserTokenStore {
  get(key: FundingUserTokenKey): Promise<FundingUserTokenRow | null>;
  putIfEnvelope(key: FundingUserTokenKey, expectedEnvelope: string | null, row: Put): Promise<boolean>;
  deleteIfEnvelope(key: FundingUserTokenKey, envelope: string): Promise<boolean>;
  delete(key: FundingUserTokenKey): Promise<boolean>;
  listNotAtVersion(activeVersion: number, afterKey: Cursor | null, limit: number): Promise<Array<{ key: FundingUserTokenKey; row: FundingUserTokenRow }>>;
  replaceIfEnvelope(key: FundingUserTokenKey, expectedEnvelope: string, row: { envelope: string; updatedAt: string }): Promise<boolean>;
  countNotAtVersion(activeVersion: number): Promise<number>;
}
export class FundingUserTokenStoreError extends Error {
  constructor(code: "invalid-envelope" | "invalid-destination" | "query-failed") { super(code); }
}
const DESTINATION = /^0x[0-9a-f]{40}$/;
function validEnvelope(envelope: string): number {
  const version = typeof envelope === "string" && envelope.length <= 8192 && SECRET_ENVELOPE_PATTERN.test(envelope) ? envelopeKeyVersion(envelope) : null;
  if (version === null) throw new FundingUserTokenStoreError("invalid-envelope");
  return version;
}
function validDestination(destination: string): string {
  const normalized = typeof destination === "string" ? destination.toLowerCase() : "";
  if (!DESTINATION.test(normalized)) throw new FundingUserTokenStoreError("invalid-destination");
  return normalized;
}
function tuple(key: FundingUserTokenKey): unknown[] { return [key.owner.accountProvider, key.owner.subject, key.providerId, key.region, key.sandbox]; }
function serializedKey(key: FundingUserTokenKey): string { return JSON.stringify(tuple(key)); }
/** @public exercised by funding user token store and core tests */
export class MemoryFundingProviderUserTokenStore implements FundingProviderUserTokenStore {
  private readonly rows = new Map<string, { key: FundingUserTokenKey; row: FundingUserTokenRow }>();
  async get(key: FundingUserTokenKey) { return structuredClone(this.rows.get(serializedKey(key))?.row ?? null); }
  async putIfEnvelope(key: FundingUserTokenKey, expectedEnvelope: string | null, row: Put) {
    if (expectedEnvelope !== null) validEnvelope(expectedEnvelope);
    const value = { ...row, destination: validDestination(row.destination), keyVersion: validEnvelope(row.envelope) };
    const current = this.rows.get(serializedKey(key));
    if (expectedEnvelope === null ? !!current : current?.row.envelope !== expectedEnvelope) return false;
    this.rows.set(serializedKey(key), { key: structuredClone(key), row: structuredClone(value) });
    return true;
  }
  async deleteIfEnvelope(key: FundingUserTokenKey, envelope: string) {
    validEnvelope(envelope);
    if (this.rows.get(serializedKey(key))?.row.envelope !== envelope) return false;
    this.rows.delete(serializedKey(key)); return true;
  }
  async delete(key: FundingUserTokenKey) { return this.rows.delete(serializedKey(key)); }
  async listNotAtVersion(activeVersion: number, afterKey: Cursor | null, limit: number) {
    return [...this.rows.values()].filter(({ key, row }) => row.keyVersion !== activeVersion && (!afterKey || compareKey(key, afterKey) > 0)).sort((a, b) => compareKey(a.key, b.key)).slice(0, limit).map((value) => structuredClone(value));
  }
  async replaceIfEnvelope(key: FundingUserTokenKey, expectedEnvelope: string, row: { envelope: string; updatedAt: string }) {
    validEnvelope(expectedEnvelope);
    const version = validEnvelope(row.envelope);
    const current = this.rows.get(serializedKey(key));
    if (!current || current.row.envelope !== expectedEnvelope) return false;
    current.row = { ...current.row, envelope: row.envelope, keyVersion: version, updatedAt: row.updatedAt }; return true;
  }
  async countNotAtVersion(activeVersion: number) { return [...this.rows.values()].filter(({ row }) => row.keyVersion !== activeVersion).length; }
}
function compareKey(a: FundingUserTokenKey, b: FundingUserTokenKey): number {
  const left = tuple(a), right = tuple(b);
  for (let i = 0; i < left.length; i++) { if (left[i] === right[i]) continue; return left[i]! < right[i]! ? -1 : 1; }
  return 0;
}
type Row = Record<string, unknown>;
function fromRow(row: Row): FundingUserTokenRow {
  return { destination: String(row.destination), envelope: String(row.envelope), keyVersion: Number(row.key_version), returnedAt: new Date(String(row.returned_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString() };
}
function keyFromRow(row: Row): FundingUserTokenKey { return { owner: { accountProvider: String(row.account_provider) as FundingOrderOwner["accountProvider"], subject: String(row.owner_subject) }, providerId: String(row.provider_id), region: String(row.region), sandbox: Boolean(row.sandbox) }; }
export class PostgresFundingProviderUserTokenStore implements FundingProviderUserTokenStore {
  constructor(private readonly sql: SqlExecutor) {}
  private async query(text: string, values: unknown[]) { try { return await this.sql.query(text, values); } catch { throw new FundingUserTokenStoreError("query-failed"); } }
  async get(key: FundingUserTokenKey) {
    const result = await this.query("SELECT * FROM funding_provider_user_tokens WHERE account_provider=$1 AND owner_subject=$2 AND provider_id=$3 AND region=$4 AND sandbox=$5", tuple(key));
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  }
  async putIfEnvelope(key: FundingUserTokenKey, expectedEnvelope: string | null, row: Put) {
    if (expectedEnvelope !== null) validEnvelope(expectedEnvelope);
    const destination = validDestination(row.destination), version = validEnvelope(row.envelope);
    const values = [...tuple(key),destination,row.envelope,version,row.returnedAt,row.updatedAt];
    if (expectedEnvelope === null) {
      return (await this.query(`INSERT INTO funding_provider_user_tokens (account_provider,owner_subject,provider_id,region,sandbox,destination,envelope,key_version,returned_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (account_provider,owner_subject,provider_id,region,sandbox) DO NOTHING`, values)).rowCount > 0;
    }
    return (await this.query(`UPDATE funding_provider_user_tokens SET destination=$6,envelope=$7,key_version=$8,returned_at=$9,updated_at=$10
      WHERE account_provider=$1 AND owner_subject=$2 AND provider_id=$3 AND region=$4 AND sandbox=$5 AND envelope=$11`, [...values,expectedEnvelope])).rowCount > 0;
  }
  async deleteIfEnvelope(key: FundingUserTokenKey, envelope: string) { validEnvelope(envelope); return (await this.query("DELETE FROM funding_provider_user_tokens WHERE account_provider=$1 AND owner_subject=$2 AND provider_id=$3 AND region=$4 AND sandbox=$5 AND envelope=$6", [...tuple(key),envelope])).rowCount > 0; }
  async delete(key: FundingUserTokenKey) { return (await this.query("DELETE FROM funding_provider_user_tokens WHERE account_provider=$1 AND owner_subject=$2 AND provider_id=$3 AND region=$4 AND sandbox=$5", tuple(key))).rowCount > 0; }
  async listNotAtVersion(activeVersion: number, afterKey: Cursor | null, limit: number) {
    const result = await this.query(`SELECT * FROM funding_provider_user_tokens WHERE key_version <> $1 AND ($2::text IS NULL OR (account_provider,owner_subject,provider_id,region,sandbox) > ($2::text,$3::text,$4::text,$5::text,$6::boolean)) ORDER BY account_provider,owner_subject,provider_id,region,sandbox LIMIT $7`, [activeVersion, ...(afterKey ? tuple(afterKey) : [null,null,null,null,null]),limit]);
    return result.rows.map((row) => ({ key: keyFromRow(row), row: fromRow(row) }));
  }
  async replaceIfEnvelope(key: FundingUserTokenKey, expectedEnvelope: string, row: { envelope: string; updatedAt: string }) {
    validEnvelope(expectedEnvelope); const version = validEnvelope(row.envelope);
    return (await this.query("UPDATE funding_provider_user_tokens SET envelope=$7,key_version=$8,updated_at=$9 WHERE account_provider=$1 AND owner_subject=$2 AND provider_id=$3 AND region=$4 AND sandbox=$5 AND envelope=$6", [...tuple(key),expectedEnvelope,row.envelope,version,row.updatedAt])).rowCount > 0;
  }
  async countNotAtVersion(activeVersion: number) { const result = await this.query("SELECT count(*)::integer AS count FROM funding_provider_user_tokens WHERE key_version <> $1", [activeVersion]); return Number(result.rows[0]?.count ?? 0); }
}
export function createRuntimeFundingProviderUserTokenStore(env: Readonly<Record<string, string | undefined>> = process.env) { return new PostgresFundingProviderUserTokenStore(getSqlExecutor(env)); }
