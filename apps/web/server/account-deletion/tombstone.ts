import "server-only";

import { createHash, createHmac } from "node:crypto";
import type { AccountProvider, VerifiedAccountSession } from "@/shared/account/session-types";
import { ACCOUNT_DELETION_REVOCATION_WINDOW_MS } from "@/shared/account/financial-retention";
import { readAccountDeletionTombstoneSecret, readDatabaseUrl } from "@/server/config/env";
import { getSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { AccountDeletedError, AccountDeletionAuthUnavailable, AccountDeletionError } from "./errors";

export function tombstoneKey(value = readAccountDeletionTombstoneSecret()): Buffer | null {
  return value && Buffer.byteLength(value, "utf8") >= 32 ? Buffer.from(value, "utf8") : null;
}

export function requireTombstoneKey(): Buffer {
  const key = tombstoneKey();
  if (!key) throw new AccountDeletionError("ACCOUNT_DELETION_UNAVAILABLE");
  return key;
}

export function credentialDigest(key: Buffer, provider: AccountProvider, subject: string): string {
  return createHmac("sha256", key).update(`home.account-deletion.v1\0${provider}\0${subject}`).digest("hex");
}

export function tombstoneKeyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

export async function lockCredential(sql: SqlExecutor, digest: string): Promise<void> {
  await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [digest]);
}

export async function findTombstone(sql: SqlExecutor, session: VerifiedAccountSession, now = new Date(), key = tombstoneKey(), revocationOnly = true): Promise<{ request_id: string } | null> {
  if (!key) {
    if ((await sql.query("SELECT 1 FROM account_deletion_tombstones LIMIT 1")).rowCount) throw new AccountDeletionAuthUnavailable();
    return null;
  }
  return (await sql.query<{ request_id: string }>(
    "SELECT request_id FROM account_deletion_tombstones WHERE credential_digest=$1 AND ($2::timestamptz IS NULL OR completed_at>$2) AND expires_at>$3",
    [credentialDigest(key, session.accountProvider, session.user.subject), revocationOnly ? new Date(now.getTime() - ACCOUNT_DELETION_REVOCATION_WINDOW_MS) : null, now],
  )).rows[0] ?? null;
}

export async function assertCredentialLive(sql: SqlExecutor, session: VerifiedAccountSession, now = new Date(), lock = false): Promise<void> {
  try {
    const key = tombstoneKey();
    if (lock && key) await lockCredential(sql, credentialDigest(key, session.accountProvider, session.user.subject));
    if (await findTombstone(sql, session, now, key)) throw new AccountDeletedError();
  } catch (error) {
    if (error instanceof AccountDeletedError || error instanceof AccountDeletionAuthUnavailable) throw error;
    throw new AccountDeletionAuthUnavailable();
  }
}

export async function assertSessionLive(session: VerifiedAccountSession, now = new Date()): Promise<void> {
  if (readDatabaseUrl()) await assertCredentialLive(getSqlExecutor(), session, now);
}
