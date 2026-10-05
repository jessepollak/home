import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { getAddress } from "viem";
import { fixtureFetch } from "@/tests/helpers/fetch";
import { parseJson } from "@/tests/helpers/read-json";
import { isRecord } from "@/shared/guards";
import type { CreateOrderResult, ReconciliationIntent } from "@/shared/funding/provider-contract";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { createProviderContext, FundingProviderFetchError } from "../../core/provider-context";
import { describeFundingAdapter } from "../../core/testing/describeFundingAdapter";
import { createIdrxSignature, idrxProvider, readExpiry } from "./adapter";
import { IDRX_API_ORIGIN, idrxManifest } from "./manifest";

const env = { IDRX_CLIENT_ID: "client", IDRX_CLIENT_SECRET: Buffer.from("synthetic-secret").toString("base64"), IDRX_CUSTOMER_NAME: "Synthetic Customer" };
const intent = {
  homeOrderId: "11111111-1111-4111-8111-111111111111",
  destination: "0x1111111111111111111111111111111111111111" as const,
  fiatAmount: "20000",
  returnUrl: "https://home.example/fund",
};
const providerOrderId = "synthetic-order-1";
const candidateOnramp = idrxProvider.onramp;
if (!candidateOnramp?.createQuote) throw new Error("IDRX fixture requires a quoting onramp.");
const onramp = candidateOnramp;
const createQuote = candidateOnramp.createQuote;
const lines: string[] = [];

function context(fetchImplementation: typeof fetch, timeoutMs?: number) {
  return createProviderContext({ manifest: idrxManifest, region: "ID", paymentMethodId: "qris", env, fetchImplementation, timeoutMs });
}

function reconciliation(ctx: ReturnType<typeof context>): ReconciliationIntent {
  return { ...intent, providerOrderId, transactionType: "MINT", chainId: ctx.binding.asset.chainId, tokenAddress: ctx.binding.asset.address, expectedTokenAmountAtomic: "2000000", tokenDecimals: ctx.binding.asset.decimals };
}

function quotePayload() {
  return { data: { baseAmount: "20000", toBeMinted: "20000", paymentAmount: "20000", fees: [] } };
}

function createPayload() {
  return { data: { merchantOrderId: providerOrderId, checkoutUrl: "https://checkout.idrx.co/?token=synthetic-token" } };
}

function codes() {
  return lines.map((line) => {
    const event = parseJson(line);
    if (!isRecord(event) || typeof event.code !== "string") throw new Error("Expected a provider log code.");
    return event.code;
  });
}

beforeEach(() => {
  lines.length = 0;
  setObservabilityLogWriterForTests((line) => lines.push(line));
});
afterEach(() => setObservabilityLogWriterForTests());

async function assertInvalidBody(response: () => Response, quoteCode: string) {
  const ctx = context(fixtureFetch(async () => response()));
  await expect(createQuote(intent, ctx)).rejects.toBeInstanceOf(Error);
  expect(codes()).toEqual([quoteCode]);
  expect(await onramp.createOrder(intent, ctx)).toEqual({ outcome: "ambiguous" });
  expect(codes()).toEqual([quoteCode]);
  expect(await onramp.getOrder(reconciliation(ctx), ctx)).toEqual({ state: "unknown", providerStatus: "INVALID_RESPONSE" });
  expect(codes()).toEqual([quoteCode, "PROVIDER_INVALID_RESPONSE"]);
}

