import { describe, expect, test } from "bun:test";
import { readProviderBindings } from "./providers";

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
