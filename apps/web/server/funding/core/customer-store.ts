import "server-only";

import { getSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import type { FundingOrderOwner } from "./store";

export type FundingProviderCustomerState = "reserving" | "pending" | "verified" | "rejected" | "dispatch-ambiguous";
export type FundingProviderCustomer = {
  id: string;
  owner: FundingOrderOwner;
  providerId: string;
  region: string;
  customerRef: string | null;
  state: FundingProviderCustomerState;
  verificationStartedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export interface FundingProviderCustomerStore {
  reserve(input: { id: string; owner: FundingOrderOwner; providerId: string; region: string; createdAt: string }): Promise<{ created: boolean; customer: FundingProviderCustomer }>;
  get(owner: FundingOrderOwner, providerId: string, region: string): Promise<FundingProviderCustomer | null>;
  list(owner: FundingOrderOwner, region: string): Promise<ReadonlyArray<FundingProviderCustomer>>;
  completeCreate(id: string, input: { customerRef: string; expectedVersion: number; updatedAt: string }): Promise<FundingProviderCustomer | null>;
  markRejected(id: string, expectedVersion: number, updatedAt: string): Promise<FundingProviderCustomer | null>;
  markDispatchAmbiguous(id: string, expectedVersion: number, updatedAt: string): Promise<FundingProviderCustomer | null>;
  claimVerification(id: string, expectedVersion: number, updatedAt: string): Promise<FundingProviderCustomer | null>;
  markVerified(id: string, expectedVersion: number, updatedAt: string): Promise<FundingProviderCustomer | null>;
}

export class MemoryFundingProviderCustomerStore implements FundingProviderCustomerStore {
  private readonly customers = new Map<string, FundingProviderCustomer>();
  private key(owner: FundingOrderOwner, providerId: string, region: string) { return `${owner.accountProvider}:${owner.subject}:${providerId}:${region}`; }
  async reserve(input: { id: string; owner: FundingOrderOwner; providerId: string; region: string; createdAt: string }) {
    const key = this.key(input.owner, input.providerId, input.region);
    const existing = this.customers.get(key);
    if (existing) return { created: false, customer: structuredClone(existing) };
    const customer: FundingProviderCustomer = { ...structuredClone(input), customerRef: null, state: "reserving", verificationStartedAt: null, version: 0, updatedAt: input.createdAt };
    this.customers.set(key, customer);
    return { created: true, customer: structuredClone(customer) };
  }
  async get(owner: FundingOrderOwner, providerId: string, region: string) { const value = this.customers.get(this.key(owner, providerId, region)); return value ? structuredClone(value) : null; }
  async list(owner: FundingOrderOwner, region: string) { return [...this.customers.values()].filter((value) => value.region === region && value.owner.subject === owner.subject && value.owner.accountProvider === owner.accountProvider).map((value) => structuredClone(value)); }
  async completeCreate(id: string, input: { customerRef: string; expectedVersion: number; updatedAt: string }) { return this.update(id, input.expectedVersion, ["reserving"], { customerRef: input.customerRef, state: "pending", updatedAt: input.updatedAt }); }
  async markRejected(id: string, expectedVersion: number, updatedAt: string) { return this.update(id, expectedVersion, ["reserving", "pending"], { state: "rejected", updatedAt }); }
  async markDispatchAmbiguous(id: string, expectedVersion: number, updatedAt: string) { return this.update(id, expectedVersion, ["reserving", "pending"], { state: "dispatch-ambiguous", updatedAt }); }
  async claimVerification(id: string, expectedVersion: number, updatedAt: string) {
    const value = [...this.customers.values()].find((candidate) => candidate.id === id);
    if (value?.verificationStartedAt) return null;
    return this.update(id, expectedVersion, ["pending"], { verificationStartedAt: updatedAt, updatedAt });
  }
  async markVerified(id: string, expectedVersion: number, updatedAt: string) {
    const value = [...this.customers.values()].find((candidate) => candidate.id === id);
    if (!value?.verificationStartedAt) return null;
    return this.update(id, expectedVersion, ["pending"], { state: "verified", updatedAt });
  }
  private async update(id: string, version: number, states: ReadonlyArray<FundingProviderCustomerState>, patch: Partial<FundingProviderCustomer>) {
    const value = [...this.customers.values()].find((candidate) => candidate.id === id);
    if (!value || value.version !== version || !states.includes(value.state)) return null;
    Object.assign(value, patch, { version: value.version + 1 });
    return structuredClone(value);
  }
}

type Row = Record<string, unknown>;
export class PostgresFundingProviderCustomerStore implements FundingProviderCustomerStore {
  constructor(private readonly sql: SqlExecutor) {}
  async reserve(input: { id: string; owner: FundingOrderOwner; providerId: string; region: string; createdAt: string }) {
    return this.sql.transaction(async (transaction) => {
      const inserted = await transaction.query(`INSERT INTO funding_provider_customers (id,owner_subject,account_provider,provider_id,region,state,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,'reserving',$6,$6) ON CONFLICT (account_provider,owner_subject,provider_id,region) DO NOTHING RETURNING *`, [input.id,input.owner.subject,input.owner.accountProvider,input.providerId,input.region,input.createdAt]);
      const row = inserted.rows[0] ?? (await transaction.query("SELECT * FROM funding_provider_customers WHERE account_provider=$1 AND owner_subject=$2 AND provider_id=$3 AND region=$4 FOR UPDATE", [input.owner.accountProvider,input.owner.subject,input.providerId,input.region])).rows[0];
      if (!row) throw new Error("funding-provider-customer-reservation-missing");
      return { created: Boolean(inserted.rows[0]), customer: fromRow(row as Row) };
    });
  }
  async get(owner: FundingOrderOwner, providerId: string, region: string) { return this.one("SELECT * FROM funding_provider_customers WHERE account_provider=$1 AND owner_subject=$2 AND provider_id=$3 AND region=$4", [owner.accountProvider,owner.subject,providerId,region]); }
  async list(owner: FundingOrderOwner, region: string) { const result = await this.sql.query("SELECT * FROM funding_provider_customers WHERE account_provider=$1 AND owner_subject=$2 AND region=$3 ORDER BY updated_at DESC", [owner.accountProvider,owner.subject,region]); return result.rows.map((row) => fromRow(row as Row)); }
  async completeCreate(id: string, input: { customerRef: string; expectedVersion: number; updatedAt: string }) { return this.one("UPDATE funding_provider_customers SET customer_ref=$2,state='pending',version=version+1,updated_at=$4 WHERE id=$1 AND state='reserving' AND version=$3 RETURNING *", [id,input.customerRef,input.expectedVersion,input.updatedAt]); }
  async markRejected(id: string, version: number, updatedAt: string) { return this.one("UPDATE funding_provider_customers SET state='rejected',version=version+1,updated_at=$3 WHERE id=$1 AND state IN ('reserving','pending') AND version=$2 RETURNING *", [id,version,updatedAt]); }
  async markDispatchAmbiguous(id: string, version: number, updatedAt: string) { return this.one("UPDATE funding_provider_customers SET state='dispatch-ambiguous',version=version+1,updated_at=$3 WHERE id=$1 AND state IN ('reserving','pending') AND version=$2 RETURNING *", [id,version,updatedAt]); }
  async claimVerification(id: string, version: number, updatedAt: string) { return this.one("UPDATE funding_provider_customers SET verification_started_at=$3,version=version+1,updated_at=$3 WHERE id=$1 AND state='pending' AND verification_started_at IS NULL AND version=$2 RETURNING *", [id,version,updatedAt]); }
  async markVerified(id: string, version: number, updatedAt: string) { return this.one("UPDATE funding_provider_customers SET state='verified',version=version+1,updated_at=$3 WHERE id=$1 AND state='pending' AND verification_started_at IS NOT NULL AND version=$2 RETURNING *", [id,version,updatedAt]); }
  private async one(text: string, values: unknown[]) { const result = await this.sql.query(text, values); return result.rows[0] ? fromRow(result.rows[0] as Row) : null; }
}
export function createRuntimeFundingProviderCustomerStore(env: Readonly<Record<string,string|undefined>> = process.env) { return new PostgresFundingProviderCustomerStore(getSqlExecutor(env)); }
function fromRow(row: Row): FundingProviderCustomer { return { id:String(row.id),owner:{subject:String(row.owner_subject),accountProvider:String(row.account_provider) as FundingOrderOwner["accountProvider"]},providerId:String(row.provider_id),region:String(row.region),customerRef:row.customer_ref===null?null:String(row.customer_ref),state:String(row.state) as FundingProviderCustomerState,verificationStartedAt:date(row.verification_started_at),version:Number(row.version),createdAt:new Date(String(row.created_at)).toISOString(),updatedAt:new Date(String(row.updated_at)).toISOString()}; }
function date(value: unknown) { return value === null ? null : new Date(String(value)).toISOString(); }
