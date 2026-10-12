import { expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { BASE_CHAIN_ID } from "@/shared/account/session-types";
import { parseOperatorErrorResponse } from "@/shared/operator/contract";
import { parseOperatorSettingsErrorResponse } from "@/shared/operator-settings/contract";
import { createOperatorApiHandler } from "@/server/operator/api";
import { readOperatorConfig } from "@/server/operator/config";
import { createAuditListHandler, createSettingsDomainHandlers, createSettingsListHandler } from "@/server/operator-settings/handlers";

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
