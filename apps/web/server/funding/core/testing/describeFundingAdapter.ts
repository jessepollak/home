import { describe, expect, test } from "bun:test";
import type { CountryCode } from "@/config/regions";
import type { FundingAsset } from "@/shared/funding/assets";
import type {
  FundingProvider,
  Instruction,
  OrderIntent,
  ReconciliationIntent,
} from "@/shared/funding/provider-contract";
import {
  FundingProviderConfigurationError,
  FundingProviderFetchError,
  createProviderContext,
} from "../provider-context";

type ConformanceOptions = {
  provider: FundingProvider;
  region: CountryCode;
  paymentMethodId: string;
  env: Readonly<Record<string, string>>;
  intent: OrderIntent;
  successResponse: (requestIndex: number, url: string) => Response;
  createRequestPath?: string;
  reconciliationProviderOrderId?: string;
  invalidCreateResponses: ReadonlyArray<{
    name: string;
    response: (requestIndex: number, url: string) => Response;
  }>;
  unknownStatusResponse: (requestIndex: number, url: string) => Response;
};

type RecordedRequest = {
  url: string;
  init: RequestInit;
};

export function describeFundingAdapter(options: ConformanceOptions): void {
  const suiteName = `${options.provider.manifest.id}:${options.paymentMethodId}`;

  describe(`funding adapter conformance · ${suiteName}`, () => {
    test("fails closed before any outbound call when declared environment is missing", () => {
      let outboundCalls = 0;
      expect(() => createProviderContext({
        manifest: options.provider.manifest,
        region: options.region,
        paymentMethodId: options.paymentMethodId,
        env: {},
        fetchImplementation: (async () => {
          outboundCalls += 1;
          return new Response();
        }) as unknown as typeof fetch,
      })).toThrow(FundingProviderConfigurationError);
      expect(outboundCalls).toBe(0);
    });

    test("exposes declared environment only and enforces API origins with manual redirects", async () => {
      const binding = options.provider.manifest.bindings.find(
        (candidate) => candidate.region === options.region,
      );
      expect(binding).toBeDefined();
      let outboundCalls = 0;
      let redirectMode: RequestRedirect | undefined;
      const ctx = createProviderContext({
        manifest: options.provider.manifest,
        region: options.region,
        paymentMethodId: options.paymentMethodId,
        env: { ...options.env, UNDECLARED_SECRET: "must-not-leak" },
        fetchImplementation: (async (
          _input: RequestInfo | URL,
          init?: RequestInit,
        ) => {
          outboundCalls += 1;
          redirectMode = init?.redirect;
          return new Response(null, { status: 302, headers: { location: "https://evil.example" } });
        }) as unknown as typeof fetch,
      });
      expect(Object.keys(ctx.env).sort()).toEqual([...(binding?.env ?? [])].sort());
      expect(ctx.env).not.toHaveProperty("UNDECLARED_SECRET");

      const apiOrigin = options.provider.manifest.apiOrigins[0];
      if (!apiOrigin) throw new Error("Conformance requires an API origin.");
      const allowedUrl = new URL("/conformance", apiOrigin);
      await ctx.fetch(allowedUrl, { redirect: "follow" });
      expect(redirectMode).toBe("manual");
      expect(outboundCalls).toBe(1);

      await expect(ctx.fetch("https://evil.example/conformance")).rejects.toBeInstanceOf(
        FundingProviderFetchError,
      );
      expect(outboundCalls).toBe(1);

      let abortedCalls = 0;
      const abortedCtx = createProviderContext({
        manifest: options.provider.manifest,
        region: options.region,
        paymentMethodId: options.paymentMethodId,
        env: options.env,
        fetchImplementation: (async () => {
          abortedCalls += 1;
          return new Response();
        }) as unknown as typeof fetch,
      });
      const alreadyAborted = new AbortController();
      alreadyAborted.abort();
      await expect(abortedCtx.fetch(allowedUrl, {
        signal: alreadyAborted.signal,
      })).rejects.toBeInstanceOf(FundingProviderFetchError);
      expect(abortedCalls).toBe(0);

      const timeoutCtx = createProviderContext({
        manifest: options.provider.manifest,
        region: options.region,
        paymentMethodId: options.paymentMethodId,
        env: options.env,
        timeoutMs: 5,
        fetchImplementation: (async () =>
          new Promise<Response>(() => undefined)) as unknown as typeof fetch,
      });
      await expect(timeoutCtx.fetch(allowedUrl)).rejects.toBeInstanceOf(
        FundingProviderFetchError,
      );
    });

    test("binds the core destination, reference policy, asset, and exact atomic amount", async () => {
      const requests: RecordedRequest[] = [];
      const ctx = createProviderContext({
        manifest: options.provider.manifest,
        region: options.region,
        paymentMethodId: options.paymentMethodId,
        env: options.env,
        fetchImplementation: (async (
          input: RequestInfo | URL,
          init: RequestInit = {},
        ) => {
          requests.push({
            url: input instanceof Request ? input.url : String(input),
            init,
          });
          return options.successResponse(requests.length, input instanceof Request ? input.url : String(input));
        }) as unknown as typeof fetch,
      });
      const result = await options.provider.createOrder(options.intent, ctx);
      const createRequests = options.createRequestPath
        ? requests.filter((request) => new URL(request.url).pathname === options.createRequestPath)
        : requests;
      expect(createRequests).toHaveLength(1);
      const body = parseRequestBody(createRequests[0]?.init.body);
      expect(containsValue(body, options.intent.destination)).toBe(true);
      if (options.provider.manifest.reference === "home") {
        expect(containsValue(body, options.intent.homeOrderId)).toBe(true);
      }

      expect(result.outcome).toBe("created");
      if (result.outcome !== "created") return;
      expect(result.order.tokenAddress.toLowerCase()).toBe(
        ctx.binding.asset.address.toLowerCase(),
      );
      expect(result.order.expectedTokenAmountAtomic).toBe(
        decimalToAtomic(options.intent.fiatAmount, ctx.binding.asset.decimals),
      );
      assertInstructionIsSafe(result.order.instructions, options.provider.manifest.redirectOrigins);
    });

    test("fails closed on contradictory create echoes without retrying", async () => {
      expect(options.invalidCreateResponses.length).toBeGreaterThan(0);
      for (const scenario of options.invalidCreateResponses) {
        let calls = 0;
        let createCalls = 0;
        const ctx = createProviderContext({
          manifest: options.provider.manifest,
          region: options.region,
          paymentMethodId: options.paymentMethodId,
          env: options.env,
          fetchImplementation: (async (input: RequestInfo | URL) => {
            calls += 1;
            const url = input instanceof Request ? input.url : String(input);
            if (!options.createRequestPath || new URL(url).pathname === options.createRequestPath) createCalls += 1;
            return scenario.response(calls, url);
          }) as unknown as typeof fetch,
        });
        const result = await options.provider.createOrder(options.intent, ctx);
        expect(result, scenario.name).toEqual({ outcome: "ambiguous" });
        expect(createCalls, scenario.name).toBe(1);
      }
    });

    test("returns ambiguous after transport loss or uncertain HTTP status without retrying", async () => {
      const failures: ReadonlyArray<{
        name: string;
        response: () => Promise<Response>;
      }> = [
        {
          name: "transport loss",
          response: async () => { throw new TypeError("connection lost"); },
        },
        ...[302, 408, 409, 422, 429, 503].map((status) => ({
          name: `HTTP ${status}`,
          response: async () => new Response("uncertain", { status }),
        })),
      ];
      for (const failure of failures) {
        let calls = 0;
        let createCalls = 0;
        const ctx = createProviderContext({
          manifest: options.provider.manifest,
          region: options.region,
          paymentMethodId: options.paymentMethodId,
          env: options.env,
          fetchImplementation: (async (input: RequestInfo | URL) => {
            calls += 1;
            const url = input instanceof Request ? input.url : String(input);
            const isCreate = !options.createRequestPath || new URL(url).pathname === options.createRequestPath;
            if (!isCreate) return options.successResponse(calls, url);
            createCalls += 1;
            return failure.response();
          }) as unknown as typeof fetch,
        });
        const result = await options.provider.createOrder(options.intent, ctx);
        expect(result, failure.name).toEqual({ outcome: "ambiguous" });
        expect(createCalls, failure.name).toBe(1);
      }
    });

    test("maps an unrecognized provider status to unknown", async () => {
      let calls = 0;
      const ctx = createProviderContext({
        manifest: options.provider.manifest,
        region: options.region,
        paymentMethodId: options.paymentMethodId,
        env: options.env,
        fetchImplementation: (async (input: RequestInfo | URL) => {
          calls += 1;
          return options.unknownStatusResponse(calls, input instanceof Request ? input.url : String(input));
        }) as unknown as typeof fetch,
      });
      await expect(options.provider.getOrder(
        reconciliationIntent(options, ctx.binding.asset),
        ctx,
      )).resolves.toMatchObject({ state: "unknown" });
    });
  });
}

