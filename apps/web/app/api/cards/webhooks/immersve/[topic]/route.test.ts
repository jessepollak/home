import { generateKeyPairSync, sign } from "node:crypto";
import { expect, spyOn, test } from "bun:test";
import * as sqlModule from "@/server/db/sql";
import * as storeModule from "@/server/cards/store";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import type { CardEvent } from "@/server/cards/store";
import { POST } from "./route";

function request(body: string, topic: string, headers?: Headers) {
  return new Request(`https://home.test/api/cards/webhooks/immersve/${topic}`, { method: "POST", body, headers });
}
function context(topic: string) {
  return { params: Promise.resolve({ topic }) };
}

test("oversize Immersve delivery is bounded and still receives 202", async () => {
  setObservabilityLogWriterForTests(() => undefined);
  try {
    const response = await POST(request("a".repeat(64 * 1024 + 1), "payment-updated"), context("payment-updated"));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
  } finally { setObservabilityLogWriterForTests(); }
});

test("unknown URL topic is rejected before reading a delivery", async () => {
  const log: string[] = [];
  setObservabilityLogWriterForTests((line) => { log.push(line); });
  try {
    const response = await POST(request("{}", "not-subscribed"), context("not-subscribed"));
    expect(response.status).toBe(202);
    expect(log.map((line) => JSON.parse(line) as { code: string })).toEqual([expect.objectContaining({ code: "WEBHOOK_REJECTED" })]);
    expect(log.join(" ")).not.toContain("not-subscribed");
  } finally { setObservabilityLogWriterForTests(); }
});

test("misconfigured enabled ingress remains a deliberate 202 rejection", async () => {
  const previousEnabled = process.env.IMMERSVE_ENABLED;
  const previousPartner = process.env.IMMERSVE_PARTNER_ACCOUNT_ID;
  process.env.IMMERSVE_ENABLED = "1";
  process.env.IMMERSVE_PARTNER_ACCOUNT_ID = "";
  const logs: string[] = [];
  setObservabilityLogWriterForTests((line) => { logs.push(line); });
  try {
    const response = await POST(request("{}", "payment-updated"), context("payment-updated"));
    expect(response.status).toBe(202);
    expect(logs.map((line) => JSON.parse(line) as { code: string })).toEqual([expect.objectContaining({ code: "WEBHOOK_REJECTED" })]);
    expect(logs.join(" ")).not.toContain("IMMERSVE_PARTNER_ACCOUNT_ID");
  } finally {
    if (previousEnabled === undefined) delete process.env.IMMERSVE_ENABLED;
    else process.env.IMMERSVE_ENABLED = previousEnabled;
    if (previousPartner === undefined) delete process.env.IMMERSVE_PARTNER_ACCOUNT_ID;
    else process.env.IMMERSVE_PARTNER_ACCOUNT_ID = previousPartner;
    setObservabilityLogWriterForTests();
  }
});

test("14-second deadline returns retryable 503 without waiting in real time", async () => {
  const logs: string[] = [];
  setObservabilityLogWriterForTests((line) => { logs.push(line); });
  const originalSetTimeout = globalThis.setTimeout;
  const timeout = spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) => {
    if (delay === 14_000) {
      queueMicrotask(callback);
      return originalSetTimeout(() => undefined, 0);
    }
    return originalSetTimeout(callback, delay);
  }) as typeof setTimeout);
  try {
    const response = await POST(request("{}", "payment-updated"), { params: new Promise<{ topic: string }>(() => undefined) });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ accepted: false });
    expect(logs.map((line) => JSON.parse(line) as { code: string })).toEqual([expect.objectContaining({ code: "WEBHOOK_UNAVAILABLE" })]);
  } finally {
    timeout.mockRestore();
    setObservabilityLogWriterForTests();
  }
});

