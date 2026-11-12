import { afterEach, expect, test } from "bun:test";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { readOperatorConfig } from "@/server/operator/config";
import { BASE_CHAIN_ID, type VerifiedAccountSession } from "@/shared/account/session-types";
import { parseGrowthAdminErrorResponse, parseRewardDecisionRequest, type GrowthAdminErrorCode } from "@/shared/growth/admin-contract";
import { createRewardDecisionHandler } from "./admin-handlers";

const operator = "0x1111111111111111111111111111111111111111" as const;
const customer = "0x2222222222222222222222222222222222222222" as const;
const id = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ id }) };
const session = (address: typeof operator | typeof customer): VerifiedAccountSession => ({
  user: { subject: "growth-handler-test" }, smartAccount: { address, chainId: BASE_CHAIN_ID }, accountProvider: "base-account",
});
const config = () => readOperatorConfig({ HOME_OPERATOR_ADDRESSES: operator });
const request = (body = '{"version":1,"action":"approve"}', headers: Record<string, string> = {}) => new Request(`https://home.test/api/admin/growth/rewards/${id}`, {
  method: "POST", headers: { origin: "https://home.test", "content-type": "application/json", ...headers }, body,
});
const denyDataAccess = () => { throw new Error("unexpected database access"); };
const handler = createRewardDecisionHandler({ authorize: async () => session(operator), config, sql: denyDataAccess });

async function expectError(response: Response, status: number, code: GrowthAdminErrorCode) {
  expect(response.status).toBe(status);
  expect(parseGrowthAdminErrorResponse(await response.json())).toEqual({ error: { code } });
  expect(response.headers.get("cache-control")).toContain("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
}

afterEach(() => setObservabilityLogWriterForTests());

test.each([
  [async () => Response.json({}, { status: 401 }), 401, "UNAUTHENTICATED"],
  [async () => session(customer), 403, "OPERATOR_FORBIDDEN"],
  [async () => Response.json({ error: { code: "AUTH_UNAVAILABLE" } }, { status: 503 }), 503, "AUTH_UNAVAILABLE"],
] as const)("authorization fails closed before parsing or database access: %s", async (authorize, status, code) => {
  const handle = createRewardDecisionHandler({ authorize, config, sql: denyDataAccess });
  await expectError(await handle(request("not json"), context), status, code);
});

test.each<Record<string, string>>([
  { origin: "https://evil.test" }, { origin: "" }, { origin: "null" },
  { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" },
])("rejects cross-origin decisions before database access: %j", async (headers) => {
  await expectError(await handler(request(undefined, headers), context), 403, "CROSS_ORIGIN");
});

test.each([
  "", "{", "null", "[]", '{"version":2,"action":"approve"}', '{"version":1,"action":"pay"}',
  '{"version":1,"action":"reject","reason":" "}', JSON.stringify({ version: 1, action: "reject", reason: "x".repeat(201) }),
  JSON.stringify({ version: 1, action: "approve", actor: customer }),
  JSON.stringify({ version: 1, action: "approve", customerId: id }),
  JSON.stringify({ version: 1, action: "approve", wallet: customer }),
  JSON.stringify({ version: 1, action: "reject", reason: "é".repeat(8_193) }),
])("rejects malformed, oversized or identity-bearing request bodies", async (body) => {
  await expectError(await handler(request(body), context), 400, "INVALID_REQUEST");
});

test.each(["Review\u0000reason", "Review\u0001reason", "Review\u001freason", "Review\u007freason", "Review\u0085reason", "\tReview", "Review\n"])("reject reason parser and handler reject control characters: %j", async (reason) => {
  const body = { version: 1, action: "reject", reason };
  expect(parseRewardDecisionRequest(body)).toBeNull();
  await expectError(await handler(request(JSON.stringify(body)), context), 400, "INVALID_REQUEST");
});

test.each(["Review\ud800", "\udc00Review", "Review\ud800x\udc00", "\udc00\ud800"])("reject reason parser and handler reject ill-formed Unicode: %j", async (reason) => {
  const body = { version: 1, action: "reject", reason };
  expect(parseRewardDecisionRequest(body)).toBeNull();
  await expectError(await handler(request(JSON.stringify(body)), context), 400, "INVALID_REQUEST");
});

test("reject reason parser preserves valid surrogate pairs", () => {
  const body = { version: 1, action: "reject", reason: "Manual review 😀" } as const;
  expect(parseRewardDecisionRequest(body)).toEqual(body);
});

test.each(["", "text/plain", "application/json; charset=iso-8859-1"])("requires JSON content type: %s", async (contentType) => {
  await expectError(await handler(request(undefined, { "content-type": contentType }), context), 400, "INVALID_REQUEST");
});

test.each(["not-a-uuid", `${id}'`, id.replaceAll("-", "")])("validates reward UUID before database access: %s", async (invalid) => {
  await expectError(await handler(request(), { params: Promise.resolve({ id: invalid }) }), 400, "INVALID_REQUEST");
});

test("declared body length above 16 KB is rejected", async () => {
  await expectError(await handler(request(undefined, { "content-length": "16385" }), context), 400, "INVALID_REQUEST");
});

test("database errors are private, typed and observed without leaking the cause", async () => {
  const logs: string[] = [];
  setObservabilityLogWriterForTests((line) => { logs.push(line); });
  const handle = createRewardDecisionHandler({ authorize: async () => session(operator), config, sql: () => { throw new Error("private database details"); } });
  const response = await handle(request(), context);
  await expectError(response, 503, "UNAVAILABLE");
  expect(logs.join(" ")).toContain("GROWTH_REWARD_DECISION_FAILED");
  expect(logs.join(" ")).not.toContain("private database details");
});
