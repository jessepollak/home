import { describe, expect, test } from "bun:test";
import { buildClientErrorReport, reportClientError } from "./client-reporter";

describe("client error reporter", () => {
  test("scrubs secrets and keeps only pathname, name, and message", () => {
    expect(
      buildClientErrorReport({
        name: "TypeError",
        message: "Failed for Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
        route: "/account?code=847291#otp",
      }),
    ).toEqual({
      name: "TypeError",
      message: "Failed for Bearer [REDACTED]",
      route: "/account",
    });
  });

  test("posts a same-origin report without credentials", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    await reportClientError(
      {
        name: "Error",
        message: "boom",
        route: "/activity",
      },
      async (input, init) => {
        calls.push({ input, init });
        return new Response(null, { status: 204 });
      },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("/api/client-errors");
    expect(calls[0]?.init).toMatchObject({
      method: "POST",
      credentials: "omit",
      keepalive: true,
    });
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        name: "Error",
        message: "boom",
        route: "/activity",
      }),
    );
  });
});
