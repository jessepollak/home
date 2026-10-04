import { expect, test } from "bun:test";
import { NATIVE_BASE_CHALLENGE_VERSION, parseNativeBaseChallenge } from "./base-nonce";

const challenge = {
  nonce: "a".repeat(48),
  chainId: 8453 as const,
  domain: "home.example",
  uri: "https://home.example",
  version: NATIVE_BASE_CHALLENGE_VERSION,
  statement: "Sign in to Home." as const,
  issuedAt: "2026-09-12T12:00:00.000Z",
  expirationTime: "2026-09-12T12:05:00.000Z",
};

test("challenge preserves exact fields, canonical dates, TTL, and origin binding", () => {
  expect(parseNativeBaseChallenge(challenge)).toEqual(challenge);
  for (const value of [
    null, [], { ...challenge, extra: true },
    ...Object.keys(challenge).map((key) => Object.fromEntries(Object.entries(challenge).filter(([name]) => name !== key))),
    { ...challenge, nonce: "A".repeat(48) },
    { ...challenge, nonce: "a".repeat(47) },
    { ...challenge, chainId: 1 },
    { ...challenge, version: 1 },
    { ...challenge, statement: "Another statement" },
    { ...challenge, domain: "" },
    { ...challenge, domain: "a".repeat(256) },
    { ...challenge, issuedAt: "2026-09-12T12:00:00Z" },
    { ...challenge, expirationTime: "2026-09-12T12:05:00+00:00" },
    { ...challenge, issuedAt: "not-a-date" },
    { ...challenge, expirationTime: "2026-09-12T12:04:59.999Z" },
    { ...challenge, expirationTime: challenge.issuedAt },
    { ...challenge, domain: "elsewhere.example" },
    { ...challenge, uri: "https://home.example/" },
    { ...challenge, uri: "https://home.example/path" },
    { ...challenge, uri: "ftp://home.example" },
    { ...challenge, uri: "not-a-url" },
  ]) expect(parseNativeBaseChallenge(value)).toBeNull();
  expect(parseNativeBaseChallenge({ ...challenge, uri: "http://home.example:3103" })).toEqual({
    ...challenge, uri: "http://home.example:3103",
  });
});
