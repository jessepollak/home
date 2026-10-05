import "server-only";

import { readDatabaseUrl } from "@/server/config/env";

import { randomBytes } from "node:crypto";
import { INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH } from "@/shared/invites/contract";
import { getSqlExecutor, type SqlExecutor } from "@/server/db/sql";

export function generateInviteCode(bytes: (count: number) => Uint8Array = randomBytes): string {
  const alphabetLength = INVITE_CODE_ALPHABET.length;
  const limit = Math.floor(256 / alphabetLength) * alphabetLength;
  let code = "";
  while (code.length < INVITE_CODE_LENGTH) {
    for (const byte of bytes(INVITE_CODE_LENGTH - code.length)) {
      if (byte < limit) code += INVITE_CODE_ALPHABET[byte % alphabetLength];
    }
  }
  return code;
}

export class InviteStore {
  constructor(private readonly sql: SqlExecutor, private readonly generate: () => string = generateInviteCode) {}

  async getOrCreateInviteCode(customerId: string): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = this.generate();
      const inserted = await this.sql.query<{ code: string }>(
        `INSERT INTO invite_codes (code,customer_id) VALUES ($1,$2)
         ON CONFLICT DO NOTHING RETURNING code`, [candidate, customerId],
      );
      if (inserted.rows[0]) return inserted.rows[0].code;
      const existing = await this.sql.query<{ code: string }>("SELECT code FROM invite_codes WHERE customer_id=$1", [customerId]);
      if (existing.rows[0]) return existing.rows[0].code;
    }
    throw new Error("invite code generation exhausted");
  }

  async findInviter(code: string): Promise<{ customerId: string; status: string } | null> {
    const result = await this.sql.query<{ customer_id: string; status: string }>(
      "SELECT c.id AS customer_id,c.status FROM invite_codes i JOIN customers c ON c.id=i.customer_id WHERE i.code=$1", [code],
    );
    const row = result.rows[0];
    return row ? { customerId: row.customer_id, status: row.status } : null;
  }

  async readInviteStats(): Promise<{ inviteLinks: number; attributedSignUps: number }> {
    const result = await this.sql.query<{ invite_links: string; attributed_sign_ups: string }>(
      "SELECT (SELECT count(*) FROM invite_codes) AS invite_links, (SELECT count(*) FROM customers WHERE invite_code IS NOT NULL) AS attributed_sign_ups",
    );
    return { inviteLinks: Number(result.rows[0].invite_links), attributedSignUps: Number(result.rows[0].attributed_sign_ups) };
  }
}

export function getInviteStore(): InviteStore | null {
  return readDatabaseUrl() ? new InviteStore(getSqlExecutor()) : null;
}

export async function getOrCreateInviteCode(customerId: string): Promise<string> {
  const store = getInviteStore();
  if (!store) throw new Error("invites unavailable");
  return store.getOrCreateInviteCode(customerId);
}

export async function findInviter(code: string): Promise<{ customerId: string; status: string } | null> {
  return (await getInviteStore()?.findInviter(code)) ?? null;
}

export async function readInviteStats(): Promise<{ inviteLinks: number; attributedSignUps: number }> {
  const store = getInviteStore();
  if (!store) throw new Error("invites unavailable");
  return store.readInviteStats();
}
