import { expect, test } from "bun:test";
import type { CardJourneyConfig } from "../bridge/journey-config";
import { createStripeClient } from "./client";

const config: CardJourneyConfig = {
  mode: "sandbox", bridgeOrigin: "https://api.sandbox.bridge.xyz", bridgeApiKey: "synthetic-key",
  stripeSecretKey: "sk_test_synthetic", stripeApiVersion: "2026-08-26.dahlia", funding: { kind: "crypto_wallet" },
};
const card = { id: "ic_synthetic", cardholder: "ich_synthetic", status: "active", last4: "1234", metadata: {} };
const cardholder = { id: "ich_synthetic", status: "active" };

test("raw Stripe card reads reject non-primitive status, ID and cardholder binding", async () => {
  let payload: unknown = card;
  const client = createStripeClient(config, Object.assign(async () => Response.json(payload), { preconnect: fetch.preconnect }));
  expect(await client.readCard("ic_synthetic"))
    .toEqual({ id: "ic_synthetic", cardholderId: "ich_synthetic", status: "active", last4: "1234", customerFrozen: false });

  for (const malformed of [
    { ...card, status: ["active"] },
    { ...card, id: ["ic_synthetic"] },
    { ...card, cardholder: { id: ["ich_synthetic"] } },
  ]) {
    payload = malformed;
    await expect(client.readCard("ic_synthetic")).rejects.toThrow("Invalid Stripe card");
  }
});

test("raw Stripe cardholder reads reject non-primitive status and ID", async () => {
  let payload: unknown = cardholder;
  const client = createStripeClient(config, Object.assign(async () => Response.json(payload), { preconnect: fetch.preconnect }));
  expect(await client.readCardholder("ich_synthetic")).toEqual({ id: "ich_synthetic", status: "active" });

  for (const malformed of [
    { ...cardholder, status: ["active"] },
    { ...cardholder, id: ["ich_synthetic"] },
  ]) {
    payload = malformed;
    await expect(client.readCardholder("ich_synthetic")).rejects.toThrow("Invalid Stripe cardholder");
  }
});
