import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { createProviderContext } from "../../core/provider-context";
import { ripioProvider } from "./adapter";
import { ripioManifest } from "./manifest";

const env = { RIPIO_CLIENT_ID_AR: "client", RIPIO_CLIENT_SECRET_AR: "secret", RIPIO_WEBHOOK_SECRET: "w".repeat(32) };
function context(fetchImplementation: typeof fetch) { return createProviderContext({ manifest: ripioManifest, region: "AR", paymentMethodId: "bank_transfer", env, fetchImplementation }); }

describe("Ripio funding adapter", () => {
  test("declares independently configured country bindings", () => {
    expect(ripioManifest.reference).toBe("home");
    expect(ripioManifest.quotes).toBe(true);
    expect(ripioManifest.bindings.map((binding) => binding.region)).toEqual(["AR", "CO"]);
  });

  test("maps an uncertain create failure to ambiguous and never retries", async () => {
    let calls = 0;
    const result = await ripioProvider.createOrder({
      homeOrderId: "11111111-1111-4111-8111-111111111111",
      destination: "0x1111111111111111111111111111111111111111",
      fiatAmount: "1000", customerRef: "22222222-2222-4222-8222-222222222222",
      quote: { providerQuoteId: "33333333-3333-4333-8333-333333333333", fiatAmount: "1000", tokenAmountAtomic: "1000000000000000000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" },
      returnUrl: "https://home.example/fund",
    }, context((async () => { calls += 1; throw new Error("timeout"); }) as unknown as typeof fetch));
    expect(result).toEqual({ outcome: "ambiguous" });
    expect(calls).toBe(1);
  });

  test("verifies the raw webhook body before returning a provider order ID", () => {
    const raw = new TextEncoder().encode(JSON.stringify({ eventType: "ONRAMP_PAYMENT_RECEIVED", issueDatetime: "2026-09-12T00:00:00.000Z", transactionObject: { transactionId: "44444444-4444-4444-8444-444444444444" } }));
    const signature = createHmac("sha256", env.RIPIO_WEBHOOK_SECRET).update(raw).digest("hex");
    expect(ripioProvider.verifyWebhook!(raw, new Headers({ "http-x-wh-signature-256": signature }), context(fetch))).toEqual({ providerOrderId: "44444444-4444-4444-8444-444444444444" });
    expect(ripioProvider.verifyWebhook!(raw, new Headers({ "http-x-wh-signature-256": "0".repeat(64) }), context(fetch))).toBeNull();
  });
});
