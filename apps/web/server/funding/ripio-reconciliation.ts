import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  exactBaseTransferMatches,
  type RipioBaseTransferEvidence,
  type RipioOrderState,
} from "@/shared/funding/ripio-contract";
import type { RipioTransactionReference } from "./ripio-client";

export type DurableRipioOrder = {
  homeOrderId: string;
  homeCustomerKey: string;
  country: "AR" | "CO";
  customerId: string;
  quoteId: string;
  providerOrderId: string;
  operationType: "ON_RAMP";
  fromCurrency: "ARS" | "COP";
  toCurrency: "wARS" | "wCOP";
  chain: "BASE";
  paymentMethodType: string;
  destination: `0x${string}`;
  tokenAddress: `0x${string}`;
  tokenDecimals: 18;
  expectedAmountAtomic: string;
  state: RipioOrderState;
  providerStatus: string;
  providerTransactionHash: `0x${string}` | null;
  latestRefundStatus: string | null;
  latestRefundRejectionReason: string | null;
  transferEvidence: RipioBaseTransferEvidence | null;
  version: number;
  updatedAt: string;
};

export type RipioWebhookEvent = {
  eventId: string;
  providerOrderId: string;
  status: string;
  occurredAt: string;
};

export type RipioVerifiedObservation = {
  event: RipioWebhookEvent;
  rawBodyDigest: string;
  transaction: RipioTransactionReference;
  transferEvidence: RipioBaseTransferEvidence | null;
  observedAt: string;
};

export type RipioInboxRecord = {
  event: RipioWebhookEvent;
  rawBodyDigest: string;
  state: "pending-recovery";
  recordedAt: string;
};

export type PendingRipioInbox = {
  eventId: string;
  providerOrderId: string;
};

export interface RipioReconciliationStore {
  hasWebhookEvent(eventId: string): Promise<boolean>;
  recordUnmatchedWebhook(record: RipioInboxRecord): Promise<boolean>;
  getByProviderOrderId(providerOrderId: string): Promise<DurableRipioOrder | null>;
  /** Locks/reloads the order, re-reconciles, and commits event+order atomically. */
  applyVerifiedObservation(observation: RipioVerifiedObservation): Promise<"applied" | "duplicate" | "unmatched" | "binding-conflict">;
  listPendingInbox(limit: number): Promise<PendingRipioInbox[]>;
  resolveInbox(input: { eventId: string; country: "AR" | "CO"; transaction: RipioTransactionReference; resolvedAt: string }): Promise<"applied" | "pending" | "binding-conflict">;
}

export function verifyRipioWebhook(input: {
  rawBody: Uint8Array;
  signature: string | null;
  signingKey: string;
}): boolean {
  if (!input.signature || input.signingKey.length < 16) return false;
  const supplied = normalizeSignature(input.signature);
  if (!supplied) return false;
  const expected = createHmac("sha256", input.signingKey).update(input.rawBody).digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function parseRipioWebhook(rawBody: Uint8Array): RipioWebhookEvent | null {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(rawBody)); } catch { return null; }
  if (
    !isRecord(value) || typeof value.eventType !== "string" || value.eventType.length === 0 ||
    typeof value.issueDatetime !== "string" || !Number.isFinite(Date.parse(value.issueDatetime)) ||
    !isRecord(value.transactionObject) || typeof value.transactionObject.transactionId !== "string" ||
    !validUuid(value.transactionObject.transactionId)
  ) return null;
  return {
    eventId: createHash("sha256").update(`${value.eventType}\u0000${value.transactionObject.transactionId}\u0000${value.issueDatetime}`).digest("hex"),
    providerOrderId: value.transactionObject.transactionId,
    status: value.eventType,
    occurredAt: value.issueDatetime,
  };
}

export function transactionMatchesOrder(order: DurableRipioOrder, transaction: RipioTransactionReference): boolean {
  const returnedAmount = transaction.amount === undefined
    ? order.expectedAmountAtomic
    : decimalToAtomic(transaction.amount, order.tokenDecimals);
  return (
    transaction.transactionId === order.providerOrderId &&
    !conflicts(transaction.customerId, order.customerId) &&
    !conflicts(transaction.quoteId, order.quoteId) &&
    !conflicts(transaction.externalRef, order.homeOrderId) &&
    !conflicts(transaction.operationType, order.operationType) &&
    !conflicts(transaction.fromCurrency, order.fromCurrency) &&
    !conflicts(transaction.toCurrency, order.toCurrency) &&
    !conflicts(transaction.chain, order.chain) &&
    !conflicts(transaction.paymentMethodType, order.paymentMethodType) &&
    (transaction.destination === undefined || transaction.destination.toLowerCase() === order.destination.toLowerCase()) &&
    returnedAmount === order.expectedAmountAtomic
  );
}

