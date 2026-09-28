import "server-only";

import type { EmailRequestClaimWrite, EmailRequestWrite } from "@/shared/account/contracts/email-request";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { CustomerResolver, getCustomerResolver } from "@/server/customers/resolve";
import { getSqlExecutor, type SqlExecutor } from "@/server/db/sql";

const STATEMENT_TIMEOUT = "SET LOCAL statement_timeout = '5s'";

export class EmailRequestIdentityMismatchError extends Error {}

export class EmailRequestStore {
  constructor(private readonly sql: SqlExecutor, private readonly customers: CustomerResolver) {}

  async read(session: VerifiedAccountSession): Promise<{ asked: boolean }> {
    const result = await this.sql.query<{ asked: boolean }>(
      `SELECT asked_at IS NOT NULL AS asked FROM customer_email_requests WHERE account_provider=$1 AND subject=$2`,
      [session.accountProvider, session.user.subject], { timeoutMs: 750 },
    );
    return { asked: result.rows[0]?.asked === true };
  }

  async claim(session: VerifiedAccountSession, input: EmailRequestClaimWrite): Promise<{ claimed: boolean }> {
    if (session.accountProvider !== "base-account") throw new Error("email-request-unsupported");
    if (!session.smartAccount || input.address !== session.smartAccount.address.toLowerCase()) {
      throw new EmailRequestIdentityMismatchError("email-request-identity-mismatch");
    }
    const key = [session.accountProvider, session.user.subject];
    return this.sql.transaction(async (tx) => {
      await tx.query(STATEMENT_TIMEOUT);
      await this.customers.resolveCustomerInTransaction(tx, session);
      const result = await tx.query<{ claimed: boolean }>(
        `INSERT INTO customer_email_requests (account_provider,subject,asked_at)
         VALUES ($1,$2,now())
         ON CONFLICT (account_provider,subject) DO UPDATE SET
           asked_at=COALESCE(customer_email_requests.asked_at,now()),updated_at=now()
         WHERE customer_email_requests.asked_at IS NULL
         RETURNING true AS claimed`,
        key,
      );
      return { claimed: result.rows.length === 1 };
    });
  }

  async write(session: VerifiedAccountSession, input: EmailRequestWrite): Promise<{ asked: boolean }> {
    if (session.accountProvider !== "base-account") throw new Error("email-request-unsupported");
    if (!session.smartAccount || input.address !== session.smartAccount.address.toLowerCase()) {
      throw new EmailRequestIdentityMismatchError("email-request-identity-mismatch");
    }
    const key = [session.accountProvider, session.user.subject];
    return this.sql.transaction(async (tx) => {
      await tx.query(STATEMENT_TIMEOUT);
      await this.customers.resolveCustomerInTransaction(tx, session);
      switch (input.kind) {
        case "sign_in_capability": {
          const result = await tx.query<{ asked: boolean }>(
            `INSERT INTO customer_email_requests (account_provider,subject,sign_in_capability,wallet_code,wallet_message)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (account_provider,subject) DO UPDATE SET sign_in_capability=EXCLUDED.sign_in_capability,
               wallet_code=EXCLUDED.wallet_code,wallet_message=EXCLUDED.wallet_message,updated_at=now()
             RETURNING asked_at IS NOT NULL AS asked`,
            [...key, input.result, input.walletCode ?? null, input.walletMessage ?? null],
          );
          return { asked: result.rows[0]?.asked === true };
        }
        case "asked":
          await tx.query(
            `INSERT INTO customer_email_requests (account_provider,subject,asked_at) VALUES ($1,$2,now())
             ON CONFLICT (account_provider,subject) DO UPDATE SET
               asked_at=COALESCE(customer_email_requests.asked_at,now()),updated_at=now()`,
            key,
          );
          return { asked: true };
        case "answer":
          await tx.query(
            `INSERT INTO customer_email_requests (account_provider,subject,asked_at,answer,answer_channel,wallet_code,wallet_message)
             VALUES ($1,$2,now(),$3,$4,$5,$6)
             ON CONFLICT (account_provider,subject) DO UPDATE SET
               asked_at=COALESCE(customer_email_requests.asked_at,now()),
               answer=CASE WHEN customer_email_requests.answer='shared' THEN customer_email_requests.answer ELSE EXCLUDED.answer END,
               answer_channel=CASE WHEN customer_email_requests.answer='shared' THEN customer_email_requests.answer_channel ELSE EXCLUDED.answer_channel END,
               wallet_code=COALESCE(EXCLUDED.wallet_code,customer_email_requests.wallet_code),
               wallet_message=COALESCE(EXCLUDED.wallet_message,customer_email_requests.wallet_message),
               updated_at=now()`,
            [...key, input.answer, input.channel, input.walletCode ?? null, input.walletMessage ?? null],
          );
          return { asked: true };
        case "email":
          await tx.query(
            `UPDATE customer_credentials SET email=$3,email_source='wallet_reported',updated_at=now()
             WHERE account_provider=$1 AND subject=$2 AND (email_source IS NULL OR email_source='wallet_reported')`,
            [...key, input.email.toLowerCase()],
          );
          await tx.query(
            `INSERT INTO customer_email_requests (account_provider,subject,asked_at,answer,answer_channel,bundle_id)
             VALUES ($1,$2,now(),'shared',$3,$4)
             ON CONFLICT (account_provider,subject) DO UPDATE SET
               asked_at=COALESCE(customer_email_requests.asked_at,now()),answer='shared',
               answer_channel=EXCLUDED.answer_channel,
               bundle_id=COALESCE(EXCLUDED.bundle_id,customer_email_requests.bundle_id),updated_at=now()`,
            [...key, input.channel, input.bundleId ?? null],
          );
          return { asked: true };
      }
    });
  }
}

function runtimeStore(): EmailRequestStore | null {
  const customers = getCustomerResolver();
  return customers ? new EmailRequestStore(getSqlExecutor(), customers) : null;
}

export async function readEmailRequest(session: VerifiedAccountSession, store: EmailRequestStore | null = runtimeStore()): Promise<{ asked: boolean } | null> {
  return store ? store.read(session) : null;
}

export async function claimEmailRequest(session: VerifiedAccountSession, input: EmailRequestClaimWrite, store: EmailRequestStore | null = runtimeStore()): Promise<{ claimed: boolean }> {
  if (!store) throw new Error("email-request-store-unavailable");
  return store.claim(session, input);
}

export async function writeEmailRequest(session: VerifiedAccountSession, input: EmailRequestWrite, store: EmailRequestStore | null = runtimeStore()): Promise<{ asked: boolean }> {
  if (!store) throw new Error("email-request-store-unavailable");
  return store.write(session, input);
}
