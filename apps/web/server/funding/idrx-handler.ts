import {
  ACCOUNT_PROVIDER_HEADER,
  type AccountProvider,
  type VerifiedAccountSession,
} from "@/shared/account/session-types";
import type { FundingSessionAuthorizer } from "./handler";
import type {
  IdrxAttemptIntent,
  IdrxAttemptStore,
} from "./idrx-attempt-store";
import {
  IDRX_BASE_CHAIN_ID,
  isAllowedIdrxMintAmount,
  isIdrxVaChannel,
  type CreateIdrxMintRequest,
  type IdrxCustomerBinding,
} from "./idrx";
import type { IdrxFundingRail, IdrxVaChannel } from "@/shared/funding/types";

const privateResponseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  Vary: `Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
} as const;

const allowedIntentKeys = new Set([
  "assetId",
  "country",
  "toBeMinted",
  "rail",
  "channelId",
  "consent",
  "attemptId",
]);
const attemptIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createIdrxMintHandler(dependencies: {
  authorize: FundingSessionAuthorizer;
  createMint: CreateIdrxMintRequest;
  resolveCustomer: (subject: string) => IdrxCustomerBinding | null;
  attempts: IdrxAttemptStore;
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

    const customer = dependencies.resolveCustomer(session.user.subject);
    if (!customer || customer.subject !== session.user.subject) {
      return privateError(
        "IDRX_CUSTOMER_NOT_LINKED",
        "Link a verified IDRX customer identity before creating a payment request.",
        424,
      );
    }
    const owner = {
      subject: session.user.subject,
      smartAccount: session.smartAccount.address,
    };
    const persistedIntent: IdrxAttemptIntent = {
      toBeMinted: intent.toBeMinted,
      rail: intent.rail,
      channelId: intent.channelId ?? null,
      customerSubject: customer.subject,
      customerName: customer.customerName,
    };
    let attempt;
    try {
      attempt = await dependencies.attempts.begin(
        owner,
        intent.attemptId,
        persistedIntent,
      );
    } catch {
      return privateError(
        "IDRX_ATTEMPT_STORE_UNAVAILABLE",
        "Durable IDRX attempt recovery is unavailable; no provider request was sent.",
        424,
      );
    }
    if (attempt.status === "completed") return privateJson(attempt.result, 200);
    if (attempt.status === "mismatch") {
      return privateError(
        "IDRX_ATTEMPT_MISMATCH",
        "This attempt is already bound to different funding instructions.",
        409,
      );
    }
    if (attempt.status === "pending") {
      return privateError(
        "IDRX_ATTEMPT_PENDING",
        "This funding attempt may already have reached IDRX. Check balance and activity instead of creating another order.",
        409,
      );
    }

    try {
      const minted = await dependencies.createMint({
        address: session.smartAccount.address,
        customer,
        toBeMinted: intent.toBeMinted,
        rail: intent.rail,
        channelId: intent.channelId,
        returnUrl: new URL("/fund?return=idrx", requestOrigin).toString(),
        signal: request.signal,
      });
      await dependencies.attempts.complete(owner, intent.attemptId, minted);
      return privateJson(minted, 200);
    } catch {
      return privateError(
        "IDRX_ATTEMPT_PENDING",
        "IDRX may have received this attempt. Check balance and activity; Home will not create another order.",
        409,
      );
    }
  };
}

async function readMintIntent(
  request: Request,
): Promise<
  | {
      attemptId: string;
      toBeMinted: string;
      rail: IdrxFundingRail;
      channelId?: IdrxVaChannel;
    }
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
    value.consent !== true ||
    typeof value.attemptId !== "string" ||
    !attemptIdPattern.test(value.attemptId) ||
    (value.rail !== "bank-va" && value.rail !== "qris") ||
    (value.rail === "bank-va" && !isIdrxVaChannel(value.channelId)) ||
    (value.rail === "qris" && value.channelId !== undefined)
  ) {
    return "invalid";
  }
  if (value.rail === "bank-va") {
    return {
      attemptId: value.attemptId as string,
      toBeMinted: value.toBeMinted,
      rail: "bank-va",
      channelId: value.channelId as IdrxVaChannel,
    };
  }
  return {
    attemptId: value.attemptId as string,
    toBeMinted: value.toBeMinted,
    rail: "qris",
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
