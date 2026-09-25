import "server-only";

import type { SqlExecutor } from "@/server/db/sql";
import { validCursor, type AuditEntry } from "@/shared/operator-settings/contract";
import { OperatorSettingsValidationError } from "./store";

type AuditRow = {
  id: string; occurred_at: Date; actor: `0x${string}`; action: "settings.update" | "customer.read";
  target_kind: "settings" | "customer"; target_id: string; purpose: string | null; before: unknown; after: unknown;
};

export class AdminAuditLog {
  constructor(private readonly sql: SqlExecutor) {}

  async recordCustomerRead(input: { actor: `0x${string}`; customerId: string; purpose: string }): Promise<void> {
    if (input.customerId.length < 1 || input.customerId.length > 200 || input.purpose.length < 1 || input.purpose.length > 200 || input.purpose !== input.purpose.trim()) throw new OperatorSettingsValidationError("Invalid customer read");
    await this.sql.query(`INSERT INTO admin_audit_log (actor, action, target_kind, target_id, purpose)
      VALUES ($1, 'customer.read', 'customer', $2, $3)`, [input.actor, input.customerId, input.purpose]);
  }

  async list(input: { limit?: number; before?: string } = {}): Promise<{ entries: AuditEntry[]; nextCursor: string | null }> {
    const limit = input.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (input.before !== undefined && !validCursor(input.before))) throw new OperatorSettingsValidationError("Invalid audit cursor or limit");
    const result = await this.sql.query<AuditRow>(`SELECT * FROM admin_audit_log
      WHERE ($1::bigint IS NULL OR id < $1::bigint) ORDER BY id DESC LIMIT $2`, [input.before ?? null, limit + 1]);
    const entries: AuditEntry[] = result.rows.slice(0, limit).map((row) => {
      const common = { id: row.id, occurredAt: row.occurred_at.toISOString(), actor: row.actor };
      return row.action === "settings.update"
        ? { ...common, action: "settings.update", target: { kind: "settings", id: row.target_id }, before: row.before, after: row.after }
        : { ...common, action: "customer.read", target: { kind: "customer", id: row.target_id }, purpose: row.purpose! };
    });
    return { entries, nextCursor: result.rows.length > limit ? entries.at(-1)!.id : null };
  }
}
