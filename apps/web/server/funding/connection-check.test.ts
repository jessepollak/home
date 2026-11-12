import { describe, expect, test } from "bun:test";
import { fixtureFetch } from "@/tests/helpers/fetch";
import { createProviderContext } from "./core/provider-context";
import { createCoinbaseProvider } from "./providers/coinbase/adapter";
import { coinbaseManifest } from "./providers/coinbase/manifest";
import { idrxProvider } from "./providers/idrx/adapter";
import { ripioProvider } from "./providers/ripio/adapter";
import { createPeerProvider } from "./providers/peer/adapter";
import { peerManifest } from "./providers/peer/manifest";
import type { FundingProvider, ProviderContext } from "@/shared/funding/provider-contract";
import { checkFundingConnection } from "./connection-check";

const coinbase = createCoinbaseProvider({ generateJwtImplementation: async () => "synthetic-jwt" });
const cdpEnv = { CDP_API_KEY_ID: "synthetic-id", CDP_API_KEY_SECRET: "synthetic-secret" };
const idrxEnv = { IDRX_CLIENT_ID: "synthetic-id", IDRX_CLIENT_SECRET: "c2VjcmV0", IDRX_CUSTOMER_NAME: "Synthetic" };
const ripioEnv = Object.fromEntries(["AR", "BR", "CO"].flatMap((region) => [`RIPIO_CLIENT_ID_${region}`, `RIPIO_CLIENT_SECRET_${region}`, `RIPIO_WEBHOOK_SECRET_${region}`].map((name) => [name, "synthetic"])));

function onrampContext(provider: FundingProvider, env: Record<string, string>, fetchImplementation: typeof fetch): ProviderContext {
  const binding = provider.manifest.bindings[0];
  const paymentMethodId = binding?.directions.onramp?.paymentMethods[0]?.id;
  if (!binding || !paymentMethodId) throw new Error("fixture provider has no onramp binding");
  return createProviderContext({ manifest: provider.manifest, region: binding.region, paymentMethodId, env, fetchImplementation });
}

function runCheck(provider: FundingProvider, ctx: ProviderContext) {
  if (!provider.checkConnection) throw new Error("fixture provider has no connection check");
  return provider.checkConnection(ctx);
}

const cases = [
  { name: "IDRX", provider: idrxProvider, env: idrxEnv, success: { records: [] }, connectedStatus: 200 },
  { name: "Coinbase", provider: coinbase, env: cdpEnv, success: {}, connectedStatus: 404 },
] as const;
for (const item of cases) {
  describe(`${item.name} connection check`, () => {
    test.each([200, 201, 401, 403, 404, 400, 429, 500, 503])("classifies HTTP %i without mutations or retries", async (status) => {
      let calls = 0;
      const ctx = onrampContext(item.provider, item.env, fixtureFetch(async (input, init) => {
        calls += 1;
        expect(init?.method).toBe("GET");
        expect(init?.body).toBeUndefined();
        const url = new URL(String(input));
        const headers = new Headers(init?.headers);
        if (item.name === "IDRX") {
          expect(url.pathname).toBe("/transaction/user-transaction-history");
          expect(Object.fromEntries(url.searchParams)).toEqual({ transactionType: "MINT", page: "1", take: "1" });
          expect(headers.get("idrx-api-sig")).toBeTruthy();
        } else {
          expect(url.pathname).toMatch(/^\/platform\/v2\/onramp\/orders\/[a-f0-9-]{36}$/);
          expect(headers.get("authorization")).toBe("Bearer synthetic-jwt");
        }
        return Response.json(item.success, { status });
      }));
      const expected = status === 401 || status === 403 ? "rejected" : status >= 500 ? "unreachable" : status === item.connectedStatus ? "connected" : "inconclusive";
      expect(await runCheck(item.provider, ctx)).toBe(expected);
      expect(calls).toBe(1);
    });
    test("transport exceptions remain unreachable", async () => {
      expect(await runCheck(item.provider, onrampContext(item.provider, item.env, fixtureFetch(async () => { throw new Error("private provider failure"); })))).toBe("unreachable");
    });
    test.each([null, {}, { records: {} }, "invalid JSON"])("invalid success body never means connected: %j", async (body) => {
      const ctx = onrampContext(item.provider, item.env, fixtureFetch(async () => typeof body === "string" ? new Response(body) : Response.json(body)));
      expect(await runCheck(item.provider, ctx)).toBe("inconclusive");
    });
  });
}

