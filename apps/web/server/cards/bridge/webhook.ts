import "server-only";

import { createHash, createHmac, createPublicKey, timingSafeEqual, verify } from "node:crypto";
import type { BridgeConfig } from "./config";
import type { CardObservation, CardProvider, CardVerification } from "../provider";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const TEN_MINUTES = 600_000;
const FIVE_MINUTES = 300_000;
const THIRTY_DAYS = 30 * 24 * 60 * 60_000;

export function createBridgeWebhookProvider(config: BridgeConfig, now: () => number = Date.now): CardProvider {
  const key = createPublicKey(config.webhookPublicKey);
  return {
    fundingStrategy: "allowance-pull",
    async verifyAndNormalize(raw, headers): Promise<CardVerification> {
      const signature = headers.get("x-webhook-signature");
      const match = signature && /^t=([1-9]\d{12}),v0=([A-Za-z0-9+/]+={0,2})$/.exec(signature);
      if (!match || !within(Number(match[1]), now(), TEN_MINUTES)) return { outcome: "rejected" };
      const decoded = Buffer.from(match[2], "base64");
      if (decoded.length !== 256 && decoded.length !== 384 && decoded.length !== 512) return { outcome: "rejected" };
      if (decoded.toString("base64") !== match[2]) return { outcome: "rejected" };
      const digest = createHash("sha256").update(match[1]).update(".").update(raw).digest();
      if (!verify("RSA-SHA256", digest, key, decoded)) return { outcome: "rejected" };
      const data = parseObject(raw);
      if (!data || data.api_version !== "v0" || !id(data.event_id) || !id(data.event_object_id) ||
          !isoDate(data.event_created_at, now()) || !object(data.event_object) || data.event_object.id !== data.event_object_id ||
          typeof data.event_category !== "string" || typeof data.event_type !== "string" ||
          !data.event_type.startsWith(`${data.event_category}.`)) return { outcome: "rejected" };
      const observation = bridgeObservation(data, config.mode);
      return observation ? { outcome: "accepted", observation } : { outcome: "rejected" };
    },
  };
}

export function createStripeWebhookProvider(config: BridgeConfig, now: () => number = Date.now): CardProvider {
  return {
    fundingStrategy: "allowance-pull",
    async verifyAndNormalize(raw, headers): Promise<CardVerification> {
      const signature = headers.get("stripe-signature");
      if (!signature || signature.length > 2048) return { outcome: "rejected" };
      const parts = signature.split(",");
      const stamps = parts.filter((part) => /^t=[1-9]\d{9}$/.test(part));
      const candidates = parts.filter((part) => /^v1=[a-fA-F0-9]{64}$/.test(part));
      if (stamps.length !== 1 || candidates.length === 0 || !within(Number(stamps[0].slice(2)) * 1000, now(), FIVE_MINUTES)) return { outcome: "rejected" };
      const expected = createHmac("sha256", config.stripeWebhookSecret).update(stamps[0].slice(2)).update(".").update(raw).digest();
      let matched = false;
      for (const candidate of candidates) matched = timingSafeEqual(expected, Buffer.from(candidate.slice(3), "hex")) || matched;
      if (!matched) return { outcome: "rejected" };
      const data = parseObject(raw);
      if (!data || !id(data.id) || typeof data.type !== "string" || !object(data.data) || !object(data.data.object) ||
          data.livemode !== (config.mode === "production") || !Number.isSafeInteger(data.created) ||
          !eventTime((data.created as number) * 1000, now())) return { outcome: "rejected" };
      const observation = stripeObservation(data, config.mode);
      return observation ? { outcome: "accepted", observation } : { outcome: "rejected" };
    },
  };
}

function bridgeObservation(data: Record<string, unknown>, mode: BridgeConfig["mode"]): CardObservation | null {
  const resource = data.event_object as Record<string, unknown>;
  const kind = data.event_type as string;
  if (data.event_category !== "customer" && data.event_category !== "kyc_link") return null;
  const customer = data.event_category === "customer" ? data.event_object_id : resource.customer_id;
  if (!id(customer)) return null;
  return {
    provider: "bridge", mode, eventId: data.event_id as string, kind,
    externalIds: { customer, cardholder: id(resource.stripe_cardholder_id) ? resource.stripe_cardholder_id : null, card: null, transaction: null },
    occurredAt: data.event_created_at as string,
  };
}

function stripeObservation(data: Record<string, unknown>, mode: BridgeConfig["mode"]): CardObservation | null {
  const resource = (data.data as Record<string, unknown>).object as Record<string, unknown>;
  const kind = data.type as string;
  const isAuthorization = kind === "issuing_authorization.created" || kind === "issuing_authorization.updated";
  const isTransaction = kind === "issuing_transaction.created" || kind === "issuing_transaction.updated";
  const isCardholder = kind === "issuing_cardholder.created";
  if (!isAuthorization && !isTransaction && !isCardholder) return null;
  if (resource.object !== (isAuthorization ? "issuing.authorization" : isTransaction ? "issuing.transaction" : "issuing.cardholder") || !id(resource.id)) return null;
  const cardholder = isCardholder ? resource.id : linkedId(resource.cardholder, "issuing.cardholder");
  const card = isCardholder ? null : linkedId(resource.card, "issuing.card");
  if (!isCardholder && !card) return null;
  return {
    provider: "bridge", mode, eventId: `stripe:${data.id}`, kind,
    externalIds: { cardholder: id(cardholder) ? cardholder : null, card, transaction: isTransaction ? resource.id as string : null, customer: null },
    occurredAt: new Date((data.created as number) * 1000).toISOString(),
  };
}

function parseObject(raw: Uint8Array): Record<string, unknown> | null {
  try { const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); return object(value) ? value : null; }
  catch { return null; }
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function id(value: unknown): value is string { return typeof value === "string" && ID.test(value); }
function linkedId(value: unknown, type: string): string | null {
  if (id(value)) return value;
  return object(value) && value.object === type && id(value.id) ? value.id : null;
}
function within(value: number, now: number, tolerance: number): boolean {
  return Number.isSafeInteger(value) && value > now - tolerance && value <= now + tolerance;
}
function eventTime(timestamp: number, now: number): boolean {
  return Number.isSafeInteger(timestamp) && timestamp > now - THIRTY_DAYS && timestamp <= now + FIVE_MINUTES;
}
function isoDate(value: unknown, now: number): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return eventTime(timestamp, now) && new Date(timestamp).toISOString().slice(0, 10) === value.slice(0, 10);
}
