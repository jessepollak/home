import "server-only";

import { isDeepStrictEqual } from "node:util";
import { isUniqueViolation, type SqlExecutor } from "@/server/db/sql";
import { OPERATOR_SETTINGS_DOMAINS, type DomainRegistry, type SettingsEntry } from "@/shared/operator-settings/contract";

export class OperatorSettingsCorruptError extends Error {}
export class OperatorSettingsValidationError extends Error {}
export class OperatorSettingsConflictError extends Error {}

type SettingsRow = {
  domain: string; schema_version: number; value: unknown; revision: string;
  updated_at: Date; updated_by: string;
};

export class OperatorSettingsStore {
  constructor(private readonly sql: SqlExecutor, readonly registry: DomainRegistry = OPERATOR_SETTINGS_DOMAINS) {}

  hasDomain(domain: string): boolean {
    return Object.hasOwn(this.registry, domain);
  }

  private definition(domain: string) {
    if (!this.hasDomain(domain)) throw new OperatorSettingsValidationError("Unknown settings domain");
    return this.registry[domain]!;
  }

  private effective(domain: string, row?: SettingsRow): SettingsEntry {
    const definition = this.definition(domain);
    if (!row) return { domain, settings: { value: definition.defaults, revision: 0, source: "default", updatedAt: null, updatedBy: null } };
    let value = row.value;
    if (!Number.isSafeInteger(row.schema_version) || row.schema_version < 1 || row.schema_version > definition.schemaVersion) throw new OperatorSettingsCorruptError("Unsupported settings schema");
    for (let version = row.schema_version; version < definition.schemaVersion; version++) {
      if (!definition.upgrade) throw new OperatorSettingsCorruptError("Missing settings upgrade");
      try { value = definition.upgrade(version, value); }
      catch { throw new OperatorSettingsCorruptError("Settings upgrade failed"); }
    }
    const parsed = definition.parse(value);
    const revision = Number(row.revision);
    if (parsed === null || !Number.isSafeInteger(revision) || revision < 1) throw new OperatorSettingsCorruptError("Invalid stored settings");
    return { domain, settings: { value: parsed, revision, source: "stored", updatedAt: row.updated_at.toISOString(), updatedBy: row.updated_by } };
  }

  async read(domain: string): Promise<SettingsEntry> {
    this.definition(domain);
    const result = await this.sql.query<SettingsRow>("SELECT * FROM operator_settings WHERE domain = $1", [domain]);
    return this.effective(domain, result.rows[0]);
  }

  async readAll(): Promise<SettingsEntry[]> {
    const rows = await this.sql.query<SettingsRow>("SELECT * FROM operator_settings");
    return Object.keys(this.registry).map((domain) => this.effective(domain, rows.rows.find((row) => row.domain === domain)));
  }

  async write(input: { domain: string; expectedRevision: number; value: unknown; actor: string }): Promise<SettingsEntry> {
    const definition = this.definition(input.domain);
    const parsed = definition.parse(input.value);
    if (parsed === null || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new OperatorSettingsValidationError("Invalid settings write");
    try {
      return await this.sql.transaction(async (tx) => {
        const result = await tx.query<SettingsRow>("SELECT * FROM operator_settings WHERE domain = $1 FOR UPDATE", [input.domain]);
        const current = this.effective(input.domain, result.rows[0]);
        if (current.settings.revision !== input.expectedRevision) throw new OperatorSettingsConflictError("Settings revision conflict");
        if (isDeepStrictEqual(current.settings.value, parsed)) return current;
        const written = result.rows.length === 0
          ? await tx.query<SettingsRow>(`INSERT INTO operator_settings (domain, schema_version, value, revision, updated_at, updated_by)
              VALUES ($1, $2, $3::jsonb, 1, now(), $4) RETURNING *`, [input.domain, definition.schemaVersion, JSON.stringify(parsed), input.actor])
          : await tx.query<SettingsRow>(`UPDATE operator_settings SET schema_version = $2, value = $3::jsonb,
              revision = revision + 1, updated_at = now(), updated_by = $4 WHERE domain = $1 RETURNING *`,
              [input.domain, definition.schemaVersion, JSON.stringify(parsed), input.actor]);
        await tx.query(`INSERT INTO admin_audit_log (actor, action, target_kind, target_id, before, after)
          VALUES ($1, 'settings.update', 'settings', $2, $3::jsonb, $4::jsonb)`, [input.actor, input.domain, JSON.stringify(current.settings.value), JSON.stringify(parsed)]);
        return this.effective(input.domain, written.rows[0]);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new OperatorSettingsConflictError("Settings revision conflict");
      throw error;
    }
  }
}
