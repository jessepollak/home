import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  ACCOUNT_PROVIDER_HEADER,
  type VerifiedAccountSession,
} from "@/shared/account/session-types";
import { HOME_SESSION_COOKIE, signedValue } from "@/server/auth/native-base-session";
import {
  AuthUnavailableError,
  InvalidAccessTokenError,
  createSessionHandler,
  type AccessTokenValidator,
  type SessionHandlerDependencies,
} from "./session";

const requestUrl = "http://127.0.0.1:3103/api/session";
const smartAccountAddress = "0xAbCdEf0123456789aBCdef0123456789abCDef01";
const baseAddress = "0x1111111111111111111111111111111111111111" as const;
const SECRET = "test-home-session-secret-value-at-least-32-bytes";

function makeRequest(
  authorization?: string,
  accountProvider?: string,
  cookieValue?: string,
): Request {
  const headers = new Headers();
  if (authorization) headers.set("Authorization", authorization);
  if (accountProvider) headers.set(ACCOUNT_PROVIDER_HEADER, accountProvider);
  if (cookieValue) headers.set("Cookie", cookieValue);
  return new Request(requestUrl, { headers });
}

function makeHandler(
  validateAccessToken: AccessTokenValidator["validateAccessToken"],
  getValidator: () => Promise<AccessTokenValidator> = async () => ({
    validateAccessToken,
  }),
  options: Omit<SessionHandlerDependencies, "getValidator"> = {},
) {
  return createSessionHandler({ getValidator, ...options });
}

