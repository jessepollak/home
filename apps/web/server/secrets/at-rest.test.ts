import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { envelopeKeyVersion, openSecret, resolveSecretKeyring, sealSecret } from "./at-rest";
const key = () => randomBytes(32).toString("base64url");
const active = key(), old = key(), other = key();
const env = (version = "2", secret = active, previous: string | null = old) => ({ HOME_SECRET_KEY_VERSION: version, HOME_SECRET_ENCRYPTION_KEY: secret, ...(previous === null ? {} : { HOME_SECRET_ENCRYPTION_KEY_PREVIOUS: previous }) });
const ring = (value: ReturnType<typeof env>) => { const resolved = resolveSecretKeyring(value); if (!resolved.ok) throw new Error("invalid test keyring"); return resolved.keyring; };
const aad = (destination: string, owner = "a", sandbox = "false") => ({ purpose: "funding-provider-user-token", binding: { destination, owner, sandbox } });
const binding = aad("0x1111111111111111111111111111111111111111");
test("authenticated round trip, active writes, previous-only reads, and tamper rejection", () => {
  const current = ring(env());
  const ciphertext = sealSecret(current, "synthetic-token", binding);
  expect(envelopeKeyVersion(ciphertext)).toBe(2);
  expect(openSecret(current, ciphertext, binding)).toEqual({ ok: true, plaintext: "synthetic-token" });
  const previous = sealSecret(ring(env("1", old, null)), "previous-token", binding);
  expect(openSecret(current, previous, binding)).toEqual({ ok: true, plaintext: "previous-token" });
  expect(openSecret(ring(env("3", other, active)), previous, binding)).toEqual({ ok: false, reason: "unknown-version" });
  expect(openSecret(ring(env("2", other, old)), ciphertext, binding)).toEqual({ ok: false, reason: "unreadable" });
  for (const field of [1, 2, 3]) {
    const parts = ciphertext.split(".");
    parts[field] = (parts[field]![0] === "A" ? "B" : "A") + parts[field]!.slice(1);
    expect(openSecret(current, parts.join("."), binding).ok).toBe(false);
  }
  for (const swapped of [aad("0x2222222222222222222222222222222222222222"), aad(binding.binding.destination, "b"), aad(binding.binding.destination, "a", "true")]) {
    expect(openSecret(current, ciphertext, swapped)).toEqual({ ok: false, reason: "unreadable" });
  }
  expect(openSecret(current, "plaintext", binding)).toEqual({ ok: false, reason: "malformed" });
  expect(openSecret(current, ciphertext.replace(/^v2/, "v9"), binding)).toEqual({ ok: false, reason: "unknown-version" });
  expect(JSON.stringify(current)).not.toContain(active);
});
test("keyring rejects partial, padded, invalid length, alphabet, version and previous", () => {
  expect(resolveSecretKeyring({})).toEqual({ ok: false, reason: "unset" });
  expect(resolveSecretKeyring({ HOME_SECRET_ENCRYPTION_KEY: "", HOME_SECRET_KEY_VERSION: "", HOME_SECRET_ENCRYPTION_KEY_PREVIOUS: "" })).toEqual({ ok: false, reason: "unset" });
  const emptyPrevious = resolveSecretKeyring(env("1", active, ""));
  expect(emptyPrevious.ok).toBe(true);
  if (!emptyPrevious.ok) throw new Error("invalid test keyring");
  const previousEnvelope = sealSecret(ring(env("1", old, null)), "old-token", binding);
  const versionTwo = resolveSecretKeyring(env("2", active, ""));
  expect(versionTwo.ok).toBe(true);
  if (!versionTwo.ok) throw new Error("invalid test keyring");
  expect(openSecret(versionTwo.keyring, previousEnvelope, binding)).toEqual({ ok: false, reason: "unknown-version" });
  expect(resolveSecretKeyring({ HOME_SECRET_ENCRYPTION_KEY: active, HOME_SECRET_KEY_VERSION: "" })).toEqual({ ok: false, reason: "invalid-version" });
  expect(resolveSecretKeyring({ HOME_SECRET_ENCRYPTION_KEY: "", HOME_SECRET_KEY_VERSION: "1" })).toEqual({ ok: false, reason: "invalid-key" });
  for (const bad of ["abc", active + "=", active.replace(/./, "+")]) expect(resolveSecretKeyring(env("2", bad))).toEqual({ ok: false, reason: "invalid-key" });
  for (const bad of ["0", "01", "1000000000", "nope"]) expect(resolveSecretKeyring(env(bad))).toEqual({ ok: false, reason: "invalid-version" });
  expect(resolveSecretKeyring(env("1"))).toEqual({ ok: false, reason: "invalid-previous" });
  expect(resolveSecretKeyring(env("2", active, active))).toEqual({ ok: false, reason: "invalid-previous" });
  expect(resolveSecretKeyring(env("2", active, "abc"))).toEqual({ ok: false, reason: "invalid-previous" });
});
