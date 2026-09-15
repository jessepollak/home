import "server-only";

import { describe, expect, test } from "bun:test";
import type { CountryCode, FiatCurrencyCode } from "@/config/regions";
import type { FundingProvider } from "@/shared/funding/provider-contract";
import { FundingProviderConfigurationError, createProviderContext } from "../provider-context";

export function describeFundingOfframpAdapter(options: {
  provider: FundingProvider;
  region: CountryCode;
  paymentMethodId: string;
  currency: FiatCurrencyCode;
  env: Readonly<Record<string, string>>;
  owner: `0x${string}`;
  disabled?: boolean;
}): void {
  describe(`funding offramp adapter conformance · ${options.provider.manifest.id}:${options.paymentMethodId}`, () => {
    test("requires the exact directional binding environment before adapter code runs", () => {
      let outbound = 0;
      expect(() => createProviderContext({
        manifest: options.provider.manifest,
        region: options.region,
        direction: "offramp",
        paymentMethodId: options.paymentMethodId,
        env: {},
        fetchImplementation: (async () => { outbound += 1; return new Response(); }) as unknown as typeof fetch,
      })).toThrow(FundingProviderConfigurationError);
      expect(outbound).toBe(0);
    });

    test("binds direction, currency, selected deployment, and declared environment only", () => {
      const ctx = createProviderContext({
        manifest: options.provider.manifest,
        region: options.region,
        direction: "offramp",
        paymentMethodId: options.paymentMethodId,
        env: { ...options.env, UNDECLARED_SECRET: "no" },
      });
      expect(ctx.binding.direction).toBe("offramp");
      expect(ctx.binding.currency).toBe(options.currency);
      const production = options.provider.manifest.offramp?.production;
      if (!production) throw new Error("Missing production deployment.");
      expect(ctx.deployment).toEqual(production);
      expect(ctx.env).not.toHaveProperty("UNDECLARED_SECRET");
    });

    if (options.disabled) {
      test("fails closed across every money-relevant lifecycle method", async () => {
        const adapter = options.provider.offramp;
        if (!adapter) throw new Error("Missing offramp adapter.");
        const ctx = createProviderContext({ manifest: options.provider.manifest, region: options.region, direction: "offramp", paymentMethodId: options.paymentMethodId, env: options.env });
        const common = { owner: options.owner };
        for (const operation of [
          () => adapter.capabilities(ctx),
          () => adapter.estimate({ amountAtomic: BigInt(1), platform: options.paymentMethodId, currency: options.currency }, ctx),
          () => adapter.prepareDeposit({ ...common, amountAtomic: BigInt(1), platform: options.paymentMethodId, currency: options.currency, payoutHandle: "fixture" }, ctx),
          () => adapter.prepareWithdraw({ ...common, depositId: "fixture" }, ctx),
          () => adapter.readOrder({ ...common, depositId: "fixture" }, ctx),
          () => adapter.listOrders({ ...common, inFlight: true }, ctx),
        ]) await expect(operation()).rejects.toBeInstanceOf(Error);
      });
    }
  });
}
