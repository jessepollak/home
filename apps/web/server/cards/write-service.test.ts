import { describe, expect, test } from "bun:test";
import type { SqlExecutor } from "@/server/db/sql";
import { fetchFakeBridge, fixtureCustomer, startFakeBridge } from "@/tests/cards/fake-bridge";
import { createBridgeClient } from "./bridge/client";
import type { CardJourneyConfig } from "./bridge/journey-config";
import { createStripeClient } from "./stripe/client";
import { createCardWriteService } from "./write-service";

describe("card enrollment return", () => {
  test("forwards the route-provided return URI to Bridge for an existing customer", async () => {
    const fake = startFakeBridge("fake-key");
    try {
      const config: CardJourneyConfig = { mode: "sandbox", bridgeOrigin: fake.origin, bridgeApiKey: "fake-key",
        stripeSecretKey: "sk_test_fake", stripeApiVersion: "2026-08-26.dahlia", funding: { kind: "crypto_wallet" } };
      const bridge = createBridgeClient(config, fetchFakeBridge);
      await bridge.createCustomer("11111111-1111-4111-8111-111111111111");
      const sql = {
        query: async (statement: string) => statement.startsWith("SELECT bridge_customer_id")
          ? { rows: [{ bridge_customer_id: fixtureCustomer.id, stripe_cardholder_id: null }], rowCount: 1 }
          : { rows: [], rowCount: 1 },
        transaction: async (operation: (tx: SqlExecutor) => Promise<unknown>) => operation(sql as SqlExecutor),
      } as unknown as SqlExecutor;
      const service = createCardWriteService({ sql, config, bridge, stripe: createStripeClient(config) });
      const redirectUri = "https://home.example/card?return=verification";
      const link = new URL(await service.enroll("owner-id", redirectUri));
      expect(link.searchParams.get("redirect_uri")).toBe(redirectUri);
      expect(link.origin).toBe("https://bridge.withpersona.com");
    } finally { await fake.stop(); }
  });
});
