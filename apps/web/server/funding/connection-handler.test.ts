import { expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { readOperatorConfig } from "@/server/operator/config";
import { parseFundingConnectionResponse } from "@/shared/operator-settings/contract-funding-connections";
import { createFundingConnectionHandler } from "./connection-handler";
import { coinbaseManifest } from "./providers/coinbase/manifest";

const operator = "0x1111111111111111111111111111111111111111" as const;
const customer = "0x2222222222222222222222222222222222222222" as const;
function session(address: `0x${string}`): VerifiedAccountSession {
  return { user: { subject: "connection-handler-test" }, accountProvider: "base-account", smartAccount: { address, chainId: 8453 } };
}
const config = () => readOperatorConfig({ HOME_OPERATOR_ADDRESSES: operator });
const deps = { authorize: async () => session(operator), config, providers: [{ manifest: coinbaseManifest }] };
function request(headers: Record<string, string> = {}, body = JSON.stringify({ version: 1, providerId: "coinbase" })) {
  return new Request("https://home.test/api/admin/settings/funding/connections", {
    method: "POST", headers: { origin: "https://home.test", "content-type": "application/json", ...headers }, body,
  });
}

test("operator authorization precedes parsing and probing", async () => {
  for (const variant of [
    { authorize: async () => Response.json({}, { status: 401 }), status: 401, code: "UNAUTHENTICATED" },
    { authorize: async () => session(customer), status: 403, code: "OPERATOR_FORBIDDEN" },
    { authorize: async () => Response.json({ error: { code: "AUTH_UNAVAILABLE" } }, { status: 503 }), status: 503, code: "AUTH_UNAVAILABLE" },
  ]) {
    const handler = createFundingConnectionHandler({ ...deps, authorize: variant.authorize, check: async () => { throw new Error("must not probe"); } });
    const response = await handler(request({ origin: "https://other.test" }, "not JSON"));
    expect(response.status).toBe(variant.status);
    expect(await response.json()).toEqual({ error: { code: variant.code } });
  }
});

test.each([
  [{ origin: "https://other.test" }, "CROSS_ORIGIN", 403],
  [{ origin: "" }, "CROSS_ORIGIN", 403],
  [{ "sec-fetch-site": "cross-site" }, "CROSS_ORIGIN", 403],
  [{ "content-type": "text/plain" }, "INVALID_REQUEST", 400],
  [{ "content-type": "application/json; charset=latin1" }, "INVALID_REQUEST", 400],
] as const)("rejects unsafe request headers %j", async (headers, code, status) => {
  const response = await createFundingConnectionHandler(deps)(request(headers));
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: { code } });
});

test.each(["not JSON", "null", "{}", JSON.stringify({ version: 2, providerId: "coinbase" }), JSON.stringify({ version: 1, providerId: "coinbase", extra: true }), " ".repeat(1025)])("rejects malformed or oversized request %j", async (body) => {
  const response = await createFundingConnectionHandler(deps)(request({}, body));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
});

test("unknown provider is not found, without probing", async () => {
  const response = await createFundingConnectionHandler(deps)(request({}, JSON.stringify({ version: 1, providerId: "unknown" })));
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: { code: "NOT_FOUND" } });
});

test("invalid probe results return unavailable instead of an invalid response contract", async () => {
  const response = await createFundingConnectionHandler({ ...deps, check: async () => ({ providerId: "coinbase", checkedAt: "invalid", status: "connected", scopes: [{ regions: ["US"], status: "connected" }] }) })(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: { code: "SETTINGS_UNAVAILABLE" } });
});

test("returns only a private timestamped result and catches unexpected failures", async () => {
  const response = await createFundingConnectionHandler(deps)(request({ "content-type": "application/json; charset=utf-8", "sec-fetch-site": "same-origin" }));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(parseFundingConnectionResponse(await response.json())?.status).toBe("unsupported");
  const failed = await createFundingConnectionHandler({ ...deps, authorize: async () => { throw new Error("private failure"); } })(request());
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({ error: { code: "SETTINGS_UNAVAILABLE" } });
});
