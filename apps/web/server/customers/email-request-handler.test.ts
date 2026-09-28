import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { EMAIL_REQUEST_ERROR_CODES, parseEmailRequestClaimResponse, parseEmailRequestErrorResponse, parseEmailRequestReadResponse, parseEmailRequestWriteResponse } from "@/shared/account/contracts/email-request";
import { createEmailRequestReadHandler, createEmailRequestWriteHandler } from "./email-request-handler";
import { EmailRequestIdentityMismatchError } from "./email-request";

const address = "0x1111111111111111111111111111111111111111" as const;
const baseSession = { accountProvider: "base-account" as const, user: { subject: "base-subject" }, smartAccount: { chainId: 8453 as const, address } };
const cdpSession = { accountProvider: "cdp-embedded" as const, user: { subject: "cdp-subject" }, smartAccount: null };
const endpoint = "https://home.test/api/account/email-request";
const request = (body: unknown, origin = "https://home.test", provider = "base-account") => new Request(endpoint, {
  method: "POST", headers: { "X-Home-Account-Provider": provider, Origin: origin }, body: JSON.stringify(body),
});

async function errorCode(response: Response) {
  const parsed = parseEmailRequestErrorResponse(await response.json());
  if (!parsed) throw new Error("Expected email request error response");
  return parsed.error.code;
}

afterEach(() => { spyOn(console, "log").mockRestore(); spyOn(console, "error").mockRestore(); spyOn(console, "warn").mockRestore(); });

describe("email request handlers", () => {
  test("rejects non-Base sessions and unauthorized requests before reading or writing", async () => {
    let calls = 0;
    const read = async () => { calls++; return { asked: false }; };
    const write = async () => { calls++; return { asked: true }; };
    const denied = async () => Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
    expect((await createEmailRequestReadHandler({ authorize: denied, read })(new Request(endpoint))).status).toBe(401);
    expect((await createEmailRequestWriteHandler({ authorize: denied, write })(request({ version: 1, kind: "asked", channel: "share_step", address }))).status).toBe(401);
    const cdpRead = await createEmailRequestReadHandler({ authorize: async () => cdpSession, read })(new Request(endpoint));
    const cdpWrite = await createEmailRequestWriteHandler({ authorize: async () => cdpSession, write })(request({ version: 1, kind: "asked", channel: "share_step", address }, "https://home.test", "cdp-embedded"));
    expect(cdpRead.status).toBe(403);
    expect(cdpWrite.status).toBe(403);
    expect(EMAIL_REQUEST_ERROR_CODES).toContain(await errorCode(cdpRead));
    const cdpCode = await errorCode(cdpWrite);
    expect(EMAIL_REQUEST_ERROR_CODES).toContain(cdpCode);
    expect(cdpCode).toBe("EMAIL_REQUEST_UNSUPPORTED");
    expect(calls).toBe(0);
  });

  test("rejects cross-origin and malformed write bodies before persistence", async () => {
    let calls = 0;
    const handler = createEmailRequestWriteHandler({ authorize: async () => baseSession, write: async () => { calls++; return { asked: true }; } });
    for (const origin of ["https://other.test", "null", "https://home.test:443/"]) {
      const response = await handler(request({ version: 1, kind: "asked", channel: "share_step", address }, origin));
      expect(response.status).toBe(403);
      expect(EMAIL_REQUEST_ERROR_CODES).toContain(await errorCode(response));
    }
    const response = await handler(request({ version: 1, kind: "email", channel: "sign_in", email: "bad", address }));
    expect(response.status).toBe(400);
    expect(EMAIL_REQUEST_ERROR_CODES).toContain(await errorCode(response));
    expect(calls).toBe(0);
  });

  test("reads and writes private asked responses", async () => {
    const seen: unknown[] = [];
    const read = createEmailRequestReadHandler({ authorize: async () => baseSession, read: async (session) => { seen.push(session); return { asked: false }; } });
    const write = createEmailRequestWriteHandler({ authorize: async () => baseSession, write: async (session, input) => { seen.push(input, session); return { asked: true }; } });
    const get = await read(new Request(endpoint, { headers: { "X-Home-Account-Provider": "base-account" } }));
    const post = await write(request({ version: 1, kind: "email", channel: "share_step", email: "  ALICE@EXAMPLE.COM ", address }));
    expect(parseEmailRequestReadResponse(await get.json())).toEqual({ version: 1, asked: false });
    expect(parseEmailRequestWriteResponse(await post.json())).toEqual({ version: 1, asked: true });
    expect(get.headers.get("cache-control")).toContain("no-store");
    expect(post.headers.get("cache-control")).toContain("no-store");
    expect(seen).toEqual([baseSession, { version: 1, kind: "email", channel: "share_step", email: "alice@example.com", address }, baseSession]);
  });

  test("routes a claim to the injected dependency and returns a private claim response", async () => {
    const seen: unknown[] = [];
    const handler = createEmailRequestWriteHandler({
      authorize: async () => baseSession,
      claim: async (session) => { seen.push(session); return { claimed: true }; },
      write: async () => { throw new Error("claim reached write"); },
    });
    const response = await handler(request({ version: 1, kind: "claim", channel: "share_step", address }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(parseEmailRequestClaimResponse(await response.json())).toEqual({ version: 1, claimed: true });
    expect(seen).toEqual([baseSession]);
  });

  test("a claim identity mismatch returns the INVALID contract error", async () => {
    const handler = createEmailRequestWriteHandler({
      authorize: async () => baseSession,
      claim: async () => { throw new EmailRequestIdentityMismatchError("email-request-identity-mismatch"); },
    });
    const response = await handler(request({ version: 1, kind: "claim", channel: "share_step", address }));
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("EMAIL_REQUEST_INVALID");
  });

  test("an identity mismatch returns the INVALID contract error", async () => {
    const handler = createEmailRequestWriteHandler({
      authorize: async () => baseSession,
      write: async () => { throw new EmailRequestIdentityMismatchError("email-request-identity-mismatch"); },
    });
    const response = await handler(request({ version: 1, kind: "email", channel: "sign_in", email: "a@b.com", address }));
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("EMAIL_REQUEST_INVALID");
  });

  test("unavailable store returns generic errors and never logs reported email", async () => {
    const email = "alice@example.com";
    const logs = [spyOn(console, "log").mockImplementation(() => {}), spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {})];
    const read = createEmailRequestReadHandler({ authorize: async () => baseSession, read: async () => null });
    const write = createEmailRequestWriteHandler({ authorize: async () => baseSession, write: async () => { throw new Error(email); } });
    const get = await read(new Request(endpoint, { headers: { "X-Home-Account-Provider": "base-account" } }));
    const post = await write(request({ version: 1, kind: "email", channel: "sign_in", email, address }));
    expect(get.status).toBe(503);
    expect(post.status).toBe(503);
    expect(EMAIL_REQUEST_ERROR_CODES).toContain(await errorCode(get));
    expect(EMAIL_REQUEST_ERROR_CODES).toContain(await errorCode(post.clone()));
    expect((await post.text()).includes(email)).toBe(false);
    expect(logs.flatMap((log) => log.mock.calls).flat().join(" ")).not.toContain(email);
    for (const log of logs) log.mockRestore();
  });
});
