import { expect, test } from "bun:test";
import { fixtureCustomer } from "@/tests/cards/fake-bridge";
import type { CardJourneyConfig } from "./journey-config";
import { createBridgeClient } from "./client";

const config: CardJourneyConfig = {
  mode: "sandbox", bridgeOrigin: "https://api.sandbox.bridge.xyz", bridgeApiKey: "synthetic-key",
  stripeSecretKey: "sk_test_synthetic", stripeApiVersion: "2026-08-26.dahlia", funding: { kind: "crypto_wallet" },
};

test("raw Bridge customer reads reject non-primitive identities and customer or cards status", async () => {
  let payload: unknown = fixtureCustomer;
  const client = createBridgeClient(config, Object.assign(async () => Response.json(payload), { preconnect: fetch.preconnect }));
  expect(await client.readCustomer(fixtureCustomer.id)).toEqual({
    id: "1e210e5b-700e-41e6-a62a-0eb0b6ac1967", status: "active", stripeCardholderId: "ich_1SVf3CG6FooBAru7mB2MSrDY",
    cardsEndorsement: { status: "approved", pending: false, missing: false, issues: false },
  });

  for (const item of [
    { payload: { ...fixtureCustomer, status: ["active"] }, error: "Invalid Bridge customer" },
    { payload: { ...fixtureCustomer, id: [fixtureCustomer.id] }, error: "Invalid Bridge customer" },
    { payload: { ...fixtureCustomer, stripe_cardholder_id: [fixtureCustomer.stripe_cardholder_id] }, error: "Invalid Bridge customer" },
    { payload: { ...fixtureCustomer, endorsements: fixtureCustomer.endorsements.map((endorsement) => ({ ...endorsement, status: ["approved"] })) }, error: "Invalid Bridge cards endorsement" },
  ]) {
    payload = item.payload;
    await expect(client.readCustomer(fixtureCustomer.id)).rejects.toThrow(item.error);
  }
});
