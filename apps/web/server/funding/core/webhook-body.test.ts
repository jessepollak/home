import "server-only";

import { expect, test } from "bun:test";
import { readBoundedWebhookBody } from "./webhook-body";

test("webhook streaming ignores advisory length but rejects actual oversize and timeout", async () => {
  const advisory = new Request("https://home.example/webhook", { method: "POST", headers: { "Content-Length": "999999" }, body: "ok" });
  expect(new TextDecoder().decode(await readBoundedWebhookBody(advisory, { maxBytes: 8, timeoutMs: 50 }) ?? new Uint8Array())).toBe("ok");
  const oversized = new Request("https://home.example/webhook", { method: "POST", body: "12345" });
  expect(await readBoundedWebhookBody(oversized, { maxBytes: 4, timeoutMs: 50 })).toBeNull();
  const stalled = new Request("https://home.example/webhook", { method: "POST", body: new ReadableStream<Uint8Array>({ start() {} }), duplex: "half" } as RequestInit & { duplex: "half" });
  expect(await readBoundedWebhookBody(stalled, { maxBytes: 8, timeoutMs: 5 })).toBeNull();
});
