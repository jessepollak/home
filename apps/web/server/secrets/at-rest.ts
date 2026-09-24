import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const SECRET_ENVELOPE_PATTERN = /^v[1-9][0-9]{0,8}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/;
const VERSION = /^[1-9][0-9]{0,8}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const keys = new WeakMap<SecretKeyring, { active: Buffer; previous: Buffer | null }>();

export class SecretKeyring {
  private constructor(readonly version: number) {}
  static create(version: number, active: Buffer, previous: Buffer | null): SecretKeyring {
    const keyring = new SecretKeyring(version);
    keys.set(keyring, { active, previous });
    return keyring;
  }
  toJSON() { return "[redacted keyring]"; }
}

type Environment = Readonly<Record<string, string | undefined>>;
export type SecretAad = { purpose: string; binding: Readonly<Record<string, string>> };
function decodeKey(value: string | undefined): Buffer | null {
  if (!value || !BASE64URL.test(value)) return null;
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === 32 && decoded.toString("base64url") === value ? decoded : null;
}
export function resolveSecretKeyring(env: Environment): { ok: true; keyring: SecretKeyring } | { ok: false; reason: "unset" | "invalid-key" | "invalid-version" | "invalid-previous" } {
  const active = env.HOME_SECRET_ENCRYPTION_KEY || undefined;
  const version = env.HOME_SECRET_KEY_VERSION || undefined;
  const previous = env.HOME_SECRET_ENCRYPTION_KEY_PREVIOUS || undefined;
  if (active === undefined && version === undefined && previous === undefined) return { ok: false, reason: "unset" };
  if (!VERSION.test(version ?? "")) return { ok: false, reason: "invalid-version" };
  const key = decodeKey(active);
  if (!key) return { ok: false, reason: "invalid-key" };
  const oldKey = previous === undefined ? null : decodeKey(previous);
  if (previous !== undefined && (Number(version) === 1 || !oldKey || oldKey.equals(key))) return { ok: false, reason: "invalid-previous" };
  return { ok: true, keyring: SecretKeyring.create(Number(version), key, oldKey) };
}
function associatedData(aad: SecretAad): Buffer {
  return Buffer.from(JSON.stringify(["home-secret-at-rest", aad.purpose, ...Object.entries(aad.binding).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)]));
}
export function envelopeKeyVersion(envelope: string): number | null {
  if (!SECRET_ENVELOPE_PATTERN.test(envelope)) return null;
  return Number(envelope.slice(1, envelope.indexOf(".")));
}
export function sealSecret(keyring: SecretKeyring, plaintext: string, aad: SecretAad): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keys.get(keyring)!.active, iv);
  cipher.setAAD(associatedData(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `v${keyring.version}.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}
export function openSecret(keyring: SecretKeyring, envelope: string, aad: SecretAad): { ok: true; plaintext: string } | { ok: false; reason: "malformed" | "unknown-version" | "unreadable" } {
  const version = envelopeKeyVersion(envelope);
  if (version === null) return { ok: false, reason: "malformed" };
  const pair = keys.get(keyring);
  const key = version === keyring.version ? pair?.active : version === keyring.version - 1 ? pair?.previous : null;
  if (!key) return { ok: false, reason: "unknown-version" };
  try {
    const [, ivText, tagText, ciphertextText] = envelope.split(".");
    const iv = Buffer.from(ivText!, "base64url");
    const tag = Buffer.from(tagText!, "base64url");
    const ciphertext = Buffer.from(ciphertextText!, "base64url");
    if (iv.toString("base64url") !== ivText || tag.toString("base64url") !== tagText || ciphertext.toString("base64url") !== ciphertextText || ciphertext.length === 0) return { ok: false, reason: "malformed" };
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(associatedData(aad));
    decipher.setAuthTag(tag);
    return { ok: true, plaintext: Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8") };
  } catch { return { ok: false, reason: "unreadable" }; }
}