describe("IDRX bounded provider requests", () => {
  test("preserves request URLs, serialization, signed headers and successful outcomes", async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const ctx = context(fixtureFetch(async (input, init = {}) => {
      const url = String(input);
      requests.push({ url, init });
      if (new URL(url).pathname === "/v2/transaction/mint-quote") return Response.json(quotePayload());
      if (new URL(url).pathname === "/transaction/mint-request") return Response.json(createPayload());
      return Response.json({ records: [] });
    }));
    expect(await createQuote(intent, ctx)).toMatchObject({ fiatAmount: "20000", tokenAmountAtomic: "2000000", fees: [], feesKnown: true });
    expect(await onramp.createOrder(intent, ctx)).toEqual({ outcome: "created", order: {
      providerOrderId, tokenAddress: ctx.binding.asset.address, expectedTokenAmountAtomic: "2000000", fees: [], expiresAt: null,
      instructions: { kind: "redirect", url: "https://checkout.idrx.co/?token=synthetic-token" },
    } });
    expect(await onramp.getOrder(reconciliation(ctx), ctx)).toEqual({ state: "awaiting-payment", providerStatus: "NOT_FOUND" });
    expect(requests.map(({ url }) => url)).toEqual([
      `${IDRX_API_ORIGIN}/v2/transaction/mint-quote?amount=20000&chainId=8453&paymentMethod=qris&channelId=QR`,
      `${IDRX_API_ORIGIN}/transaction/mint-request`,
      `${IDRX_API_ORIGIN}/transaction/user-transaction-history?transactionType=MINT&page=1&take=10&merchantOrderId=${providerOrderId}`,
    ]);
    const expectedBody = JSON.stringify({ toBeMinted: "20000", destinationWalletAddress: intent.destination, networkChainId: "8453", requestType: "idrx", expiryPeriod: 60, returnUrl: intent.returnUrl, paymentMethod: "qris", channelId: "QR", flow: "hosted" });
    for (const [index, { url, init }] of requests.entries()) {
      const method = index === 1 ? "POST" : "GET";
      const body = index === 1 ? expectedBody : "";
      const headers = new Headers(init.headers);
      const timestamp = headers.get("idrx-api-ts");
      if (!timestamp) throw new Error("Expected the signed request timestamp.");
      expect(init).toMatchObject({ method, cache: "no-store", redirect: "manual" });
      expect(init.body).toBe(index === 1 ? expectedBody : undefined);
      expect(Object.fromEntries(headers.entries())).toEqual({
        accept: "application/json", "content-type": "application/json", "user-agent": "home/idrx-funding-adapter", "idrx-api-key": env.IDRX_CLIENT_ID,
        "idrx-api-ts": timestamp, "idrx-api-sig": createIdrxSignature({ method, url, body, timestamp, secretKey: env.IDRX_CLIENT_SECRET }),
      });
    }
    expect(codes()).toEqual([]);
  });

  test("bounds oversized success streams and cancels them at all three sites", async () => {
    let cancellations = 0;
    const response = () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(64 * 1024 + 1)); },
      cancel() { cancellations += 1; },
    }, { highWaterMark: 0 }));
    const ctx = context(fixtureFetch(async () => response()));
    await expect(createQuote(intent, ctx)).rejects.toThrow("IDRX response is too large.");
    expect(await onramp.createOrder(intent, ctx)).toEqual({ outcome: "ambiguous" });
    expect(await onramp.getOrder(reconciliation(ctx), ctx)).toEqual({ state: "unknown", providerStatus: "INVALID_RESPONSE" });
    expect(cancellations).toBe(3);
    expect(codes()).toEqual(["PROVIDER_TRANSPORT", "PROVIDER_INVALID_RESPONSE"]);
  });

  test("rejects declared oversized success bodies before reading", async () => {
    await assertInvalidBody(() => new Response("{}", { headers: { "content-length": String(64 * 1024 + 1) } }), "PROVIDER_TRANSPORT");
  });

  test("treats truncated JSON as the existing parse failure at each site", async () => {
    await assertInvalidBody(() => new Response('{"data":'), "QUOTE_ECHO_MISMATCH");
  });

  test("rejects a truncated body even when the remaining bytes form valid JSON", async () => {
    await assertInvalidBody(() => new Response(JSON.stringify({ ...quotePayload(), ...createPayload(), records: [] }), { headers: { "content-length": "4096" } }), "PROVIDER_TRANSPORT");
  });

  test("rejects partial HTTP 206 responses", async () => {
    await assertInvalidBody(() => Response.json({ ...quotePayload(), ...createPayload(), records: [] }, { status: 206 }), "PROVIDER_TRANSPORT");
  });

  test("retains malformed JSON failure codes", async () => {
    await assertInvalidBody(() => new Response("not-json"), "QUOTE_ECHO_MISMATCH");
  });

  test("retains fatal UTF-8 read failure codes", async () => {
    await assertInvalidBody(() => new Response(new Uint8Array([0xff])), "PROVIDER_TRANSPORT");
  });

  test("maps the context deadline to the transport-failure path without retrying", async () => {
    let calls = 0;
    for (const site of ["quote", "create", "status"]) {
      const controller = new AbortController();
      const timeout = spyOn(AbortSignal, "timeout").mockImplementation(() => controller.signal);
      try {
        const ctx = context(fixtureFetch(() => {
          calls += 1;
          controller.abort();
          return new Promise<Response>(() => {});
        }), 100);
        if (site === "quote") {
          await expect(createQuote(intent, ctx)).rejects.toBeInstanceOf(FundingProviderFetchError);
        } else if (site === "create") {
          expect(await onramp.createOrder(intent, ctx)).toEqual({ outcome: "ambiguous" });
        } else {
          expect(await onramp.getOrder(reconciliation(ctx), ctx)).toEqual({ state: "unknown", providerStatus: "TRANSPORT_ERROR" });
        }
      } finally {
        timeout.mockRestore();
      }
    }
    expect(calls).toBe(3);
    expect(codes()).toEqual(["PROVIDER_TRANSPORT", "PROVIDER_TRANSPORT"]);
  });

  test("preserves definitive and ambiguous HTTP create classifications", async () => {
    const rejected: CreateOrderResult = { outcome: "rejected", message: "IDRX rejected the funding order." };
    const ambiguous: CreateOrderResult = { outcome: "ambiguous" };
    const scenarios: { status: number; payload: unknown; expected: CreateOrderResult }[] = [
      { status: 400, payload: { statusCode: 400, data: { code: "BANK_ACCOUNT_REQUIRED" } }, expected: { outcome: "rejected", message: "This bank transfer option is not available for this account yet. Choose another way to pay." } },
      { status: 400, payload: { data: { code: "OTHER_PROVIDER_ERROR" } }, expected: rejected },
      { status: 400, payload: { message: "channelId is required when paymentMethod is set" }, expected: rejected },
      { status: 400, payload: { message: "Unsupported VA channel: OTHER" }, expected: rejected },
      { status: 422, payload: { statusCode: 422, message: "Unsupported VA channel: OTHER" }, expected: rejected },
      { status: 400, payload: { message: "uncertain" }, expected: ambiguous },
      { status: 422, payload: { data: { code: "BANK_ACCOUNT_REQUIRED" } }, expected: ambiguous },
      { status: 422, payload: { message: "channelId is required when paymentMethod is set" }, expected: ambiguous },
      { status: 400, payload: { statusCode: 422, data: { code: "BANK_ACCOUNT_REQUIRED" } }, expected: ambiguous },
      ...[401, 403].map((status) => ({ status, payload: {}, expected: { outcome: "rejected" as const, message: "IDRX rejected the provider credentials or account eligibility." } })),
      ...[302, 408, 409, 429, 503].map((status) => ({ status, payload: { data: { code: "BANK_ACCOUNT_REQUIRED" } }, expected: ambiguous })),
    ];
    for (const { status, payload, expected } of scenarios) {
      let calls = 0;
      const ctx = context(fixtureFetch(async () => { calls += 1; return Response.json(payload, { status }); }));
      expect(await onramp.createOrder(intent, ctx), `HTTP ${status} ${JSON.stringify(payload)}`).toEqual(expected);
      expect(calls).toBe(1);
    }
    expect(codes()).toEqual([]);
  });

  test("keeps unreadable or oversized 400/422 bodies ambiguous", async () => {
    for (const status of [400, 422]) {
      for (const response of [
        () => new Response('{"data":', { status }),
        () => new Response(new Uint8Array([0xff]), { status }),
        () => new Response(" ".repeat(64 * 1024 + 1), { status }),
        () => Response.json({ message: "Unsupported VA channel: OTHER" }, { status, headers: { "content-length": String(64 * 1024 + 1) } }),
      ]) {
        const ctx = context(fixtureFetch(async () => response()));
        expect(await onramp.createOrder(intent, ctx)).toEqual({ outcome: "ambiguous" });
      }
    }
  });

  test("retains quote/status HTTP errors without reading their non-ok bodies", async () => {
    for (const status of [400, 503]) {
      let reads = 0;
      const ctx = context(fixtureFetch(async () => new Response(new ReadableStream<Uint8Array>({
        pull(controller) { reads += 1; controller.enqueue(new Uint8Array([0xff])); },
      }, { highWaterMark: 0 }), { status })));
      await expect(createQuote(intent, ctx)).rejects.toThrow(`IDRX quote failed with HTTP ${status}.`);
      expect(await onramp.getOrder(reconciliation(ctx), ctx)).toEqual({ state: "unknown", providerStatus: `HTTP_${status}` });
      expect(reads).toBe(0);
    }
    expect(codes()).toEqual(["PROVIDER_HTTP_4XX", "PROVIDER_HTTP_4XX", "PROVIDER_HTTP_5XX", "PROVIDER_HTTP_5XX"]);
  });
});

