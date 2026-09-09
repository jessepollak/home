import {
  ACCOUNT_PROVIDER_HEADER,
  type AccountProvider,
  type VerifiedAccountSession,
} from "@/features/account/session-types";
import type { FundingSessionAuthorizer } from "./handler";
import {
  IDRX_BASE_CHAIN_ID,
  IdrxMintError,
  isAllowedIdrxMintAmount,
  isIdrxVaChannel,
  type CreateIdrxMintRequest,
  type IdrxVaChannel,
} from "./idrx";

const privateResponseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  Vary: `Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
} as const;

const allowedIntentKeys = new Set(["assetId", "country", "toBeMinted", "channelId"]);

export function createIdrxMintHandler(dependencies: {
  authorize: FundingSessionAuthorizer;
  createMint: CreateIdrxMintRequest;
}) {
  return async function POST(request: Request): Promise<Response> {
    const requestOrigin = new URL(request.url).origin;
    const boundaryResponse = await dependencies.authorize(request);
    if (!boundaryResponse.ok) return withFundingHeaders(boundaryResponse);

    const session = await parseAuthorizedSession(
      boundaryResponse,
      readRequestedProvider(request),
    );
    if (!session) {
      return privateError(
        "AUTH_UNAVAILABLE",
        "Authentication is temporarily unavailable.",
        503,
      );
    }
    if (!session.smartAccount) {
      return privateError(
        "SMART_ACCOUNT_UNAVAILABLE",
        "A verified Base smart account is not available yet.",
        503,
      );
    }

    const intent = await readMintIntent(request);
    if (intent === "invalid") {
      return privateError(
        "INVALID_IDRX_MINT",
        "Use IDRX on Base with an Indonesia rail amount of at least 20000 IDR.",
        400,
      );
    }
    if (intent === "country") {
      return privateError(
        "IDRX_COUNTRY_UNSUPPORTED",
        "IDRX issuer mint is available for the Indonesia rail only.",
        400,
      );
    }

    try {
      const minted = await dependencies.createMint({
        address: session.smartAccount.address,
        toBeMinted: intent.toBeMinted,
        channelId: intent.channelId,
        returnUrl: new URL("/fund?return=idrx", requestOrigin).toString(),
        signal: request.signal,
      });
      return privateJson(minted, 200);
    } catch (error) {
      if (error instanceof IdrxMintError && error.code === "not-configured") {
        return privateError(
          "IDRX_NOT_CONFIGURED",
          "IDRX mint needs this deployment's server-only IDRX_API_KEY and IDRX_API_SECRET.",
          424,
        );
      }
      return privateError(
        "IDRX_UNAVAILABLE",
        "IDRX could not create a mint request. Try again or use hosted checkout once keys are configured.",
        503,
      );
    }
  };
}

async function readMintIntent(
  request: Request,
): Promise<
  | { toBeMinted: string; channelId: IdrxVaChannel }
  | "invalid"
  | "country"
> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    return "invalid";
  }
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return "invalid";
  }
  if (!isRecord(value) || Object.keys(value).some((key) => !allowedIntentKeys.has(key))) {
    return "invalid";
  }
  if (value.country !== undefined && value.country !== "ID") return "country";
  if (
    value.assetId !== "idrx" ||
    value.country !== "ID" ||
    !isAllowedIdrxMintAmount(value.toBeMinted) ||
    (value.channelId !== undefined && !isIdrxVaChannel(value.channelId))
  ) {
    return "invalid";
  }
  return {
    toBeMinted: value.toBeMinted,
    channelId: isIdrxVaChannel(value.channelId) ? value.channelId : "MANDIRI",
  };
}

async function parseAuthorizedSession(
  response: Response,
  expectedProvider: AccountProvider | null,
): Promise<VerifiedAccountSession | null> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    !isRecord(value.user) ||
    typeof value.user.subject !== "string" ||
    value.user.subject.trim().length === 0 ||
    value.accountProvider !== expectedProvider ||
    !expectedProvider
  ) {
    return null;
  }
  if (value.smartAccount === null) {
    return expectedProvider === "cdp-embedded"
      ? {
          user: { subject: value.user.subject },
          smartAccount: null,
          accountProvider: expectedProvider,
        }
      : null;
  }
  if (!isRecord(value.smartAccount)) return null;
  const { address, chainId } = value.smartAccount;
  if (
    typeof address !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(address) ||
    chainId !== IDRX_BASE_CHAIN_ID
  ) {
    return null;
  }
  return {
    user: { subject: value.user.subject },
    smartAccount: {
      address: address.toLowerCase() as `0x${string}`,
      chainId: IDRX_BASE_CHAIN_ID,
    },
    accountProvider: expectedProvider,
  };
}

function readRequestedProvider(request: Request): AccountProvider | null {
  const requested = request.headers.get(ACCOUNT_PROVIDER_HEADER);
  if (requested === null || requested === "cdp-embedded") return "cdp-embedded";
  return requested === "base-account" ? "base-account" : null;
}

function withFundingHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(privateResponseHeaders)) {
    headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

function privateError(code: string, message: string, status: number): Response {
  return privateJson({ error: { code, message } }, status);
}

function privateJson(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: privateResponseHeaders });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
