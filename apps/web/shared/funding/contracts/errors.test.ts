import { describe, expect, test } from "bun:test";
import { FUNDING_ERROR_CODES, isFundingErrorCode, readFundingErrorResponse, readFundingFailure } from "./errors";

describe("funding error contract", () => {
  const error = { error: { code: "CORRIDOR_NOT_OFFERED", message: "Peer is no longer offered here." } } as const;

  test("reads a declared corridor error and its message", () => {
    expect(FUNDING_ERROR_CODES).toContain("CORRIDOR_NOT_OFFERED");
    expect(isFundingErrorCode("CORRIDOR_NOT_OFFERED")).toBe(true);
    expect(readFundingErrorResponse(error)).toEqual(error);
  });

  test("accepts the session-boundary codes funding routes can forward", () => {
    for (const code of ["UNAUTHENTICATED", "AUTH_UNAVAILABLE", "BASE_ACCOUNT_DISABLED", "INVALID_ACCOUNT_PROVIDER", "AMBIGUOUS_AUTHENTICATION"] as const) {
      expect(readFundingErrorResponse({ error: { code, message: "Sign in again." } })).toEqual({ error: { code, message: "Sign in again." } });
    }
  });

  test("rejects malformed wire errors", () => {
    for (const body of [
      { error: { code: "UNKNOWN", message: "No." } },
      { error: { code: "CORRIDOR_NOT_OFFERED" } },
      { error: { code: "CORRIDOR_NOT_OFFERED", message: "" } },
      { error: { code: "CORRIDOR_NOT_OFFERED", message: "x".repeat(2001) } },
      { ...error, unexpected: true },
      { error: { ...error.error, unexpected: true } },
      null,
      [error],
    ]) expect(readFundingErrorResponse(body)).toBeNull();
  });

  test("reads declared account transport failures and bounds the server message", () => {
    expect(readFundingFailure({ code: "CORRIDOR_NOT_OFFERED", serverMessage: "Peer is no longer offered here." })).toEqual({
      code: "CORRIDOR_NOT_OFFERED", message: "Peer is no longer offered here.",
    });
    expect(readFundingFailure({ code: "UNKNOWN", serverMessage: "Ignored" })).toBeNull();
    expect(readFundingFailure({ code: "CORRIDOR_NOT_OFFERED", serverMessage: "x".repeat(201) })).toEqual({
      code: "CORRIDOR_NOT_OFFERED", message: null,
    });
  });
});
