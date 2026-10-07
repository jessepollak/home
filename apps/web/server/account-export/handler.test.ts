import { describe, expect, test } from "bun:test";
import { ACCOUNT_EXPORT_HOME_CLASSES, parseAccountExportResponse, type AccountExportResponse } from "@/shared/account/contracts/data-export";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { AccountExportError } from "./errors";
import { createAccountExportHandler } from "./handler";

const session: VerifiedAccountSession = { accountProvider: "cdp-embedded", user: { subject: "owner-A" }, smartAccount: { chainId: 8453, address: "0x1111111111111111111111111111111111111111" } };
const body: AccountExportResponse = { version: 1, schema: "home.account-export", generatedAt: "2026-10-07T00:00:00.000Z", complete: true, classes: ACCOUNT_EXPORT_HOME_CLASSES.map((name) => ({ name, holder: "home", records: [] })), boundaries: { providerHeld: "Providers", publicChain: "Base", currentDevice: "This device" } };

function expectPrivate(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("Pragma")).toBe("no-cache");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
}

describe("account export authenticated boundary", () => {
  test("uses only verified session and propagates the abort signal", async () => {
    const request = new Request("https://home.test/api/account/export?subject=owner-B&customerId=other");
    let received: unknown;
    const handler = createAccountExportHandler({ authorize: async () => session, read: async (owner, signal) => { received = { owner, signal }; return body; } });
    const response = await handler(request);
    expect(received).toEqual({ owner: session, signal: request.signal });
    expect(response.status).toBe(200);
    expectPrivate(response);
    expect(parseAccountExportResponse(await response.json())).not.toBeNull();
  });

  test.each([
    [new AccountExportError("ACCOUNT_EXPORT_LINKAGE"), 409, "ACCOUNT_EXPORT_LINKAGE"],
    [new AccountExportError("ACCOUNT_EXPORT_TOO_LARGE"), 413, "ACCOUNT_EXPORT_TOO_LARGE"],
    [new Error("private-owner-token-marker"), 503, "ACCOUNT_EXPORT_UNAVAILABLE"],
  ] as const)("maps a read failure to a private, generic error", async (failure, status, code) => {
    const logs: string[] = [];
    setObservabilityLogWriterForTests((line) => { logs.push(line); });
    let response: Response;
    try {
      response = await createAccountExportHandler({ authorize: async () => session, read: async () => { throw failure; } })(new Request("https://home.test/api/account/export"));
    } finally {
      setObservabilityLogWriterForTests();
    }
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0])).toMatchObject({ route: "/api/account/export", code, outcome: status === 503 ? "unavailable" : "rejected" });
    for (const privateValue of [session.user.subject, "0x1111111111111111111111111111111111111111", "private-owner-token-marker"]) expect(logs[0]).not.toContain(privateValue);
    expect(response.status).toBe(status);
    expectPrivate(response);
    const value: unknown = await response.json();
    expect(value).toMatchObject({ error: { code } });
    expect(value).not.toHaveProperty("complete");
    expect(value).not.toHaveProperty("classes");
    expect(JSON.stringify(value)).not.toContain("private-owner-token-marker");
  });

  test("unauthenticated responses are private and never read records", async () => {
    let called = false;
    const response = await createAccountExportHandler({ authorize: async () => Response.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 }), read: async () => { called = true; return body; } })(new Request("https://home.test/api/account/export"));
    expect(response.status).toBe(401);
    expectPrivate(response);
    expect(called).toBe(false);
  });

  test("an aborted request never returns complete data", async () => {
    const controller = new AbortController();
    const response = await createAccountExportHandler({ authorize: async () => session, read: async () => { controller.abort(); return body; } })(new Request("https://home.test/api/account/export", { signal: controller.signal }));
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("classes");
    expectPrivate(response);
  });
});
