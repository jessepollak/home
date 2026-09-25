import "server-only";

import {
  ACCOUNT_PROVIDER_HEADER,
  BASE_CHAIN_ID,
  type AccountProvider,
  type AccountProviderRequest,
  type VerifiedAccountSession,
} from "@/shared/account/session-types";
import {
  isHomeSessionConfigured,
  readNativeBaseSession,
} from "@/server/auth/native-base-session";


export type SessionPayload = VerifiedAccountSession;

export type VerifiedEndUser = {
  userId: unknown;
  authenticationMethods?: unknown;
  evmSmartAccountObjects?: unknown;
};

export interface AccessTokenValidator {
  validateAccessToken(accessToken: string): Promise<unknown>;
}

export class InvalidAccessTokenError extends Error {
  constructor() {
    super("The CDP access token is invalid or expired.");
    this.name = "InvalidAccessTokenError";
  }
}

export class AuthUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("CDP authentication is unavailable.", { cause });
    this.name = "AuthUnavailableError";
  }
}

class InvalidVerifiedIdentityError extends Error {
  constructor() {
    super("CDP returned an invalid verified identity.");
    this.name = "InvalidVerifiedIdentityError";
  }
}

const compactJwtPattern = /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/;
const evmAddressPattern = /^0x[0-9a-fA-F]{40}$/;
const subjectPattern = /^[a-zA-Z0-9-]{1,100}$/;

function normalizeAddress(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !evmAddressPattern.test(value)) {
    throw new InvalidVerifiedIdentityError();
  }
  return value.toLowerCase() as `0x${string}`;
}

function normalizeEmbeddedAddress(value: VerifiedEndUser): `0x${string}` | null {
  if (!Array.isArray(value.evmSmartAccountObjects)) {
    throw new InvalidVerifiedIdentityError();
  }

  const smartAccounts = value.evmSmartAccountObjects.map((account: unknown) => {
    if (!account || typeof account !== "object" || !("address" in account)) {
      throw new InvalidVerifiedIdentityError();
    }
    return normalizeAddress(account.address);
  });

  return smartAccounts[0] ?? null;
}

function authenticatedAccountProviders(value: unknown): Set<AccountProvider> {
  if (!value || typeof value !== "object") {
    throw new InvalidVerifiedIdentityError();
  }
  const authenticationMethods = (value as VerifiedEndUser).authenticationMethods;
  if (!Array.isArray(authenticationMethods)) {
    throw new InvalidVerifiedIdentityError();
  }

  const methods: unknown[] = authenticationMethods;
  const providers = new Set<AccountProvider>();
  for (const method of methods) {
    if (
      !method ||
      typeof method !== "object" ||
      !("type" in method) ||
      typeof method.type !== "string"
    ) {
      throw new InvalidVerifiedIdentityError();
    }
    providers.add(method.type === "siwe" ? "base-account" : "cdp-embedded");
  }
  return providers;
}

function restoredAccountProvider(value: unknown): AccountProvider {
  const providers = authenticatedAccountProviders(value);
  if (providers.size !== 1) {
    throw new InvalidVerifiedIdentityError();
  }
  return [...providers][0];
}

function verifiedEmail(value: unknown): string | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as VerifiedEndUser).authenticationMethods)) return null;
  for (const method of (value as VerifiedEndUser).authenticationMethods as unknown[]) {
    if (!method || typeof method !== "object" || !("type" in method) || method.type !== "email" ||
        !("email" in method) || typeof method.email !== "string") continue;
    const email = method.email.trim().toLowerCase();
    if (email.length <= 320 && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email)) return email;
  }
  return null;
}

function normalizeVerifiedEndUser(
  value: unknown,
  accountProvider: AccountProvider,
): SessionPayload {
  if (!value || typeof value !== "object") {
    throw new InvalidVerifiedIdentityError();
  }

  const endUser = value as VerifiedEndUser;
  if (typeof endUser.userId !== "string" || !subjectPattern.test(endUser.userId)) {
    throw new InvalidVerifiedIdentityError();
  }
  if (
    accountProvider === "cdp-embedded" &&
    !authenticatedAccountProviders(endUser).has("cdp-embedded")
  ) {
    throw new InvalidVerifiedIdentityError();
  }

  const address = normalizeEmbeddedAddress(endUser);

  return {
    user: {
      subject: endUser.userId,
    },
    smartAccount: address
      ? {
          address,
          chainId: BASE_CHAIN_ID,
        }
      : null,
    accountProvider,
  };
}

