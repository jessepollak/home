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
    expect(readProviderBindings({ providers: [legacyOnramp] })).toEqual([{ ...onramp, resumeOnly: false }]);
    expect(() => assertFundingProvidersResponse({ version: FUNDING_PROVIDERS_VERSION, direction: "onramp", providers: [legacyOnramp] }, "onramp", "US")).not.toThrow();
  });
  test("rejects a binding from another region", () => {
    const otherRegion = { ...onramp, region: "BR" };
    const matchingRegion = { ...onramp, region: "AR" };
    expect(() => assertFundingProvidersResponse({ version: FUNDING_PROVIDERS_VERSION, direction: "onramp", providers: [otherRegion] }, "onramp", "AR")).toThrow("Invalid funding providers response");
    expect(() => assertFundingProvidersResponse({ version: FUNDING_PROVIDERS_VERSION, direction: "onramp", providers: [matchingRegion, otherRegion] }, "onramp", "AR")).toThrow("Invalid funding providers response");
    expect(() => assertFundingProvidersResponse({ version: FUNDING_PROVIDERS_VERSION, direction: "onramp", providers: [otherRegion] }, "onramp", "BR")).not.toThrow();
  });

  test("accepts current-version entries and a genuinely empty catalog for the requested direction", () => {
    expect(() => assertFundingProvidersResponse({ version: FUNDING_PROVIDERS_VERSION, direction: "offramp", providers: [{ ...offramp, kyc: null }] }, "offramp", "US")).not.toThrow();
    expect(readProviderBindings({ providers: [{ ...offramp, kyc: null }] })).toEqual([{ ...offramp, customerSetup: null }]);
    expect(() => assertFundingProvidersResponse({ version: FUNDING_PROVIDERS_VERSION, direction: "onramp", providers: [] }, "onramp", "US")).not.toThrow();
    expect(() => assertFundingProvidersResponse({ version: FUNDING_PROVIDERS_VERSION, direction: "offramp", providers: [] }, "offramp", "US")).not.toThrow();
  });

  test("rejects unsupported, missing, or mismatched directions even for an empty catalog", () => {
    for (const direction of ["onramp", "offramp"] as const) {
      expect(() => assertFundingProvidersResponse({ version: FUNDING_PROVIDERS_VERSION, providers: [] }, direction, "US")).toThrow("Invalid funding providers response");
      expect(() => assertFundingProvidersResponse({ version: FUNDING_PROVIDERS_VERSION, direction: "invalid", providers: [] }, direction, "US")).toThrow("Invalid funding providers response");
      expect(() => assertFundingProvidersResponse({ version: FUNDING_PROVIDERS_VERSION, direction: direction === "onramp" ? "offramp" : "onramp", providers: [] }, direction, "US")).toThrow("Invalid funding providers response");
    }
  });

  test("rejects unsupported or malformed catalogs without dropping an entry", () => {
    expect(() => assertFundingProvidersResponse({ version: 2, direction: "offramp", providers: [{ ...offramp, kyc: null }] }, "offramp", "US")).toThrow("Invalid funding providers response");
    expect(() => assertFundingProvidersResponse({ version: FUNDING_PROVIDERS_VERSION, direction: "offramp", providers: null }, "offramp", "US")).toThrow("Invalid funding providers response");
    expect(() => assertFundingProvidersResponse({ version: FUNDING_PROVIDERS_VERSION, direction: "offramp", providers: [{ ...offramp, kyc: null }, {}] }, "offramp", "US")).toThrow("Invalid funding providers response");
    expect(() => assertFundingProvidersResponse({ version: FUNDING_PROVIDERS_VERSION, direction: "offramp", providers: [{ ...offramp, kyc: null, direction: "unknown" }] }, "offramp", "US")).toThrow("Invalid funding providers response");
  });

  test("rejects a valid binding in the wrong direction and accepts the onramp entry", () => {
    const onramp = {
      providerId: "idrx", displayName: "IDRX", region: "ID", assetId: "base:idrx", assetSymbol: "IDRX",
      assetDecimals: 2, currency: "IDR", direction: "onramp" as const, paymentMethods: [{ id: "qris", label: "QRIS" }],
      quotes: false, customerSetup: null,
    };
    expect(() => assertFundingProvidersResponse({ version: FUNDING_PROVIDERS_VERSION, direction: "offramp", providers: [offramp, onramp] }, "offramp", "US")).toThrow("Invalid funding providers response");
    expect(() => assertFundingProvidersResponse({ version: FUNDING_PROVIDERS_VERSION, direction: "onramp", providers: [onramp, offramp] }, "onramp", "ID")).toThrow("Invalid funding providers response");
    expect(readProviderBindings({ providers: [onramp] })).toEqual([{ ...onramp, resumeOnly: false }]);
  });

  test("accepts current and legacy null off-ramp setup shapes", () => {
    for (const setup of [{ customerSetup: null }, { kyc: null }]) {
      expect(readProviderBindings({ providers: [{ ...offramp, ...setup }] })).toEqual([
        { ...offramp, customerSetup: null },
      ]);
    }
  });

  test("round-trips resume-only on onramps and defaults missing flags to false", () => {
    const onramp = {
      providerId: "idrx", displayName: "IDRX", region: "ID", assetId: "base:idrx", assetSymbol: "IDRX",
      assetDecimals: 2, currency: "IDR", direction: "onramp" as const, paymentMethods: [{ id: "qris", label: "QRIS" }],
      quotes: false, customerSetup: null,
    };
    expect(readProviderBindings({ providers: [{ ...onramp, resumeOnly: true }, { ...onramp, resumeOnly: false }, onramp] })).toEqual([
      { ...onramp, resumeOnly: true }, { ...onramp, resumeOnly: false }, { ...onramp, resumeOnly: false },
    ]);
    expect(readProviderBindings({ providers: [{ ...onramp, resumeOnly: "true" }, onramp] })).toEqual([{ ...onramp, resumeOnly: false }]);
  });

  test("keeps the wire version an older client accepts while adding resume-only", () => {
    const paused = { ...onramp, resumeOnly: true };
    const response = { version: 3, direction: "onramp" as const, providers: [paused] };
    expect(FUNDING_PROVIDERS_VERSION).toBe(3);
    expect(readProviderBindings(response)).toEqual([{ ...paused, resumeOnly: true }]);
    expect(() => assertFundingProvidersResponse(response, "onramp", "US")).not.toThrow();
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


test.each([
  { assetDecimals: 1.5 }, { assetDecimals: Number.MAX_SAFE_INTEGER + 1 },
  { paymentMethods: [{ ...offramp.paymentMethods[0], minimumAmountAtomic: "01" }] },
  { paymentMethods: [{ ...offramp.paymentMethods[0], maximumAmountAtomic: undefined }] },
  { paymentMethods: [{ ...offramp.paymentMethods[0], platform: null }] },
  { paymentMethods: [{ ...offramp.paymentMethods[0], estimateSemantics: "guaranteed" }] },
  { paymentMethods: [{ ...offramp.paymentMethods[0], etaSemantics: "guaranteed" }] },
  { quotes: true }, { customerSetup: null, kyc: { hosted: true } },
])("rejects nested or noncanonical off-ramp data without accepting a partial envelope: %p", (override) => {
  const invalid = { ...offramp, ...override };
  expect(readProviderBindings({ providers: [invalid, offramp] })).toEqual([{ ...offramp, customerSetup: null }]);
  expect(() => assertFundingProvidersResponse({ version: 3, direction: "offramp", providers: [offramp, invalid] }, "offramp", "US"))
    .toThrow("Invalid funding providers response");
});

test("on-ramp setup is exact, but payment method metadata and signed safe decimals remain compatible", () => {
  const onramp = { ...offramp, direction: "onramp" as const, quotes: true, assetDecimals: -1,
    paymentMethods: [{ id: "bank", label: "Bank", metadata: "retained" }], customerSetup: { hosted: true as const } };
  expect(readProviderBindings({ providers: [onramp] })).toEqual([{ ...onramp, resumeOnly: false }]);
  for (const customerSetup of [{ hosted: false }, { hosted: true, fields: [] }, { hosted: true, extra: undefined }]) {
    expect(readProviderBindings({ providers: [{ ...onramp, customerSetup }] })).toEqual([]);
  }
});
