import { describe, expect, test } from "bun:test";
import {
  getVisibleVerifiedSession,
  normalizeProjectId,
  validateAccountSession,
  type SessionFetch,
  type VerifiedSessionOwner,
} from "./session-client";
import {
  ACCOUNT_PROVIDER_HEADER,
  isBaseAccountEnabled,
} from "@/shared/account/session-types";

const TEST_ADDRESS = "0x1111111111111111111111111111111111111111";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("account project configuration", () => {
  test("treats missing and blank project IDs as unavailable", () => {
    expect(normalizeProjectId(undefined)).toBeNull();
    expect(normalizeProjectId("   ")).toBeNull();
    expect(normalizeProjectId(" test-project ")).toBe("test-project");
  });

  test("enables Base Account only for the explicit operator value", () => {
    expect(isBaseAccountEnabled(undefined)).toBe(false);
    expect(isBaseAccountEnabled("")).toBe(false);
    expect(isBaseAccountEnabled("true")).toBe(false);
    expect(isBaseAccountEnabled("1")).toBe(true);
  });
});

describe("session validation boundary", () => {
  test("uses the bearer token only in a private same-origin session request", async () => {
    let capturedInput: RequestInfo | URL | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchFixture: SessionFetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      capturedInput = input;
      capturedInit = init;
      return jsonResponse({
        user: { subject: "cdp:test-subject" },
        smartAccount: { address: TEST_ADDRESS, chainId: 8453 },
        accountProvider: "cdp-embedded",
      });
    };

    const session = await validateAccountSession(
      "test-access-token",
      undefined,
      fetchFixture,
    );

    expect(capturedInput).toBe("/api/session");
    expect(capturedInit?.method).toBe("GET");
    expect(capturedInit?.cache).toBe("no-store");
    expect(capturedInit?.credentials).toBe("same-origin");
    expect(
      new Headers(capturedInit?.headers).get("Authorization"),
    ).toBe("Bearer test-access-token");
    expect(session.smartAccount?.address).toBe(TEST_ADDRESS);
    expect(session.accountProvider).toBe("cdp-embedded");
  });

  test("requests Base mode without sending an expected browser address and rejects a server address mismatch", async () => {
    let capturedHeaders = new Headers();
    const fetchFixture: SessionFetch = async (_input, init) => {
      capturedHeaders = new Headers(init?.headers);
      return jsonResponse({
        user: { subject: "cdp:siwe-subject" },
        smartAccount: {
          address: "0x2222222222222222222222222222222222222222",
          chainId: 8453,
        },
        accountProvider: "base-account",
      });
    };

    await expect(
      validateAccountSession(
        "test-access-token",
        undefined,
        fetchFixture,
        {
          accountProvider: "base-account",
          expectedAddress: TEST_ADDRESS,
        },
      ),
    ).rejects.toMatchObject({ reason: "address-mismatch" });
    expect(capturedHeaders.get(ACCOUNT_PROVIDER_HEADER)).toBe("base-account");
    expect([...capturedHeaders.keys()]).not.toContain("x-home-account-address");
  });

  test("accepts an unambiguous provider selected by the server during restoration", async () => {
    let capturedProvider: string | null = null;
    const fetchFixture: SessionFetch = async (_input, init) => {
      capturedProvider = new Headers(init?.headers).get(ACCOUNT_PROVIDER_HEADER);
      return jsonResponse({
        user: { subject: "cdp:siwe-subject" },
        smartAccount: { address: TEST_ADDRESS, chainId: 8453 },
        accountProvider: "base-account",
      });
    };

    const session = await validateAccountSession(
      "test-access-token",
      undefined,
      fetchFixture,
      { accountProvider: "restore" },
    );

    expect(capturedProvider as unknown).toBe("restore");
    expect(session.accountProvider).toBe("base-account");
  });

  test("accepts a verified session whose smart account is not ready", async () => {
    const fetchFixture: SessionFetch = async () =>
      jsonResponse({
        user: { subject: "cdp:test-subject" },
        smartAccount: null,
        accountProvider: "cdp-embedded",
      });

    const session = await validateAccountSession(
      "test-access-token",
      undefined,
      fetchFixture,
    );

    expect(session.smartAccount).toBeNull();
  });

  test("fails closed for unauthorized and malformed responses", async () => {
    const unauthorizedFetch: SessionFetch = async () =>
      jsonResponse(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "Test fixture rejection",
          },
        },
        401,
      );
    const malformedFetch: SessionFetch = async () =>
      jsonResponse({
        user: { subject: "cdp:test-subject" },
        smartAccount: { address: TEST_ADDRESS, chainId: 1 },
        accountProvider: "cdp-embedded",
      });

    expect(
      validateAccountSession(
        "test-access-token",
        undefined,
        unauthorizedFetch,
      ),
    ).rejects.toMatchObject({ reason: "unauthenticated" });
    expect(
      validateAccountSession("test-access-token", undefined, malformedFetch),
    ).rejects.toMatchObject({ reason: "invalid-response" });
  });
});

describe("private account cleanup", () => {
  const verified: VerifiedSessionOwner = {
    ownerKey: "sdk-user-a",
    session: {
      user: { subject: "cdp:test-subject" },
      smartAccount: { address: TEST_ADDRESS, chainId: 8453 },
      accountProvider: "cdp-embedded",
    },
  };

  test("hides verified details immediately on logout or SDK user switch", () => {
    expect(getVisibleVerifiedSession(verified, "sdk-user-a", false)).toEqual(
      verified.session,
    );
    expect(getVisibleVerifiedSession(verified, "sdk-user-b", false)).toBeNull();
    expect(getVisibleVerifiedSession(verified, "sdk-user-a", true)).toBeNull();
    expect(getVisibleVerifiedSession(verified, null, false)).toBeNull();
  });
});