test("Coinbase signing failures reject malformed credentials without a network request", async () => {
  const provider = createCoinbaseProvider({ generateJwtImplementation: async () => { throw new Error("malformed private key"); } });
  let calls = 0;
  const ctx = onrampContext(provider, cdpEnv, fixtureFetch(async () => { calls += 1; return Response.json({}, { status: 404 }); }));
  expect(await runCheck(provider, ctx)).toBe("rejected");
  expect(calls).toBe(0);
});

describe("Ripio connection check", () => {
  test.each([200, 401, 403, 404, 400, 500])("maps catalog HTTP %i after exactly one token exchange", async (status) => {
    const methods: string[] = [];
    const ctx = onrampContext(ripioProvider, ripioEnv, fixtureFetch(async (input, init) => {
      methods.push(init?.method ?? "GET");
      if (new URL(String(input)).pathname === "/oauth2/token/") return Response.json({ access_token: "synthetic-access-token", expires_in: 3600 });
      expect(String(input)).toBe("https://skala.ripio.com/api/v1/depositNetworks/?include_currency=true");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-access-token");
      return Response.json([], { status });
    }));
    expect(await runCheck(ripioProvider, ctx)).toBe(status === 200 ? "connected" : status === 401 || status === 403 ? "rejected" : status >= 500 ? "unreachable" : "inconclusive");
    expect(methods).toEqual(["POST", "GET"]);
  });
  test.each([401, 403, 500])("token HTTP %i stops before catalog", async (status) => {
    let calls = 0;
    const ctx = onrampContext(ripioProvider, ripioEnv, fixtureFetch(async () => { calls += 1; return Response.json({}, { status }); }));
    expect(await runCheck(ripioProvider, ctx)).toBe(status === 500 ? "unreachable" : "rejected");
    expect(calls).toBe(1);
  });
  test.each([null, {}, { error: "private provider failure" }, { networks: {} }])("invalid catalog envelope is inconclusive: %j", async (body) => {
    const ctx = onrampContext(ripioProvider, ripioEnv, fixtureFetch(async (input) =>
      new URL(String(input)).pathname === "/oauth2/token/"
        ? Response.json({ access_token: "synthetic-access-token", expires_in: 3600 })
        : Response.json(body),
    ));
    expect(await runCheck(ripioProvider, ctx)).toBe("inconclusive");
  });
  test("empty catalog envelope does not require a country entitlement", async () => {
    const ctx = onrampContext(ripioProvider, ripioEnv, fixtureFetch(async (input) =>
      new URL(String(input)).pathname === "/oauth2/token/"
        ? Response.json({ access_token: "synthetic-access-token", expires_in: 3600 })
        : Response.json({ networks: [] }),
    ));
    expect(await runCheck(ripioProvider, ctx)).toBe("connected");
  });
  test("invalid token and malformed catalog JSON are inconclusive; transport is unreachable", async () => {
    for (const step of ["token", "catalog", "transport"]) {
      const ctx = onrampContext(ripioProvider, ripioEnv, fixtureFetch(async (input) => {
        if (step === "transport") throw new Error("private");
        if (step === "catalog" && new URL(String(input)).pathname === "/oauth2/token/") return Response.json({ access_token: "synthetic-access-token", expires_in: 3600 });
        return new Response("not JSON");
      }));
      expect(await runCheck(ripioProvider, ctx)).toBe(step === "transport" ? "unreachable" : "inconclusive");
    }
  });
});

function peerContext() {
  return createProviderContext({ manifest: peerManifest, region: "US", direction: "offramp", paymentMethodId: "cashapp", env: {}, sandbox: true });
}

