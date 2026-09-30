import { describe, expect, test } from "bun:test";
import { createBridgeClient, parseBridgeCustomer } from "./client";
import { readCardJourneyConfig } from "./journey-config";
import { fetchFakeBridge, fixtureCustomer, startFakeBridge } from "@/tests/cards/fake-bridge";

const env = { BRIDGE_CARDS_ENABLED: "1", BRIDGE_MODE: "sandbox", [["BRIDGE", "API_KEY"].join("_")]: "fake-key",
  BRIDGE_STRIPE_SECRET_KEY: "sk_test_fake", BRIDGE_STRIPE_API_VERSION: "2026-08-26.dahlia", BRIDGE_STRIPE_CARD_FUNDING: "crypto_wallet" };

describe("Bridge client", () => {
  test("fetches the documented customer shape over HTTP with Api-Key", async () => {
    const fake = startFakeBridge("fake-key");
    try {
      const config = readCardJourneyConfig({ ...env, BRIDGE_API_BASE_URL: fake.origin });
      expect(config).not.toBeNull();
      const customer = await createBridgeClient(config!, fetchFakeBridge).readCustomer(fixtureCustomer.id);
      expect(customer.cardsEndorsement).toEqual({ status: "approved", missing: false, pending: false, issues: false });
      expect(customer.stripeCardholderId).toBe(fixtureCustomer.stripe_cardholder_id);
      await expect(createBridgeClient({ ...config!, bridgeApiKey: "incorrect" }, fetchFakeBridge).readCustomer(fixtureCustomer.id)).rejects.toThrow("404");
    } finally { await fake.stop(); }
  });
  test("does not fetch a customer when the eligibility signal is already aborted", async () => {
    let requests = 0;
    const controller = new AbortController();
    controller.abort();
    const config = readCardJourneyConfig(env);
    expect(config).not.toBeNull();
    const client = createBridgeClient(config!, (async () => { requests++; return Response.json(fixtureCustomer); }) as unknown as typeof fetch);
    await expect(client.readCustomer(fixtureCustomer.id, controller.signal)).rejects.toThrow();
    expect(requests).toBe(0);
  });
  test("parses documented customer and endorsement statuses, rejecting unknowns and malformed requirements", () => {
    for (const status of ["not_started", "incomplete", "awaiting_questionnaire", "awaiting_ubo", "under_review", "active", "rejected", "paused", "offboarded", "deposits_restricted"] as const) {
      expect(parseBridgeCustomer({ ...fixtureCustomer, status }).status).toBe(status);
    }
    for (const status of ["approved", "incomplete", "revoked"] as const) {
      expect(parseBridgeCustomer({ ...fixtureCustomer, endorsements: [{ ...fixtureCustomer.endorsements[0], status }] }).cardsEndorsement?.status).toBe(status);
    }
    for (const status of ["pending", "inactive", "unknown"]) expect(() => parseBridgeCustomer({ ...fixtureCustomer, status })).toThrow();
    for (const status of ["pending", "rejected", "unknown"])
      expect(() => parseBridgeCustomer({ ...fixtureCustomer, endorsements: [{ ...fixtureCustomer.endorsements[0], status }] })).toThrow();
    expect(parseBridgeCustomer({ ...fixtureCustomer, endorsements: [{ ...fixtureCustomer.endorsements[0], requirements: { complete: [], pending: [], missing: { all_of: ["terms_of_service_v1"] }, issues: [{ id_front_photo: "id_expired" }] } }] }).cardsEndorsement)
      .toEqual({ status: "approved", missing: true, pending: false, issues: true });
    expect(() => parseBridgeCustomer({ ...fixtureCustomer, endorsements: [{ name: "cards", status: "approved" }] })).toThrow();
    expect(() => parseBridgeCustomer({ ...fixtureCustomer, endorsements: [{ ...fixtureCustomer.endorsements[0], requirements: { pending: [], missing: [], issues: [] } }] })).toThrow();
  });
  test("rejects mismatched Bridge customer ID", async () => {
    const fake = startFakeBridge("fake-key", { ...fixtureCustomer, id: "ffffffff-ffff-ffff-ffff-ffffffffffff" });
    try {
      const config = readCardJourneyConfig({ ...env, BRIDGE_API_BASE_URL: fake.origin });
      await expect(createBridgeClient(config!, fetchFakeBridge).readCustomer(fixtureCustomer.id)).rejects.toThrow("mismatch");
    } finally { await fake.stop(); }
  });
  test("rejects an oversized Bridge HTTP response", async () => {
    const fake = startFakeBridge("fake-key", { ...fixtureCustomer, padding: "x".repeat(64 * 1024) });
    try {
      const config = readCardJourneyConfig({ ...env, BRIDGE_API_BASE_URL: fake.origin });
      await expect(createBridgeClient(config!, fetchFakeBridge).readCustomer(fixtureCustomer.id)).rejects.toThrow("response too large");
    } finally { await fake.stop(); }
  });
  test("creates a customer idempotently then obtains a hosted cards KYC link", async () => {
    const fake = startFakeBridge("fake-key", { ...fixtureCustomer, status: "not_started", stripe_cardholder_id: null, endorsements: [] });
    try {
      const config = readCardJourneyConfig({ ...env, BRIDGE_API_BASE_URL: fake.origin })!;
      const client = createBridgeClient(config, fetchFakeBridge);
      const created = await client.createCustomer("11111111-1111-4111-8111-111111111111");
      expect(created.id).toBe(fixtureCustomer.id);
      expect(created.stripeCardholderId).toBeNull();
      const redirectUri = "https://home.example/card?return=verification&flow=a%20b";
      const link = new URL(await client.cardsKycLink(created.id, redirectUri));
      expect(link.origin).toBe("https://bridge.withpersona.com");
      expect(link.searchParams.get("redirect_uri")).toBe(redirectUri);
      expect(link.searchParams.get("inquiry-id")).toBe("inq_test");
      expect(new URL(await client.cardsKycLink(created.id, "http://127.0.0.1:3199/card?return=verification")).searchParams.get("redirect_uri"))
        .toBe("http://127.0.0.1:3199/card?return=verification");
      expect(await client.readCustomer(created.id)).toEqual(created);
    } finally { await fake.stop(); }
  });
  test("rejects unsafe return URLs before Bridge egress", async () => {
    const config = readCardJourneyConfig(env)!;
    let calls = 0;
    const fetcher = (async () => { calls++; return Response.json({ url: "https://bridge.withpersona.com/inquiry" }); }) as unknown as typeof fetch;
    const sandbox = createBridgeClient(config, fetcher);
    const production = createBridgeClient({ ...config, mode: "production" }, fetcher);
    for (const redirect of ["http://home.example/card", "http://example.test/card", "javascript:alert(1)", "ftp://home.example/card", "https://user:pass@home.example/card", "https://home.example/card#fragment", "/card?return=verification"])
      await expect(sandbox.cardsKycLink(fixtureCustomer.id, redirect)).rejects.toThrow("return URL");
    await expect(production.cardsKycLink(fixtureCustomer.id, "http://localhost/card?return=verification")).rejects.toThrow("return URL");
    expect(calls).toBe(0);
  });
  test("every Bridge write read rejects failures, timeouts and partial results", async () => {
    const config = readCardJourneyConfig(env)!;
    const key = "11111111-1111-4111-8111-111111111111";
    for (const call of ["create", "link"] as const) {
      const invoke = (fetcher: typeof fetch) => call === "create" ? createBridgeClient(config, fetcher).createCustomer(key) : createBridgeClient(config, fetcher).cardsKycLink(fixtureCustomer.id, "https://home.example/card?return=verification");
      await expect(invoke((async () => new Response(null, { status: 503 })) as unknown as typeof fetch)).rejects.toThrow("503");
      await expect(invoke((async () => { throw new DOMException("timed out", "TimeoutError"); }) as unknown as typeof fetch)).rejects.toThrow("timed out");
      await expect(invoke((async () => Response.json(call === "create" ? { id: fixtureCustomer.id } : { url: "https://wrong.example.test/" })) as unknown as typeof fetch)).rejects.toThrow();
    }
  });
  test("fake endorsement approval permits only Stripe TEST cardholder creation", async () => {
    const fake = startFakeBridge("fake-key");
    let calls = 0;
    try {
      await expect(fake.approveCards("sk_live_wrong", (async () => { calls++; return Response.json({ id: "ich_123" }); }) as unknown as typeof fetch)).rejects.toThrow("TEST key");
      expect(calls).toBe(0);
      await fake.approveCards("sk_test_synthetic", (async () => { calls++; return Response.json({ id: "ich_123" }); }) as unknown as typeof fetch);
      expect(calls).toBe(1);
      const config = readCardJourneyConfig({ ...env, BRIDGE_API_BASE_URL: fake.origin })!;
      expect((await createBridgeClient(config, fetchFakeBridge).readCustomer(fixtureCustomer.id)).stripeCardholderId).toBe("ich_123");
    } finally { await fake.stop(); }
  });
});
