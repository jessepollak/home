import "server-only";

import { describe, expect, test } from "bun:test";
import type { FundingProviderManifest } from "@/shared/funding/provider-contract";
import { FundingProviderConfigurationError, FundingProviderFetchError, createProviderContext } from "./provider-context";

const manifest = {
  id: "both",
  displayName: "Both",
  docsUrl: "https://example.com",
  onramp: { apiOrigins: ["https://on.example"], sandbox: true, reference: "home" },
  offramp: {
    production: { apiOrigins: ["https://off.example"], contracts: { escrow: "0x1111111111111111111111111111111111111111", intentGuardian: "0x2222222222222222222222222222222222222222", intentGatingService: "0x3333333333333333333333333333333333333333" } },
    sandbox: { apiOrigins: ["https://sandbox-off.example"], contracts: { escrow: "0x4444444444444444444444444444444444444444", intentGuardian: "0x5555555555555555555555555555555555555555", intentGatingService: "0x6666666666666666666666666666666666666666" } },
  },
  bindings: [{ region: "US", assetId: "base:usdc", currency: "USD", directions: {
    onramp: { paymentMethods: [{ id: "shared", label: "On" }], env: ["ON_KEY"] },
    offramp: { paymentMethods: [{ id: "shared", label: "Off" }], env: ["OFF_KEY"], confirmedBy: "fixture" },
  } }],
} as const satisfies FundingProviderManifest;

describe("directional funding provider context", () => {
  test("distinguishes identical method ids and grants only selected origins and env", async () => {
    const calls: string[] = [];
    const transport = (async (input: RequestInfo | URL) => { calls.push(String(input)); return new Response(); }) as typeof fetch;
    const on = createProviderContext({ manifest, region: "US", direction: "onramp", paymentMethodId: "shared", env: { ON_KEY: "on", OFF_KEY: "off" }, fetchImplementation: transport });
    expect(on.binding).toMatchObject({ direction: "onramp", currency: "USD", paymentMethod: { label: "On" } });
    expect(on.env).toEqual({ ON_KEY: "on" });
    await expect(on.fetch("https://off.example/path")).rejects.toBeInstanceOf(FundingProviderFetchError);

    const off = createProviderContext({ manifest, region: "US", direction: "offramp", paymentMethodId: "shared", env: { ON_KEY: "on", OFF_KEY: "off" }, fetchImplementation: transport, sandbox: true });
    expect(off.binding).toMatchObject({ direction: "offramp", currency: "USD", paymentMethod: { label: "Off" } });
    expect(off.env).toEqual({ OFF_KEY: "off" });
    expect(off.deployment.contracts.escrow).toBe("0x4444444444444444444444444444444444444444");
    await expect(off.fetch("https://off.example/path")).rejects.toBeInstanceOf(FundingProviderFetchError);
    await off.fetch("https://sandbox-off.example/path");
    expect(calls).toHaveLength(1);
  });

  test("fails sandbox context creation when a direction has no sandbox", () => {
    expect(() => createProviderContext({ manifest: { ...manifest, offramp: { production: manifest.offramp.production } }, region: "US", direction: "offramp", paymentMethodId: "shared", env: { OFF_KEY: "off" }, sandbox: true })).toThrow(FundingProviderConfigurationError);
  });
});
