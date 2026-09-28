import { describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { parseCardEphemeralKeyRequest, parseCardEphemeralKeyResponse, parseCardWriteError } from "@/shared/cards/contract";
import { createCardRevealHandler } from "./reveal-handler";
import { CardWriteFailure } from "./write-service";

const session: VerifiedAccountSession = { accountProvider: "base-account", user: { subject: "owner" },
  smartAccount: { chainId: 8453, address: "0x1111111111111111111111111111111111111111" } };
const request = (body = '{"nonce":"nonce_synthetic123"}', headers: Record<string, string> = {}) => new Request("http://localhost/api/cards/ic_123/ephemeral-key", {
  method: "POST", body, headers: { origin: "http://localhost", "content-type": "application/json", "X-Home-Account-Provider": "base-account", ...headers },
});

describe("POST /api/cards/{id}/ephemeral-key", () => {
  test("parses strict nonce, session-only auth, and private secret-only contract", async () => {
    let received = "";
    const POST = createCardRevealHandler({ authorize: async () => session, customer: async () => ({ id: "owner-id" }),
      ephemeralKey: async (owner, id, nonce) => { received = `${owner}/${id}/${nonce}`; return "ek_test_synthetic123456"; } });
    const result = await POST(request(), "ic_123");
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(result.headers.get("referrer-policy")).toBe("no-referrer");
    expect(parseCardEphemeralKeyResponse(await result.json())).toEqual({ version: 1, cardId: "ic_123", ephemeralKeySecret: "ek_test_synthetic123456" });
    expect(received).toBe("owner-id/ic_123/nonce_synthetic123");
    for (const input of [{ nonce: "nonce_synthetic123", extra: "leak" }, { nonce: "x" }, { nonce: "nonce_abc def" }, { nonce: 3 }, []]) {
      expect(parseCardEphemeralKeyRequest(input)).toBeNull();
    }
  });
  test("accepts an authenticated CDP session without a smart account or fresh signature", async () => {
    const cdp: VerifiedAccountSession = { accountProvider: "cdp-embedded", user: { subject: "owner" }, smartAccount: null };
    const POST = createCardRevealHandler({ authorize: async () => cdp, customer: async () => ({ id: "owner-id" }),
      ephemeralKey: async () => "ek_test_synthetic123456" });
    const result = await POST(request('{"nonce":"nonce_synthetic123"}', { "X-Home-Account-Provider": "cdp-embedded" }), "ic_123");
    expect(result.status).toBe(200);
    expect(parseCardEphemeralKeyResponse(await result.json())?.cardId).toBe("ic_123");
  });
  test("refuses unauthorized, cross-origin, malformed body, unowned ID and provider error without disclosing a secret", async () => {
    let calls = 0;
    const deps = { customer: async () => ({ id: "owner-id" }), ephemeralKey: async () => { calls++; return "ek_test_synthetic123456"; } };
    const unauthorized = createCardRevealHandler({ ...deps, authorize: async () => Response.json({}, { status: 401 }) });
    expect((await unauthorized(request(), "ic_123")).status).toBe(401);
    const missing = createCardRevealHandler({ ...deps, authorize: async () => session, customer: async () => null });
    expect(parseCardWriteError(await (await missing(request(), "ic_123")).json())?.error.code).toBe("CARDS_UNAVAILABLE");
    const POST = createCardRevealHandler({ ...deps, authorize: async () => session });
    for (const [body, headers] of [
      ['{"nonce":"nonce_synthetic123"}', { origin: "http://evil.test" }],
      ['{"nonce":"nonce_synthetic123"}', { "sec-fetch-site": "cross-site" }],
      ['{"nonce":"nonce_synthetic123"}', { "content-type": "text/plain" }],
      ['{"nonce":"short"}', {}],
      ['{"nonce":"nonce_synthetic123","secret":"not-allowed"}', {}],
    ] as Array<[string, Record<string, string>]>) {
      const result = await POST(request(body, headers), "ic_123");
      expect(parseCardWriteError(await result.json())).not.toBeNull();
    }
    expect(parseCardWriteError(await (await POST(request(), "other")).json())?.error.code).toBe("CARD_NOT_FOUND");
    const denied = createCardRevealHandler({ authorize: async () => session, customer: deps.customer,
      ephemeralKey: async () => { throw new CardWriteFailure("CARD_NOT_READY", 409); } });
    const response = await denied(request(), "ic_123");
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("ek_test_");
    expect(calls).toBe(0);
  });
});
