import { afterEach, describe, expect, test } from "bun:test";
import { extractOtp, gmailReadonlyScope, isReadonlyScopeGrant, pollGmailOtp, verifyAccountEmail, type GmailCredentials, type GmailMessage } from "./gmail";

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

  test("accepts the code from the subject when the body is empty or ambiguous", () => {
    const withSubject = (subject: string, snippet: string) => message({
      snippet,
      payload: {
        headers: [
          { name: "From", value: `Coinbase <${sender}>` },
          { name: "Subject", value: subject },
        ],
      },
    });
    expect(extractOtp(withSubject("Your sign-in code is 847291", "Sign in to Home"), sender, submittedAt, submittedAt + 300_000)).toBe("847291");
    expect(extractOtp(withSubject("Your sign-in code is 847291", "Code 847291 and 123456"), sender, submittedAt, submittedAt + 300_000)).toBe("847291");
    expect(extractOtp(withSubject("Two codes 111111 and 222222", "Code 847291 and 123456"), sender, submittedAt, submittedAt + 300_000)).toBeNull();
    expect(extractOtp(withSubject("No code here", "Code 847291 and 123456"), sender, submittedAt, submittedAt + 300_000)).toBeNull();
  });

  test("accepts a split six-digit code", () => {
    expect(extractOtp(message({ snippet: "Your code is 847 291" }), sender, submittedAt, submittedAt + 300_000)).toBe("847291");
  });

  test("rejects a code from a subject the sender check would not have matched", () => {
    expect(extractOtp(message({
      snippet: "Sign in to Home",
      payload: { headers: [{ name: "From", value: "attacker@example.com" }, { name: "Subject", value: "Your code is 847291" }] },
    }), sender, submittedAt, submittedAt + 300_000)).toBeNull();
  });

  test("rejects every other sender and a matching display-name spoof", () => {
    expect(extractOtp(message({ payload: { headers: [{ name: "From", value: "attacker@example.com" }] } }), sender, submittedAt, submittedAt + 300_000)).toBeNull();
    expect(extractOtp(message({ payload: { headers: [{ name: "From", value: `${sender} <attacker@example.com>` }] } }), sender, submittedAt, submittedAt + 300_000)).toBeNull();
  });

  test("requires the word code in a subject before trusting a six-digit number", () => {
    const withSubject = (subject: string, snippet: string) => message({
      snippet,
      payload: {
        headers: [
          { name: "From", value: `Coinbase <${sender}>` },
          { name: "Subject", value: subject },
        ],
      },
    });
    expect(extractOtp(withSubject("Your September statement 202609 is ready", "Sign in to Home"), sender, submittedAt, submittedAt + 300_000)).toBeNull();
    expect(extractOtp(withSubject("Order 123 456 shipped", "Sign in to Home"), sender, submittedAt, submittedAt + 300_000)).toBeNull();
    expect(extractOtp(withSubject("Your verification code is 111111 or 222222", "Sign in to Home"), sender, submittedAt, submittedAt + 300_000)).toBeNull();
    expect(extractOtp(withSubject("Your Coinbase verification code is 847 291", "Sign in to Home"), sender, submittedAt, submittedAt + 300_000)).toBe("847291");
    expect(extractOtp(withSubject("Order 123 456 shipped", "Your sign-in code is 847291"), sender, submittedAt, submittedAt + 300_000)).toBe("847291");
  });
});

describe("Gmail account configuration", () => {
  test("accepts the configured bot account email and refuses when it is unset", () => {
    expect(verifyAccountEmail({ HOME_VERIFY_ACCOUNT_EMAIL: " bot@example.com " })).toBe("bot@example.com");
    expect(() => verifyAccountEmail({})).toThrow("HOME_VERIFY_ACCOUNT_EMAIL");
    expect(() => verifyAccountEmail({ HOME_VERIFY_ACCOUNT_EMAIL: "   " })).toThrow("HOME_VERIFY_ACCOUNT_EMAIL");
  });

  test("refuses OTP polling without a mailbox instead of querying an unfiltered mailbox", async () => {
    await expect(pollGmailOtp(credentials, sender, submittedAt, { accountEmail: "" })).rejects.toThrow("HOME_VERIFY_ACCOUNT_EMAIL");
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
        accountEmail: "bot@example.com",
        now: () => submittedAt + 2000,
        wait: async () => undefined,
      });
      expect(code).toBe("847291");
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
    expect(requests.some((request) => request.path.includes(`from%3A${encodeURIComponent(sender)}`))).toBe(true);
    expect(requests.some((request) => request.path.includes(`to%3Abot%40example.com`))).toBe(true);
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
