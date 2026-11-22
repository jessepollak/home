import "server-only";

import { createHash } from "node:crypto";
import { readDatabaseUrl } from "@/server/config/env";
import { getSqlExecutor, type SqlExecutor } from "@/server/db/sql";

export type SessionRevocations = {
  isRevoked(token: string): Promise<boolean>;
  revoke(token: string, expiresAt: Date, now: Date): Promise<void>;
};

const EXPIRED_SWEEP_LIMIT = 100;

function tokenDigest(token: string): string {
  return createHash("sha256").update(`home.session-revocation.v1\0${token}`).digest("hex");
}

export function createSessionRevocations(sql: SqlExecutor): SessionRevocations {
  return {
    async isRevoked(token) {
      const found = await sql.query("SELECT 1 FROM home_session_revocations WHERE token_digest=$1", [tokenDigest(token)]);
      return found.rowCount > 0;
    },
    async revoke(token, expiresAt, now) {
      await sql.query(
        "INSERT INTO home_session_revocations(token_digest,revoked_at,expires_at) VALUES ($1,$2,$3) ON CONFLICT (token_digest) DO NOTHING",
        [tokenDigest(token), now, expiresAt],
      );
      await sql.query(
        "DELETE FROM home_session_revocations WHERE token_digest IN (SELECT token_digest FROM home_session_revocations WHERE expires_at<=$1 ORDER BY expires_at,token_digest LIMIT $2 FOR UPDATE SKIP LOCKED)",
        [now, EXPIRED_SWEEP_LIMIT],
      ).catch(() => undefined);
    },
  };
}

export function sessionRevocations(): SessionRevocations | null {
  return readDatabaseUrl() ? createSessionRevocations(getSqlExecutor()) : null;
}
