import { randomBytes } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { resolveSecretKeyring, sealSecret } from "@/server/secrets/at-rest";
import { openWebhookSecret, webhookSecretAad } from "./webhook-secret";
import type { WebhookSubscriptionRecord } from "./webhook-subscription-store";

function keyring(version: number) {
  const result = resolveSecretKeyring({ HOME_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64url"), HOME_SECRET_KEY_VERSION: String(version) });
  if (!result.ok) throw new Error("invalid fixture key");
  return result.keyring;
}
const active = keyring(1);
const secret = randomBytes(32).toString("base64url");
function row(id: string, key = active): WebhookSubscriptionRecord {
  const binding = { subscriptionId: id, target: "https://home.example/api/webhooks/cdp", eventType: "wallet_activity" };
  return { ...binding, createdAt: "2026-09-28T12:00:00.000Z", credential: { kind: "envelope", envelope: sealSecret(key, secret, webhookSecretAad(binding)), keyVersion: key.version } };
}

describe("balance webhook secret opening", () => {
  test("missing keyring fails closed without exposing plaintext", () => {
    const opened = openWebhookSecret(null, row("first"));
    expect(opened).toEqual({ ok: false, reason: "keyring-unavailable" });
    expect(JSON.stringify(opened)).not.toContain(secret);
  });

  test("tampering and incorrect keys are unreadable", () => {
    const sealed = row("first");
    const wrong = keyring(1);
    expect(openWebhookSecret(wrong, sealed)).toEqual({ ok: false, reason: "unreadable" });
    if (sealed.credential.kind !== "envelope") throw new Error("invalid fixture");
    const mutated = { ...sealed, credential: { ...sealed.credential, envelope: `${sealed.credential.envelope.slice(0, -1)}!` } };
    const opened = openWebhookSecret(active, mutated);
    expect(opened.ok).toBe(false);
    expect(JSON.stringify(opened)).not.toContain(secret);
  });

  test("unknown versions fail closed", () => {
    expect(openWebhookSecret(active, row("first", keyring(3)))).toEqual({ ok: false, reason: "unknown-version" });
  });

  test.each([
    { field: "target", value: "https://other.example/api/webhooks/cdp" },
    { field: "eventType", value: "another_event" },
  ] as const)("changing only $field makes a sealed webhook secret unreadable", ({ field, value }) => {
    const sealed = row("first");
    const changed = { ...sealed, [field]: value };
    const opened = openWebhookSecret(active, changed);
    expect(opened.ok).toBe(false);
    expect(JSON.stringify(opened)).not.toContain(secret);
  });

  test("swapping envelopes between subscription rows fails AAD authentication", () => {
    const first = row("first"), second = row("second");
    const swapped = [{ ...first, credential: second.credential }, { ...second, credential: first.credential }];
    expect(swapped.map((candidate) => openWebhookSecret(active, candidate).ok)).toEqual([false, false]);
    expect(JSON.stringify(swapped.map((candidate) => openWebhookSecret(active, candidate)))).not.toContain(secret);
  });
});
