import { describe, expect, test } from "bun:test";
import { GET as providers } from "./providers/route";
import { POST as quotes } from "./quotes/route";
import { GET as openOrders, POST as createOrder } from "./orders/route";
import { GET as orderStatus } from "./orders/[id]/route";
import { POST as webhook, readBoundedWebhookBody } from "./webhooks/[provider]/route";

function assertPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toContain("private");
  expect(response.headers.get("cache-control")).toContain("no-store");
}

describe("funding route privacy and rejection", () => {
  for (const [name, invoke] of [
    ["providers", () => providers(new Request("https://home.example/api/funding/providers?region=ID"))],
    ["quotes", () => quotes(new Request("https://home.example/api/funding/quotes", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }))],
    ["open orders", () => openOrders(new Request("https://home.example/api/funding/orders?region=ID"))],
    ["create order", () => createOrder(new Request("https://home.example/api/funding/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }))],
    ["order status", () => orderStatus(new Request("https://home.example/api/funding/orders/11111111-1111-4111-8111-111111111111"), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) })],
  ] as const) {
    test(`${name} rejects unauthenticated access with private no-store`, async () => {
      const response = await invoke();
      expect(response.ok).toBe(false);
      assertPrivate(response);
    });
  }

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
    expect(await response.json()).toEqual({ accepted: true });
  });
});
