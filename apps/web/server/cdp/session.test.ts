import { describe, expect, test } from "bun:test";
import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";
import {
  AuthUnavailableError,
  InvalidAccessTokenError,
  createSessionHandler,
  type AccessTokenValidator,
} from "./session";

const requestUrl = "http://127.0.0.1:3103/api/session";
const smartAccountAddress = "0xAbCdEf0123456789aBCdef0123456789abCDef01";
const siweAddress = "0x1234567890abcdef1234567890ABCDEF12345678";

function makeRequest(
  authorization?: string,
  accountProvider?: string,
): Request {
  const headers = new Headers();
  if (authorization) {
    headers.set("Authorization", authorization);
  }
  if (accountProvider) {
    headers.set(ACCOUNT_PROVIDER_HEADER, accountProvider);
  }
  return new Request(requestUrl, { headers });
}

function makeHandler(
  validateAccessToken: AccessTokenValidator["validateAccessToken"],
  getValidator: () => Promise<AccessTokenValidator> = async () => ({
    validateAccessToken,
  }),
  baseAccountEnabled = false,
) {
  return createSessionHandler({ getValidator, baseAccountEnabled });
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
    `Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
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
      makeRequest("Bearer not-a-jwt"),
      makeRequest("Bearer token.with space.value"),
      makeRequest("Bearer token.value.extra,other"),
    ]) {
      await expectPrivateJson(await handler(request), 401, unauthenticatedBody);
    }

    expect(calls).toBe(0);
  });

  test("passes only the bearer token to validation", async () => {
    let receivedToken: string | undefined;
    const handler = makeHandler(async (accessToken) => {
      receivedToken = accessToken;
      return {
        userId: "cdp-user-123",
        authenticationMethods: [
          { type: "email", email: "private@example.com" },
        ],
        evmSmartAccountObjects: [],
      };
    });

    const response = await handler(makeRequest("bEaReR\tverified.token.value"));

    expect(response.status).toBe(200);
    expect(receivedToken).toBe("verified.token.value");
  });

  test("maps invalid and expired provider tokens to 401", async () => {
    for (const error of [
      new InvalidAccessTokenError(),
      new InvalidAccessTokenError(),
    ]) {
      const handler = makeHandler(async () => {
        throw error;
      });

      await expectPrivateJson(
        await handler(makeRequest("Bearer expired.token.value")),
        401,
        unauthenticatedBody,
      );
    }
  });

  test("returns only verified identity and the first verified embedded smart account by default", async () => {
    const handler = makeHandler(async () => ({
      userId: "cdp-user-123",
      authenticationMethods: [
        { type: "email", email: "private@example.com" },
        { type: "siwe", address: siweAddress },
      ],
      evmAccounts: ["0x1111111111111111111111111111111111111111"],
      evmSmartAccountObjects: [
        {
          address: smartAccountAddress,
          ownerAddresses: ["0x1111111111111111111111111111111111111111"],
        },
        {
          address: "0x2222222222222222222222222222222222222222",
          ownerAddresses: ["0x3333333333333333333333333333333333333333"],
        },
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

  test("selects only the server-verified SIWE address for explicit Base Account mode", async () => {
    const handler = makeHandler(
      async () => ({
        userId: "cdp-siwe-user",
        authenticationMethods: [
          { type: "siwe", address: siweAddress },
        ],
        evmSmartAccountObjects: [{ address: smartAccountAddress }],
      }),
      undefined,
      true,
    );

    await expectPrivateJson(
      await handler(
        makeRequest("Bearer verified.token.value", "base-account"),
      ),
      200,
      {
        user: { subject: "cdp-siwe-user" },
        smartAccount: {
          address: siweAddress.toLowerCase(),
          chainId: 8453,
        },
        accountProvider: "base-account",
      },
    );
  });

  test("restores only an unambiguous server-verified account provider", async () => {
    const emailHandler = makeHandler(
      async () => ({
        userId: "cdp-email-user",
        authenticationMethods: [
          { type: "email", email: "private@example.com" },
        ],
        evmSmartAccountObjects: [{ address: smartAccountAddress }],
      }),
      undefined,
      true,
    );
    const baseHandler = makeHandler(
      async () => ({
        userId: "cdp-siwe-user",
        authenticationMethods: [{ type: "siwe", address: siweAddress }],
        evmSmartAccountObjects: [{ address: smartAccountAddress }],
      }),
      undefined,
      true,
    );

    expect(
      await (
        await emailHandler(
          makeRequest("Bearer verified.token.value", "restore"),
        )
      ).json(),
    ).toEqual({
      user: { subject: "cdp-email-user" },
      smartAccount: {
        address: smartAccountAddress.toLowerCase(),
        chainId: 8453,
      },
      accountProvider: "cdp-embedded",
    });
    expect(
      await (
        await baseHandler(
          makeRequest("Bearer verified.token.value", "restore"),
        )
      ).json(),
    ).toEqual({
      user: { subject: "cdp-siwe-user" },
      smartAccount: {
        address: siweAddress.toLowerCase(),
        chainId: 8453,
      },
      accountProvider: "base-account",
    });
  });

  test("fails closed when restored provider identity is missing or ambiguous", async () => {
    for (const authenticationMethods of [
      [],
      [
        { type: "email", email: "private@example.com" },
        { type: "siwe", address: siweAddress },
      ],
    ]) {
      const handler = makeHandler(
        async () => ({
          userId: "cdp-ambiguous-user",
          authenticationMethods,
          evmSmartAccountObjects: [{ address: smartAccountAddress }],
        }),
        undefined,
        true,
      );
      await expectPrivateJson(
        await handler(makeRequest("Bearer verified.token.value", "restore")),
        503,
        unavailableBody,
      );
    }
  });

  test("rejects Base Account mode while the deployment flag is off before provider access", async () => {
    let calls = 0;
    const handler = makeHandler(async () => {
      calls += 1;
      return {};
    });

    await expectPrivateJson(
      await handler(makeRequest("Bearer verified.token.value", "base-account")),
      403,
      {
        error: {
          code: "BASE_ACCOUNT_DISABLED",
          message: "Base Account sign-in is not enabled.",
        },
      },
    );
    expect(calls).toBe(0);
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

  test("fails closed when Base mode has no single valid verified SIWE address", async () => {
    for (const authenticationMethods of [
      [],
      [{ type: "email", email: "private@example.com" }],
      [{ type: "siwe" }],
      [{ type: "siwe", address: "not-an-address" }],
      [
        { type: "siwe", address: siweAddress },
        {
          type: "siwe",
          address: "0x9999999999999999999999999999999999999999",
        },
      ],
    ]) {
      const handler = makeHandler(
        async () => ({
          userId: "cdp-siwe-user",
          authenticationMethods,
          evmSmartAccountObjects: [{ address: smartAccountAddress }],
        }),
        undefined,
        true,
      );
      await expectPrivateJson(
        await handler(
          makeRequest("Bearer verified.token.value", "base-account"),
        ),
        503,
        unavailableBody,
      );
    }
  });

  test("returns null when the verified identity has no embedded smart account and never uses the EOA", async () => {
    const handler = makeHandler(async () => ({
      userId: "cdp-user-without-smart-account",
      authenticationMethods: [
        { type: "email", email: "private@example.com" },
      ],
      evmAccounts: ["0x1111111111111111111111111111111111111111"],
      evmSmartAccountObjects: [],
    }));

    await expectPrivateJson(
      await handler(makeRequest("Bearer verified.token.value")),
      200,
      {
        user: { subject: "cdp-user-without-smart-account" },
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
      throw new AuthUnavailableError(
        new Error("provider payload with sensitive details"),
      );
    });

    await expectPrivateJson(
      await missingConfigHandler(makeRequest("Bearer verified.token.value")),
      503,
      unavailableBody,
    );
    await expectPrivateJson(
      await providerFailureHandler(makeRequest("Bearer verified.token.value")),
      503,
      unavailableBody,
    );
  });

  test("fails closed on malformed verified embedded identity data", async () => {
    for (const providerValue of [
      null,
      {
        userId: "cdp-siwe-only",
        authenticationMethods: [{ type: "siwe", address: siweAddress }],
        evmSmartAccountObjects: [{ address: smartAccountAddress }],
      },
      { userId: "bad subject!", evmSmartAccountObjects: [] },
      {
        userId: "cdp-user",
        evmSmartAccountObjects: [{ address: "not-an-address" }],
      },
      { userId: "cdp-user", evmSmartAccountObjects: undefined },
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
