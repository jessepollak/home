import { describe, expect, test } from "bun:test";
import { GET as providers } from "./providers/route";
import { handleFundingProvidersRequest } from "./providers/handler";
import { POST as quotes } from "./quotes/route";
import { GET as openOrders, POST as createOrder } from "./orders/route";
import { GET as orderStatus } from "./orders/[id]/route";
import { GET as providerCustomers } from "./provider-customers/route";
import { POST as startProviderCustomerVerification } from "./provider-customers/verification/route";
import { POST as webhook } from "./webhooks/[provider]/route";
import { readBoundedWebhookBody } from "@/server/funding/core/webhook-body";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import {
  handleFundingOpenOrderGet,
  handleFundingOrderGetById,
  handleFundingOrderPost,
} from "./orders/handler";

function assertPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toContain("private");
  expect(response.headers.get("cache-control")).toContain("no-store");
}

describe("funding route privacy and rejection", () => {
  test("returns no providers when funding persistence is not configured", async () => {
    let listCalls = 0;
    const response = await handleFundingProvidersRequest(
      new Request("https://home.example/api/funding/providers?region=AR"),
      {
        authorize: async () => ({
          user: { subject: "funding-user" },
          smartAccount: {
            address: "0x1111111111111111111111111111111111111111",
            chainId: 8453,
          },
          accountProvider: "cdp-embedded",
        }),
        databaseUrl: undefined,
        listProviders: async () => {
          listCalls += 1;
          return [];
        },
      },
    );

    expect(response.status).toBe(200);
    assertPrivate(response);
    expect(await response.json()).toEqual({
      version: 3,
      direction: "onramp",
      providers: [],
    });
    expect(listCalls).toBe(0);
  });

  test("passes the requested funding direction to provider discovery", async () => {
    let requestedDirection: string | undefined;
    const response = await handleFundingProvidersRequest(
      new Request("https://home.example/api/funding/providers?region=US&direction=offramp"),
      {
        authorize: async () => ({
          user: { subject: "funding-user" },
          smartAccount: {
            address: "0x1111111111111111111111111111111111111111",
            chainId: 8453,
          },
          accountProvider: "cdp-embedded",
        }),
        databaseUrl: "postgres://configured",
        listProviders: async (_region, _session, direction) => {
          requestedDirection = direction;
          return [];
        },
      },
    );

    expect(response.status).toBe(200);
    assertPrivate(response);
    expect(requestedDirection).toBe("offramp");
    expect(await response.json()).toEqual({
      version: 3,
      direction: "offramp",
      providers: [],
    });
  });

  test("keeps provider-list failures visible as a transient service error", async () => {
    const response = await handleFundingProvidersRequest(
      new Request("https://home.example/api/funding/providers?region=AR"),
      {
        authorize: async () => ({
          user: { subject: "funding-user" },
          smartAccount: {
            address: "0x1111111111111111111111111111111111111111",
            chainId: 8453,
          },
          accountProvider: "cdp-embedded",
        }),
        databaseUrl: "postgres://configured",
        listProviders: async () => {
          throw new Error("database unavailable");
        },
      },
    );

    expect(response.status).toBe(503);
    assertPrivate(response);
    expect(await response.json()).toEqual({
      error: {
        code: "PROVIDERS_UNAVAILABLE",
        message: "Funding methods are unavailable.",
      },
    });
  });

  test("rejects every unauthenticated funding route with private no-store", async () => {
    for (const [, invoke] of [
    ["providers", () => providers(new Request("https://home.example/api/funding/providers?region=ID"))],
    ["quotes", () => quotes(new Request("https://home.example/api/funding/quotes", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }))],
    ["open orders", () => openOrders(new Request("https://home.example/api/funding/orders?region=ID"))],
    ["create order", () => createOrder(new Request("https://home.example/api/funding/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }))],
    ["order status", () => orderStatus(new Request("https://home.example/api/funding/orders/11111111-1111-4111-8111-111111111111"), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) })],
    ["provider customers", () => providerCustomers(new Request("https://home.example/api/funding/provider-customers?region=AR"))],
    ["start provider customer verification", () => startProviderCustomerVerification(new Request("https://home.example/api/funding/provider-customers/verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }))],
    ] as const) {
      const response = await invoke();
      expect(response.ok).toBe(false);
      assertPrivate(response);
    }
  });

  test("omits unknown provider attribution from each funding order route catch path", async () => {
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => lines.push(line));
    try {
      const session = {
        user: { subject: "funding-user" },
        smartAccount: { address: "0x1111111111111111111111111111111111111111" as const, chainId: 8453 as const },
        accountProvider: "cdp-embedded" as const,
      };
      const fail = async (): Promise<never> => { throw new Error("store unavailable"); };
      const dependencies = {
        authorize: async () => session,
        createOrder: fail,
        getOpenOrder: fail,
        getOrder: fail,
      };
      const responses = await Promise.all([
        handleFundingOrderPost(new Request("https://home.example/api/funding/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quoteToken: "synthetic-token" }),
        }), dependencies),
        handleFundingOpenOrderGet(
          new Request("https://home.example/api/funding/orders?region=ID"),
          dependencies,
        ),
        handleFundingOrderGetById(
          new Request("https://home.example/api/funding/orders/11111111-1111-4111-8111-111111111111"),
          "11111111-1111-4111-8111-111111111111",
          dependencies,
        ),
      ]);

      expect(responses.map((response) => response.status)).toEqual([503, 503, 503]);
      expect(lines).toHaveLength(3);
      const eventRoutes = lines.map(
        (line) => (JSON.parse(line) as Record<string, unknown>).route,
      );
      expect(eventRoutes.filter((route) => route === "/api/funding/orders")).toHaveLength(2);
      expect(eventRoutes.filter((route) => route === "/api/funding/orders/:redacted")).toHaveLength(1);
      for (const line of lines) {
        const event = JSON.parse(line) as Record<string, unknown>;
        expect(event).toMatchObject({ kind: "funding-order", code: "ORDER_UNAVAILABLE", ownerHash: expect.any(String) });
        expect(event).not.toHaveProperty("provider");
        expect(line).not.toContain("cdp-embedded");
        expect(line).not.toContain("funding-user");
      }
    } finally {
      setObservabilityLogWriterForTests();
    }
  });

  test("webhook streaming ignores advisory length but rejects actual oversize and timeout", async () => {
    const advisory = new Request("https://home.example/webhook", { method: "POST", headers: { "Content-Length": "999999" }, body: "ok" });
    expect(new TextDecoder().decode(await readBoundedWebhookBody(advisory, { maxBytes: 8, timeoutMs: 50 }) ?? new Uint8Array())).toBe("ok");
    const oversized = new Request("https://home.example/webhook", { method: "POST", body: "12345" });
    expect(await readBoundedWebhookBody(oversized, { maxBytes: 4, timeoutMs: 50 })).toBeNull();
    const stalled = new Request("https://home.example/webhook", { method: "POST", body: new ReadableStream<Uint8Array>({ start() {} }), duplex: "half" } as RequestInit & { duplex: "half" });
    expect(await readBoundedWebhookBody(stalled, { maxBytes: 8, timeoutMs: 5 })).toBeNull();
  });

  test("invalid webhook remains private, bounded and always acknowledged", async () => {
    const response = await webhook(new Request("https://home.example/api/funding/webhooks/ripio", { method: "POST", body: "invalid" }), { params: Promise.resolve({ provider: "ripio" }) });
    expect(response.status).toBe(202);
    assertPrivate(response);
    expect(await response.json()).toMatchObject({ accepted: true });
  });
});
