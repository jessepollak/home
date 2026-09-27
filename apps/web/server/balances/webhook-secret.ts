import "server-only";

import { openSecret, type SecretAad, type SecretKeyring } from "@/server/secrets/at-rest";
import type { WebhookSubscriptionRecord } from "./webhook-subscription-store";

export function webhookSecretAad(row: Pick<WebhookSubscriptionRecord, "subscriptionId" | "target" | "eventType">): SecretAad {
  return { purpose: "balances-webhook-signing-secret", binding: { subscriptionId: row.subscriptionId, target: row.target, eventType: row.eventType } };
}

export function canOpenWebhookSecret(keyring: SecretKeyring | null, row: WebhookSubscriptionRecord): boolean {
  return openWebhookSecret(keyring, row).ok;
}

export function openWebhookSecret(keyring: SecretKeyring | null, row: WebhookSubscriptionRecord): { ok: true; secret: string } | { ok: false; reason: string } {
  try {
    if (row.credential.kind === "legacy-plaintext") return { ok: true, secret: row.credential.secret };
    if (!keyring) return { ok: false, reason: "keyring-unavailable" };
    const opened = openSecret(keyring, row.credential.envelope, webhookSecretAad(row));
    return opened.ok ? { ok: true, secret: opened.plaintext } : { ok: false, reason: opened.reason };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
