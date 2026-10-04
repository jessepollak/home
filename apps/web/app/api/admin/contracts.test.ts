import { expect, test } from "bun:test";
import type { SqlExecutor } from "@/server/db/sql";
import { createOperatorApiHandler } from "@/server/operator/api";
import { readOperatorConfig } from "@/server/operator/config";
import { AdminAuditLog } from "@/server/operator-settings/audit";
import { createAuditListHandler, createSettingsDomainHandlers, createSettingsListHandler } from "@/server/operator-settings/handlers";
import { OperatorSettingsStore } from "@/server/operator-settings/store";
import { BASE_CHAIN_ID, type VerifiedAccountSession } from "@/shared/account/session-types";
import { parseOperatorErrorResponse, parseOperatorSessionResponse } from "@/shared/operator/contract";
import { OPERATOR_SETTINGS_DOMAINS, parseAllSettingsResponse, parseAuditListResponse, parseOperatorSettingsErrorResponse, parseSettingsResponse } from "@/shared/operator-settings/contract";
import { readJson } from "@/tests/helpers/read-json";

const operator = "0x1111111111111111111111111111111111111111" as const;
const customer = "0x2222222222222222222222222222222222222222" as const;
const session = (address: typeof operator | typeof customer): VerifiedAccountSession => ({
  user: { subject: "operator-contract-test" },
  smartAccount: { address, chainId: BASE_CHAIN_ID },
  accountProvider: "base-account",
});
const config = () => readOperatorConfig({ HOME_OPERATOR_ADDRESSES: operator });
const request = (path: string, body?: unknown) => new Request(`https://home.test/api/admin/${path}`, body === undefined ? {} : {
  method: "PUT",
  headers: { origin: "https://home.test", "content-type": "application/json" },
  body: JSON.stringify(body),
});
const context = { params: Promise.resolve({ domain: "support" }) };
const readPrivate = async (response: Response, status: number) => {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toContain("private");
  expect(response.headers.get("cache-control")).toContain("no-store");
  return readJson(response);
};

function emptySql(onQuery: () => void = () => {}): SqlExecutor {
  const sql: SqlExecutor = {
    query: async () => { onQuery(); return { rows: [], rowCount: 0 }; },
    transaction: async (run) => run(sql),
  };
  return sql;
}

function dependencies(sql: SqlExecutor, authorize = async () => session(operator)) {
  return { authorize, config, store: () => new OperatorSettingsStore(sql), audit: () => new AdminAuditLog(sql) };
}

test("admin handlers round-trip their private session, domain, list, write and audit outputs", async () => {
  const deps = dependencies(emptySql());
  const sessionBody = await readPrivate(await createOperatorApiHandler(true, deps.authorize, config)(request("session")), 200);
  expect<unknown>(parseOperatorSessionResponse(sessionBody)).toEqual({ version: 1, operator: { address: operator } });
  const handlers = createSettingsDomainHandlers(deps);
  const readBody = await readPrivate(await handlers.GET(request("settings/support"), context), 200);
  const expected = { version: 1, domain: "support", settings: { value: { email: null, url: null }, revision: 0, source: "default", updatedAt: null, updatedBy: null } };
  expect<unknown>(parseSettingsResponse(readBody)).toEqual(expected);
  const writeBody = await readPrivate(await handlers.PUT(request("settings/support", { version: 1, expectedRevision: 0, value: { email: null, url: null }, operator }), context), 200);
  expect<unknown>(parseSettingsResponse(writeBody)).toEqual(expected);
  const listBody = await readPrivate(await createSettingsListHandler(deps)(request("settings")), 200);
  const list = parseAllSettingsResponse(listBody);
  expect<unknown>(list).toEqual(listBody);
  expect<unknown>(list?.domains.map((entry) => entry.domain)).toEqual(Object.keys(OPERATOR_SETTINGS_DOMAINS));
  const settingsDomains = Object.keys(OPERATOR_SETTINGS_DOMAINS);
  for (const entry of list?.domains ?? []) {
    const schema = Object.values(OPERATOR_SETTINGS_DOMAINS)[settingsDomains.indexOf(entry.domain)];
    expect<unknown>(schema?.parse(entry.settings.value)).toEqual(entry.settings.value);
  }
  const auditBody = await readPrivate(await createAuditListHandler(deps)(request("audit")), 200);
  expect<unknown>(parseAuditListResponse(auditBody)).toEqual({ version: 1, entries: [], nextCursor: null });
});

test("malformed settings and operator addresses are rejected by PUT without reading or writing", async () => {
  let queries = 0;
  const handler = createSettingsDomainHandlers(dependencies(emptySql(() => { queries++; }))).PUT;
  for (const change of [
    { value: { email: "not-email", url: null } },
    { value: { email: null, url: "http://example.test" } },
    { value: { email: null, url: null, extra: true } },
    { operator: "0x1234" }, { operator: `0x${"g".repeat(40)}` },
  ]) {
    const body = await readPrivate(await handler(request("settings/support", { version: 1, expectedRevision: 0, value: { email: null, url: null }, operator, ...change }), context), 400);
    expect<unknown>(parseOperatorSettingsErrorResponse(body)).toEqual({ error: { code: "INVALID_REQUEST" } });
  }
  expect(queries).toBe(0);
});

test("admin authorization precedes malformed-body parsing and all settings or audit data access", async () => {
  let queries = 0;
  const sql = emptySql(() => { queries++; });
  for (const variant of [
    { authorize: async () => Response.json({}, { status: 401 }), status: 401, code: "UNAUTHENTICATED" },
    { authorize: async () => session(customer), status: 403, code: "OPERATOR_FORBIDDEN" },
  ]) {
    const deps = { ...dependencies(sql), authorize: variant.authorize };
    const handlers = createSettingsDomainHandlers(deps);
    const responses = [
      await handlers.GET(request("settings/support"), context),
      await handlers.PUT(request("settings/support", { malformed: true }), context),
      await createSettingsListHandler(deps)(request("settings")),
      await createAuditListHandler(deps)(request("audit")),
    ];
    for (const response of responses) {
      expect<unknown>(parseOperatorSettingsErrorResponse(await readPrivate(response, variant.status))).toEqual({ error: { code: variant.code } });
    }
    const fallback = await createOperatorApiHandler(false, variant.authorize, config)(request("unknown"));
    expect<unknown>(parseOperatorErrorResponse(await readPrivate(fallback, variant.status))).toEqual({ error: { code: variant.code } });
  }
  expect(queries).toBe(0);
});