export type SessionHandlerDependencies = {
  getValidator: () => Promise<AccessTokenValidator>;
  baseAccountEnabled?: boolean | (() => boolean);
  homeSessionSecret?: string;
  issueCookies?: (session: VerifiedAccountSession, request: Request) => string[];
  onVerifiedSession?: (session: VerifiedAccountSession, context: { request: Request; email: string | null }) => void;
};

const privateResponseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: `Cookie, Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
} as const;

function jsonResponse(body: unknown, status: number, cookies: string[] = []): Response {
  return Response.json(body, {
    status,
    headers: [
      ...Object.entries(privateResponseHeaders),
      ...cookies.map((value): [string, string] => ["Set-Cookie", value]),
    ],
  });
}

function unauthenticatedResponse(): Response {
  return jsonResponse(
    {
      error: {
        code: "UNAUTHENTICATED",
        message: "A valid access token is required.",
      },
    },
    401,
  );
}

function authUnavailableResponse(): Response {
  return jsonResponse(
    {
      error: {
        code: "AUTH_UNAVAILABLE",
        message: "Authentication is temporarily unavailable.",
      },
    },
    503,
  );
}

function baseAccountDisabledResponse(): Response {
  return jsonResponse(
    {
      error: {
        code: "BASE_ACCOUNT_DISABLED",
        message: "Base Account sign-in is not enabled.",
      },
    },
    403,
  );
}

function invalidProviderResponse(): Response {
  return jsonResponse(
    {
      error: {
        code: "INVALID_ACCOUNT_PROVIDER",
        message: "The requested account provider is not supported.",
      },
    },
    400,
  );
}

function ambiguousAuthenticationResponse(): Response {
  return jsonResponse(
    { error: { code: "AMBIGUOUS_AUTHENTICATION", message: "Use exactly one account authentication provider." } },
    400,
  );
}

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization");

  if (!authorization) {
    return null;
  }

  const match = /^Bearer[\t ]+([^\s,]+)$/i.exec(authorization);
  const token = match?.[1];

  if (!token || token.length > 8192 || !compactJwtPattern.test(token)) {
    return null;
  }

  return token;
}

function readAccountProvider(request: Request): AccountProviderRequest | null {
  const requested = request.headers.get(ACCOUNT_PROVIDER_HEADER);
  if (requested === null || requested === "cdp-embedded") {
    return "cdp-embedded";
  }
  if (requested === "base-account" || requested === "restore") {
    return requested;
  }
  return null;
}

export function createSessionHandler({
  getValidator,
  homeSessionSecret,
  baseAccountEnabled,
  issueCookies,
  onVerifiedSession,
}: SessionHandlerDependencies) {
  return async function GET(request: Request): Promise<Response> {
    const accountProvider = readAccountProvider(request);
    if (!accountProvider) {
      return invalidProviderResponse();
    }

    const authorizationPresent = request.headers.has("Authorization");
    const accessToken = readBearerToken(request);
    const nativeBaseAccountEnabled = typeof baseAccountEnabled === "function"
      ? baseAccountEnabled()
      : baseAccountEnabled ?? isHomeSessionConfigured(
        homeSessionSecret ?? process.env.HOME_SESSION_SECRET,
      );
    const nativeSession = nativeBaseAccountEnabled
      ? readNativeBaseSession(request, homeSessionSecret)
      : { kind: "absent" as const };
    if (authorizationPresent && nativeSession.kind !== "absent") {
      return ambiguousAuthenticationResponse();
    }
    if (nativeSession.kind === "invalid") {
      return unauthenticatedResponse();
    }
    if (nativeSession.kind === "valid") {
      if (accountProvider === "cdp-embedded") return invalidProviderResponse();
      const response = jsonResponse(nativeSession.session, 200);
      try { onVerifiedSession?.(nativeSession.session, { request, email: null }); } catch { return response; }
      return response;
    }
    if (!accessToken) return unauthenticatedResponse();
    if (accountProvider === "base-account") return baseAccountDisabledResponse();
    try {
      const validator = await getValidator();
      const verifiedEndUser = await validator.validateAccessToken(accessToken);
      const selectedProvider =
        accountProvider === "restore"
          ? restoredAccountProvider(verifiedEndUser)
          : accountProvider;
      if (selectedProvider === "base-account") {
        return baseAccountDisabledResponse();
      }
      const session = normalizeVerifiedEndUser(verifiedEndUser, selectedProvider);

      const response = jsonResponse(
        session,
        200,
        session.smartAccount ? issueCookies?.(session, request) ?? [] : [],
      );
      try { onVerifiedSession?.(session, { request, email: verifiedEmail(verifiedEndUser) }); } catch { return response; }
      return response;
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) {
        return unauthenticatedResponse();
      }

      return authUnavailableResponse();
    }
  };
}
