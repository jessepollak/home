import { createHash } from "node:crypto";
import { fixtureFetch } from "@/tests/helpers/fetch";
import { parseJson } from "@/tests/helpers/read-json";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import type { ReconciliationIntent } from "@/shared/funding/provider-contract";
import { createProviderContext } from "../../core/provider-context";
import { describeFundingAdapter } from "../../core/testing/describeFundingAdapter";
import { createCoinbaseProvider } from "./adapter";
import { coinbaseManifest } from "./manifest";

const checksumAddress = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" as const;
const lowercaseAddress = "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed" as const;
const invalidChecksumAddress = "0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" as const;
const env = { CDP_API_KEY_ID: "synthetic-key", CDP_API_KEY_SECRET: "synthetic-secret" };
const provider = createCoinbaseProvider({ generateJwtImplementation: async () => "synthetic-jwt" });
const onramp = provider.onramp;
if (!onramp?.createQuote) throw new Error("Coinbase fixture requires a quoting onramp.");
const createQuote = onramp.createQuote;
const providerOrderId = "synthetic-order-1";
const intent = {
  homeOrderId: "11111111-1111-4111-8111-111111111111",
  destination: lowercaseAddress,
  fiatAmount: "5.00",
  returnUrl: "https://home.example/fund",
  quote: { fiatAmount: "5.00", tokenAmountAtomic: "4880000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" },
};
function context(fetchImplementation: typeof fetch) {
  return createProviderContext({ manifest: coinbaseManifest, region: "US", paymentMethodId: "apple-pay", env, fetchImplementation });
}
function reconciliation(ctx: ReturnType<typeof context>): ReconciliationIntent {
  return { ...intent, providerOrderId, transactionType: "MINT", chainId: ctx.binding.asset.chainId, tokenAddress: ctx.binding.asset.address, expectedTokenAmountAtomic: "4880000", tokenDecimals: ctx.binding.asset.decimals };
}
function payload(overrides: Record<string, unknown> = {}) {
  return {
    order: {
      orderId: providerOrderId,
      paymentMethod: "GUEST_CHECKOUT_APPLE_PAY",
      paymentCurrency: "USD",
      purchaseCurrency: "USDC",
      destinationNetwork: "base",
      destinationAddress: lowercaseAddress,
      partnerUserRef: createHash("sha256").update(`home:${lowercaseAddress}`).digest("hex").slice(0, 32),
      paymentTotal: "5.00",
      paymentSubtotal: "4.88",
      purchaseAmount: "4.88",
      fees: [{ type: "FEE_TYPE_EXCHANGE", amount: "0.12", currency: "USD" }],
      status: "ONRAMP_ORDER_STATUS_COMPLETED",
      ...overrides,
    },
    paymentLink: { paymentLinkType: "PAYMENT_LINK_TYPE_EMBEDDED_ORDER", url: "https://pay.coinbase.com/synthetic" },
  };
}
beforeEach(() => setObservabilityLogWriterForTests(() => undefined));
afterEach(() => setObservabilityLogWriterForTests());

describeFundingAdapter({
  provider, region: "US", paymentMethodId: "apple-pay", env, intent,
  reconciliationProviderOrderId: providerOrderId,
  successResponse: () => Response.json(payload(), { status: 201 }),
  invalidCreateResponses: [{ name: "wrong destination", response: () => Response.json(payload({ destinationAddress: "0x1111111111111111111111111111111111111111" }), { status: 201 }) }],
  unknownStatusResponse: () => Response.json(payload({ status: "UNDOCUMENTED" })),
});

describe("Coinbase branded provider ingress", () => {
  test.each([
    [lowercaseAddress, checksumAddress],
    [checksumAddress, lowercaseAddress],
  ] as const)("compares normalized destination echoes and preserves wire destination %s", async (destination, echo) => {
    const requests: RequestInit[] = [];
    const ctx = context(fixtureFetch(async (_input, init = {}) => {
      requests.push(init);
      return Response.json(payload({ destinationAddress: echo }), { status: init.method === "POST" ? 201 : 200 });
    }));
    const input = { ...intent, destination };
    await expect(createQuote(input, ctx)).resolves.toMatchObject({ tokenAmountAtomic: "4880000" });
    await expect(onramp.createOrder(input, ctx)).resolves.toMatchObject({ outcome: "created" });
    await expect(onramp.getOrder({ ...reconciliation(ctx), destination }, ctx)).resolves.toEqual({ state: "sent", providerStatus: "ONRAMP_ORDER_STATUS_COMPLETED" });
    const common = {
      paymentMethod: "GUEST_CHECKOUT_APPLE_PAY", paymentCurrency: "USD", purchaseCurrency: "USDC", destinationNetwork: "base", destinationAddress: destination,
      partnerUserRef: createHash("sha256").update(`home:${lowercaseAddress}`).digest("hex").slice(0, 32), domain: "home.example",
    };
    expect(parseJson(String(requests[0]?.body))).toEqual({ isQuote: true, ...common, paymentAmount: "5.00" });
    expect(parseJson(String(requests[1]?.body))).toEqual({ ...common, purchaseAmount: "4.88", partnerOrderRef: intent.homeOrderId });
  });

  test.each([invalidChecksumAddress, "0x1234", "0x" + "g".repeat(40)])("rejects invalid destination echo %s at quote, create and status", async (destinationAddress) => {
    const ctx = context(fixtureFetch(async (_input, init) => Response.json(payload({ destinationAddress }), { status: init?.method === "POST" ? 201 : 200 })));
    await expect(createQuote(intent, ctx)).rejects.toThrow("Coinbase address echo mismatch.");
    expect(await onramp.createOrder(intent, ctx)).toEqual({ outcome: "ambiguous" });
    expect(await onramp.getOrder(reconciliation(ctx), ctx)).toEqual({ state: "unknown", providerStatus: "INVALID_RESPONSE" });
  });

  test.each([invalidChecksumAddress, "0x1234"] as const)("rejects invalid reconciliation destination %s before I/O", async (destination) => {
    let calls = 0;
    const ctx = context(fixtureFetch(async () => { calls += 1; return Response.json(payload()); }));
    expect(await onramp.getOrder({ ...reconciliation(ctx), destination }, ctx)).toEqual({ state: "unknown", providerStatus: "INVALID_RECONCILIATION_INTENT" });
    expect(calls).toBe(0);
  });

  const hashCases: { txHash: unknown; expected: `0x${string}` | null }[] = [
    { txHash: `0x${"AB".repeat(32)}`, expected: `0x${"ab".repeat(32)}` },
    ...[null, "0x1234", `0x${"g".repeat(64)}`, `0X${"AB".repeat(32)}`, 42].map((txHash) => ({ txHash, expected: null })),
  ];
  test.each(hashCases)("normalizes or omits transaction hash $txHash without changing provider state", async ({ txHash, expected }) => {
    const ctx = context(fixtureFetch(async () => Response.json(payload({ txHash }))));
    expect(await onramp.getOrder(reconciliation(ctx), ctx)).toEqual({ state: "sent", providerStatus: "ONRAMP_ORDER_STATUS_COMPLETED", ...(expected ? { transactionHash: expected } : {}) });
  });
});
