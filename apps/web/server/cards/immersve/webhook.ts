import "server-only";

import { constants, createPublicKey, verify, type JsonWebKey } from "node:crypto";
import type { ImmersveConfig } from "./config";
import { createCardWebhookHandler, type CardObservation, type CardProvider, type CardWebhookResult, type CardVerification } from "../provider";

type JwksClient = { getJwks(): Promise<unknown> };
type CardEventStore = { insert(event: CardObservation): Promise<boolean> };
type PublicJwk = JsonWebKey & { kid: string; kty: "RSA"; n: string; e: string };
export type ImmersveWebhookResult = CardWebhookResult;
const JWKS_TTL_MS = 5 * 60_000;
const JWKS_REFETCH_MS = 60_000;
const EVENT_RETENTION_MS = 30 * 24 * 60 * 60_000;
const TOPICS = new Set([
  "payment-updated", "card-created", "card-shipped", "card-activated", "card-canceled",
  "card-block-created", "card-block-released", "cardholder-block-created", "cardholder-block-released",
  "kyc-succeeded", "kyc-failed", "kyc-pending",
]);
const ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isImmersveWebhookTopic(topic: string): boolean {
  return TOPICS.has(topic);
}

export function createImmersveWebhookHandler(dependencies: {
  config: ImmersveConfig;
  client: JwksClient;
  store: CardEventStore;
  now?: () => number;
}) {
  const now = dependencies.now ?? Date.now;
  let cached: { keys: PublicJwk[]; expires: number } | null = null;
  let lastFetchedAt = Number.NEGATIVE_INFINITY;
  let loading: Promise<PublicJwk[]> | null = null;

  async function keys(force = false): Promise<PublicJwk[]> {
    if (!force && cached && now() < cached.expires) return cached.keys;
    if (loading) return loading;
    lastFetchedAt = now();
    loading = (async () => {
      const data = await dependencies.client.getJwks();
      if (!isObject(data) || !Array.isArray(data.keys) || data.keys.length > 20) throw new Error("Invalid Immersve JWKS");
      const parsed = data.keys.filter(isPublicRsaKey);
      if (parsed.length === 0) throw new Error("Invalid Immersve JWKS");
      cached = { keys: parsed, expires: now() + JWKS_TTL_MS };
      return parsed;
    })();
    try { return await loading; }
    finally { loading = null; }
  }

  const provider: CardProvider = {
    fundingStrategy: "deposit",
    async verifyAndNormalize(raw: Uint8Array, headers: Headers, topic?: string): Promise<CardVerification> {
      if (!topic || !isImmersveWebhookTopic(topic)) return { outcome: "rejected" };
    const delivery = headers.get("x-delivery-id");
    const kid = headers.get("x-key-id");
    const signature = headers.get("x-signature");
    if (!delivery || !/^[A-Za-z0-9_-]{1,128}:[1-9][0-9]{0,8}$/.test(delivery) ||
        !kid || !ID.test(kid) || !signature || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(signature) || signature.length > 2048) return { outcome: "rejected" };
    let key: PublicJwk | undefined;
    try {
      key = (await keys()).find((item) => item.kid === kid);
      if (!key && now() - lastFetchedAt >= JWKS_REFETCH_MS) key = (await keys(true)).find((item) => item.kid === kid);
    } catch { return { outcome: "unavailable" }; }
    if (!key) return { outcome: "unavailable" };
    let valid = false;
    try {
      const signed = Buffer.concat([Buffer.from(`${delivery}:${kid}:`, "utf8"), Buffer.from(raw)]);
      valid = verify("RSA-SHA256", signed, { key: createPublicKey({ key: { kty: "RSA", n: key.n, e: key.e }, format: "jwk" }), padding: constants.RSA_PKCS1_PADDING }, Buffer.from(signature, "base64"));
    } catch { return { outcome: "rejected" }; }
    if (!valid) return { outcome: "rejected" };
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)) as unknown; }
    catch { return { outcome: "rejected" }; }
    if (!isObject(parsed) || typeof parsed.messageId !== "string" || !ID.test(parsed.messageId) ||
        parsed.topic !== topic || parsed.keyId !== kid || parsed.issuer !== new URL(dependencies.config.origin).host ||
        !Number.isSafeInteger(parsed.deliveryAttempt) || delivery !== `${parsed.messageId}:${parsed.deliveryAttempt}` ||
        !isRecentCreatedAt(parsed.createdAt, now())) return { outcome: "rejected" };
    const observation = projectEvent(parsed, dependencies.config.mode);
    return observation ? { outcome: "accepted", observation } : { outcome: "rejected" };
    },
  };
  return Object.assign(createCardWebhookHandler(provider, dependencies.store), { provider });
}

function projectEvent(envelope: Record<string, unknown>, mode: ImmersveConfig["mode"]): CardObservation | null {
  const topic = envelope.topic as string;
  const payload = envelope.payload;
  if (!isObject(payload)) return null;
  let cardholderAccountId: string | null = null;
  let cardId: string | null = null;
  let paymentId: string | null = null;
  if (topic === "payment-updated") {
    if (!isObject(payload.payment) || !isObject(payload.payment.cardholder) || !isObject(payload.payment.card)) return null;
    paymentId = identifier(payload.payment.id);
    cardholderAccountId = identifier(payload.payment.cardholder.id);
    cardId = identifier(payload.payment.card.id);
    if (!paymentId || !cardholderAccountId || !cardId) return null;
  } else if (topic.startsWith("kyc-")) {
    cardholderAccountId = identifier(payload.accountId);
    if (!cardholderAccountId) return null;
  } else {
    cardholderAccountId = identifier(payload.cardholderAccountId);
    if (!cardholderAccountId) return null;
    if (topic.startsWith("card-")) {
      cardId = identifier(payload.cardId);
      if (!cardId) return null;
    }
  }
  return {
    provider: "immersve",
    mode,
    eventId: envelope.messageId as string,
    kind: topic,
    externalIds: { cardholder: cardholderAccountId, card: cardId, transaction: paymentId, customer: null },
    occurredAt: envelope.createdAt as string,
  };
}

function isRecentCreatedAt(value: unknown, current: number): boolean {
  if (typeof value !== "string") return false;
  const parts = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.exec(value);
  if (!parts) return false;
  const [, year, month, day] = parts;
  if (new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toISOString().slice(0, 10) !== `${year}-${month}-${day}`) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > current - EVENT_RETENTION_MS && timestamp <= current + 5 * 60_000;
}

function identifier(value: unknown): string | null {
  return typeof value === "string" && ID.test(value) ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPublicRsaKey(value: unknown): value is PublicJwk {
  if (!isObject(value) || value.kty !== "RSA" || identifier(value.kid) === null ||
      typeof value.n !== "string" || !/^[A-Za-z0-9_-]{342,1024}$/.test(value.n) ||
      typeof value.e !== "string" || !/^[A-Za-z0-9_-]{1,12}$/.test(value.e) ||
      (value.use !== undefined && value.use !== "sig") || (value.alg !== undefined && value.alg !== "RS256")) return false;
  try {
    const key = createPublicKey({ key: { kty: "RSA", n: value.n, e: value.e }, format: "jwk" });
    return (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048;
  } catch { return false; }
}