test("enabled ingress returns 503 for retryable failures and 202 for deliberate rejections and handling", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const secret = "synthetic-route-secret";
  const env = {
    IMMERSVE_ENABLED: "1", IMMERSVE_MODE: "sandbox", IMMERSVE_API_KEY: "synthetic-route-key", IMMERSVE_API_SECRET: secret,
    IMMERSVE_PARTNER_ACCOUNT_ID: "a".repeat(32), IMMERSVE_CLIENT_APPLICATION_ID: "b".repeat(32), IMMERSVE_CARD_PROGRAM_ID: "c".repeat(32),
    IMMERSVE_FUNDING_CHANNEL_ID: "d".repeat(32), IMMERSVE_FUNDS_STORAGE_ADDRESS: "0x1111111111111111111111111111111111111111",
    IMMERSVE_FUNDING_TYPE: "base-sepolia-usdc-universal-evm",
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const stored: CardEvent[] = [];
  let storeUnavailable = false;
  let jwks: "fetch-failure" | "malformed" | "valid" = "fetch-failure";
  const logs: string[] = [];
  setObservabilityLogWriterForTests((line) => { logs.push(line); });
  const store = spyOn(storeModule, "createCardEventStore").mockReturnValue({ insert: async (event) => {
    if (storeUnavailable) throw new Error("private database failure");
    if (stored.some((row) => row.mode === event.mode && row.messageId === event.messageId)) return false;
    stored.push(event);
    return true;
  } });
  const database = spyOn(sqlModule, "getSqlExecutor").mockReturnValue({} as ReturnType<typeof sqlModule.getSqlExecutor>);
  const fetchStub = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
    expect(String(input)).toBe("https://test.immersve.com/.well-known/jwks.json");
    if (jwks === "fetch-failure") throw new Error("private JWKS failure");
    if (jwks === "malformed") return Response.json({ keys: "malformed" });
    return Response.json({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "first", alg: "RS256" }] });
  }) as unknown as typeof fetch);
  try {
    const envelope = {
      messageId: "event-route", topic: "payment-updated", createdAt: new Date().toISOString(), deliveryAttempt: 1,
      keyId: "first", issuer: "test.immersve.com",
      payload: { payment: { id: "payment-route", cardholder: { id: "owner-route" }, card: { id: "card-route" } } },
    };
    const body = JSON.stringify(envelope);
    const signature = sign("RSA-SHA256", Buffer.concat([Buffer.from("event-route:1:first:"), Buffer.from(body)]), privateKey).toString("base64");
    const headers = new Headers({ "x-delivery-id": "event-route:1", "x-key-id": "first", "x-signature": signature });
    const signed = () => POST(request(body, "payment-updated", headers), context("payment-updated"));
    expect((await signed()).status).toBe(503);
    jwks = "malformed";
    expect((await signed()).status).toBe(503);
    jwks = "valid";
    const mismatch = await POST(request(body, "card-created", headers), context("card-created"));
    expect(mismatch.status).toBe(202);
    expect((await POST(request(body, "payment-updated"), context("payment-updated"))).status).toBe(202);
    expect(stored).toEqual([]);
    const unknown = new Headers(headers);
    unknown.set("x-key-id", "newly-rotated");
    expect((await POST(request(body, "payment-updated", unknown), context("payment-updated"))).status).toBe(503);
    const badSignature = new Headers(headers);
    badSignature.set("x-signature", sign("RSA-SHA256", Buffer.from("not-this-body"), privateKey).toString("base64"));
    expect((await POST(request(body, "payment-updated", badSignature), context("payment-updated"))).status).toBe(202);
    storeUnavailable = true;
    const failed = await signed();
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ accepted: false });
    storeUnavailable = false;
    const accepted = await signed();
    expect(accepted.status).toBe(202);
    expect(stored).toEqual([{ mode: "sandbox", messageId: "event-route", topic: "payment-updated", cardholderAccountId: "owner-route", cardId: "card-route", paymentId: "payment-route" }]);
    expect((await signed()).status).toBe(202);
    expect(stored).toHaveLength(1);
    expect(logs.map((line) => JSON.parse(line) as { code: string })).toEqual([
      expect.objectContaining({ code: "WEBHOOK_UNAVAILABLE" }),
      expect.objectContaining({ code: "WEBHOOK_UNAVAILABLE" }),
      expect.objectContaining({ code: "WEBHOOK_REJECTED" }),
      expect.objectContaining({ code: "WEBHOOK_REJECTED" }),
      expect.objectContaining({ code: "WEBHOOK_UNAVAILABLE" }),
      expect.objectContaining({ code: "WEBHOOK_REJECTED" }),
      expect.objectContaining({ code: "WEBHOOK_UNAVAILABLE" }),
    ]);
    expect(logs.join(" ")).not.toContain(secret);
    expect(logs.join(" ")).not.toContain("first");
    expect(logs.join(" ")).not.toContain("event-route");
  } finally {
    fetchStub.mockRestore();
    database.mockRestore();
    store.mockRestore();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    setObservabilityLogWriterForTests();
  }
});
