import "server-only";

import { getSqlExecutor, isUniqueViolation, type SqlExecutor } from "@/server/db/sql";
import type { Instruction, Quote } from "@/shared/funding/provider-contract";
import type { FundingOrder, FundingOrderOwner, FundingOrderStore, FundingReservation } from "./store";

type Row = Record<string, unknown>;
const TERMINAL_SQL = "'dispatch-ambiguous','received','expired','cancelled','failed','refunded'";
const PROGRESS_SQL = "ARRAY['reserving','unknown','awaiting-payment','payment-received','settling','sent','sent-unverified']";

export class PostgresFundingOrderStore implements FundingOrderStore {
  constructor(private readonly sql: SqlExecutor) {}

  async reserve(input: FundingReservation) {
    return this.sql.transaction(async (transaction) => {
      const inserted = await transaction.query(
        `INSERT INTO funding_orders
         (id, owner_subject, account_provider, destination, provider_id, region, asset_id,
          payment_method, fiat_amount, intent_digest, quote, quote_token, customer_ref, state,
          creation_block, fees, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,'reserving',$14,'[]'::jsonb,$15,$15)
         ON CONFLICT (account_provider, owner_subject, intent_digest) DO NOTHING RETURNING *`,
        [input.id, input.owner.subject, input.owner.accountProvider, input.destination.toLowerCase(), input.providerId,
          input.region, input.assetId, input.paymentMethod, input.fiatAmount, input.intentDigest, JSON.stringify(input.quote),
          input.quoteToken, input.customerRef, input.creationBlock, input.createdAt],
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
  async getByIntent(owner: FundingOrderOwner, intentDigest: string) { return this.one("SELECT * FROM funding_orders WHERE account_provider=$1 AND owner_subject=$2 AND intent_digest=$3", [owner.accountProvider, owner.subject, intentDigest]); }
  async getOpen(owner: FundingOrderOwner, region: string) { return this.one(`SELECT * FROM funding_orders WHERE account_provider=$1 AND owner_subject=$2 AND region=$3 AND (state NOT IN (${TERMINAL_SQL}) OR state='dispatch-ambiguous') ORDER BY updated_at DESC LIMIT 1`, [owner.accountProvider, owner.subject, region]); }
  async getByProviderOrderId(providerId: string, providerOrderId: string) { return this.one("SELECT * FROM funding_orders WHERE provider_id=$1 AND provider_order_id=$2", [providerId, providerOrderId]); }
  async findCustomerRef(owner: FundingOrderOwner, providerId: string, region: string) {
    const result = await this.sql.query("SELECT customer_ref FROM funding_orders WHERE account_provider=$1 AND owner_subject=$2 AND provider_id=$3 AND region=$4 AND customer_ref IS NOT NULL ORDER BY updated_at DESC LIMIT 1", [owner.accountProvider, owner.subject, providerId, region]);
    return typeof result.rows[0]?.customer_ref === "string" ? result.rows[0].customer_ref : null;
  }

  async completeDispatch(id: string, input: Parameters<FundingOrderStore["completeDispatch"]>[1]) {
    return this.updated(`UPDATE funding_orders SET state='awaiting-payment', provider_order_id=$2, expected_token_amount_atomic=$3, fees=$4::jsonb, expires_at=$5, instructions=$6::jsonb, version=version+1, updated_at=$8 WHERE id=$1 AND state='reserving' AND version=$7 RETURNING *`, [id, input.providerOrderId, input.expectedTokenAmountAtomic, JSON.stringify(input.fees), input.expiresAt, JSON.stringify(input.instructions), input.expectedVersion, input.updatedAt]);
  }
  async markDispatchAmbiguous(id: string, expectedVersion: number, updatedAt: string) {
    return this.updated(`UPDATE funding_orders SET state='dispatch-ambiguous', instructions=NULL, version=version+1, updated_at=$3 WHERE id=$1 AND state='reserving' AND version=$2 RETURNING *`, [id, expectedVersion, updatedAt]);
  }
  async applyObservation(id: string, input: Parameters<FundingOrderStore["applyObservation"]>[1]) {
    const terminal = ["expired", "cancelled", "failed", "refunded"].includes(input.state);
    return this.updatedOrNull(`UPDATE funding_orders SET state=$2, provider_status=$3, provider_transaction_hash=COALESCE($4,provider_transaction_hash), instructions=CASE WHEN $6 THEN NULL ELSE instructions END, version=version+1, updated_at=$7 WHERE id=$1 AND version=$5 AND state NOT IN (${TERMINAL_SQL}) AND ($6 OR array_position(${PROGRESS_SQL}, $2) >= array_position(${PROGRESS_SQL}, state)) RETURNING *`, [id, input.state, input.providerStatus, input.providerTransactionHash ?? null, input.expectedVersion, terminal, input.updatedAt]);
  }
  async claimReceipt(id: string, input: Parameters<FundingOrderStore["claimReceipt"]>[1]) {
    try {
      return await this.updatedOrNull(`UPDATE funding_orders SET state='received', transaction_hash=$2, log_index=$3, instructions=NULL, version=version+1, updated_at=$5 WHERE id=$1 AND version=$4 AND state NOT IN (${TERMINAL_SQL}) AND transaction_hash IS NULL AND log_index IS NULL RETURNING *`, [id, input.transactionHash.toLowerCase(), input.logIndex, input.expectedVersion, input.updatedAt]);
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

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
  return { id: String(row.id), owner: { subject: String(row.owner_subject), accountProvider: String(row.account_provider) as FundingOrderOwner["accountProvider"] }, destination: String(row.destination) as `0x${string}`, providerId: String(row.provider_id), region: String(row.region), assetId: String(row.asset_id), paymentMethod: String(row.payment_method), fiatAmount: String(row.fiat_amount), intentDigest: String(row.intent_digest), quote: json<Quote>(row.quote), quoteToken: String(row.quote_token), customerRef: row.customer_ref === null ? null : String(row.customer_ref), state: String(row.state) as FundingOrder["state"], creationBlock: String(row.creation_block), providerOrderId: row.provider_order_id === null ? null : String(row.provider_order_id), expectedTokenAmountAtomic: row.expected_token_amount_atomic === null ? null : String(row.expected_token_amount_atomic), fees: json<Quote["fees"]>(row.fees), expiresAt: row.expires_at === null ? null : new Date(String(row.expires_at)).toISOString(), instructions: row.instructions === null ? null : json<Instruction>(row.instructions), providerStatus: row.provider_status === null ? null : String(row.provider_status), providerTransactionHash: row.provider_transaction_hash === null ? null : String(row.provider_transaction_hash) as `0x${string}`, transactionHash: row.transaction_hash === null ? null : String(row.transaction_hash) as `0x${string}`, logIndex: row.log_index === null ? null : Number(row.log_index), version: Number(row.version), createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString() };
}
