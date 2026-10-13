import { describe, expect, test } from "bun:test";
import { createCardsHandler } from "./handler";
import { readCardState } from "./journey";
import { fakeProgram } from "@/tests/cards/fake-program";
import { CARDS_CONTRACT_VERSION, parseCardsResponse, type CardsResponse } from "@/shared/cards/contract";
import type { VerifiedAccountSession } from "@/shared/account/session-types";

const session: VerifiedAccountSession = { accountProvider: "base-account", user: { subject: "owner" },
  smartAccount: { chainId: 8453, address: "0x1111111111111111111111111111111111111111" } };
const response: CardsResponse = { version: CARDS_CONTRACT_VERSION, state: "not-enrolled", cards: [],
  provenance: { program: null, account: "not-requested", cards: "not-requested", fetchedAt: "2026-09-28T12:00:00.000Z" } };

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
    expect(parseCardsResponse({ ...response, version: 1 })).toBeNull();
    expect(parseCardsResponse({ ...response, state: "unknown" })).toBeNull();
  });
  test("mismatched-holder card reads return a parseable unavailable response", async () => {
    const link = { customerId: "customer-A", mode: "sandbox" as const, provider: "bridge" as const, accountId: "account", cardholderId: "holder",
      cards: [{ id: "11111111-1111-4111-8111-111111114821", providerCardId: "ic_fixture", walletAddress: "0x1111111111111111111111111111111111111111" }] };
    const { program } = fakeProgram({ readAccount: async () => ({ status: "ready", cardholderId: "holder", link: {} }),
      readCards: async () => [{ providerCardId: "ic_fixture", ok: true,
        card: { providerCardId: "ic_fixture", cardholderId: "other", status: "active", last4: "4821" } }] });
    const GET = createCardsHandler({ authorize: async () => session, customer: async () => ({ id: "customer-A" }),
      read: (id) => readCardState(id, "sandbox", { store: { read: async () => link }, programFor: async () => program }) });
    const result = await GET(request());
    expect(result.status).toBe(200);
    expect(parseCardsResponse(await result.json())).toMatchObject({ state: "unavailable", cards: [], provenance: { cards: "unavailable" } });
  });
  test("stored holder rejects fresh mismatched-holder card reads with a parseable unavailable response", async () => {
    const link = { customerId: "customer-A", mode: "sandbox" as const, provider: "bridge" as const, accountId: "account", cardholderId: "holder",
      cards: [{ id: "11111111-1111-4111-8111-111111114821", providerCardId: "ic_fixture", walletAddress: "0x1111111111111111111111111111111111111111" }] };
    const { program } = fakeProgram({ readAccount: async () => ({ status: "unavailable", cardholderId: "other", link: {} }),
      readCards: async () => [{ providerCardId: "ic_fixture", ok: true,
        card: { providerCardId: "ic_fixture", cardholderId: "other", status: "active", last4: "4821" } }] });
    const GET = createCardsHandler({ authorize: async () => session, customer: async () => ({ id: "customer-A" }),
      read: (id) => readCardState(id, "sandbox", { store: { read: async () => link }, programFor: async () => program }) });
    const result = await GET(request());
    expect(result.status).toBe(200);
    expect(parseCardsResponse(await result.json())).toMatchObject({ state: "unavailable", cards: [], provenance: { cards: "unavailable" } });
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
    expect(await result.json()).toEqual({ version: 2, error: { code: "CARDS_UNAVAILABLE" } });
    expect(reads).toBe(0);
  });
});
