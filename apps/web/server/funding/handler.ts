import {
  ACCOUNT_PROVIDER_HEADER,
  type AccountProvider,
  type VerifiedAccountSession,
} from "@/shared/account/session-types";
import type { OnrampPaymentMethod } from "@/shared/funding/types";
import type { CreateCoinbaseOnrampSession } from "./coinbase-onramp";
import { CoinbaseOnrampError } from "./coinbase-onramp";

export type FundingSessionAuthorizer = (request: Request) => Promise<Response>;

const AUTH_RESPONSE_MAX_BYTES = 4096;

const privateResponseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  Vary: `Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
} as const;

export function createFundingOnrampSessionHandler(dependencies: {
  authorize: FundingSessionAuthorizer;
  createOnrampSession: CreateCoinbaseOnrampSession;
}) {
  return async function POST(request: Request): Promise<Response> {
    const requestOrigin = new URL(request.url).origin;
    let boundaryResponse: Response;
    try {
      boundaryResponse = await dependencies.authorize(request);
    } catch {
      return privateError(
        "AUTH_UNAVAILABLE",
        "Authentication is temporarily unavailable.",
        503,
      );
    }
    if (!boundaryResponse.ok) return withFundingHeaders(boundaryResponse);

    const session = await parseAuthorizedSession(
      boundaryResponse,
      readRequestedProvider(request),
      request.signal,
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

    const body = await readFundingRequestBody(request);
    if (!body) {
      return privateError(
        "INVALID_FUNDING_REQUEST",
        "Only canonical USDC on Base is available through Coinbase funding.",
        400,
      );
    }

    const requestUrl = new URL(request.url);
    const redirectUrl = new URL("/fund?return=coinbase", requestOrigin).toString();
    try {
      const hosted = await dependencies.createOnrampSession({
        address: session.smartAccount.address,
        redirectUrl,
        domain: requestUrl.hostname,
        partnerUserRef: session.user.subject,
        paymentMethod: body.paymentMethod,
        paymentAmount: body.paymentAmount,
        clientIp: readClientIp(request),
        signal: request.signal,
      });
      return privateJson(hosted, 200);
    } catch (error) {
      if (error instanceof CoinbaseOnrampError && error.code === "not-configured") {
        return privateError(
          "ONRAMP_NOT_CONFIGURED",
          "Coinbase Onramp needs this deployment's existing CDP secret key credentials.",
          424,
        );
      }
      return privateError(
        "ONRAMP_UNAVAILABLE",
        "Coinbase could not create an Onramp session. Verify Headless Onramp access and allowlist this Home origin in the existing CDP project.",
        503,
      );
    }
  };
}

type FundingRequestBody = {
  paymentMethod: OnrampPaymentMethod;
  paymentAmount: string;
};

async function readFundingRequestBody(request: Request): Promise<FundingRequestBody | null> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    return null;
  }
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return null;
  }
  if (!isRecord(value) || value.assetId !== "usdc") return null;
  for (const key of Object.keys(value)) {
    if (key !== "assetId" && key !== "paymentMethod" && key !== "paymentAmount") {
      return null;
    }
  }
  const paymentMethod = value.paymentMethod;
  if (paymentMethod !== "apple-pay" && paymentMethod !== "google-pay") {
    return null;
  }
  const paymentAmount = value.paymentAmount;
  if (!isUsdPaymentAmount(paymentAmount)) {
    return null;
  }
  return {
    paymentMethod,
    paymentAmount: normalizeUsdAmount(paymentAmount),
  };
}

function isUsdPaymentAmount(value: unknown): value is string {
  return typeof value === "string" && /^(?:[1-9]\d{0,3})(?:\.\d{1,2})?$/.test(value);
}

function normalizeUsdAmount(value: string): string {
  const [whole, fraction = ""] = value.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

function readClientIp(request: Request): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = forwarded || request.headers.get("x-real-ip")?.trim() || undefined;
  if (!candidate || candidate.length > 45 || !/^[\d.:a-fA-F]+$/.test(candidate)) {
    return undefined;
  }
  return candidate;
}

async function parseAuthorizedSession(
  response: Response,
  expectedProvider: AccountProvider | null,
  signal: AbortSignal,
): Promise<VerifiedAccountSession | null> {
  const value = await readBoundedResponseJson(response, signal);
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
    chainId !== 8453
  ) {
    return null;
  }
  return {
    user: { subject: value.user.subject },
    smartAccount: {
      address: address.toLowerCase() as `0x${string}`,
      chainId: 8453,
    },
    accountProvider: expectedProvider,
  };
}

async function readBoundedResponseJson(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength < 0 ||
    contentLength > AUTH_RESPONSE_MAX_BYTES ||
    !response.body
  ) {
    return undefined;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let aborted = signal.aborted;
  const cancel = () => {
    aborted = true;
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });

  try {
    while (!aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > AUTH_RESPONSE_MAX_BYTES) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
    if (aborted) return undefined;

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  } finally {
    signal.removeEventListener("abort", cancel);
    try {
      reader.releaseLock();
    } catch {
      // A cancellation may still own the reader while the request is unwinding.
    }
  }
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
