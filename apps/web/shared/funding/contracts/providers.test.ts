import { describe, expect, test } from "bun:test";
import { assertFundingProvidersResponse, FUNDING_PROVIDERS_VERSION, readProviderBindings } from "./providers";

const offramp = {
  providerId: "peer",
  displayName: "Peer",
  region: "US",
  assetId: "base:usdc",
  assetSymbol: "USDC",
  assetDecimals: 6,
  currency: "USD",
  direction: "offramp",
  paymentMethods: [{
    id: "cashapp",
    label: "Cash App",
    platform: "cashapp",
    handleHint: "$handle",
    minimumAmountAtomic: "1000000",
    maximumAmountAtomic: null,
    estimateSemantics: "approximate",
    etaSemantics: "historical-not-guaranteed",
    corridorConfirmedBy: "fixture",
  }],
  quotes: false,
} as const;

describe("funding provider contract parser", () => {
  const onramp = { ...offramp, direction: "onramp", paymentMethods: [{ id: "bank_transfer", label: "Bank transfer" }], quotes: true, customerSetup: null } as const;
  test.each([
    null, {}, { providers: null }, { providers: "invalid" },
    { version: 2, direction: "onramp", providers: [] },
    { direction: "onramp", providers: [] },
    { version: FUNDING_PROVIDERS_VERSION, providers: [] },
    { version: FUNDING_PROVIDERS_VERSION, direction: "offramp", providers: [] },
    { version: FUNDING_PROVIDERS_VERSION, direction: "onramp", providers: [{ providerId: "partial" }] },
    { version: FUNDING_PROVIDERS_VERSION, direction: "onramp", providers: [onramp, { providerId: "partial" }] },
    { version: FUNDING_PROVIDERS_VERSION, direction: "onramp", providers: [offramp] },
  ])("rejects an unknown, stale, mismatched or partial providers envelope: %p", (value) => {
    expect(() => assertFundingProvidersResponse(value, "onramp", "US")).toThrow("Invalid funding providers response");
  });
  test("accepts an empty providers envelope", () => {
    expect(() => assertFundingProvidersResponse({ version: FUNDING_PROVIDERS_VERSION, direction: "onramp", providers: [] }, "onramp", "US")).not.toThrow();
  });
  test("accepts bindings matching the requested direction", () => {
    expect(() => assertFundingProvidersResponse({ version: FUNDING_PROVIDERS_VERSION, direction: "onramp", providers: [onramp] }, "onramp", "US")).not.toThrow();
    expect(() => assertFundingProvidersResponse({ version: FUNDING_PROVIDERS_VERSION, direction: "offramp", providers: [offramp] }, "offramp", "US")).not.toThrow();
  });
  test("accepts legacy on-ramp bindings without a direction", () => {
    const { direction: _direction, ...legacyOnramp } = onramp;
    expect(readProviderBindings({ providers: [legacyOnramp] })).toEqual([onramp]);
    expect(() => assertFundingProvidersResponse({ version: FUNDING_PROVIDERS_VERSION, direction: "onramp", providers: [legacyOnramp] }, "onramp", "US")).not.toThrow();
  });
  test("rejects a binding from another region", () => {
    const otherRegion = { ...onramp, region: "BR" };
    const matchingRegion = { ...onramp, region: "AR" };
    expect(() => assertFundingProvidersResponse({ version: FUNDING_PROVIDERS_VERSION, direction: "onramp", providers: [otherRegion] }, "onramp", "AR")).toThrow("Invalid funding providers response");
    expect(() => assertFundingProvidersResponse({ version: FUNDING_PROVIDERS_VERSION, direction: "onramp", providers: [matchingRegion, otherRegion] }, "onramp", "AR")).toThrow("Invalid funding providers response");
    expect(() => assertFundingProvidersResponse({ version: FUNDING_PROVIDERS_VERSION, direction: "onramp", providers: [otherRegion] }, "onramp", "BR")).not.toThrow();
  });

  test("accepts current and legacy null off-ramp setup shapes", () => {
    for (const setup of [{ customerSetup: null }, { kyc: null }]) {
      expect(readProviderBindings({ providers: [{ ...offramp, ...setup }] })).toEqual([
        { ...offramp, customerSetup: null },
      ]);
    }
  });

  test("rejects a non-null off-ramp setup shape", () => {
    expect(readProviderBindings({
      providers: [{ ...offramp, customerSetup: { hosted: true } }],
    })).toEqual([]);
    expect(readProviderBindings({
      providers: [{ ...offramp, kyc: { fields: [] } }],
    })).toEqual([]);
  });
});
