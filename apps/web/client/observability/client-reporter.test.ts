import { describe, expect, test } from "bun:test";
import {
  CLIENT_ERROR_ENDPOINT,
  CLIENT_ERROR_MAX_REPORTS_PER_PAGE,
  buildClientErrorReport,
  createBoundedClientErrorReporter,
  reportClientError,
  type ClientErrorTransport,
} from "./client-reporter";

describe("client error reporter", () => {
  test("builds only scrubbed name, message, and pathname fields", () => {
    expect(
      buildClientErrorReport({
        name: "TypeError",
        message: '{"accessToken":"raw-access-value"} https://example.com/private?otp=847291',
        route: "/account?token=query-secret#hash-secret",
      }),
    ).toEqual({
      name: "TypeError",
      message: '{"accessToken":"[REDACTED]"} [URL]',
      route: "/account",
    });
  });

  test("posts same-origin JSON without cookies, authorization, or referrer", async () => {
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const send: ClientErrorTransport = async (input, init) => {
      calls.push({ input, init });
      return { ok: true, status: 204 };
    };

    await reportClientError(
      { name: "Error", message: "boom", route: "/activity" },
      send,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe(CLIENT_ERROR_ENDPOINT);
    expect(calls[0]?.init).toMatchObject({
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      keepalive: true,
      referrerPolicy: "no-referrer",
      headers: { "content-type": "application/json" },
    });
    expect(calls[0]?.init.body).toBe(
      JSON.stringify({ name: "Error", message: "boom", route: "/activity" }),
    );
  });

  test("swallows synchronous throws and rejected transports", async () => {
    await expect(
      reportClientError(
        { name: "Error", message: "boom", route: "/" },
        (() => { throw new Error("sync failure"); }) as ClientErrorTransport,
      ),
    ).resolves.toBeUndefined();
    await expect(
      reportClientError(
        { name: "Error", message: "boom", route: "/" },
        async () => { throw new Error("async failure"); },
      ),
    ).resolves.toBeUndefined();
  });

  test("bounds reports per page to prevent error loops", async () => {
    const calls: string[] = [];
    const report = createBoundedClientErrorReporter(async (_input, init) => {
      calls.push(String(init.body));
      return { ok: true, status: 204 };
    });

    for (let index = 0; index < CLIENT_ERROR_MAX_REPORTS_PER_PAGE + 3; index += 1) {
      report({ name: "Error", message: `failure ${index}`, route: "/" });
    }
    await Promise.resolve();

    expect(calls).toHaveLength(CLIENT_ERROR_MAX_REPORTS_PER_PAGE);
  });
});
