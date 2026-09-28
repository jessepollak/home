import "server-only";

import { describe, expect, test } from "bun:test";
import type { CountryCode, FiatCurrencyCode } from "@/config/regions";
import type { FundingProvider } from "@/shared/funding/provider-contract";
import { parseCashoutQuote } from "@/shared/funding/cash-out-quote";
import { FundingProviderConfigurationError, createProviderContext } from "../provider-context";

export function describeFundingOfframpAdapter(options: {
  provider: FundingProvider;
  region: CountryCode;
  paymentMethodId: string;
  currency: FiatCurrencyCode;
  env: Readonly<Record<string, string>>;
  owner: `0x${string}`;
  disabled?: boolean;
  quote?: {
    amountAtomic: bigint;
    install(timing: "sampled" | "unsampled"): void;
  };
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

    const quoteFixture = options.quote;
    if (quoteFixture) {
      const estimate = () => {
        const adapter = options.provider.offramp;
        if (!adapter) throw new Error("Missing offramp adapter.");
        const ctx = createProviderContext({ manifest: options.provider.manifest, region: options.region, direction: "offramp", paymentMethodId: options.paymentMethodId, env: options.env });
        return adapter.estimate({ amountAtomic: quoteFixture.amountAtomic, platform: options.paymentMethodId, currency: options.currency }, ctx);
      };

      test("returns a normalized quote with fee components, rate, net receive, and a sourced arrival", async () => {
        quoteFixture.install("sampled");
        const { quote } = await estimate();
        const parsed = parseCashoutQuote(JSON.parse(JSON.stringify(quote)));
        expect(parsed).toEqual(quote);
        expect(quote.fees.operator).toBeNull();
        expect(quote.receive.currency).toBe(options.currency);
        if (quote.rate) expect(quote.rate.to).toBe(options.currency);
        expect(quote.arrival.source).not.toBe("unknown");
      });

      test("reports an unknown arrival instead of inventing one when the provider has no timing", async () => {
        quoteFixture.install("unsampled");
        const { quote } = await estimate();
        expect(quote.arrival).toEqual({ source: "unknown" });
        expect(parseCashoutQuote(quote)).toEqual(quote);
      });
    }

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
          () => adapter.listOrders({ ...common, inFlight: true, onMalformedPayee: "throw" }, ctx),
        ]) await expect(operation()).rejects.toBeInstanceOf(Error);
      });
    }
  });
}
