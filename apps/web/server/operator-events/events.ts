import "server-only";

import type { AccountProvider } from "@/shared/account/session-types";
import type { FundingOrder } from "@/server/funding/core/store";
import type { FundingProviderCustomer } from "@/server/funding/core/customer-store";
import type { ActionRow } from "@/server/actions/store";

export type OperatorOwner = { accountProvider: AccountProvider; subject: string; address?: string | null };
export type OperatorEventInput = {
  owner: OperatorOwner;
  name: "funding.order_created" | "funding.order_finalized" | "action.confirmed" | "verification.changed";
  idempotencyKey: string;
  occurredAt: Date;
  props: Record<string, string>;
  sandbox?: boolean;
};

const finalizedStates = new Set(["received", "expired", "cancelled", "failed", "refunded"]);

export function fundingOrderEvents(order: FundingOrder): OperatorEventInput[] {
  const owner = { ...order.owner, address: order.destination };
  const props = {
    provider: order.providerId, region: order.region, asset: order.assetId,
    method: order.paymentMethod, fiatAmount: order.fiatAmount,
  };
  const created: OperatorEventInput = {
    owner, name: "funding.order_created", idempotencyKey: `funding:${order.id}:created`,
    occurredAt: new Date(order.createdAt), props, sandbox: order.sandbox,
  };
  return finalizedStates.has(order.state)
    ? [created, {
        owner, name: "funding.order_finalized", idempotencyKey: `funding:${order.id}:${order.state}`,
        occurredAt: new Date(order.updatedAt), props: { ...props, state: order.state }, sandbox: order.sandbox,
      }]
    : [created];
}

export function actionConfirmedEvent(row: ActionRow): OperatorEventInput | null {
  if (!row.confirmed_at) return null;
  const [subject, address, , accountProvider] = JSON.parse(row.owner_key) as [string, string, number, AccountProvider];
  return {
    owner: { accountProvider, subject, address }, name: "action.confirmed",
    idempotencyKey: `action:${row.id}:confirmed`, occurredAt: new Date(row.confirmed_at),
    props: { kind: row.kind, accountProvider },
  };
}

export function verificationChangedEvent(customer: FundingProviderCustomer): OperatorEventInput | null {
  if (customer.state !== "pending" && customer.state !== "verified" && customer.state !== "rejected") return null;
  return {
    owner: customer.owner, name: "verification.changed",
    idempotencyKey: `kyc:${customer.id}:${customer.state}`,
    occurredAt: new Date(customer.updatedAt),
    props: { provider: customer.providerId, region: customer.region, state: customer.state },
  };
}
