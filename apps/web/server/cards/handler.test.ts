import { describe, expect, test } from "bun:test";
import { createCardsHandler } from "./handler";
import { CARDS_CONTRACT_VERSION, parseCardsResponse, type CardsResponse } from "@/shared/cards/contract";
import type { VerifiedAccountSession } from "@/shared/account/session-types";

const session: VerifiedAccountSession = { accountProvider: "base-account", user: { subject: "owner" },
  smartAccount: { chainId: 8453, address: "0x1111111111111111111111111111111111111111" } };
const response: CardsResponse = { version: CARDS_CONTRACT_VERSION, state: "not-enrolled", cards: [],
  provenance: { bridge: "not-requested", stripe: "not-requested", fetchedAt: "2026-09-28T12:00:00.000Z" } };

const request = () => new Request("http://localhost/api/cards", { headers: { "X-Home-Account-Provider": "base-account" } });

describe("GET /api/cards", () => {
  test("session owner is resolved before the scoped read and contract parses", async () => {
    let received = "";
    const GET = createCardsHandler({ authorize: async () => session, customer: async (owner) => {
      expect(owner).toEqual(session); return { id: "customer-A" };
    }, read: async (id) => { received = id; return response; } });
    const result = await GET(request());
    expect(received).toBe("customer-A");
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toContain("no-store");
    expect(parseCardsResponse(await result.json())).toEqual(response);
    expect(parseCardsResponse({ ...response, version: 2 })).toBeNull();
    expect(parseCardsResponse({ ...response, state: "unknown" })).toBeNull();
  });
  test("rejects unauthorized and unresolved owners without reading another account", async () => {
    let reads = 0;
    const unauthorized = createCardsHandler({ authorize: async () => Response.json({}, { status: 401 }),
      customer: async () => { throw new Error("unexpected"); }, read: async () => { reads++; return response; } });
    expect((await unauthorized(request())).status).toBe(401);
    const unresolved = createCardsHandler({ authorize: async () => session,
      customer: async () => null, read: async () => { reads++; return response; } });
    const result = await unresolved(request());
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ version: 1, error: { code: "CARDS_UNAVAILABLE" } });
    expect(reads).toBe(0);
  });
});
