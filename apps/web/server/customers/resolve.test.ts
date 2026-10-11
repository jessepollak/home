import { afterAll, describe, expect, spyOn, test } from "bun:test";
import * as nextServer from "next/server";
import { AccountDeletedError, AccountDeletionAuthUnavailable } from "@/server/account-deletion/errors";
import { createSessionHandler } from "@/server/cdp/session";
import { recordVerifiedCustomer } from "@/server/invites/consumption";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";

const deferred: Array<() => unknown> = [];
const afterSpy = spyOn(nextServer, "after").mockImplementation((callback) => {
  if (typeof callback !== "function") throw new Error("expected deferred function");
  deferred.push(callback);
});
const { bestEffortCustomerRecord, deferCustomerRecord, CustomerResolver, resolveCustomer } = await import("./resolve");
const originalDatabaseUrl = process.env.DATABASE_URL;

afterAll(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  setObservabilityLogWriterForTests();
  afterSpy.mockRestore();
});

describe("deferred customer recording deletion boundary", () => {
  test.each([AccountDeletedError, AccountDeletionAuthUnavailable])("after callback contains and reports %p", async (ErrorType) => {
    process.env.DATABASE_URL = "postgresql://localhost/home_test";
    const logs: string[] = [];
    setObservabilityLogWriterForTests((line) => { logs.push(line); });
    await deferCustomerRecord(async () => { throw new ErrorType(); });
    const callback = deferred.shift();
    if (!callback) throw new Error("expected after callback");
    await expect(Promise.resolve(callback())).resolves.toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('"code":"OPERATOR_REGISTRY_WRITE_FAILED"');
  });
});

describe("sign-in customer recording deletion boundary", () => {
  test.each([AccountDeletedError, AccountDeletionAuthUnavailable])("real sign-in recorder propagates %p to the session response", async (ErrorType) => {
    process.env.DATABASE_URL = "postgresql://localhost/home_test";
    const resolverSpy = spyOn(CustomerResolver.prototype, "resolveCustomer").mockRejectedValue(new ErrorType());
    try {
      const handler = createSessionHandler({
        getValidator: async () => ({ validateAccessToken: async () => ({
          userId: "recorder-user", authenticationMethods: [{ type: "email", email: "owner@example.test" }], evmSmartAccountObjects: [],
        }) }),
        assertLive: async () => {},
        onVerifiedSession: (session, { request }) => recordVerifiedCustomer(request,
          () => resolveCustomer(session, { create: true }),
          bestEffortCustomerRecord),
        issueCookies: () => ["home-render=unexpected"],
        verifiedCookies: () => ["home-verified=unexpected"],
      });
      const request = new Request("https://home.test/api/session");
      request.headers.set("Authorization", ["Bearer", "fixture.token.value"].join(" "));
      const response = await handler(request);
      expect(response.status).toBe(ErrorType === AccountDeletedError ? 401 : 503);
      expect(await response.json()).toMatchObject({ error: { code: ErrorType === AccountDeletedError ? "ACCOUNT_DELETED" : "AUTH_UNAVAILABLE" } });
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(resolverSpy).toHaveBeenCalledTimes(1);
    } finally { resolverSpy.mockRestore(); }
  });

  test("ordinary capture failures stay best-effort", async () => {
    process.env.DATABASE_URL = "postgresql://localhost/home_test";
    await expect(bestEffortCustomerRecord(async () => { throw new Error("capture failed"); })).resolves.toBeUndefined();
  });
});
