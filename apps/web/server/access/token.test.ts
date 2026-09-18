import { describe, expect, test } from "bun:test";
import { issueAccessToken, readAccessToken } from "./token";

const PASSWORD_A = "a".repeat(32);
const PASSWORD_B = "b".repeat(32);
const NOW = new Date("2026-09-18T12:00:00.000Z");

describe("deployment access token", () => {
  test("contains only version and bounded issuance timestamps", () => {
    const token = issueAccessToken(PASSWORD_A, NOW);
    expect(readAccessToken(token, PASSWORD_A, NOW)).toEqual({
      version: 1,
      issuedAt: NOW.toISOString(),
      expiresAt: "2026-09-25T12:00:00.000Z",
    });
  });

  test("expires after seven days and is invalidated by password rotation", () => {
    const token = issueAccessToken(PASSWORD_A, NOW);
    expect(readAccessToken(token, PASSWORD_B, NOW)).toBeNull();
    expect(readAccessToken(token, PASSWORD_A, new Date("2026-09-25T12:00:00.000Z"))).toBeNull();
  });

  test("rejects tampering and future-issued tokens", () => {
    const token = issueAccessToken(PASSWORD_A, NOW);
    expect(readAccessToken(`${token}x`, PASSWORD_A, NOW)).toBeNull();
    expect(readAccessToken(token, PASSWORD_A, new Date("2026-09-18T11:59:59.999Z"))).toBeNull();
  });
});
