import { expect, test } from "bun:test";
import { createCardWriteHandlers } from "./write-handler";
import { parseCardEnrollmentResponse, parseCardWriteError, parseCardWriteResponse } from "@/shared/cards/contract";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
const id = "11111111-1111-4111-8111-111111114821";
const session: VerifiedAccountSession = { accountProvider: "base-account", user: { subject: "owner" }, smartAccount: { chainId: 8453, address: "0x1111111111111111111111111111111111111111" } };
const request = (headers: Record<string, string> = {}) => new Request("http://localhost/api/cards", { method: "POST", body: "{}", headers: { origin: "http://localhost", "content-type": "application/json", "X-Home-Account-Provider": "base-account", ...headers } });
const deps = { authorize: async () => session, customer: async () => ({ id: "owner" }), service: () => ({
  enroll: async () => ({ kind: "redirect" as const, url: "https://bridge.withpersona.com/inquiry" }), issue: async () => ({ id, status: "active" as const }), freeze: async () => id,
}) };
test("all real card write responses parse v2 contracts", async () => {
  const handlers = createCardWriteHandlers(deps);
  expect(parseCardEnrollmentResponse(await (await handlers.enrollment(request())).json())?.next.kind).toBe("redirect");
  expect(parseCardWriteResponse(await (await handlers.issue(request())).json())?.card.id).toBe(id);
  expect(parseCardWriteResponse(await (await handlers.freeze(request(), id, true)).json())?.card.status).toBe("frozen");
  const complete = createCardWriteHandlers({ ...deps, service: () => ({ ...deps.service(), enroll: async () => ({ kind: "complete" as const }) }) });
  expect(parseCardEnrollmentResponse(await (await complete.enrollment(request())).json())?.next.kind).toBe("complete");
});
test("all writes enforce bounded empty JSON, aborts, auth and same origin", async () => {
  let calls = 0;
  const handlers = createCardWriteHandlers({ ...deps, customer: async () => { calls++; return { id: "owner" }; } });
  for (const handle of [handlers.enrollment, handlers.issue, (request: Request) => handlers.freeze(request, id, true)]) {
    const abort = new AbortController(); const pending = handle(new Request(request(), { signal: abort.signal, body: new ReadableStream() })); abort.abort();
    const responses = [await pending, ...await Promise.all(["{", "[]", "{}".padEnd(1025, " "), "€".repeat(1025)].map((body) => handle(new Request(request(), { body })))),
      await handle(request({ "content-type": "text/plain" })),
      await handle(new Request(request(), { body: new ReadableStream({ start(stream) { stream.error(new Error("read failed")); } }) }))];
    for (const response of responses) expect(parseCardWriteError(await response.json())?.error.code).toBe("INVALID_CARD_REQUEST");
    expect((await handle(request({ origin: "https://evil.test" }))).status).toBe(403);
  }
  expect(calls).toBe(0);
  expect((await createCardWriteHandlers({ ...deps, authorize: async () => Response.json({}, { status: 401 }) }).issue(request())).status).toBe(401);
  expect((await handlers.freeze(request(), "ic_fixture", true)).status).toBe(404);
});
