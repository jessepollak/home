import "server-only";

import { after } from "next/server";
import { BASE_CHAIN_ID, type VerifiedAccountSession } from "@/shared/account/session-types";
import { getSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { emitServerEvent } from "@/server/observability/log";
import type { OperatorEventInput } from "@/server/operator-events/events";

const STATEMENT_TIMEOUT = "SET LOCAL statement_timeout = '5s'";

type Resolution = { id: string; status: string; created: boolean };
type CustomerRow = { id: string; status: string; first_seen_at: Date; invite_code: string | null };
type CredentialRow = { id: string; customer_id: string };
type CreateOptions = { create: true; at?: Date; email?: string | null; country?: string | null };
type ReadOptions = { create: false };

export class CustomerResolver {
  constructor(private readonly sql: SqlExecutor) {}

  async resolveCustomer(session: VerifiedAccountSession, options: ReadOptions): Promise<Resolution | null>;
  async resolveCustomer(session: VerifiedAccountSession, options: CreateOptions): Promise<Resolution>;
  async resolveCustomer(session: VerifiedAccountSession, options: ReadOptions | CreateOptions): Promise<Resolution | null> {
    if (!options.create) {
      const result = await this.sql.query<CustomerRow>(
        `SELECT c.id,c.status FROM customer_credentials cr JOIN customers c ON c.id=cr.customer_id
         WHERE cr.account_provider=$1 AND cr.subject=$2`,
        [session.accountProvider, session.user.subject],
      );
      return result.rows[0] ? { id: result.rows[0].id, status: result.rows[0].status, created: false } : null;
    }
    return this.sql.transaction(async (tx) => {
      await tx.query(STATEMENT_TIMEOUT);
      return this.resolveInTransaction(tx, session, options.at ?? new Date(), "sign_in", options.email, options.country);
    });
  }

  private async resolveInTransaction(
    tx: SqlExecutor, session: VerifiedAccountSession, at: Date,
    source: "sign_in" | "activity", email?: string | null, country?: string | null,
  ): Promise<Resolution> {
    const candidateId = crypto.randomUUID();
    const normalizedEmail = session.accountProvider === "cdp-embedded" && email ? email.toLowerCase() : null;
    const inserted = await tx.query<CredentialRow>(
      `INSERT INTO customer_credentials (id,customer_id,account_provider,subject,email,email_source,first_seen_at,last_seen_at)
       VALUES (gen_random_uuid(),$1,$2,$3,$4,CASE WHEN $4::text IS NULL THEN NULL ELSE 'cdp_verified' END,$5,$5)
       ON CONFLICT (account_provider,subject) DO NOTHING RETURNING id,customer_id`,
      [candidateId, session.accountProvider, session.user.subject, normalizedEmail, at],
    );
    const created = inserted.rows.length === 1;
    let credential = inserted.rows[0];
    let customer: CustomerRow;
    if (created) {
      customer = (await tx.query<CustomerRow>(
        `INSERT INTO customers (id,country,first_seen_at,last_seen_at,first_seen_source)
         VALUES ($1,$2,$3,$3,$4) RETURNING id,status,first_seen_at,invite_code`,
        [candidateId, country ?? null, at, source],
      )).rows[0];
    } else {
      credential = (await tx.query<CredentialRow>(
        `UPDATE customer_credentials SET first_seen_at=LEAST(first_seen_at,$3::timestamptz),
         last_seen_at=CASE WHEN $4::boolean THEN GREATEST(last_seen_at,$3::timestamptz) ELSE last_seen_at END,
         email=CASE WHEN $5::text IS NOT NULL AND ($3::timestamptz >= last_seen_at OR email IS NULL OR email_source <> 'cdp_verified') THEN $5 ELSE email END,
         email_source=CASE WHEN $5::text IS NOT NULL AND ($3::timestamptz >= last_seen_at OR email IS NULL OR email_source <> 'cdp_verified') THEN 'cdp_verified' ELSE email_source END,
         updated_at=now()
         WHERE account_provider=$1 AND subject=$2 RETURNING id,customer_id`,
        [session.accountProvider, session.user.subject, at, source === "sign_in", normalizedEmail],
      )).rows[0];
      if (!credential) throw new Error("customer-credential-missing");
      customer = (await tx.query<CustomerRow>(
        `UPDATE customers SET first_seen_at=LEAST(first_seen_at,$2::timestamptz),
         last_seen_at=CASE WHEN $3::boolean THEN GREATEST(last_seen_at,$2::timestamptz) ELSE last_seen_at END,
         country=CASE WHEN $4::text IS NOT NULL AND ($2::timestamptz >= last_seen_at OR country IS NULL) THEN $4 ELSE country END,
         updated_at=now() WHERE id=$1 RETURNING id,status,first_seen_at,invite_code`,
        [credential.customer_id, at, source === "sign_in", country ?? null],
      )).rows[0];
    }
    if (!customer || !credential) throw new Error("customer-missing");
    if (created) {
      await tx.query(
        `INSERT INTO operator_events (id,customer_id,name,occurred_at,source,props,idempotency_key)
         VALUES (gen_random_uuid(),$1,'customer.signed_up',$2,'live',$3::jsonb,$4)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [customer.id, customer.first_seen_at,
          JSON.stringify({ accountProvider: session.accountProvider, ...(customer.invite_code ? { inviteCode: customer.invite_code } : {}) }),
          `signup:${customer.id}`],
      );
    }
    if (session.smartAccount) {
      await tx.query(
        `INSERT INTO customer_wallets (id,customer_id,credential_id,chain_id,address)
         VALUES (gen_random_uuid(),$1,$2,$3,$4) ON CONFLICT (chain_id,address) DO NOTHING`,
        [customer.id, credential.id, session.smartAccount.chainId, session.smartAccount.address.toLowerCase()],
      );
    }
    return { id: customer.id, status: customer.status, created };
  }

  async record(event: OperatorEventInput): Promise<boolean> {
    return this.sql.transaction(async (tx) => {
      await tx.query(STATEMENT_TIMEOUT);
      const session: VerifiedAccountSession = {
        accountProvider: event.owner.accountProvider,
        user: { subject: event.owner.subject },
        smartAccount: event.owner.address
          ? { chainId: BASE_CHAIN_ID, address: event.owner.address.toLowerCase() as `0x${string}` } : null,
      };
      const customer = await this.resolveInTransaction(tx, session, event.occurredAt, "activity");
      const result = await tx.query(
        `INSERT INTO operator_events (id,customer_id,name,occurred_at,source,sandbox,props,idempotency_key)
         VALUES (gen_random_uuid(),$1,$2,$3,'live',$4,$5::jsonb,$6)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [customer.id, event.name, event.occurredAt, event.sandbox ?? false, JSON.stringify(event.props), event.idempotencyKey],
      );
      return result.rowCount === 1;
    });
  }
}

