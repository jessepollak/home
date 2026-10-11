import { describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { parseAccountDeletionReceipt, parseAccountDeletionErrorResponse } from "@/shared/account/contracts/account-deletion";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { AccountDeletionError } from "./errors";
import { deletionReceipt } from "./receipt";
import { createAccountDeletionHandler } from "./handler";

const session: VerifiedAccountSession = { accountProvider: "cdp-embedded", user: { subject: "owner-A" }, smartAccount: null };
const receipt = deletionReceipt({ id: crypto.randomUUID(), customer_id: crypto.randomUUID(), status: "queued", requested_at: new Date("2030-01-01T00:00:00Z"), updated_at: new Date("2030-01-01T00:00:00Z"), completed_at: null, last_attempt_at: null, last_attempt_outcome: null, blockers: [], receipt: null });
const request = (method = "GET", body?: string) => new Request("https://home.test/api/account/deletion?subject=owner-B", { method, body });

function privateResponse(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
}

describe("Leave Home authenticated boundary", () => {
  test.each(["GET", "POST"])("%s uses only the cryptographically verified session and propagates abort", async (method) => {
    const input = request(method);
    let received: unknown;
    const handler = createAccountDeletionHandler({ authorize: async () => session, read: async (owner, create, signal) => { received = { owner, create, signal }; return receipt; } });
    const response = await handler(input);
    expect(received).toEqual({ owner: session, create: method === "POST", signal: input.signal });
    expect(response.status).toBe(200);
    privateResponse(response);
    expect(parseAccountDeletionReceipt(await response.json())).not.toBeNull();
  });
  test.each(["null", "[]", '{"subject":"owner-B"}', "invalid"])("rejects an identity/body payload %s before reading", async (body) => {
    const handler = createAccountDeletionHandler({ authorize: async () => session, read: async () => { throw new Error("Must not read"); } });
    const response = await handler(request("POST", body));
    expect(response.status).toBe(400);
    privateResponse(response);
    expect(parseAccountDeletionErrorResponse(await response.json())).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });
  test.each([
    [new AccountDeletionError("ACCOUNT_DELETION_LINKAGE"), 409, "ACCOUNT_DELETION_LINKAGE"],
    [new AccountDeletionError("ACCOUNT_DELETION_NOT_FOUND"), 404, "ACCOUNT_DELETION_NOT_FOUND"],
    [new Error("private-subject-token"), 503, "ACCOUNT_DELETION_UNAVAILABLE"],
  ] as const)("maps errors without identity-bearing logs", async (failure, status, code) => {
    const logs: string[] = [];
    setObservabilityLogWriterForTests((line) => { logs.push(line); });
    let response: Response;
    try { response = await createAccountDeletionHandler({ authorize: async () => session, read: async () => { throw failure; } })(request()); }
    finally { setObservabilityLogWriterForTests(); }
    expect(response.status).toBe(status);
    privateResponse(response);
    expect(await response.json()).toMatchObject({ error: { code } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toContain(session.user.subject);
    expect(logs[0]).not.toContain("private-subject-token");
  });
  test("unauthenticated requests cannot read and aborted requests fail closed", async () => {
    const auth = createAccountDeletionHandler({ authorize: async () => Response.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 }) });
    expect((await auth(request())).status).toBe(401);
    const controller = new AbortController(); controller.abort();
    const aborted = new Request(request(), { signal: controller.signal });
    expect((await createAccountDeletionHandler({ authorize: async () => session })(aborted)).status).toBe(503);
  });
});
