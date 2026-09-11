import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  exactBaseTransferMatches,
  type RipioBaseTransferEvidence,
  type RipioOrderState,
} from "@/shared/funding/ripio-contract";

export type DurableRipioOrder = {
  homeOrderId: string;
  homeCustomerKey: string;
  country: "AR" | "CO";
  customerId: string;
  quoteId: string;
  providerOrderId: string;
  destination: `0x${string}`;
  tokenAddress: `0x${string}`;
  expectedAmountAtomic: string;
  state: RipioOrderState;
  providerStatus: string;
  providerTransactionHash: `0x${string}` | null;
  transferEvidence: RipioBaseTransferEvidence | null;
  updatedAt: string;
};

export type RipioWebhookEvent = {
  eventId: string;
  providerOrderId: string;
  status: string;
  occurredAt: string;
};

export interface RipioReconciliationStore {
  hasWebhookEvent(eventId: string): Promise<boolean>;
  /** Must atomically return false if eventId was already persisted. */
  recordWebhookEvent(event: RipioWebhookEvent, rawBodyDigest: string): Promise<boolean>;
  getByProviderOrderId(providerOrderId: string): Promise<DurableRipioOrder | null>;
  saveReconciledOrder(order: DurableRipioOrder): Promise<void>;
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
  try {
    value = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    typeof value.eventType !== "string" ||
    value.eventType.length === 0 ||
    typeof value.issueDatetime !== "string" ||
    !Number.isFinite(Date.parse(value.issueDatetime)) ||
    !isRecord(value.transactionObject) ||
    typeof value.transactionObject.transactionId !== "string" ||
    !validUuid(value.transactionObject.transactionId)
  ) return null;
  return {
    eventId: createHash("sha256")
      .update(`${value.eventType}\u0000${value.transactionObject.transactionId}\u0000${value.issueDatetime}`)
      .digest("hex"),
    providerOrderId: value.transactionObject.transactionId,
    status: value.eventType,
    occurredAt: value.issueDatetime,
  };
}

export function reconcileRipioOrder(input: {
  order: DurableRipioOrder;
  providerStatus: string;
  providerTransactionHash: string | null;
  transferEvidence?: RipioBaseTransferEvidence | null;
  minimumConfirmations?: number;
  now: string;
}): DurableRipioOrder {
  const nextProvider = providerState(input.providerStatus);
  const current = input.order.state;
  let next = chooseMonotonicState(current, nextProvider);
  const evidence = input.transferEvidence ?? input.order.transferEvidence;
  const hash = validHash(input.providerTransactionHash)
    ? input.providerTransactionHash.toLowerCase() as `0x${string}`
    : input.order.providerTransactionHash;

  if (next === "sent-unverified" || next === "received") {
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
    providerStatus: input.providerStatus,
    providerTransactionHash: hash,
    transferEvidence: evidence ?? null,
    updatedAt: input.now,
  };
}

export function homeCustomerKey(input: {
  subject: string;
  country: "AR" | "CO";
}): string {
  // Stable Home identity mapping. It deliberately excludes order UUIDs, wallet
  // addresses and provider order IDs; rotation of an account must not create a
  // second provider person.
  return `${input.country}:${input.subject}`;
}

function providerState(status: string): RipioOrderState {
  switch (status.toUpperCase()) {
    case "CREATED":
    case "PENDING":
    case "AWAITING_PAYMENT": return "awaiting-payment";
    case "PAYMENT_RECEIVED":
    case "ONRAMP_PAYMENT_RECEIVED": return "payment-received";
    case "CONVERTING":
    case "PROCESSING":
    case "ONRAMP_CRYPTO_BUY_IN_PROGRESS": return "converting";
    case "SENDING": return "sending";
    case "COMPLETED":
    case "SUCCESS":
    case "ONRAMP_CRYPTO_SENT": return "sent-unverified";
    case "CANCELLED":
    case "EXPIRED":
    case "ONRAMP_CANCELED": return "cancelled";
    case "REFUNDED":
    case "REFUND_COMPLETED":
    case "ONRAMP_REFUNDED": return "refunded";
    case "FAILED":
    case "SERVICE_UNAVAILABLE":
    case "ONRAMP_FAILED": return "outage";
    default: return "unknown";
  }
}

function chooseMonotonicState(current: RipioOrderState, next: RipioOrderState): RipioOrderState {
  if (current === "received" || current === "refunded") return current;
  if (next === "refunded") return "refunded";
  if (next === "cancelled" && progress(current) <= progress("awaiting-payment")) return next;
  if (next === "outage") return current === "unknown" ? "outage" : current;
  if (next === "unknown") return current;
  return progress(next) >= progress(current) ? next : current;
}

function progress(state: RipioOrderState): number {
  return ({ unknown: -1, outage: 0, cancelled: 0, refunded: 6, "awaiting-payment": 1, "payment-received": 2, converting: 3, sending: 4, "sent-unverified": 5, received: 6 } as const)[state];
}
function normalizeSignature(value: string): Uint8Array | null {
  const normalized = value.trim().replace(/^sha256=/i, "");
  if (!/^[0-9a-f]{64}$/i.test(normalized)) return null;
  return Buffer.from(normalized, "hex");
}
function validHash(value: unknown): value is `0x${string}` { return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value); }
function validUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