let runtimeResolver: CustomerResolver | null = null;

export function getCustomerResolver(): CustomerResolver | null {
  if (!process.env.DATABASE_URL?.trim()) return null;
  return runtimeResolver ??= new CustomerResolver(getSqlExecutor());
}

export async function resolveCustomer(session: VerifiedAccountSession, options: ReadOptions | CreateOptions): Promise<Resolution | null> {
  const resolver = getCustomerResolver();
  if (!resolver) return null;
  return options.create ? resolver.resolveCustomer(session, options) : resolver.resolveCustomer(session, options);
}

async function bestEffortCustomerRecord(operation: (resolver: CustomerResolver) => Promise<unknown>): Promise<void> {
  try {
    const resolver = getCustomerResolver();
    if (resolver) await operation(resolver);
  } catch {
    emitServerEvent("operator-registry", {
      route: "/operator-registry", code: "OPERATOR_REGISTRY_WRITE_FAILED", outcome: "failed",
    });
  }
}

export async function deferCustomerRecord(operation: (resolver: CustomerResolver) => Promise<unknown>): Promise<void> {
  if (!getCustomerResolver()) return;
  try {
    after(() => bestEffortCustomerRecord(operation));
  } catch {
    emitServerEvent("operator-registry", {
      route: "/operator-registry", code: "OPERATOR_REGISTRY_OUTSIDE_REQUEST", outcome: "failed",
    });
    await bestEffortCustomerRecord(operation);
  }
}