const checksumAddress = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" as const;
const lowercaseAddress = "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed" as const;
const invalidChecksumAddress = "0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" as const;

describeFundingAdapter({
  provider: idrxProvider, region: "ID", paymentMethodId: "qris", env, intent,
  reconciliationProviderOrderId: providerOrderId,
  successResponse: () => Response.json(createPayload()),
  invalidCreateResponses: [{ name: "wrong destination", response: () => Response.json({ data: { ...createPayload().data, destinationWalletAddress: "0x2222222222222222222222222222222222222222" } }) }],
  unknownStatusResponse: () => Response.json({ records: [{ merchantOrderId: providerOrderId, userMintStatus: "UNDOCUMENTED", paymentStatus: "PAID" }] }),
});

describe("IDRX branded provider ingress", () => {
  test.each([
    [lowercaseAddress, checksumAddress],
    [checksumAddress, lowercaseAddress],
  ] as const)("normalizes echoes without re-casing the signed mint body for %s", async (destination, echo) => {
    const requests: { url: string; init: RequestInit }[] = [];
    const ctx = context(fixtureFetch(async (input, init = {}) => {
      const url = String(input);
      requests.push({ url, init });
      if (init.method === "POST") return Response.json({ data: { ...createPayload().data, destinationWalletAddress: echo } });
      return Response.json({ records: [{ merchantOrderId: providerOrderId, destinationWalletAddress: echo, tokenAddress: getAddress(ctx.binding.asset.address), userMintStatus: "MINTED", paymentStatus: "PAID" }] });
    }));
    expect(await onramp.createOrder({ ...intent, destination }, ctx)).toMatchObject({ outcome: "created" });
    expect(await onramp.getOrder({ ...reconciliation(ctx), destination }, ctx)).toEqual({ state: "sent", providerStatus: "MINTED:PAID" });
    const firstRequest = requests[0];
    if (!firstRequest) throw new Error("Expected the mint request.");
    const { url, init } = firstRequest;
    const expectedBody = JSON.stringify({ toBeMinted: "20000", destinationWalletAddress: destination, networkChainId: "8453", requestType: "idrx", expiryPeriod: 60, returnUrl: intent.returnUrl, paymentMethod: "qris", channelId: "QR", flow: "hosted" });
    expect(init.body).toBe(expectedBody);
    const headers = new Headers(init.headers);
    const timestamp = headers.get("idrx-api-ts");
    if (!timestamp) throw new Error("Expected the signed mint timestamp.");
    const signature = createHmac("sha256", Buffer.from(env.IDRX_CLIENT_SECRET, "base64"))
      .update(timestamp).update("POST").update(url).update(expectedBody).digest("base64url");
    expect(headers.get("idrx-api-sig")).toBe(signature);
  });

  test.each([invalidChecksumAddress, "0x1234", `0x${"g".repeat(40)}`])("rejects invalid address alias %s on create and status", async (address) => {
    for (const field of ["destinationWalletAddress", "destinationAddress", "destination", "tokenAddress", "contractAddress", "assetAddress"]) {
      const ctx = context(fixtureFetch(async (_input, init) => init?.method === "POST"
        ? Response.json({ data: { ...createPayload().data, [field]: address } })
        : Response.json({ records: [{ merchantOrderId: providerOrderId, [field]: address, userMintStatus: "MINTED", paymentStatus: "PAID" }] })));
      expect(await onramp.createOrder({ ...intent, destination: lowercaseAddress }, ctx), field).toEqual({ outcome: "ambiguous" });
      expect(await onramp.getOrder({ ...reconciliation(ctx), destination: lowercaseAddress }, ctx), field).toEqual({ state: "unknown", providerStatus: "INTENT_MISMATCH" });
    }
  });

  test.each([invalidChecksumAddress, "0x1234"] as const)("rejects invalid reconciliation destination %s before I/O", async (destination) => {
    let calls = 0;
    const ctx = context(fixtureFetch(async () => { calls += 1; return Response.json({ records: [] }); }));
    expect(await onramp.getOrder({ ...reconciliation(ctx), destination }, ctx)).toEqual({ state: "unknown", providerStatus: "INVALID_RECONCILIATION_INTENT" });
    expect(calls).toBe(0);
  });

  test("normalizes uppercase hash aliases and retains case-insensitive alias equality", async () => {
    const ctx = context(fixtureFetch(async (_input, init) => {
      const hashes = { transactionHash: `0x${"AB".repeat(32)}`, txHash: `0x${"ab".repeat(32)}` };
      return init?.method === "POST"
        ? Response.json({ data: { ...createPayload().data, ...hashes } })
        : Response.json({ records: [{ merchantOrderId: providerOrderId, userMintStatus: "MINTED", paymentStatus: "PAID", ...hashes }] });
    }));
    expect(await onramp.createOrder(intent, ctx)).toMatchObject({ outcome: "created" });
    expect(await onramp.getOrder(reconciliation(ctx), ctx)).toEqual({ state: "sent", providerStatus: "MINTED:PAID", transactionHash: `0x${"ab".repeat(32)}` });
  });

  test.each(["0x1234", `0x${"g".repeat(64)}`, `0X${"AB".repeat(32)}`, 42])("rejects malformed transaction hash %s without treating the order as sent", async (transactionHash) => {
    const ctx = context(fixtureFetch(async (_input, init) => init?.method === "POST"
      ? Response.json({ data: { ...createPayload().data, transactionHash } })
      : Response.json({ records: [{ merchantOrderId: providerOrderId, userMintStatus: "MINTED", paymentStatus: "PAID", transactionHash }] })));
    expect(await onramp.createOrder(intent, ctx)).toEqual({ outcome: "ambiguous" });
    expect(await onramp.getOrder(reconciliation(ctx), ctx)).toEqual({ state: "unknown", providerStatus: "INTENT_MISMATCH" });
  });
});

describe("readExpiry", () => {
  test("keeps an explicit offset and normalizes to ISO", () => {
    expect(readExpiry("2026-09-12T15:00:00+07:00")).toBe("2026-09-12T08:00:00.000Z");
    expect(readExpiry("2026-09-12 15:00:00+0700")).toBe("2026-09-12T08:00:00.000Z");
    expect(readExpiry("2026-09-12T15:00:00Z")).toBe("2026-09-12T15:00:00.000Z");
  });

  test("ignores parseable values with no real offset", () => {
    expect(readExpiry("+2026")).toBeNull();
    expect(readExpiry("-2026")).toBeNull();
    expect(readExpiry("2026-09-12 15:00:00")).toBeNull();
    expect(readExpiry("Fri, 12 Sep 2026 10:00:00 GMT")).toBeNull();
  });

  test("normalizes a rolled-over calendar date to a stored-safe timestamp", () => {
    expect(readExpiry("2026-02-30T00:00:00Z")).toBe("2026-03-02T00:00:00.000Z");
  });

  test("throws for an invalid expiry", () => {
    expect(() => readExpiry("garbage")).toThrow("Invalid IDRX expiry.");
  });
});
