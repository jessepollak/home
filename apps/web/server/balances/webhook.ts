import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { emitServerEvent } from "@/server/observability/log";
import type { BalanceSnapshotStore } from "./snapshot-store";
import type { WebhookSubscriptionRecord, WebhookSubscriptionStore } from "./webhook-subscription-store";

const SIGNATURE_MAX_AGE_SECONDS = 5 * 60;
const SUBSCRIPTION_CACHE_MS = 60_000;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const ADDRESS_FIELDS = new Set(["address", "matchedAddress", "from", "to", "transaction_from", "transaction_to"]);
const ACTIVITY_EVENTS = new Set(["wallet.activity.detected", "wallet.activity.multi", "wallet.activity"]);

export function createCdpWebhookHandler(dependencies: {
  store: Pick<BalanceSnapshotStore, "markStaleMany">;
  subscriptions: Pick<WebhookSubscriptionStore, "list">;
  now?: () => Date;
}) {
  const now = dependencies.now ?? (() => new Date());
  let cached: { at: number; records: WebhookSubscriptionRecord[] } | null = null;
  let lastForcedListAt = Number.NEGATIVE_INFINITY;

  async function subscriptions(force = false): Promise<WebhookSubscriptionRecord[]> {
    const current = now().getTime();
    if (!force && cached && current - cached.at <= SUBSCRIPTION_CACHE_MS) return cached.records;
    const records = await dependencies.subscriptions.list();
    cached = { at: current, records };
    return records;
  }

  return async function handleCdpWebhook(raw: Uint8Array, signatureHeader: string | null, headers: Headers = new Headers()): Promise<Response> {
    const startedAt = Date.now();
    const current = now();
    let payload: unknown = null;
    try {
      payload = JSON.parse(new TextDecoder().decode(raw)) as unknown;
    } catch {
      // Authenticate against every stored secret before reporting a body error.
    }

    let records = await subscriptions();
    const identified = isRecord(payload) ? readSubscriptionId(payload) : null;
    let matches = identified
      ? records.filter((record) => record.subscriptionId === identified)
      : records;
    if (
      identified &&
      matches.length === 0 &&
      current.getTime() - lastForcedListAt >= SUBSCRIPTION_CACHE_MS
    ) {
      lastForcedListAt = current.getTime();
      records = await subscriptions(true);
      matches = records.filter((record) => record.subscriptionId === identified);
    }
    const candidates = matches.length > 0 ? matches : records;
    if (candidates.length === 0 || !candidates.some((record) => verifyCdpWebhookSignature(raw, signatureHeader, record.secret, current, headers))) {
      observe("rejected", "WEBHOOK_SIGNATURE_REJECTED", startedAt);
      return Response.json({ accepted: false }, { status: 401 });
    }
    if (!isRecord(payload)) {
      observe("rejected", "WEBHOOK_BODY_REJECTED", startedAt);
      return Response.json({ accepted: false }, { status: 400 });
    }

    const eventType = readEventType(payload);
    if (!eventType || !ACTIVITY_EVENTS.has(eventType)) {
      observe("ignored", "WEBHOOK_EVENT_IGNORED", startedAt);
      return Response.json({ accepted: true }, { status: 200 });
    }

    const addresses = extractCdpActivityAddresses(payload);
    await dependencies.store.markStaleMany(8453, addresses, current);
    observe("accepted", "WEBHOOK_ACCEPTED", startedAt);
    return Response.json({ accepted: true }, { status: 200 });
  };
}

export function verifyCdpWebhookSignature(raw: Uint8Array, header: string | null, secret: string, now: Date, headers: Headers = new Headers()): boolean {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (Math.abs(nowSeconds - parsed.timestamp) > SIGNATURE_MAX_AGE_SECONDS) return false;
  const body = Buffer.from(raw);
  const candidates: Array<{ signature: string; payload: Uint8Array }> = [];
  if (parsed.v0) candidates.push({ signature: parsed.v0, payload: Buffer.concat([Buffer.from(`${parsed.timestamp}.`, "utf8"), body]) });
  if (parsed.v1.length > 0 && parsed.headerNames) {
    const payload = Buffer.concat([Buffer.from(`${parsed.timestamp}.${parsed.headerNames}.${parsed.headerNames.split(" ").map((name) => headers.get(name) ?? "").join(".")}.`, "utf8"), body]);
    for (const signature of parsed.v1) candidates.push({ signature, payload });
  }
  return candidates.some(({ signature, payload }) => {
    if (!/^[0-9a-fA-F]{64}$/.test(signature)) return false;
    const expected = createHmac("sha256", secret).update(payload).digest();
    const candidate = Buffer.from(signature, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

export function extractCdpActivityAddresses(payload: Record<string, unknown>): `0x${string}`[] {
  const addresses = new Set<`0x${string}`>();
  visitDocumentedFields(payload, addresses);
  return [...addresses];
}

function parseSignatureHeader(header: string | null): { timestamp: number; headerNames: string | null; v0: string | null; v1: string[] } | null {
  if (!header) return null;
  let timestamp: number | null = null;
  let headerNames: string | null = null;
  let v0: string | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const [rawKey, ...rest] = part.trim().split("=");
    const value = rest.join("=").trim();
    if (rawKey === "t" && /^\d{1,16}$/.test(value)) timestamp = Number(value);
    if (rawKey === "h" && /^[A-Za-z0-9-]+(?: [A-Za-z0-9-]+)*$/.test(value)) headerNames = value;
    if (rawKey === "v0" && value) v0 = value;
    if (rawKey === "v1" && value) v1.push(value);
  }
  return timestamp !== null && Number.isSafeInteger(timestamp) && (v0 !== null || v1.length > 0) ? { timestamp, headerNames, v0, v1 } : null;
}

function readSubscriptionId(payload: Record<string, unknown>): string | null {
  for (const key of ["subscriptionId", "subscription_id"]) {
    if (typeof payload[key] === "string" && payload[key].length <= 256) return payload[key];
  }
  return null;
}

function readEventType(payload: Record<string, unknown>): string | null {
  for (const key of ["eventType", "event_type", "type"]) if (typeof payload[key] === "string") return payload[key];
  return null;
}

function visitDocumentedFields(value: unknown, addresses: Set<`0x${string}`>): void {
  if (Array.isArray(value)) {
    for (const item of value) visitDocumentedFields(item, addresses);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (ADDRESS_FIELDS.has(key)) collectAddressValue(child, addresses);
    if (isRecord(child) || Array.isArray(child)) visitDocumentedFields(child, addresses);
  }
}

function collectAddressValue(value: unknown, addresses: Set<`0x${string}`>): void {
  const candidates = Array.isArray(value) ? value : [value];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && ADDRESS_PATTERN.test(candidate)) addresses.add(candidate.toLowerCase() as `0x${string}`);
  }
}

function observe(outcome: "accepted" | "rejected" | "ignored", code: string, startedAt: number): void {
  emitServerEvent("balances-webhook", { route: "/api/webhooks/cdp", code, outcome, durationMs: Date.now() - startedAt });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
