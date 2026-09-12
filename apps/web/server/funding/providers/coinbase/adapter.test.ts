import { describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { createProviderContext } from "@/server/funding/core/provider-context";
import { FundingCore } from "@/server/funding/core/service";
import { MemoryFundingOrderStore } from "@/server/funding/core/store";
import { describeFundingAdapter } from "@/server/funding/core/testing/describeFundingAdapter";
import type { OrderIntent } from "@/shared/funding/provider-contract";
import { createCoinbaseProvider } from "./adapter";
import { coinbaseManifest } from "./manifest";

const DESTINATION = "0x1111111111111111111111111111111111111111" as const;
const HOSTED_URL = "https://pay.coinbase.com/buy/select-asset?sessionToken=synthetic-session";
const env = {
  CDP_API_KEY_ID: "synthetic-key-id",
  CDP_API_KEY_SECRET: "synthetic-key-secret",
};
const intent = {
  homeOrderId: "11111111-1111-4111-8111-111111111111",
  destination: DESTINATION,
  fiatAmount: "25",
  quote: {
    fiatAmount: "25",
    tokenAmountAtomic: "25000000",
    fees: [],
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
  returnUrl: "https://home.example/fund?return=funding",
} satisfies OrderIntent;

const provider = createCoinbaseProvider({
  generateJwtImplementation: async () => "synthetic-jwt",
});

describeFundingAdapter({
  provider,
  region: "US",
  paymentMethodId: "hosted",
  env,
  intent,
  successResponse: () => Response.json({ session: { onrampUrl: HOSTED_URL } }),
  invalidCreateResponses: [
    {
      name: "redirect outside the declared Coinbase origin",
      response: () => Response.json({
        session: {
          onrampUrl: "https://evil.example/buy/select-asset?sessionToken=synthetic-session",
        },
      }),
    },
  ],
  unknownStatusResponse: () => Response.json({ status: "UNUSED" }),
});

describe("Coinbase funding adapter", () => {
  test("declares one configured US USDC redirect binding without quotes", () => {
    expect(coinbaseManifest.bindings).toEqual([
      {
        region: "US",
        assetId: "base:usdc",
        paymentMethods: [{ id: "hosted", label: "Coinbase" }],
        env: ["CDP_API_KEY_ID", "CDP_API_KEY_SECRET"],
      },
    ]);
    expect(coinbaseManifest.reference).toBe("provider");
    expect(coinbaseManifest).not.toHaveProperty("quotes");
  });

  test("preserves the hosted-session JWT and request contract", async () => {
    const jwtOptions: unknown[] = [];
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const adapter = createCoinbaseProvider({
      generateJwtImplementation: async (options) => {
        jwtOptions.push(options);
        return "signed-jwt";
      },
    });
    const ctx = createProviderContext({
      manifest: adapter.manifest,
      region: "US",
      paymentMethodId: "hosted",
      env,
      fetchImplementation: (async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ input: String(input), init });
        return Response.json({ session: { onrampUrl: HOSTED_URL } });
      }) as unknown as typeof fetch,
    });

    const result = await adapter.createOrder(intent, ctx);

    expect(jwtOptions).toEqual([
      {
        apiKeyId: "synthetic-key-id",
        apiKeySecret: "synthetic-key-secret",
        requestMethod: "POST",
        requestHost: "api.cdp.coinbase.com",
        requestPath: "/platform/v2/onramp/sessions",
        expiresIn: 120,
      },
    ]);
    expect(requests[0]?.input).toBe(
      "https://api.cdp.coinbase.com/platform/v2/onramp/sessions",
    );
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      purchaseCurrency: "USDC",
      destinationNetwork: "base",
      destinationAddress: DESTINATION,
      redirectUrl: "https://home.example/fund?return=funding",
    });
    expect(result).toEqual({
      outcome: "created",
      order: {
        providerOrderId: "synthetic-session",
        tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        expectedTokenAmountAtomic: "25000000",
        fees: [],
        expiresAt: null,
        instructions: { kind: "redirect", url: HOSTED_URL },
      },
    });
  });

  test("lists the manifest binding only when both CDP API keys are configured", async () => {
    const session: VerifiedAccountSession = {
      user: { subject: "subject-a" },
      smartAccount: { address: DESTINATION, chainId: 8453 },
      accountProvider: "base-account",
    };
    const configured = new FundingCore({
      providers: [provider],
      store: new MemoryFundingOrderStore(),
      env,
      currentBaseBlock: async () => "1",
      verifyReceipt: async () => null,
    });
    const missingSecret = new FundingCore({
      providers: [provider],
      store: new MemoryFundingOrderStore(),
      env: { CDP_API_KEY_ID: env.CDP_API_KEY_ID },
      currentBaseBlock: async () => "1",
      verifyReceipt: async () => null,
    });

    await expect(configured.listProviders("US", session)).resolves.toEqual([
      expect.objectContaining({
        providerId: "coinbase",
        region: "US",
        assetId: "base:usdc",
        quotes: false,
      }),
    ]);
    await expect(missingSecret.listProviders("US", session)).resolves.toEqual([]);
  });
});
