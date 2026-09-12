import "server-only";

import { Pool } from "@neondatabase/serverless";
import type { Instruction, Quote } from "@/shared/funding/provider-contract";
import {
  isTerminalFundingState,
  type FundingOrder,
  type FundingOrderOwner,
  type FundingOrderStore,
  type FundingReservation,
} from "./store";

type Row = Record<string, unknown>;

export class PostgresFundingOrderStore implements FundingOrderStore {
  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresFundingOrderStore {
    if (!connectionString.trim()) throw new Error("DATABASE_URL is required for funding orders");
    return new PostgresFundingOrderStore(new Pool({ connectionString }));
  }

  async reserve(input: FundingReservation) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO funding_orders
         (id, owner_subject, account_provider, destination, provider_id, region, asset_id,
          payment_method, fiat_amount, intent_digest, quote, customer_ref, state, creation_block,
          fees, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,'reserving',$13,'[]'::jsonb,$14,$14)
         ON CONFLICT (account_provider, owner_subject, intent_digest) DO NOTHING
         RETURNING *`,
        [input.id, input.owner.subject, input.owner.accountProvider, input.destination.toLowerCase(),
          input.providerId, input.region, input.assetId, input.paymentMethod, input.fiatAmount,
          input.intentDigest, JSON.stringify(input.quote), input.customerRef, input.creationBlock, input.createdAt],
      );
      const result = inserted.rows[0] ?? (await client.query(
        `SELECT * FROM funding_orders WHERE account_provider=$1 AND owner_subject=$2 AND intent_digest=$3 FOR UPDATE`,
        [input.owner.accountProvider, input.owner.subject, input.intentDigest],
      )).rows[0];
      await client.query("COMMIT");
      if (!result) throw new Error("funding-reservation-missing");
      return { created: Boolean(inserted.rows[0]), order: fromRow(result as Row) };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async getOwned(id: string, owner: FundingOrderOwner) {
    return this.one(`SELECT * FROM funding_orders WHERE id=$1 AND account_provider=$2 AND owner_subject=$3`, [id, owner.accountProvider, owner.subject]);
  }
  async getOpen(owner: FundingOrderOwner, region: string) {
    return this.one(`SELECT * FROM funding_orders WHERE account_provider=$1 AND owner_subject=$2 AND region=$3 AND state NOT IN ('dispatch-ambiguous','received','expired','cancelled','failed','refunded') ORDER BY updated_at DESC LIMIT 1`, [owner.accountProvider, owner.subject, region]);
  }
  async getByProviderOrderId(providerId: string, providerOrderId: string) {
    return this.one(`SELECT * FROM funding_orders WHERE provider_id=$1 AND provider_order_id=$2`, [providerId, providerOrderId]);
  }
  async findCustomerRef(owner: FundingOrderOwner, providerId: string, region: string) {
    const result = await this.pool.query(`SELECT customer_ref FROM funding_orders WHERE account_provider=$1 AND owner_subject=$2 AND provider_id=$3 AND region=$4 AND customer_ref IS NOT NULL ORDER BY updated_at DESC LIMIT 1`, [owner.accountProvider, owner.subject, providerId, region]);
    return typeof result.rows[0]?.customer_ref === "string" ? result.rows[0].customer_ref : null;
  }

  async completeDispatch(id: string, input: { providerOrderId: string; expectedTokenAmountAtomic: string; fees: Quote["fees"]; expiresAt: string | null; instructions: Instruction; updatedAt: string }) {
    return this.updated(`UPDATE funding_orders SET state='awaiting-payment', provider_order_id=$2, expected_token_amount_atomic=$3, fees=$4::jsonb, expires_at=$5, instructions=$6::jsonb, updated_at=$7 WHERE id=$1 AND state='reserving' RETURNING *`, [id, input.providerOrderId, input.expectedTokenAmountAtomic, JSON.stringify(input.fees), input.expiresAt, JSON.stringify(input.instructions), input.updatedAt]);
  }
  async markDispatchAmbiguous(id: string, updatedAt: string) {
    return this.updated(`UPDATE funding_orders SET state='dispatch-ambiguous', instructions=NULL, updated_at=$2 WHERE id=$1 AND state='reserving' RETURNING *`, [id, updatedAt]);
  }
  async applyObservation(id: string, input: { state: Parameters<FundingOrderStore["applyObservation"]>[1]["state"]; providerStatus: string; transactionHash?: `0x${string}` | null; updatedAt: string }) {
    const instructions = isTerminalFundingState(input.state) ? "NULL" : "instructions";
    return this.updated(`UPDATE funding_orders SET state=$2, provider_status=$3, transaction_hash=COALESCE($4,transaction_hash), instructions=${instructions}, updated_at=$5 WHERE id=$1 AND state <> 'received' RETURNING *`, [id, input.state, input.providerStatus, input.transactionHash ?? null, input.updatedAt]);
  }
  async claimReceipt(id: string, input: { transactionHash: `0x${string}`; logIndex: number; updatedAt: string }) {
    try {
      return await this.updated(`UPDATE funding_orders SET state='received', transaction_hash=$2, log_index=$3, instructions=NULL, updated_at=$4 WHERE id=$1 RETURNING *`, [id, input.transactionHash.toLowerCase(), input.logIndex, input.updatedAt]);
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "23505") return null;
      throw error;
    }
  }

  private async one(text: string, values: unknown[]): Promise<FundingOrder | null> {
    const result = await this.pool.query(text, values);
    return result.rows[0] ? fromRow(result.rows[0] as Row) : null;
  }
  private async updated(text: string, values: unknown[]): Promise<FundingOrder> {
    const order = await this.one(text, values);
    if (!order) throw new Error("funding-order-state-conflict");
    return order;
  }
}

export function createRuntimeFundingOrderStore(env: Readonly<Record<string, string | undefined>> = process.env): FundingOrderStore {
  const url = env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is required for funding-order persistence");
  return PostgresFundingOrderStore.fromConnectionString(url);
}

function fromRow(row: Row): FundingOrder {
  const json = <T>(value: unknown): T => typeof value === "string" ? JSON.parse(value) as T : value as T;
  return {
    id: String(row.id), owner: { subject: String(row.owner_subject), accountProvider: String(row.account_provider) as FundingOrderOwner["accountProvider"] },
    destination: String(row.destination) as `0x${string}`, providerId: String(row.provider_id), region: String(row.region), assetId: String(row.asset_id), paymentMethod: String(row.payment_method), fiatAmount: String(row.fiat_amount), intentDigest: String(row.intent_digest),
    quote: json<Quote>(row.quote), customerRef: row.customer_ref === null ? null : String(row.customer_ref), state: String(row.state) as FundingOrder["state"], creationBlock: String(row.creation_block), providerOrderId: row.provider_order_id === null ? null : String(row.provider_order_id), expectedTokenAmountAtomic: row.expected_token_amount_atomic === null ? null : String(row.expected_token_amount_atomic), fees: json<Quote["fees"]>(row.fees), expiresAt: row.expires_at === null ? null : new Date(String(row.expires_at)).toISOString(), instructions: row.instructions === null ? null : json<Instruction>(row.instructions), providerStatus: row.provider_status === null ? null : String(row.provider_status), transactionHash: row.transaction_hash === null ? null : String(row.transaction_hash) as `0x${string}`, logIndex: row.log_index === null ? null : Number(row.log_index), createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}
