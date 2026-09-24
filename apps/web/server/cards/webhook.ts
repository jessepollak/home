import "server-only";

import { constants, createPublicKey, verify, type JsonWebKey } from "node:crypto";
import type { ImmersveConfig } from "./config";
import type { CardEvent } from "./store";

type JwksClient = { getJwks(): Promise<unknown> };
type CardEventStore = { insert(event: CardEvent): Promise<boolean> };
type PublicJwk = JsonWebKey & { kid: string; kty: "RSA"; n: string; e: string };
const JWKS_TTL_MS = 5 * 60_000;
const TOPICS = new Set([
  "payment-updated", "card-created", "card-shipped", "card-activated", "card-canceled",
  "card-block-created", "card-block-released", "cardholder-block-created", "cardholder-block-released",
  "kyc-succeeded", "kyc-failed", "kyc-pending",
]);
const ID = /^[A-Za-z0-9_-]{1,128}$/;

export function createImmersveWebhookHandler(dependencies: {
  config: ImmersveConfig;
  client: JwksClient;
  store: CardEventStore;
  now?: () => number;
}) {
  const now = dependencies.now ?? Date.now;
  let cached: { keys: PublicJwk[]; expires: number } | null = null;

  async function keys(force = false): Promise<PublicJwk[]> {
    if (!force && cached && now() < cached.expires) return cached.keys;
    const data = await dependencies.client.getJwks();
    if (!isObject(data) || !Array.isArray(data.keys) || data.keys.length > 20) throw new Error("Invalid Immersve JWKS");
    const parsed = data.keys.filter(isPublicRsaKey);
    if (parsed.length === 0) throw new Error("Invalid Immersve JWKS");
    cached = { keys: parsed, expires: now() + JWKS_TTL_MS };
    return parsed;
  }

  return async function handle(raw: Uint8Array, headers: Headers): Promise<boolean> {
    const delivery = headers.get("x-delivery-id");
    const kid = headers.get("x-key-id");
    const signature = headers.get("x-signature");
    if (!delivery || !/^[A-Za-z0-9_-]{1,128}:[1-9][0-9]{0,8}$/.test(delivery) ||
        !kid || !ID.test(kid) || !signature || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(signature) || signature.length > 2048) return false;
    let key = (await keys()).find((item) => item.kid === kid);
    if (!key) key = (await keys(true)).find((item) => item.kid === kid);
    if (!key) return false;
    let valid = false;
    try {
      const signed = Buffer.concat([Buffer.from(`${delivery}:${kid}:`, "utf8"), Buffer.from(raw)]);
      valid = verify("RSA-SHA256", signed, { key: createPublicKey({ key: { kty: "RSA", n: key.n, e: key.e }, format: "jwk" }), padding: constants.RSA_PKCS1_PADDING }, Buffer.from(signature, "base64"));
    } catch { return false; }
    if (!valid) return false;
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)) as unknown; }
    catch { return false; }
    if (!isObject(parsed) || !ID.test(String(parsed.messageId)) || typeof parsed.topic !== "string" ||
        !TOPICS.has(parsed.topic) || parsed.keyId !== kid || parsed.issuer !== new URL(dependencies.config.origin).host ||
        !Number.isSafeInteger(parsed.deliveryAttempt) || delivery !== `${parsed.messageId}:${parsed.deliveryAttempt}`) return false;
    const event = projectEvent(parsed, dependencies.config.mode);
    if (!event) return false;
    await dependencies.store.insert(event);
    return true;
  };
}

function projectEvent(envelope: Record<string, unknown>, mode: ImmersveConfig["mode"]): CardEvent | null {
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
    mode,
    messageId: envelope.messageId as string,
    topic,
    cardholderAccountId,
    cardId,
    paymentId,
  };
}

function identifier(value: unknown): string | null {
  return typeof value === "string" && ID.test(value) ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPublicRsaKey(value: unknown): value is PublicJwk {
  return isObject(value) && value.kty === "RSA" && identifier(value.kid) !== null &&
    typeof value.n === "string" && /^[A-Za-z0-9_-]{100,1024}$/.test(value.n) &&
    typeof value.e === "string" && /^[A-Za-z0-9_-]{1,12}$/.test(value.e) &&
    (value.use === undefined || value.use === "sig") && (value.alg === undefined || value.alg === "RS256");
}