function reconciliationIntent(
  options: ConformanceOptions,
  asset: FundingAsset,
): ReconciliationIntent {
  return {
    homeOrderId: options.intent.homeOrderId,
    providerOrderId: options.reconciliationProviderOrderId ?? "synthetic-order-1",
    providerQuoteId: options.intent.quote?.providerQuoteId,
    customerRef: options.intent.customerRef,
    transactionType: "MINT",
    chainId: asset.chainId,
    tokenAddress: asset.address,
    destination: options.intent.destination,
    fiatAmount: options.intent.fiatAmount,
    expectedTokenAmountAtomic: decimalToAtomic(
      options.intent.fiatAmount,
      asset.decimals,
    ),
    tokenDecimals: asset.decimals,
  };
}

function parseRequestBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== "string") return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function containsValue(value: unknown, expected: string): boolean {
  if (value === expected) return true;
  if (Array.isArray(value)) return value.some((item) => containsValue(item, expected));
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some((item) => containsValue(item, expected));
}

function decimalToAtomic(value: string, decimals: number): string {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  if (!match || !Number.isSafeInteger(decimals) || decimals < 0) {
    throw new Error("The conformance amount is invalid.");
  }
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new Error("The conformance amount exceeds the asset precision.");
  }
  return (
    BigInt(match[1]) * BigInt(10) ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0")
  ).toString(10);
}

function assertInstructionIsSafe(
  instruction: Instruction,
  redirectOrigins: ReadonlyArray<string> | undefined,
): void {
  if (instruction.kind !== "redirect") return;
  expect(redirectOrigins?.length).toBeGreaterThan(0);
  const url = new URL(instruction.url);
  expect(url.protocol).toBe("https:");
  expect(redirectOrigins).toContain(url.origin);
  expect(url.username).toBe("");
  expect(url.password).toBe("");
  expect(url.hash).toBe("");
}
