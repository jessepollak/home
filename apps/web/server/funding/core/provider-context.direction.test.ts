import "server-only";

import { describe, expect, spyOn, test } from "bun:test";
import { fixtureFetch } from "@/tests/helpers/fetch";
import type { FundingProviderManifest } from "@/shared/funding/provider-contract";
import { FundingProviderConfigurationError, FundingProviderFetchError, createProviderContext, resolveWebhookEnvironment } from "./provider-context";

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

function requestContext(fetchImplementation: typeof fetch, timeoutMs?: number) {
  return createProviderContext({
    manifest,
    region: "US",
    paymentMethodId: "shared",
    env: { ON_KEY: "on" },
    fetchImplementation,
    timeoutMs,
  });
}

describe("bounded funding provider requests", () => {
  test("rejects disallowed origins before dispatch", async () => {
    let calls = 0;
    const ctx = requestContext(fixtureFetch(async () => { calls += 1; return Response.json({}); }));
    await expect(ctx.request("https://off.example/path", { maxBytes: 1024 })).rejects.toBeInstanceOf(FundingProviderFetchError);
    expect(calls).toBe(0);
  });

  test("maps the configured timeout even when the transport ignores cancellation", async () => {
    const controller = new AbortController();
    const timeout = spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      expect(ms).toBeLessThanOrEqual(100);
      expect(ms).toBeGreaterThan(0);
      return controller.signal;
    });
    try {
      const ctx = requestContext(fixtureFetch(() => {
        controller.abort();
        return new Promise<Response>(() => {});
      }), 100);
      expect(await ctx.request("https://on.example/path", { maxBytes: 1024 })).toEqual({ ok: false, kind: "timeout" });
    } finally {
      timeout.mockRestore();
    }
  });

  test("maps an injected abort during dispatch", async () => {
    const controller = new AbortController();
    const ctx = requestContext(fixtureFetch(() => {
      controller.abort();
      return new Promise<Response>(() => {});
    }));
    expect(await ctx.request("https://on.example/path", { maxBytes: 1024, signal: controller.signal })).toEqual({ ok: false, kind: "aborted" });
  });

  test("maps a streamed response above the byte limit to oversized", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new TextEncoder().encode("12345")); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const ctx = requestContext(fixtureFetch(async () => new Response(body)));
    expect(await ctx.request("https://on.example/path", { maxBytes: 4 })).toEqual({ ok: false, kind: "oversized" });
    expect(cancelled).toBeTrue();
  });

  test("retains HTTP status without reading an unrequested error body", async () => {
    let reads = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { reads += 1; controller.enqueue(new Uint8Array([1])); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const ctx = requestContext(fixtureFetch(async () => new Response(body, { status: 503 })));
    expect(await ctx.request("https://on.example/path", { maxBytes: 1024 })).toEqual({ ok: false, kind: "http", status: 503 });
    expect(reads).toBe(0);
    expect(cancelled).toBeTrue();
  });

  test("retains an explicitly bounded HTTP error body", async () => {
    const ctx = requestContext(fixtureFetch(async () => new Response("declined", { status: 400 })));
    expect(await ctx.request("https://on.example/path", { maxBytes: 1024, errorBodyMaxBytes: 32 })).toEqual({
      ok: false, kind: "http", status: 400, body: new TextEncoder().encode("declined"),
    });
  });

  test("passes parsed JSON to the parser and forwards request options", async () => {
    const ctx = requestContext(fixtureFetch(async (input, init) => {
      expect(input).toBe("https://on.example/path");
      expect(init).toMatchObject({ method: "POST", headers: { Accept: "application/json" }, body: "request", cache: "no-store", redirect: "manual" });
      return Response.json({ amount: "3" }, { status: 201 });
    }));
    const result = await ctx.request("https://on.example/path", {
      method: "POST", headers: { Accept: "application/json" }, body: "request", maxBytes: 1024,
      responseType: "json", parse: (value) => { expect(value).toEqual({ amount: "3" }); return "parsed"; },
    });
    expect(result).toEqual({ ok: true, status: 201, value: "parsed" });
  });

  test("maps transport failure rather than rejecting", async () => {
    const ctx = requestContext(fixtureFetch(async () => { throw new Error("connection lost"); }));
    expect(await ctx.request("https://on.example/path", { maxBytes: 1024 })).toEqual({ ok: false, kind: "transport" });
  });

  test("maps malformed JSON to invalid", async () => {
    const ctx = requestContext(fixtureFetch(async () => new Response("not-json")));
    expect(await ctx.request("https://on.example/path", { maxBytes: 1024 })).toEqual({ ok: false, kind: "invalid" });
  });

  test("maps parser failure to invalid", async () => {
    const ctx = requestContext(fixtureFetch(async () => Response.json({})));
    expect(await ctx.request("https://on.example/path", { maxBytes: 1024, parse: () => { throw new Error("invalid envelope"); } })).toEqual({ ok: false, kind: "invalid" });
  });

  test("maps an invalid URL to invalid without dispatch", async () => {
    let calls = 0;
    const ctx = requestContext(fixtureFetch(async () => { calls += 1; return Response.json({}); }));
    expect(await ctx.request("not a URL", { maxBytes: 1024 })).toEqual({ ok: false, kind: "invalid" });
    expect(calls).toBe(0);
  });

  test("maps an invalid response budget to invalid without dispatch", async () => {
    let calls = 0;
    const ctx = requestContext(fixtureFetch(async () => { calls += 1; return Response.json({}); }));
    expect(await ctx.request("https://on.example/path", { maxBytes: 0 })).toEqual({ ok: false, kind: "invalid" });
    expect(calls).toBe(0);
  });
});

