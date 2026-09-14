import { describe, expect, test } from "bun:test";
import { jsonResponse } from "@/tests/helpers/http";
import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";
import {
  clearNativeBaseSession,
  requestNativeBaseChallenge,
  restoreNativeBaseSession,
  verifyNativeBaseChallenge,
  type NativeBaseFetch,
} from "./native-base-session-client";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;

function session() {
  return {
    user: { subject: "base-subject" },
    smartAccount: { address: ADDRESS, chainId: 8453 as const },
    accountProvider: "base-account" as const,
  };
}

describe("native Base session restoration", () => {
  test("restores only the native provider through a private same-origin request", async () => {
    let input: RequestInfo | URL | undefined;
    let init: RequestInit | undefined;
    const fetchFixture: NativeBaseFetch = async (nextInput, nextInit) => {
      input = nextInput;
      init = nextInit;
      return jsonResponse(session());
    };

    expect(await restoreNativeBaseSession(fetchFixture)).toEqual(session());
    expect(input).toBe("/api/session");
    expect(init?.method).toBe("GET");
    expect(init?.credentials).toBe("same-origin");
    expect(init?.cache).toBe("no-store");
    expect(new Headers(init?.headers).get(ACCOUNT_PROVIDER_HEADER)).toBe("base-account");
  });

  test("distinguishes a confirmed signed-out response from unavailable restoration", async () => {
    expect(await restoreNativeBaseSession(async () => jsonResponse({}, 401))).toBeNull();

    for (const fetchFixture of [
      async () => jsonResponse({ error: { code: "AUTH_UNAVAILABLE" } }, 503),
      async () => jsonResponse({ malformed: true }),
      async () => { throw new Error("fixture transport failure"); },
    ]) {
      await expect(
        restoreNativeBaseSession(fetchFixture),
      ).rejects.toThrow("Native Base authentication failed.");
    }
  });
});

describe("native Base challenge and verification", () => {
  test("requests an address-independent challenge and verifies address, message, and signature", async () => {
    const challenge = {
      nonce: "a".repeat(48),
      chainId: 8453 as const,
      domain: "home.example",
      uri: "https://home.example",
      version: "1" as const,
      statement: "Sign in to Home." as const,
      issuedAt: "2026-09-13T12:00:00.000Z",
      expirationTime: "2026-09-13T12:05:00.000Z",
    };
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const fetchFixture: NativeBaseFetch = async (input, init) => {
      requests.push({ input: String(input), init });
      return requests.length === 1 ? jsonResponse(challenge) : jsonResponse(session());
    };

    expect(await requestNativeBaseChallenge(fetchFixture)).toEqual(challenge);
    expect(requests[0]?.input).toBe("/api/auth/base/nonce");
    expect(requests[0]?.init?.body).toBe("{}");

    await expect(verifyNativeBaseChallenge(
      ADDRESS,
      "signed message",
      "0x1234",
      fetchFixture,
    )).resolves.toEqual(session());
    expect(requests[1]?.input).toBe("/api/auth/base/verify");
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
      address: ADDRESS,
      message: "signed message",
      signature: "0x1234",
    });
  });
});

describe("native Base sign-out", () => {
  test("is never pinned to the serving deployment", async () => {
    const previous = process.env.NEXT_DEPLOYMENT_ID;
    process.env.NEXT_DEPLOYMENT_ID = "dpl_stale";
    try {
      let captured: RequestInit | undefined;
      const fetchFixture: NativeBaseFetch = async (_input, init) => {
        captured = init;
        return jsonResponse({ signedOut: true }, 200);
      };
      await clearNativeBaseSession(fetchFixture);
      expect(new Headers(captured?.headers).has("x-deployment-id")).toBe(false);
      expect(captured?.credentials).toBe("same-origin");
    } finally {
      if (previous === undefined) delete process.env.NEXT_DEPLOYMENT_ID;
      else process.env.NEXT_DEPLOYMENT_ID = previous;
    }
  });
});
