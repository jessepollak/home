import "server-only";

import type { SqlExecutor } from "@/server/db/sql";

export async function backfillOperatorRegistry(sql: SqlExecutor): Promise<{ customers: number; events: number }> {
  const customers = await sql.query(`
    WITH origins AS (
      SELECT account_provider, owner_subject, destination AS address, created_at AS seen_at FROM funding_orders
      UNION ALL
      SELECT owner_key::jsonb->>3, owner_key::jsonb->>0, owner_key::jsonb->>1, created_at FROM actions
      UNION ALL
      SELECT account_provider, owner_subject, NULL::text, created_at FROM funding_provider_customers
    ), earliest AS (
      SELECT account_provider, owner_subject, min(seen_at) AS first_seen_at, max(seen_at) AS last_seen_at
      FROM origins GROUP BY account_provider, owner_subject
    ), inserted AS (
      INSERT INTO customer_credentials (id,customer_id,account_provider,subject,first_seen_at,last_seen_at)
      SELECT gen_random_uuid(),gen_random_uuid(),account_provider,owner_subject,first_seen_at,last_seen_at
      FROM earliest
      ON CONFLICT (account_provider,subject) DO NOTHING
      RETURNING customer_id,account_provider,subject,first_seen_at,last_seen_at
    )
    INSERT INTO customers (id,first_seen_at,last_seen_at,first_seen_source)
    SELECT customer_id,first_seen_at,last_seen_at,'backfill' FROM inserted`);

  await sql.query(`
    WITH origins AS (
      SELECT account_provider, owner_subject, destination AS address, created_at AS seen_at FROM funding_orders
      UNION ALL
      SELECT owner_key::jsonb->>3, owner_key::jsonb->>0, owner_key::jsonb->>1, created_at FROM actions
    ), newest_address AS (
      SELECT DISTINCT ON (account_provider, owner_subject) account_provider, owner_subject, lower(address) AS address
      FROM origins WHERE address IS NOT NULL
      ORDER BY account_provider, owner_subject, seen_at DESC, address DESC
    )
    INSERT INTO customer_wallets (id,customer_id,credential_id,chain_id,address)
    SELECT gen_random_uuid(),cr.customer_id,cr.id,8453,a.address
    FROM newest_address a JOIN customer_credentials cr
      ON cr.account_provider=a.account_provider AND cr.subject=a.owner_subject
    ON CONFLICT (chain_id,address) DO NOTHING`);

  const signup = await sql.query(`
    INSERT INTO operator_events (id,customer_id,name,occurred_at,source,props,idempotency_key)
    SELECT gen_random_uuid(),c.id,'customer.signed_up',c.first_seen_at,'backfill',
      jsonb_build_object('accountProvider',cr.account_provider) ||
        CASE WHEN c.invite_code IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('inviteCode',c.invite_code) END,
      'signup:' || c.id
    FROM customers c JOIN customer_credentials cr ON cr.customer_id=c.id
    ON CONFLICT (idempotency_key) DO NOTHING`);

  const funding = await sql.query(`
    INSERT INTO operator_events (id,customer_id,name,occurred_at,source,sandbox,props,idempotency_key)
    SELECT gen_random_uuid(),c.id,'funding.order_created',o.created_at,'backfill',o.sandbox,
      jsonb_build_object('provider',o.provider_id,'region',o.region,'asset',o.asset_id,'method',o.payment_method,'fiatAmount',o.fiat_amount),
      'funding:' || o.id || ':created'
    FROM funding_orders o JOIN customer_credentials cr ON cr.account_provider=o.account_provider AND cr.subject=o.owner_subject
      JOIN customers c ON c.id=cr.customer_id
    ON CONFLICT (idempotency_key) DO NOTHING`);

  const finalized = await sql.query(`
    INSERT INTO operator_events (id,customer_id,name,occurred_at,source,sandbox,props,idempotency_key)
    SELECT gen_random_uuid(),c.id,'funding.order_finalized',o.updated_at,'backfill',o.sandbox,
      jsonb_build_object('provider',o.provider_id,'region',o.region,'asset',o.asset_id,'method',o.payment_method,'fiatAmount',o.fiat_amount,'state',o.state),
      'funding:' || o.id || ':' || o.state
    FROM funding_orders o JOIN customer_credentials cr ON cr.account_provider=o.account_provider AND cr.subject=o.owner_subject
      JOIN customers c ON c.id=cr.customer_id
    WHERE o.state IN ('received','expired','cancelled','failed','refunded')
    ON CONFLICT (idempotency_key) DO NOTHING`);

  const actions = await sql.query(`
    INSERT INTO operator_events (id,customer_id,name,occurred_at,source,props,idempotency_key)
    SELECT gen_random_uuid(),c.id,'action.confirmed',a.confirmed_at,'backfill',
      jsonb_build_object('kind',a.kind,'accountProvider',a.owner_key::jsonb->>3),
      'action:' || a.id || ':confirmed'
    FROM actions a JOIN customer_credentials cr ON cr.account_provider=a.owner_key::jsonb->>3
      AND cr.subject=a.owner_key::jsonb->>0 JOIN customers c ON c.id=cr.customer_id
    WHERE a.confirmed_at IS NOT NULL
    ON CONFLICT (idempotency_key) DO NOTHING`);

  const verification = await sql.query(`
    INSERT INTO operator_events (id,customer_id,name,occurred_at,source,props,idempotency_key)
    SELECT gen_random_uuid(),c.id,'verification.changed',p.updated_at,'backfill',
      jsonb_build_object('provider',p.provider_id,'region',p.region,'state',p.state),
      'kyc:' || p.id || ':' || p.state
    FROM funding_provider_customers p JOIN customer_credentials cr ON cr.account_provider=p.account_provider AND cr.subject=p.owner_subject
      JOIN customers c ON c.id=cr.customer_id
    WHERE p.state IN ('pending','verified','rejected')
    ON CONFLICT (idempotency_key) DO NOTHING`);
  return { customers: customers.rowCount, events: signup.rowCount + funding.rowCount + finalized.rowCount + actions.rowCount + verification.rowCount };
}