describe("directional funding provider context", () => {
  test("distinguishes identical method ids and grants only selected origins and env", async () => {
    const calls: string[] = [];
    const transport = fixtureFetch(async (input) => { calls.push(String(input)); return new Response(); });
    const on = createProviderContext({ manifest, region: "US", direction: "onramp", paymentMethodId: "shared", env: { ON_KEY: "on", OFF_KEY: "off" }, fetchImplementation: transport });
    expect(on.binding).toMatchObject({ direction: "onramp", currency: "USD", paymentMethod: { label: "On" } });
    expect(on.env).toEqual({ ON_KEY: "on" });
    await expect(on.request("https://off.example/path", { maxBytes: 1024 })).rejects.toBeInstanceOf(FundingProviderFetchError);

    const off = createProviderContext({ manifest, region: "US", direction: "offramp", paymentMethodId: "shared", env: { ON_KEY: "on", OFF_KEY: "off" }, fetchImplementation: transport, sandbox: true });
    expect(off.binding).toMatchObject({ direction: "offramp", currency: "USD", paymentMethod: { label: "Off" } });
    expect(off.env).toEqual({ OFF_KEY: "off" });
    expect(off.deployment.contracts.escrow).toBe("0x4444444444444444444444444444444444444444");
    await expect(off.request("https://off.example/path", { maxBytes: 1024 })).rejects.toBeInstanceOf(FundingProviderFetchError);
    await off.request("https://sandbox-off.example/path", { maxBytes: 1024 });
    expect(calls).toHaveLength(1);
  });

  test("resolves string and country webhook environment declarations without exposing other bindings", () => {
    expect(resolveWebhookEnvironment({ signatureHeader: "x-signature", env: "SHARED_SECRET" }, "US")).toBe("SHARED_SECRET");
    expect(resolveWebhookEnvironment({ signatureHeader: "x-signature", env: { US: "US_SECRET", BR: "BR_SECRET" } }, "US")).toBe("US_SECRET");
    expect(resolveWebhookEnvironment({ signatureHeader: "x-signature", env: { BR: "BR_SECRET" } }, "US")).toBeUndefined();

    const regional = {
      ...manifest,
      onramp: { ...manifest.onramp, webhook: { signatureHeader: "x-signature", env: { US: "US_SECRET" } } },
      bindings: [{ ...manifest.bindings[0], directions: { ...manifest.bindings[0].directions, onramp: { ...manifest.bindings[0].directions.onramp, env: ["ON_KEY", "US_SECRET"] } } }],
    } as const satisfies FundingProviderManifest;
    const ctx = createProviderContext({ manifest: regional, region: "US", paymentMethodId: "shared", env: { ON_KEY: "on", US_SECRET: "us", BR_SECRET: "br" } });
    expect(ctx.env).toEqual({ ON_KEY: "on", US_SECRET: "us" });
  });

  test("fails sandbox context creation when a direction has no sandbox", () => {
    expect(() => createProviderContext({ manifest: { ...manifest, offramp: { production: manifest.offramp.production } }, region: "US", direction: "offramp", paymentMethodId: "shared", env: { OFF_KEY: "off" }, sandbox: true })).toThrow(FundingProviderConfigurationError);
  });
});
