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
});
