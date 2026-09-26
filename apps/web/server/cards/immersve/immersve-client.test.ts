import { expect, test } from "bun:test";
import { createImmersveClient } from "./immersve-client";

const config = { origin: "https://test.immersve.com" as const, apiKey: "synthetic-key", apiSecret: "synthetic-secret" };

test("pins API origin, strips credentials from public JWKS, and rejects redirects without following", async () => {
  let calls = 0;
  const client = createImmersveClient(config, { fetchImplementation: (async (url, init) => {
    calls++;
    expect(String(url)).toBe("https://test.immersve.com/.well-known/jwks.json");
    expect(init?.redirect).toBe("manual");
    expect(new Headers(init?.headers).has("x-api-secret")).toBe(false);
    return new Response(null, { status: 302, headers: { location: "https://evil.test/keys" } });
  }) as typeof fetch });
  await expect(client.getJwks()).rejects.toThrow("Immersve response status 302");
  expect(calls).toBe(1);
  expect(() => createImmersveClient({ ...config, origin: "https://evil.test" as typeof config.origin })).toThrow();
});

test("bounds requests and does not expose credentials in failures", async () => {
  const client = createImmersveClient(config, { timeoutMs: 1, fetchImplementation: (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch });
  await expect(client.getSupportedRegions("a".repeat(32))).rejects.toThrow("Immersve request timed out");
  const failed = createImmersveClient(config, { fetchImplementation: (async () => { throw new Error(config.apiSecret); }) as unknown as typeof fetch });
  await expect(failed.getSupportedRegions("a".repeat(32))).rejects.toThrow("Immersve request failed");
});

test("authenticates supported-regions without exposing raw responses", async () => {
  const client = createImmersveClient(config, { fetchImplementation: (async (url, init) => {
    expect(String(url)).toBe(`https://test.immersve.com/api/accounts/${"a".repeat(32)}/supported-regions`);
    expect(new Headers(init?.headers).get("x-api-secret")).toBe(config.apiSecret);
    return Response.json({ regions: [] });
  }) as typeof fetch });
  expect(await client.getSupportedRegions("a".repeat(32))).toEqual({ regions: [] });
  expect(() => client.getSupportedRegions("../other")).toThrow();
});