function rpcRequestId(value: unknown): number {
  if (typeof value !== "object" || value === null || !("id" in value) || typeof value.id !== "number") throw new Error("The RPC request has no numeric id.");
  return value.id;
}

function peerRpc(result: unknown, options: { status?: number; failure?: boolean } = {}) {
  const requests: unknown[] = [];
  const fetchImpl = fixtureFetch(async (_input, init) => {
    if (options.failure) throw new Error("private RPC failure");
    const request: unknown = JSON.parse(String(init?.body));
    requests.push(request);
    return options.status
      ? new Response("upstream failure", { status: options.status })
      : Response.json({ jsonrpc: "2.0", id: rpcRequestId(request), result });
  });
  return { requests, fetchImpl };
}

test.each([
  ["0x1234", "connected"],
  ["0x", "inconclusive"],
  [["0x1234"], "inconclusive"],
  [undefined, "inconclusive"],
] as const)("Peer classifies escrow code %j as %s with one eth_getCode and no other call", async (result, expected) => {
  const { requests, fetchImpl } = peerRpc(result);
  expect(await runCheck(createPeerProvider({ fetchImpl }), peerContext())).toBe(expected);
  expect(requests).toEqual([{ jsonrpc: "2.0", id: expect.any(Number), method: "eth_getCode", params: [peerManifest.offramp.sandbox.contracts.escrow, "latest"] }]);
});

test("Peer maps transport, HTTP, abort and malformed RPC responses away from connected", async () => {
  expect(await runCheck(createPeerProvider({ fetchImpl: peerRpc(undefined, { failure: true }).fetchImpl }), peerContext())).toBe("unreachable");
  expect(await runCheck(createPeerProvider({ fetchImpl: peerRpc("0x1234", { status: 502 }).fetchImpl }), peerContext())).toBe("unreachable");
  const aborted = peerRpc("0x1234");
  expect(await runCheck(createPeerProvider({ fetchImpl: aborted.fetchImpl }), { ...peerContext(), signal: AbortSignal.abort() })).toBe("unreachable");
  expect(aborted.requests).toEqual([]);
  const malformed = fixtureFetch(async () => new Response("not JSON"));
  expect(await runCheck(createPeerProvider({ fetchImpl: malformed }), peerContext())).toBe("inconclusive");
});

describe("connection provider failures", () => {
  test("missing configuration performs zero network requests", async () => {
    let calls = 0;
    const result = await checkFundingConnection({ providerId: "ripio", providers: [ripioProvider], env: {}, fetchImplementation: fixtureFetch(async () => { calls += 1; throw new Error("unexpected request"); }) });
    expect(result.status).toBe("not-configured");
    expect(result.scopes).toEqual(["AR", "BR", "CO"].map((region) => ({ regions: [region], status: "not-configured" })));
    expect(calls).toBe(0);
  });
  test("adapter throws are scrubbed unreachable; configuration throws are inconclusive", async () => {
    const provider: FundingProvider = { manifest: coinbaseManifest, async checkConnection() { throw new Error("credential/private-body"); } };
    const result = await checkFundingConnection({ providerId: "coinbase", providers: [provider], env: cdpEnv, now: () => new Date("2026-10-21T12:00:00.000Z") });
    expect(result).toEqual({ providerId: "coinbase", checkedAt: "2026-10-21T12:00:00.000Z", status: "unreachable", scopes: [{ regions: ["US"], status: "unreachable" }] });
    expect((await checkFundingConnection({ providerId: "coinbase", providers: [provider], env: { ...cdpEnv, COINBASE_ONRAMP_MODE: "invalid" } })).status).toBe("inconclusive");
  });
  test("overall deadline aborts even a non-cooperative adapter", async () => {
    let signal: AbortSignal | undefined;
    const provider: FundingProvider = { manifest: coinbaseManifest, async checkConnection(ctx) { signal = ctx.signal; return new Promise(() => {}); } };
    expect((await checkFundingConnection({ providerId: "coinbase", providers: [provider], env: cdpEnv, timeoutMs: 1 })).status).toBe("unreachable");
    expect(signal?.aborted).toBe(true);
  });
});
