import "server-only";

import { describe, expect, test } from "bun:test";
import type { FundingProvider } from "@/shared/funding/provider-contract";
import { validateFundingProviders } from "./validate";

const onramp = {
  createOrder: async () => ({ outcome: "ambiguous" as const }),
  getOrder: async () => ({ state: "unknown" as const, providerStatus: "unknown" }),
};

function fixture(): FundingProvider {
  return {
    manifest: {
      id: "fixture",
      displayName: "Fixture",
      docsUrl: "https://example.com",
      onramp: { apiOrigins: ["https://onramp.example"], reference: "home" },
      bindings: [{
        region: "US",
        assetId: "base:usdc",
        currency: "USD",
        directions: { onramp: { paymentMethods: [{ id: "bank", label: "Bank" }], env: ["FIXTURE_KEY"] } },
      }],
    },
    onramp,
  };
}

describe("funding provider registry validation", () => {
  test("accepts a directional provider and rejects a missing port", () => {
    expect(() => validateFundingProviders([fixture()])).not.toThrow();
    const invalid = fixture();
    invalid.onramp = undefined;
    expect(() => validateFundingProviders([invalid])).toThrow("manifest and port must be declared together");
  });

  test("rejects ambiguous direction methods, duplicate origins, and webhook env gaps", () => {
    const duplicateMethod = fixture();
    duplicateMethod.manifest.bindings = [...duplicateMethod.manifest.bindings, {
      ...duplicateMethod.manifest.bindings[0]!,
      directions: { onramp: { paymentMethods: [{ id: "bank", label: "Duplicate" }], env: ["FIXTURE_KEY"] } },
    }];
    expect(() => validateFundingProviders([duplicateMethod])).toThrow("ambiguous binding");

    const duplicateOrigin = fixture();
    duplicateOrigin.manifest.onramp!.apiOrigins = ["https://onramp.example", "https://onramp.example"];
    expect(() => validateFundingProviders([duplicateOrigin])).toThrow("duplicated");

    const webhookGap = fixture();
    webhookGap.manifest.onramp!.webhook = { signatureHeader: "x-signature", env: "WEBHOOK_SECRET" };
    expect(() => validateFundingProviders([webhookGap])).toThrow("webhook secret");
  });
});
