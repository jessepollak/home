import { expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { BASE_CHAIN_ID } from "@/shared/account/session-types";
import { parseOperatorErrorResponse } from "@/shared/operator/contract";
import { parseOperatorSettingsErrorResponse } from "@/shared/operator-settings/contract";
import { createOperatorApiHandler } from "@/server/operator/api";
import { readOperatorConfig } from "@/server/operator/config";
import { createAuditListHandler, createSettingsDomainHandlers, createSettingsListHandler } from "@/server/operator-settings/handlers";
import { OperatorSettingsStore } from "@/server/operator-settings/store";

const operator = "0x1111111111111111111111111111111111111111" as const;
const customer = "0x2222222222222222222222222222222222222222" as const;
const context = { params: Promise.resolve({ domain: "support" }) };
const session = (address: typeof operator | typeof customer): VerifiedAccountSession => ({
  user: { subject: "operator-authorization-test" },
  smartAccount: { address, chainId: BASE_CHAIN_ID },
  accountProvider: "base-account",
});
const request = (path: string, body?: unknown) => new Request(`https://home.test/api/admin/${path}`, body === undefined ? {} : {
  method: "PUT",
  headers: { origin: "https://home.test", "content-type": "application/json" },
  body: JSON.stringify(body),
});

test.each(["oversized", "content-length", "invalid-length", "malformed", "invalid-utf8", "empty", "aborted", "wrong-type", "missing-type"])("settings PUT rejects %s bodies before data access", async (failure) => {
  let queries = 0;
  const store = new OperatorSettingsStore({
    query: async () => { queries++; throw new Error("invalid request reached database"); },
    transaction: async () => { queries++; throw new Error("invalid request reached transaction"); },
  });
  const { PUT } = createSettingsDomainHandlers({
    authorize: async () => session(operator),
    config: () => readOperatorConfig({ HOME_OPERATOR_ADDRESSES: operator }),
    store: () => store,
  });
  const body = JSON.stringify({ version: 1, expectedRevision: 0, operator, value: store.registry.support?.defaults });
  const headers = new Headers({ origin: "https://home.test" });
  if (failure !== "missing-type") headers.set("content-type", failure === "wrong-type" ? "text/plain" : "application/json");
  if (failure === "content-length") headers.set("content-length", "16385");
  if (failure === "invalid-length") headers.set("content-length", "invalid");
  const input = new Request("https://home.test/api/admin/settings/support", {
    method: "PUT", headers,
    signal: failure === "aborted" ? AbortSignal.abort() : undefined,
    body: failure === "oversized" ? " ".repeat(16_384) + body : failure === "malformed" ? "{" : failure === "invalid-utf8" ? new Uint8Array([0x22, 0xff, 0x22]) : failure === "empty" ? undefined : new TextEncoder().encode(body),
  });
  const response = await PUT(input, context);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
  expect(queries).toBe(0);
  expect(input.body?.locked ?? false).toBe(false);
});

test("operator authorization precedes malformed-body parsing and settings or audit data access", async () => {
  const denyDataAccess = () => { throw new Error("operator data accessed before authorization"); };
  for (const variant of [
    { authorize: async () => Response.json({}, { status: 401 }), status: 401, code: "UNAUTHENTICATED" },
    { authorize: async () => session(customer), status: 403, code: "OPERATOR_FORBIDDEN" },
  ]) {
    const dependencies = {
      authorize: variant.authorize,
      config: () => readOperatorConfig({ HOME_OPERATOR_ADDRESSES: operator }),
      store: denyDataAccess,
      audit: denyDataAccess,
    };
    const handlers = createSettingsDomainHandlers(dependencies);
    for (const response of [
      await handlers.GET(request("settings/support"), context),
      await handlers.PUT(request("settings/support", { malformed: true }), context),
      await createSettingsListHandler(dependencies)(request("settings")),
      await createAuditListHandler(dependencies)(request("audit")),
    ]) {
      expect(response.status).toBe(variant.status);
      expect<unknown>(parseOperatorSettingsErrorResponse(await response.json())).toEqual({ error: { code: variant.code } });
    }
    const fallback = await createOperatorApiHandler(false, variant.authorize, dependencies.config)(request("unknown"));
    expect(fallback.status).toBe(variant.status);
    expect<unknown>(parseOperatorErrorResponse(await fallback.json())).toEqual({ error: { code: variant.code } });
  }
});
