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
  test("fails closed when Bridge changes the endorsement schema or ID", async () => {
    expect(() => parseBridgeCustomer({ ...fixtureCustomer, endorsements: [{ name: "cards", status: "approved" }] })).toThrow();
    expect(() => parseBridgeCustomer({ ...fixtureCustomer, endorsements: [{ name: "cards", status: "unknown", requirements: { pending: [], missing: null, issues: [] } }] })).toThrow();
    const fake = startFakeBridge("fake-key", { ...fixtureCustomer, id: "ffffffff-ffff-ffff-ffff-ffffffffffff" });
    try {
      const config = readCardJourneyConfig({ ...env, BRIDGE_API_BASE_URL: fake.origin });
      await expect(createBridgeClient(config!, fetchFakeBridge).readCustomer(fixtureCustomer.id)).rejects.toThrow("mismatch");
    } finally { await fake.stop(); }
  });
});
