import { afterEach, describe, expect, test } from "bun:test";
import { extractOtp, gmailReadonlyScope, isReadonlyScopeGrant, pollGmailOtp, type GmailCredentials, type GmailMessage } from "./gmail";

const credentials: Required<GmailCredentials> = {
  client_id: "client-id",
  client_secret: "client-secret",
  refresh_token: "refresh-token",
};
const submittedAt = Date.parse("2026-09-21T12:00:00.000Z");
const sender = "no-reply@coinbase.com";
const servers: Array<{ stop(closeActiveConnections?: boolean): void }> = [];

function message(overrides: Partial<GmailMessage> = {}): GmailMessage {
  return {
    id: "message-1",
    internalDate: String(submittedAt + 1000),
    snippet: "Your sign-in code is 847291",
    payload: { headers: [{ name: "From", value: `Coinbase <${sender}>` }] },
    ...overrides,
  };
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

describe("Gmail OTP parsing", () => {
  test("accepts exactly one six-digit code from the configured sender and window", () => {
    expect(extractOtp(message(), sender, submittedAt, submittedAt + 300_000)).toBe("847291");
    expect(extractOtp(message({ snippet: "Code 847291 and 123456" }), sender, submittedAt, submittedAt + 300_000)).toBeNull();
    expect(extractOtp(message({ internalDate: String(submittedAt - 1) }), sender, submittedAt, submittedAt + 300_000)).toBeNull();
    expect(extractOtp(message({ internalDate: String(submittedAt + 300_001) }), sender, submittedAt, submittedAt + 300_000)).toBeNull();
  });

  test("rejects every other sender and a matching display-name spoof", () => {
    expect(extractOtp(message({ payload: { headers: [{ name: "From", value: "attacker@example.com" }] } }), sender, submittedAt, submittedAt + 300_000)).toBeNull();
    expect(extractOtp(message({ payload: { headers: [{ name: "From", value: `${sender} <attacker@example.com>` }] } }), sender, submittedAt, submittedAt + 300_000)).toBeNull();
  });
});

describe("Gmail polling", () => {
  test("queries a fake Gmail server and never logs the code or tokens", async () => {
    const requests: Array<{ path: string; authorization: string | null }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        requests.push({ path: `${url.pathname}${url.search}`, authorization: request.headers.get("authorization") });
        if (url.pathname === "/token") return Response.json({ access_token: "access-token" });
        if (url.pathname.endsWith("/messages")) return Response.json({ messages: [{ id: "message-1" }] });
        return Response.json(message());
      },
    });
    servers.push(server);
    const output: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...values) => output.push(values.join(" "));
    console.error = (...values) => output.push(values.join(" "));
    try {
      const code = await pollGmailOtp(credentials, sender, submittedAt, {
        tokenEndpoint: `http://127.0.0.1:${server.port}/token`,
        apiBaseUrl: `http://127.0.0.1:${server.port}/gmail/v1`,
        now: () => submittedAt + 2000,
        wait: async () => undefined,
      });
      expect(code).toBe("847291");
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
    expect(requests.some((request) => request.path.includes(`from%3A${encodeURIComponent(sender)}`))).toBe(true);
    expect(requests.filter((request) => request.path !== "/token").every((request) => request.authorization === "Bearer access-token")).toBe(true);
    expect(output.join(" ")).not.toContain("847291");
    expect(output.join(" ")).not.toContain("access-token");
    expect(output.join(" ")).not.toContain("refresh-token");
  });

  test("requests and accepts only the readonly OAuth scope", () => {
    expect(gmailReadonlyScope).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(isReadonlyScopeGrant(gmailReadonlyScope)).toBe(true);
    expect(isReadonlyScopeGrant(`${gmailReadonlyScope} https://www.googleapis.com/auth/gmail.modify`)).toBe(false);
    expect(isReadonlyScopeGrant(undefined)).toBe(false);
  });
});