export function reconcileRipioOrder(input: {
  order: DurableRipioOrder;
  transaction: RipioTransactionReference;
  transferEvidence?: RipioBaseTransferEvidence | null;
  minimumConfirmations?: number;
  now: string;
}): DurableRipioOrder {
  if (!transactionMatchesOrder(input.order, input.transaction)) throw new Error("ripio-binding-conflict");
  const current = input.order.state;
  const provider = providerState(input.transaction.status);
  const refund = refundState(input.transaction.latestRefund?.status ?? null);
  let next = transition(current, provider, refund);
  const evidence = input.transferEvidence ?? input.order.transferEvidence;
  const hash = validHash(input.transaction.txnHash)
    ? input.transaction.txnHash.toLowerCase() as `0x${string}`
    : input.order.providerTransactionHash;

  if (current === "received") next = "received";
  else if (next === "sent-unverified") {
    next = evidence && hash && evidence.transactionHash.toLowerCase() === hash && exactBaseTransferMatches({
      evidence,
      destination: input.order.destination,
      tokenAddress: input.order.tokenAddress,
      amountAtomic: input.order.expectedAmountAtomic,
      minimumConfirmations: input.minimumConfirmations ?? 1,
    }) ? "received" : "sent-unverified";
  }

  return {
    ...input.order,
    state: next,
    providerStatus: input.transaction.status,
    providerTransactionHash: hash,
    latestRefundStatus: input.transaction.latestRefund?.status ?? input.order.latestRefundStatus,
    latestRefundRejectionReason: input.transaction.latestRefund?.rejectionReason ?? input.order.latestRefundRejectionReason,
    transferEvidence: evidence ?? null,
    version: input.order.version + 1,
    updatedAt: input.now,
  };
}

export function homeCustomerKey(input: { subject: string; country: "AR" | "CO" }): string {
  return `${input.country}:${input.subject}`;
}

function providerState(status: string): RipioOrderState {
  switch (status.toUpperCase()) {
    case "CREATED": case "PENDING": case "AWAITING_PAYMENT": return "awaiting-payment";
    case "PAYMENT_RECEIVED": case "ONRAMP_PAYMENT_RECEIVED": return "payment-received";
    case "CONVERTING": case "PROCESSING": case "ONRAMP_CRYPTO_BUY_IN_PROGRESS": return "converting";
    case "SENDING": return "sending";
    case "COMPLETED": case "SUCCESS": case "ONRAMP_CRYPTO_SENT": return "sent-unverified";
    case "CANCELLED": case "EXPIRED": case "ONRAMP_CANCELED": return "cancelled";
    case "REFUNDED": case "REFUND_COMPLETED": case "ONRAMP_REFUNDED": return "refunded";
    case "FAILED": case "SERVICE_UNAVAILABLE": case "ONRAMP_FAILED": return "outage";
    default: return "unknown";
  }
}

function refundState(status: string | null): RipioOrderState | null {
  switch (status?.toUpperCase()) {
    case "PENDING": case "CREATED": case "PROCESSING": return "refund-pending";
    case "REJECTED": case "FAILED": return "refund-rejected";
    case "COMPLETED": case "REFUNDED": case "SUCCESS": return "refunded";
    default: return null;
  }
}

function transition(current: RipioOrderState, provider: RipioOrderState, refund: RipioOrderState | null): RipioOrderState {
  if (current === "received" || current === "refunded") return current;
  if (refund === "refunded") return "refunded";
  if (refund === "refund-pending") return "refund-pending";
  if (refund === "refund-rejected") return "refund-rejected";
  if (current === "cancelled" || current === "refund-pending" || current === "refund-rejected") {
    return provider === "refunded" ? "refunded" : current;
  }
  if (provider === "cancelled") return "cancelled";
  if (provider === "refunded") return "refunded";
  if (provider === "outage") return current === "unknown" ? "outage" : current;
  if (provider === "unknown") return current;
  return progress(provider) >= progress(current) ? provider : current;
}

function progress(state: RipioOrderState): number {
  return ({ unknown: -1, outage: 0, cancelled: 6, "refund-pending": 7, "refund-rejected": 7, refunded: 8, "awaiting-payment": 1, "payment-received": 2, converting: 3, sending: 4, "sent-unverified": 5, received: 8 } as const)[state];
}
function decimalToAtomic(value: string, decimals: number): string | null {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) return null;
  return `${whole}${fraction.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "");
}
function normalizeSignature(value: string): Uint8Array | null {
  const normalized = value.trim().replace(/^sha256=/i, "");
  if (!/^[0-9a-f]{64}$/i.test(normalized)) return null;
  return Buffer.from(normalized, "hex");
}
function conflicts(actual: string | undefined, expected: string): boolean { return actual !== undefined && actual !== expected; }
function validHash(value: unknown): value is `0x${string}` { return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value); }
function validUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
