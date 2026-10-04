import "server-only";

import { getSqlExecutor, isUniqueViolation, type SqlExecutor } from "@/server/db/sql";
import { recordCustomerIds } from "@/server/customers/record-ids";
import type { Instruction, Quote } from "@/shared/funding/provider-contract";
import { assertHistoryLimit, type FundingOrder, type FundingOrderOwner, type FundingOrderStore, type FundingReservation } from "./store";

type Row = Record<string, unknown>;
const TERMINAL_SQL = "'dispatch-ambiguous','received','expired','cancelled','failed','refunded'";
const OPEN_SQL = `(state NOT IN (${TERMINAL_SQL}) OR state='dispatch-ambiguous') AND state<>'abandoned' AND NOT (sandbox=true AND state='sent-unverified')`;
const PROGRESS_SQL = "ARRAY['reserving','unknown','awaiting-payment','abandoned','payment-received','settling','sent']";

export class PostgresFundingOrderStore implements FundingOrderStore {
  constructor(private readonly sql: SqlExecutor) {}

  async reserve(input: FundingReservation) {
    const ids = await recordCustomerIds(this.sql, { ...input.owner, address: input.destination }, new Date(input.createdAt));
    return this.sql.transaction(async (transaction) => {
      const inserted = await transaction.query(
        `INSERT INTO funding_orders
         (id, owner_subject, account_provider, destination, provider_id, region, asset_id,
          payment_method, fiat_amount, intent_digest, quote, quote_token, customer_ref, sandbox, state,
          creation_block, fees, created_at, updated_at, customer_id, credential_id, wallet_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,'reserving',$15,'[]'::jsonb,$16,$16,$17,$18,$19)
         ON CONFLICT (account_provider, owner_subject, intent_digest) DO NOTHING RETURNING *`,
        [input.id, input.owner.subject, input.owner.accountProvider, input.destination.toLowerCase(), input.providerId,
          input.region, input.assetId, input.paymentMethod, input.fiatAmount, input.intentDigest, JSON.stringify(input.quote),
          input.quoteToken, input.customerRef, input.sandbox, input.creationBlock, input.createdAt, ids.customerId, ids.credentialId, ids.walletId],
      );
      const result = inserted.rows[0] ?? (await transaction.query(
        "SELECT * FROM funding_orders WHERE account_provider=$1 AND owner_subject=$2 AND intent_digest=$3 FOR UPDATE",
        [input.owner.accountProvider, input.owner.subject, input.intentDigest],
      )).rows[0];
      if (!result) throw new Error("funding-reservation-missing");
      return { created: Boolean(inserted.rows[0]), order: fromRow(result as Row) };
    });
  }

