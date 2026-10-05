import "server-only";

import { createHmac } from "node:crypto";
import { timingSafeEqualBytes } from "@/server/http/hmac";
import { emitServerEvent } from "@/server/observability/log";
import { HISTORY_CHAIN_ID, type HistoryStore } from "./history/types";
import type { BalanceSnapshotStore } from "./snapshot-store";
import type { SecretKeyring } from "@/server/secrets/at-rest";
import { openWebhookSecret } from "./webhook-secret";
import type { WebhookSubscriptionStore } from "./webhook-subscription-store";

const SIGNATURE_MAX_AGE_SECONDS = 5 * 60;
const SUBSCRIPTION_CACHE_MS = 60_000;
const HISTORY_DIRTY_ACK_TIMEOUT_MS = 2_000;
const HISTORY_DIRTY_WRITE_TIMEOUT_MS = 2_500;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const ADDRESS_FIELDS = new Set(["address", "matchedAddress", "from", "to", "transaction_from", "transaction_to"]);
const MATCHED_ADDRESS_FIELDS = new Set(["address", "matchedAddress"]);
const ACTIVITY_EVENTS = new Set(["wallet.activity.detected", "wallet.activity.multi", "wallet.activity"]);

export function createCdpWebhookHandler(dependencies: {
  store: Pick<BalanceSnapshotStore, "markStaleMany">;
  history: Pick<HistoryStore, "markDirty"> | null;
  subscriptions: Pick<WebhookSubscriptionStore, "list">;
  keyring: SecretKeyring | null;
  now?: () => Date;
  schedule?: (task: () => Promise<void>) => void;
  settleActions?: (addresses: readonly string[], signal: AbortSignal) => Promise<void>;
}) {
  const now = dependencies.now ?? (() => new Date());
  let cached: { at: number; records: Array<{ subscriptionId: string; secret: string }> } | null = null;
  let lastForcedListAt = Number.NEGATIVE_INFINITY;

  async function subscriptions(force = false): Promise<Array<{ subscriptionId: string; secret: string }>> {
    const current = now().getTime();
    if (!force && cached && current - cached.at <= SUBSCRIPTION_CACHE_MS) return cached.records;
    const rows = await dependencies.subscriptions.list();
    let unreadable = false;
    const records = rows.flatMap((row) => {
      const opened = openWebhookSecret(dependencies.keyring, row);
      if (!opened.ok) { unreadable = true; return []; }
      return [{ subscriptionId: row.subscriptionId, secret: opened.secret }];
    });
    if (unreadable) emitServerEvent("balances-webhook", {
      route: "/api/webhooks/cdp", code: "WEBHOOK_SECRET_UNREADABLE", outcome: "unavailable", durationMs: 0,
    });
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
    const matched = extractCdpActivityAddresses(payload, MATCHED_ADDRESS_FIELDS);
    const settleTargets = matched.length > 0 ? matched : addresses;
    if (settleTargets.length && dependencies.schedule && dependencies.settleActions) {
      const settleActions = dependencies.settleActions;
      try {
        dependencies.schedule(async () => {
          const settledAt = Date.now();
          try {
            await settleActions(settleTargets.slice(0, 50), AbortSignal.timeout(25_000));
          } catch {
            observe("unavailable", "WEBHOOK_SETTLE_UNAVAILABLE", settledAt);
          }
        });
      } catch {
        observe("unavailable", "WEBHOOK_SETTLE_UNAVAILABLE", startedAt);
      }
    }
    const history = dependencies.history;
    let historyDirtyTimeout: ReturnType<typeof setTimeout> | undefined;
    if (history) {
      const acknowledgement = new Promise<"timeout">((resolve) => {
        historyDirtyTimeout = setTimeout(() => resolve("timeout"), HISTORY_DIRTY_ACK_TIMEOUT_MS);
      });
      try {
        const outcome = await Promise.race([
          history.markDirty(HISTORY_CHAIN_ID, addresses, current, { timeoutMs: HISTORY_DIRTY_WRITE_TIMEOUT_MS }),
          acknowledgement,
        ]);
        if (outcome === "timeout") observe("unavailable", "WEBHOOK_HISTORY_DIRTY_TIMEOUT", startedAt);
      } catch {
        emitServerEvent("balances-webhook", {
          route: "/api/webhooks/cdp", code: "WEBHOOK_HISTORY_DIRTY_FAILED", outcome: "failed", durationMs: Date.now() - startedAt,
        });
      } finally {
        if (historyDirtyTimeout !== undefined) clearTimeout(historyDirtyTimeout);
      }
    }
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
    return timingSafeEqualBytes(candidate, expected);
  });
}

export function extractCdpActivityAddresses(payload: Record<string, unknown>, fields: ReadonlySet<string> = ADDRESS_FIELDS): `0x${string}`[] {
  const addresses = new Set<`0x${string}`>();
  visitDocumentedFields(payload, addresses, fields);
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

function visitDocumentedFields(value: unknown, addresses: Set<`0x${string}`>, fields: ReadonlySet<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) visitDocumentedFields(item, addresses, fields);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (fields.has(key)) collectAddressValue(child, addresses);
    if (isRecord(child) || Array.isArray(child)) visitDocumentedFields(child, addresses, fields);
  }
}

function collectAddressValue(value: unknown, addresses: Set<`0x${string}`>): void {
  const candidates = Array.isArray(value) ? value : [value];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && ADDRESS_PATTERN.test(candidate)) addresses.add(candidate.toLowerCase() as `0x${string}`);
  }
}

function observe(outcome: "accepted" | "rejected" | "ignored" | "unavailable", code: string, startedAt: number): void {
  emitServerEvent("balances-webhook", { route: "/api/webhooks/cdp", code, outcome, durationMs: Date.now() - startedAt });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