async function expectPrivateJson(
  response: Response,
  status: number,
  body: unknown,
) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe(
    "private, no-store, max-age=0",
  );
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("vary")).toBe(
    `Cookie, Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
  );
  expect(await response.json()).toEqual(body);
}

const unauthenticatedBody = {
  error: {
    code: "UNAUTHENTICATED",
    message: "A valid access token is required.",
  },
};

const unavailableBody = {
  error: {
    code: "AUTH_UNAVAILABLE",
    message: "Authentication is temporarily unavailable.",
  },
};

const baseAccountDisabledBody = {
  error: {
    code: "BASE_ACCOUNT_DISABLED",
    message: "Base Account sign-in is not enabled.",
  },
};

describe("GET /api/session handler", () => {
  test("rejects missing and malformed authorization headers before provider access", async () => {
    let calls = 0;
    const handler = makeHandler(async () => {
      calls += 1;
      return {};
    });

    for (const request of [
      makeRequest(),
      makeRequest("Basic abc"),
      makeRequest("Bearer"),
      makeRequest("Bearer verified.token"),
      makeRequest("Bearer verified.token.value space.value"),
      makeRequest("Bearer verified.token.value,second.token.value"),
    ]) {
      await expectPrivateJson(await handler(request), 401, unauthenticatedBody);
    }

    expect(calls).toBe(0);
  });

  test("passes only the bearer token to validation", async () => {
    let receivedToken: string | undefined;
    const handler = makeHandler(async (accessToken) => {
      receivedToken = accessToken;
      return embeddedProfile();
    });

    const response = await handler(makeRequest("bEaReR\tverified.token.value"));

    expect(response.status).toBe(200);
    expect(receivedToken).toBe("verified.token.value");
  });

  test("maps invalid and expired provider tokens to 401", async () => {
    for (const error of [new InvalidAccessTokenError(), new InvalidAccessTokenError()]) {
      const handler = makeHandler(async () => {
        throw error;
      });
      await expectPrivateJson(
        await handler(makeRequest("Bearer invalid.token.value")),
        401,
        unauthenticatedBody,
      );
    }
  });

  test("returns only verified identity and the first embedded smart account", async () => {
    const handler = makeHandler(async () => ({
      ...embeddedProfile(),
      evmAccounts: [baseAddress],
      evmSmartAccountObjects: [
        { address: smartAccountAddress, ownerAddresses: [baseAddress] },
        { address: "0x2222222222222222222222222222222222222222" },
      ],
      providerInternalField: "must-not-leak",
    }));

    await expectPrivateJson(
      await handler(makeRequest("Bearer verified.token.value")),
      200,
      {
        user: { subject: "cdp-user-123" },
        smartAccount: {
          address: smartAccountAddress.toLowerCase(),
          chainId: 8453,
        },
        accountProvider: "cdp-embedded",
      },
    );
  });

  test("rejects Bearer-validated Base Account profiles for explicit and restore selectors", async () => {
    let calls = 0;
    const handler = makeHandler(async () => {
      calls += 1;
      return {
        userId: "cdp-siwe-user",
        authenticationMethods: [{ type: "siwe", address: baseAddress }],
        evmSmartAccountObjects: [{ address: smartAccountAddress }],
      };
    });

    for (const selector of ["base-account", "restore"]) {
      await expectPrivateJson(
        await handler(makeRequest(`Bearer ${selector}.token.value`, selector)),
        403,
        baseAccountDisabledBody,
      );
    }
    // The explicit selector is answered before CDP is consulted; only `restore`
    // needs the profile to learn that it resolves to Base Account.
    expect(calls).toBe(1);
  });

  test("restores only an unambiguous email account provider", async () => {
    const emailHandler = makeHandler(async () => embeddedProfile());
    await expectPrivateJson(
      await emailHandler(makeRequest("Bearer email.token.value", "restore")),
      200,
      {
        user: { subject: "cdp-user-123" },
        smartAccount: {
          address: smartAccountAddress.toLowerCase(),
          chainId: 8453,
        },
        accountProvider: "cdp-embedded",
      },
    );

    for (const authenticationMethods of [
      [],
      [
        { type: "email", email: "private@example.com" },
        { type: "siwe", address: baseAddress },
      ],
    ]) {
      const handler = makeHandler(async () => ({
        ...embeddedProfile(),
        authenticationMethods,
      }));
      await expectPrivateJson(
        await handler(makeRequest("Bearer restore.token.value", "restore")),
        503,
        unavailableBody,
      );
    }
  });

  test("native Base gate follows HOME_SESSION_SECRET even when a CDP project is configured", async () => {
    const previousProjectId = process.env.NEXT_PUBLIC_CDP_PROJECT_ID;
    process.env.NEXT_PUBLIC_CDP_PROJECT_ID = "configured-project";
    try {
      const cookieValue = nativeSessionCookie();
      const enabled = makeHandler(async () => ({}), undefined, {
        homeSessionSecret: SECRET,
      });
      const disabled = makeHandler(async () => ({}), undefined, {
        baseAccountEnabled: false,
      });

      await expectPrivateJson(
        await enabled(makeRequest(undefined, "base-account", cookieValue)),
        200,
        {
          user: { subject: nativeSubject(baseAddress) },
          smartAccount: { address: baseAddress, chainId: 8453 },
          accountProvider: "base-account",
        },
      );
      await expectPrivateJson(
        await disabled(makeRequest(undefined, "base-account", cookieValue)),
        401,
        unauthenticatedBody,
      );
    } finally {
      restoreEnvironment("NEXT_PUBLIC_CDP_PROJECT_ID", previousProjectId);
    }
  });

  test("rejects simultaneous token and valid native session authentication", async () => {
    let calls = 0;
    const handler = makeHandler(async () => {
      calls += 1;
      return embeddedProfile();
    }, undefined, {
      baseAccountEnabled: true,
      homeSessionSecret: SECRET,
    });

    await expectPrivateJson(
      await handler(makeRequest(
        "bEaReR\tverified.token.value",
        "cdp-embedded",
        nativeSessionCookie(),
      )),
      400,
      {
        error: {
          code: "AMBIGUOUS_AUTHENTICATION",
          message: "Use exactly one account authentication provider.",
        },
      },
    );
    expect(calls).toBe(0);
  });

  test("issues render cookies only for Bearer-validated smart accounts", async () => {
    const calls: VerifiedAccountSession[] = [];
    const issueCookies = (session: VerifiedAccountSession) => {
      calls.push(session);
      return ["home-cdp-session=issued; Path=/"];
    };
    const bearerWithSmartAccount = makeHandler(async () => embeddedProfile(), undefined, {
      issueCookies,
    });
    const bearerWithoutSmartAccount = makeHandler(async () => ({
      ...embeddedProfile(),
      evmSmartAccountObjects: [],
    }), undefined, { issueCookies });
    const native = makeHandler(async () => ({}), undefined, {
      homeSessionSecret: SECRET,
      issueCookies,
    });

    const bearerResponse = await bearerWithSmartAccount(
      makeRequest("Bearer verified.token.value"),
    );
    expect(bearerResponse.headers.getSetCookie()).toEqual([
      "home-cdp-session=issued; Path=/",
    ]);
    expect((await bearerWithoutSmartAccount(
      makeRequest("Bearer verified.token.value"),
    )).headers.getSetCookie()).toEqual([]);
    expect((await native(
      makeRequest(undefined, "base-account", nativeSessionCookie()),
    )).headers.getSetCookie()).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.accountProvider).toBe("cdp-embedded");
  });

  test("rejects unknown account-provider selectors before provider access", async () => {
    let calls = 0;
    const handler = makeHandler(async () => {
      calls += 1;
      return {};
    });

    await expectPrivateJson(
      await handler(makeRequest("Bearer verified.token.value", "browser-wallet")),
      400,
      {
        error: {
          code: "INVALID_ACCOUNT_PROVIDER",
          message: "The requested account provider is not supported.",
        },
      },
    );
    expect(calls).toBe(0);
  });

  test("returns null when the verified identity has no embedded smart account", async () => {
    const handler = makeHandler(async () => ({
      ...embeddedProfile(),
      evmAccounts: [baseAddress],
      evmSmartAccountObjects: [],
    }));

    await expectPrivateJson(
      await handler(makeRequest("Bearer verified.token.value")),
      200,
      {
        user: { subject: "cdp-user-123" },
        smartAccount: null,
        accountProvider: "cdp-embedded",
      },
    );
  });

  test("fails closed when provider configuration or transport is unavailable", async () => {
    const missingConfigHandler = makeHandler(
      async () => ({}),
      async () => {
        throw new AuthUnavailableError();
      },
    );
    const providerFailureHandler = makeHandler(async () => {
      throw new AuthUnavailableError(new Error("provider payload with sensitive details"));
    });

    for (const handler of [missingConfigHandler, providerFailureHandler]) {
      await expectPrivateJson(
        await handler(makeRequest("Bearer verified.token.value")),
        503,
        unavailableBody,
      );
    }
  });

  test("fails closed on malformed verified embedded identity data", async () => {
    for (const providerValue of [
      null,
      {
        userId: "cdp-siwe-only",
        authenticationMethods: [{ type: "siwe", address: baseAddress }],
        evmSmartAccountObjects: [{ address: smartAccountAddress }],
      },
      { userId: "bad subject!", evmSmartAccountObjects: [] },
      {
        userId: "cdp-user",
        authenticationMethods: [{ type: "email" }],
        evmSmartAccountObjects: [{ address: "not-an-address" }],
      },
      {
        userId: "cdp-user",
        authenticationMethods: [{ type: "email" }],
        evmSmartAccountObjects: undefined,
      },
    ]) {
      const handler = makeHandler(async () => providerValue);
      await expectPrivateJson(
        await handler(makeRequest("Bearer verified.token.value")),
        503,
        unavailableBody,
      );
    }
  });
});

function embeddedProfile() {
  return {
    userId: "cdp-user-123",
    authenticationMethods: [{ type: "email", email: "private@example.com" }],
    evmSmartAccountObjects: [{ address: smartAccountAddress }],
  };
}

function nativeSubject(address: string): string {
  return `base-${createHash("sha256").update(address).digest("hex").slice(0, 32)}`;
}

function nativeSessionCookie(): string {
  const issuedAt = new Date();
  const payload = {
    version: 1,
    session: {
      user: { subject: nativeSubject(baseAddress) },
      smartAccount: { address: baseAddress, chainId: 8453 },
      accountProvider: "base-account",
    },
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 60_000).toISOString(),
  };
  const token = signedValue(Buffer.from(SECRET), JSON.stringify(payload));
  return `${HOME_SESSION_COOKIE}=${token}`;
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("verified session capture", () => {
  for (const { name, methods, email } of [
    { name: "CDP email", methods: [{ type: "email", email: "  USER@Example.COM  " }], email: "user@example.com" },
    { name: "SMS", methods: [{ type: "sms", phoneNumber: "+15555550100" }], email: null },
    { name: "malformed email", methods: [{ type: "email", email: "invalid" }], email: null },
    { name: "malformed domain", methods: [{ type: "email", email: "user@foo..com" }], email: null },
    { name: "overlong email", methods: [{ type: "email", email: `${"x".repeat(320)}@example.com` }], email: null },
  ]) {
    test(`${name} gives the capture hook only a valid verified email`, async () => {
      const captured: Array<{ session: VerifiedAccountSession; email: string | null; request: Request }> = [];
      const handler = makeHandler(async () => ({ ...embeddedProfile(), authenticationMethods: methods }), undefined, {
        onVerifiedSession: (session, { request, email: receivedEmail }) => captured.push({ session, email: receivedEmail, request }),
      });
      const request = makeRequest("Bearer verified.token.value");
      expect((await handler(request)).status).toBe(200);
      expect(captured).toEqual([{ session: {
        user: { subject: "cdp-user-123" },
        smartAccount: { address: smartAccountAddress.toLowerCase() as `0x${string}`, chainId: 8453 },
        accountProvider: "cdp-embedded",
      }, email, request }]);
    });
  }

  test("native Base session passes null email", async () => {
    const captured: Array<{ email: string | null; provider: string }> = [];
    const handler = makeHandler(async () => ({}), undefined, {
      homeSessionSecret: SECRET,
      onVerifiedSession: (session, { email }) => captured.push({ provider: session.accountProvider, email }),
    });
    expect((await handler(makeRequest(undefined, "base-account", nativeSessionCookie()))).status).toBe(200);
    expect(captured).toEqual([{ provider: "base-account", email: null }]);
  });

  test("no capture on 401 but capture a provisioning session without a smart account", async () => {
    const captured: string[] = [];
    const handler = makeHandler(async () => ({ ...embeddedProfile(), evmSmartAccountObjects: [] }), undefined, {
      onVerifiedSession: (session) => captured.push(session.user.subject),
    });
    expect((await handler(makeRequest())).status).toBe(401);
    expect((await handler(makeRequest("Bearer verified.token.value"))).status).toBe(200);
    expect(captured).toEqual(["cdp-user-123"]);
  });

  test("untrusted customerId in request cannot enter capture or response", async () => {
    const suppliedId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const captured: VerifiedAccountSession[] = [];
    const handler = makeHandler(async () => embeddedProfile(), undefined, {
      onVerifiedSession: (session) => { captured.push(session); },
      issueCookies: () => ["home-render=verified; Path=/; HttpOnly"],
    });
    const request = makeRequest("Bearer verified.token.value");
    request.headers.set("X-Customer-Id", suppliedId);
    const response = await handler(new Request(`${requestUrl}?customerId=${suppliedId}`, { headers: request.headers }));
    expect(captured).toEqual([{ user: { subject: "cdp-user-123" },
      smartAccount: { address: smartAccountAddress.toLowerCase() as `0x${string}`, chainId: 8453 }, accountProvider: "cdp-embedded" }]);
    expect(JSON.stringify(await response.json())).not.toContain(suppliedId);
    expect(response.headers.get("set-cookie")).not.toContain(suppliedId);
  });

  test("throwing capture hook preserves successful session", async () => {
    const handler = makeHandler(async () => embeddedProfile(), undefined, {
      onVerifiedSession: () => { throw new Error("capture failed"); },
    });
    const response = await handler(makeRequest("Bearer verified.token.value"));
    expect(response.status).toBe(200);
    expect((await response.json()).accountProvider).toBe("cdp-embedded");
  });
});