  async getOwned(id: string, owner: FundingOrderOwner) { return this.one("SELECT * FROM funding_orders WHERE id=$1 AND account_provider=$2 AND owner_subject=$3", [id, owner.accountProvider, owner.subject]); }
  async listOwned(owner: FundingOrderOwner, limit: number): Promise<FundingOrder[]> {
    assertHistoryLimit(limit);
    return this.all(`SELECT * FROM (
      SELECT * FROM funding_orders WHERE account_provider=$1 AND owner_subject=$2
      ORDER BY CASE WHEN ${OPEN_SQL} THEN 0 ELSE 1 END, created_at DESC, id ASC LIMIT $3
    ) history ORDER BY created_at DESC, id ASC`, [owner.accountProvider, owner.subject, limit]);
  }
  async getByIntent(owner: FundingOrderOwner, intentDigest: string) { return this.one("SELECT * FROM funding_orders WHERE account_provider=$1 AND owner_subject=$2 AND intent_digest=$3", [owner.accountProvider, owner.subject, intentDigest]); }
  async getOpen(owner: FundingOrderOwner, region: string) { return this.one(`SELECT * FROM funding_orders WHERE account_provider=$1 AND owner_subject=$2 AND region=$3 AND ${OPEN_SQL} ORDER BY updated_at DESC LIMIT 1`, [owner.accountProvider, owner.subject, region]); }
  async listOpen(owner: FundingOrderOwner, region: string): Promise<ReadonlyArray<FundingOrder>> {
    return this.all(`SELECT * FROM funding_orders WHERE account_provider=$1 AND owner_subject=$2 AND region=$3 AND ${OPEN_SQL} ORDER BY updated_at DESC`, [owner.accountProvider, owner.subject, region]);
  }
  async getOpenForProvider(owner: FundingOrderOwner, region: string, providerId: string, paymentMethod?: string, assetId?: string) { return this.one(`SELECT * FROM funding_orders WHERE account_provider=$1 AND owner_subject=$2 AND region=$3 AND provider_id=$4 AND ($5::text IS NULL OR payment_method=$5) AND ($6::text IS NULL OR asset_id=$6) AND ${OPEN_SQL} ORDER BY updated_at DESC LIMIT 1`, [owner.accountProvider, owner.subject, region, providerId, paymentMethod ?? null, assetId ?? null]); }
  async getDispatchAmbiguous(owner: FundingOrderOwner, region: string, providerId: string) { return this.one("SELECT * FROM funding_orders WHERE account_provider=$1 AND owner_subject=$2 AND region=$3 AND provider_id=$4 AND state='dispatch-ambiguous' ORDER BY updated_at ASC LIMIT 1", [owner.accountProvider, owner.subject, region, providerId]); }
  async getByProviderOrderId(providerId: string, providerOrderId: string) { return this.one("SELECT * FROM funding_orders WHERE provider_id=$1 AND provider_order_id=$2", [providerId, providerOrderId]); }
  async completeDispatch(id: string, input: Parameters<FundingOrderStore["completeDispatch"]>[1]) {
    return this.updated(`UPDATE funding_orders SET state='awaiting-payment', provider_order_id=$2, expected_token_amount_atomic=$3, fees=$4::jsonb, expires_at=$5, instructions=$6::jsonb, version=version+1, updated_at=$8 WHERE id=$1 AND state='reserving' AND version=$7 RETURNING *`, [id, input.providerOrderId, input.expectedTokenAmountAtomic, JSON.stringify(input.fees), input.expiresAt, JSON.stringify(input.instructions), input.expectedVersion, input.updatedAt]);
  }
  async markDispatchAmbiguous(id: string, expectedVersion: number, updatedAt: string) {
    return this.updated(`UPDATE funding_orders SET state='dispatch-ambiguous', instructions=NULL, version=version+1, updated_at=$3 WHERE id=$1 AND state='reserving' AND version=$2 RETURNING *`, [id, expectedVersion, updatedAt]);
  }
  async resolveDispatchAmbiguous(id: string, owner: FundingOrderOwner, expectedVersion: number, updatedAt: string) {
    return this.updatedOrNull(`UPDATE funding_orders SET state='cancelled', instructions=NULL, version=version+1, updated_at=$5 WHERE id=$1 AND account_provider=$2 AND owner_subject=$3 AND state='dispatch-ambiguous' AND version=$4 RETURNING *`, [id, owner.accountProvider, owner.subject, expectedVersion, updatedAt]);
  }
  async abandon(id: string, owner: FundingOrderOwner, input: Parameters<FundingOrderStore["abandon"]>[2]) {
    return this.updatedOrNull(`UPDATE funding_orders SET state='abandoned', abandon_reason=$5, instructions=NULL, version=version+1, updated_at=$6 WHERE id=$1 AND account_provider=$2 AND owner_subject=$3 AND state='awaiting-payment' AND version=$4 RETURNING *`, [id, owner.accountProvider, owner.subject, input.expectedVersion, input.reason, input.updatedAt]);
  }
  async applyObservation(id: string, input: Parameters<FundingOrderStore["applyObservation"]>[1]) {
    const terminal = ["expired", "cancelled", "failed", "refunded"].includes(input.state);
    return this.updatedOrNull(`WITH observation AS (
      SELECT id, ($6 OR array_position(${PROGRESS_SQL}, CASE WHEN $2='sent-unverified' THEN 'sent' ELSE $2 END) >= array_position(${PROGRESS_SQL}, CASE WHEN state='sent-unverified' THEN 'sent' ELSE state END)) AS advances,
        (state IS DISTINCT FROM $2 OR provider_status IS DISTINCT FROM $3 OR
          COALESCE($4,provider_transaction_hash) IS DISTINCT FROM provider_transaction_hash OR
          COALESCE($8,expected_token_amount_atomic) IS DISTINCT FROM expected_token_amount_atomic OR
          COALESCE($9::jsonb,fees) IS DISTINCT FROM fees) AS material
      FROM funding_orders WHERE id=$1 AND version=$5 AND state NOT IN (${TERMINAL_SQL})
    ) UPDATE funding_orders AS orders SET
      state=CASE WHEN observation.advances THEN $2 ELSE orders.state END,
      abandon_reason=CASE WHEN observation.advances AND $2<>'abandoned' THEN NULL ELSE orders.abandon_reason END,
      provider_status=CASE WHEN observation.advances THEN $3 ELSE orders.provider_status END,
      provider_transaction_hash=CASE WHEN observation.advances THEN COALESCE($4,orders.provider_transaction_hash) ELSE orders.provider_transaction_hash END,
      expected_token_amount_atomic=CASE WHEN observation.advances THEN COALESCE($8,orders.expected_token_amount_atomic) ELSE orders.expected_token_amount_atomic END,
      fees=CASE WHEN observation.advances THEN COALESCE($9::jsonb,orders.fees) ELSE orders.fees END,
      instructions=CASE WHEN observation.advances AND $6 THEN NULL ELSE orders.instructions END,
      version=orders.version+CASE WHEN observation.advances AND observation.material THEN 1 ELSE 0 END,
      updated_at=CASE WHEN observation.advances AND observation.material THEN $7::timestamptz ELSE orders.updated_at END,
      checked_at=$7::timestamptz
    FROM observation WHERE orders.id=observation.id AND orders.version=$5 AND orders.state NOT IN (${TERMINAL_SQL}) RETURNING orders.*`, [id, input.state, input.providerStatus, input.providerTransactionHash ?? null, input.expectedVersion, terminal, input.updatedAt, input.expectedTokenAmountAtomic ?? null, input.fees ? JSON.stringify(input.fees) : null]);
  }
  async claimReceipt(id: string, input: Parameters<FundingOrderStore["claimReceipt"]>[1]) {
    try {
      return await this.updatedOrNull(`UPDATE funding_orders SET state='received', abandon_reason=NULL, transaction_hash=$2, log_index=$3, instructions=NULL, version=version+1, updated_at=$5 WHERE id=$1 AND version=$4 AND state NOT IN (${TERMINAL_SQL}) AND transaction_hash IS NULL AND log_index IS NULL RETURNING *`, [id, input.transactionHash.toLowerCase(), input.logIndex, input.expectedVersion, input.updatedAt]);
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  private async all(text: string, values: unknown[]): Promise<FundingOrder[]> { const result = await this.sql.query(text, values); return result.rows.map((row) => fromRow(row as Row)); }
  private async one(text: string, values: unknown[]): Promise<FundingOrder | null> { const result = await this.sql.query(text, values); return result.rows[0] ? fromRow(result.rows[0] as Row) : null; }
  private async updated(text: string, values: unknown[]): Promise<FundingOrder> { const order = await this.updatedOrNull(text, values); if (!order) throw new Error("funding-order-state-conflict"); return order; }
  private async updatedOrNull(text: string, values: unknown[]): Promise<FundingOrder | null> { return this.one(text, values); }
}

export function createRuntimeFundingOrderStore(
  env: Readonly<Record<string, string | undefined>> = process.env,
): FundingOrderStore {
  return new PostgresFundingOrderStore(getSqlExecutor(env));
}

function fromRow(row: Row): FundingOrder {
  const json = <T>(value: unknown): T => typeof value === "string" ? JSON.parse(value) as T : value as T;
  const checkedAt = row.checked_at == null ? null : new Date(String(row.checked_at)).toISOString();
  const abandonReason = row.state !== "abandoned" || row.abandon_reason == null ? null : row.abandon_reason;
  if (abandonReason !== null && abandonReason !== "owner" && abandonReason !== "timed-out") throw new Error("invalid-funding-abandon-reason");
  return { checkedAt, abandonReason, id: String(row.id), owner: { subject: String(row.owner_subject), accountProvider: String(row.account_provider) as FundingOrderOwner["accountProvider"] }, destination: String(row.destination) as `0x${string}`, providerId: String(row.provider_id), region: String(row.region), assetId: String(row.asset_id), paymentMethod: String(row.payment_method), fiatAmount: String(row.fiat_amount), intentDigest: String(row.intent_digest), quote: json<Quote>(row.quote), quoteToken: String(row.quote_token), customerRef: row.customer_ref === null ? null : String(row.customer_ref), sandbox: row.sandbox === true, state: String(row.state) as FundingOrder["state"], creationBlock: String(row.creation_block), providerOrderId: row.provider_order_id === null ? null : String(row.provider_order_id), expectedTokenAmountAtomic: row.expected_token_amount_atomic === null ? null : String(row.expected_token_amount_atomic), fees: json<Quote["fees"]>(row.fees), expiresAt: row.expires_at === null ? null : new Date(String(row.expires_at)).toISOString(), instructions: row.instructions === null ? null : json<Instruction>(row.instructions), providerStatus: row.provider_status === null ? null : String(row.provider_status), providerTransactionHash: row.provider_transaction_hash === null ? null : String(row.provider_transaction_hash) as `0x${string}`, transactionHash: row.transaction_hash === null ? null : String(row.transaction_hash) as `0x${string}`, logIndex: row.log_index === null ? null : Number(row.log_index), version: Number(row.version), createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString() };
}
