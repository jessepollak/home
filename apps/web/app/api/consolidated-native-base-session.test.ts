import { afterAll, describe, expect, test } from "bun:test";
import {
  ACCOUNT_PROVIDER_HEADER,
} from "@/shared/account/session-types";
import {
  HOME_CHALLENGE_COOKIE,
  HOME_SESSION_COOKIE,
  createNativeBaseNonceHandler,
  createNativeBaseVerifyHandler,
} from "@/server/auth/native-base-session";

const SECRET = "native-base-route-test-secret-with-32-bytes";
const ADDRESS = "0x1111111111111111111111111111111111111111";
const ORIGIN = "https://home.example";
const NOW = new Date("2026-09-13T12:00:00.000Z");
const previousSecret = process.env.HOME_SESSION_SECRET;
const previousProjectId = process.env.NEXT_PUBLIC_CDP_PROJECT_ID;

process.env.HOME_SESSION_SECRET = SECRET;
delete process.env.NEXT_PUBLIC_CDP_PROJECT_ID;

const previousFetch = globalThis.fetch;
globalThis.fetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    void init;
    return new Response(null, { status: 503 });
  },
  { preconnect: previousFetch.preconnect },
);

const [valuation, savings, activity, borrow, trades] = await Promise.all([
  import("./portfolio/valuation/route"),
  import("./savings/positions/route"),
  import("./activity/route"),
  import("./borrow/route"),
  import("./trades/route"),
]);

afterAll(() => {
  restoreEnvironment("HOME_SESSION_SECRET", previousSecret);
  restoreEnvironment("NEXT_PUBLIC_CDP_PROJECT_ID", previousProjectId);
  globalThis.fetch = previousFetch;
});

describe("consolidated route authorization", () => {
  test("accepts valid native Base sessions and rejects invalid sessions", async () => {
    const validCookie = await createSessionCookie();
    const invalidCookie = tamper(validCookie);
    const routes = [
      {
        name: "portfolio valuation",
        invoke: (cookie: string) => valuation.GET(request("/api/portfolio/valuation?region=US", "GET", cookie)),
      },
      {
        name: "savings positions",
        invoke: (cookie: string) => savings.GET(request("/api/savings/positions", "GET", cookie)),
      },
      {
        name: "activity",
        invoke: (cookie: string) => activity.GET(request("/api/activity?to=2026-09-12T12%3A00%3A00.000Z", "GET", cookie)),
      },
      {
        name: "borrow",
        invoke: (cookie: string) => borrow.GET(request("/api/borrow", "GET", cookie)),
      },
      {
        name: "trades",
        invoke: (cookie: string) => trades.POST(request("/api/trades", "POST", cookie)),
      },
    ] as const;

    for (const route of routes) {
      const valid = await route.invoke(validCookie);
      const validBody = (await valid.clone().json().catch(() => null)) as { error?: { code?: string } } | null;
      expect([400, 401, 403], `${route.name} valid session status ${valid.status}`).not.toContain(valid.status);
      expect(validBody?.error?.code, `${route.name} valid session boundary code`).not.toBe("AUTH_UNAVAILABLE");
      expect((await route.invoke(invalidCookie)).status, `${route.name} invalid session`).toBe(401);
    }
  });
});

async function createSessionCookie(): Promise<string> {
  const dependencies = {
    sessionSecret: SECRET,
    now: () => NOW,
    randomId: () => "a".repeat(48),
    verify: async () => true,
  };
  const nonce = createNativeBaseNonceHandler(dependencies);
  const verify = createNativeBaseVerifyHandler(dependencies);
  const nonceResponse = await nonce(jsonRequest("/api/auth/base/nonce", { address: ADDRESS }));
  const challengeCookie = responseCookie(nonceResponse, HOME_CHALLENGE_COOKIE);
  const { message } = await nonceResponse.json() as { message: string };
  const verifyResponse = await verify(jsonRequest(
    "/api/auth/base/verify",
    { message, signature: "0x1234" },
    challengeCookie,
  ));
  expect(verifyResponse.status).toBe(200);
  return responseCookie(verifyResponse, HOME_SESSION_COOKIE);
}

function request(path: string, method: "GET" | "POST", cookie: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      Cookie: cookie,
      [ACCOUNT_PROVIDER_HEADER]: "base-account",
    },
  });
}

function jsonRequest(path: string, body: unknown, cookie?: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function responseCookie(response: Response, name: string): string {
  const value = response.headers.getSetCookie().find((header) => header.startsWith(`${name}=`));
  if (!value) throw new Error(`Missing ${name} cookie`);
  return value.slice(0, value.indexOf(";"));
}

function tamper(cookie: string): string {
  const last = cookie.at(-1);
  return `${cookie.slice(0, -1)}${last === "x" ? "y" : "x"}`;
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
