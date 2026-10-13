import { expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { parseCardRevealResponse, parseCardWriteError } from "@/shared/cards/contract";
import { createCardRevealHandler } from "./reveal-handler";
import { CardWriteFailure } from "./write-service";
const id = "11111111-1111-4111-8111-111111114821";
const session: VerifiedAccountSession = { accountProvider: "cdp-embedded", user: { subject: "owner" }, smartAccount: null };
const request = (body = '{"method":"stripe-issuing-elements","step":"prepare"}', headers: Record<string, string> = {}) => new Request(`http://localhost/api/cards/${id}/reveal`, {
  method: "POST", body, headers: { origin: "http://localhost", "content-type": "application/json", ...headers },
});
const deps = { authorize: async () => session, customer: async () => ({ id: "owner" }),
  reveal: async (_owner: string, _id: string, body: Parameters<Parameters<typeof createCardRevealHandler>[0]["reveal"]>[2]) =>
    body.step === "prepare" ? { method: body.method, step: body.step, issuingCard: "ic_fixture" } :
      { method: body.method, step: body.step, issuingCard: "ic_fixture", nonce: body.nonce, ephemeralKeySecret: "ek_test_synthetic123456" } };
test.each(["prepare", "grant"] as const)("reveal %s response parses and is private", async (step) => {
  const body = step === "prepare" ? { method: "stripe-issuing-elements", step } : { method: "stripe-issuing-elements", step, nonce: "nonce_synthetic123" };
  const response = await createCardRevealHandler(deps)(request(JSON.stringify(body)), id);
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
  expect(parseCardRevealResponse(await response.json())?.cardId).toBe(id);
});
test("bounded malformed, rejected and aborted body reads never invoke the service", async () => {
  let calls = 0;
  const POST = createCardRevealHandler({ ...deps, reveal: async (...args) => { calls++; return deps.reveal(...args); } });
  const abort = new AbortController();
  const pending = POST(new Request(request(), { signal: abort.signal, body: new ReadableStream() }), id); abort.abort();
  const responses = [await pending,
    ...await Promise.all(["{", "[]", '{}'.padEnd(1025, " "), "€".repeat(1025), '{"method":"stripe-issuing-elements","step":"prepare","extra":true}'].map((body) => POST(request(body), id))),
    await POST(request(undefined, { "content-type": "text/plain" }), id),
    await POST(new Request(request(), { body: new ReadableStream({ start(stream) { stream.error(new Error("read failed")); } }) }), id)];
  for (const response of responses) { expect(response.status).toBe(400); expect(parseCardWriteError(await response.json())?.error.code).toBe("INVALID_CARD_REQUEST"); }
  expect(calls).toBe(0);
});
test("auth, origin, ownership and provider failures never disclose a grant", async () => {
  expect((await createCardRevealHandler({ ...deps, authorize: async () => Response.json({}, { status: 401 }) })(request(), id)).status).toBe(401);
  expect((await createCardRevealHandler(deps)(request(undefined, { origin: "https://evil.test" }), id)).status).toBe(403);
  expect((await createCardRevealHandler(deps)(request(), "ic_fixture")).status).toBe(404);
  for (const failure of [new CardWriteFailure("CARD_NOT_READY", 409), new Error("provider unavailable"), new DOMException("timeout", "TimeoutError")]) {
    const response = await createCardRevealHandler({ ...deps, reveal: async () => { throw failure; } })(request(), id);
    expect(response.status).toBe(failure instanceof CardWriteFailure ? 409 : 503); expect(await response.text()).not.toContain("issuingCard");
  }
});
