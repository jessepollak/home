import { describe, expect, test } from "bun:test";
import { issueAccessToken, readAccessToken } from "./token";

const CREDENTIAL_A = "a".repeat(8);
const CREDENTIAL_B = "b".repeat(8);
const SIGNING_SECRET_A = "s".repeat(32);
const SIGNING_SECRET_B = "t".repeat(32);
const SIGNER_A = { credential: CREDENTIAL_A, signingSecret: SIGNING_SECRET_A };
const NOW = new Date("2026-09-18T12:00:00.000Z");

describe("deployment access token", () => {
  test("contains only version and bounded issuance timestamps", () => {
    const token = issueAccessToken(SIGNER_A, NOW);
    expect(readAccessToken(token, SIGNER_A, NOW)).toEqual({
      version: 1,
      issuedAt: NOW.toISOString(),
      expiresAt: "2026-09-25T12:00:00.000Z",
    });
  });

  test("is invalidated by rotation of either the credential or signing secret", () => {
    const token = issueAccessToken(SIGNER_A, NOW);
    expect(readAccessToken(token, {
      credential: CREDENTIAL_B,
      signingSecret: SIGNING_SECRET_A,
    }, NOW)).toBeNull();
    expect(readAccessToken(token, {
      credential: CREDENTIAL_A,
      signingSecret: SIGNING_SECRET_B,
    }, NOW)).toBeNull();
  });

  test("expires after seven days", () => {
    const token = issueAccessToken(SIGNER_A, NOW);
    expect(readAccessToken(token, SIGNER_A, new Date("2026-09-25T12:00:00.000Z")))
      .toBeNull();
  });

  test("rejects tampering and future-issued tokens", () => {
    const token = issueAccessToken(SIGNER_A, NOW);
    expect(readAccessToken(`${token}x`, SIGNER_A, NOW)).toBeNull();
    expect(readAccessToken(token, SIGNER_A, new Date("2026-09-18T11:59:59.999Z")))
      .toBeNull();
  });
});
