import {
  ACCOUNT_PROVIDER_HEADER,
  type AccountProvider,
  type VerifiedAccountSession,
} from "@/shared/account/session-types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import type { PrepareTradeRequest, TradeIntentReview } from "@/shared/trading/types";
import {
  TradePreparationError,
  type TradePreparationFailure,
} from "./prepare";
import { TradeRuntimeCapabilityError } from "./runtime-intent-store";
import type { Hex } from "@/shared/trading/server-types";

export type TradeSessionAuthorizer = (request: Request) => Promise<Response>;
export type TradePreparer = (input: {
  httpRequest: Request;
  session: VerifiedAccountSession;
  request: PrepareTradeRequest;
  signal?: AbortSignal;
}) => Promise<TradeIntentReview>;
export type TradeFinalizer = (input: {
  httpRequest: Request;
  session: VerifiedAccountSession;
  intentId: string;
  intentHash: string;
  signature: Hex;
  signal?: AbortSignal;
}) => Promise<PreparedMoneyAction>;

const privateResponseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: `Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
} as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const intentHashPattern = /^[0-9a-f]{64}$/;
const eoaSignaturePattern = /^0x[0-9a-fA-F]{130}$/;
const smartAccountSignaturePattern = /^0x(?:[0-9a-fA-F]{2}){65,2048}$/;

export function createTradeHandler(dependencies: {
  authorize: TradeSessionAuthorizer;
  prepare: TradePreparer;
}) {
  return async function POST(request: Request): Promise<Response> {
    const session = await authorizeSession(request, dependencies.authorize);
    if (session instanceof Response) return session;
    const tradeRequest = await parseTradeRequest(request);
    if (!tradeRequest) {
      return privateError("INVALID_TRADE_REQUEST", "Choose an allowlisted asset, side, exact amount, and supported slippage.", 400);
    }
    try {
      return privateJson(await dependencies.prepare({
        httpRequest: request,
        session,
        request: tradeRequest,
        signal: request.signal,
      }), 200);
    } catch (error) {
      return responseForError(error);
    }
  };
}

export function createTradeFinalizeHandler(dependencies: {
  authorize: TradeSessionAuthorizer;
  finalize: TradeFinalizer;
}) {
  return async function POST(
    request: Request,
    context: { params: Promise<{ id: string }> },
  ): Promise<Response> {
    const session = await authorizeSession(request, dependencies.authorize);
    if (session instanceof Response) return session;
    const { id } = await context.params;
    const body = await parseFinalizeRequest(request, session.accountProvider);
    if (!uuidPattern.test(id) || !body) {
      return privateError("INVALID_TRADE_FINALIZATION", "A valid reviewed intent hash and signature are required.", 400);
    }
    try {
      return privateJson(await dependencies.finalize({
        httpRequest: request,
        session,
        intentId: id,
        intentHash: body.intentHash,
        signature: body.signature,
        signal: request.signal,
      }), 200);
    } catch (error) {
      return responseForError(error);
    }
  };
}

async function authorizeSession(
  request: Request,
  authorize: TradeSessionAuthorizer,
): Promise<VerifiedAccountSession | Response> {
  const boundaryResponse = await authorize(request);
  if (!boundaryResponse.ok) return boundaryResponse;
  const session = await parseAuthorizedSession(boundaryResponse, readRequestedProvider(request));
  if (!session) return privateError("TRADE_UNAVAILABLE", "Authentication is temporarily unavailable.", 503);
  if (!session.smartAccount) {
    return privateError("SMART_ACCOUNT_UNAVAILABLE", "A verified Base smart account is required.", 503);
  }
  return session;
}

async function parseTradeRequest(request: Request): Promise<PrepareTradeRequest | null> {
  const body = await readBoundedJson(request);
  if (!isRecord(body)) return null;
  const keys = Object.keys(body).sort();
  if (keys.join(",") !== "amountBaseUnits,assetId,side,slippageBps") return null;
  if (
    typeof body.assetId !== "string" || body.assetId.length > 32 ||
    (body.side !== "buy" && body.side !== "sell") ||
    typeof body.amountBaseUnits !== "string" || body.amountBaseUnits.length > 78 ||
    typeof body.slippageBps !== "number"
  ) return null;
  return body as PrepareTradeRequest;
}

async function parseFinalizeRequest(
  request: Request,
  provider: AccountProvider,
): Promise<{ intentHash: string; signature: Hex } | null> {
  const body = await readBoundedJson(request, provider === "base-account" ? 16_384 : 4096);
  const signaturePattern = provider === "base-account" ? smartAccountSignaturePattern : eoaSignaturePattern;
  if (
    !isRecord(body) ||
    Object.keys(body).sort().join(",") !== "intentHash,signature" ||
    typeof body.intentHash !== "string" ||
    !intentHashPattern.test(body.intentHash) ||
    typeof body.signature !== "string" ||
    !signaturePattern.test(body.signature)
  ) return null;
  return { intentHash: body.intentHash, signature: body.signature.toLowerCase() as Hex };
}

async function readBoundedJson(request: Request, maxBytes = 4096): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim();
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (
    contentType !== "application/json" ||
    !Number.isFinite(contentLength) || contentLength < 0 || contentLength > maxBytes
  ) return null;
  try { return await request.json(); } catch { return null; }
}

async function parseAuthorizedSession(
  response: Response,
  expectedProvider: AccountProvider | null,
): Promise<VerifiedAccountSession | null> {
  let value: unknown;
  try { value = await response.json(); } catch { return null; }
  if (
    !isRecord(value) || !isRecord(value.user) ||
    typeof value.user.subject !== "string" || value.user.subject.trim().length === 0 ||
    !expectedProvider || value.accountProvider !== expectedProvider
  ) return null;
  if (value.smartAccount === null) {
    return { user: { subject: value.user.subject }, smartAccount: null, accountProvider: expectedProvider };
  }
  if (!isRecord(value.smartAccount)) return null;
  const { address, chainId } = value.smartAccount;
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address) || chainId !== 8453) return null;
  return {
    user: { subject: value.user.subject },
    smartAccount: { address: address.toLowerCase() as `0x${string}`, chainId: 8453 },
    accountProvider: expectedProvider,
  };
}

function responseForError(error: unknown): Response {
  if (error instanceof TradeRuntimeCapabilityError) {
    return privateError(error.code, error.message, 503);
  }
  if (!(error instanceof TradePreparationError)) {
    return privateError("TRADE_UNAVAILABLE", "A trade action could not be prepared safely.", 502);
  }
  return responseForPreparationError(error.reason);
}

function responseForPreparationError(reason: TradePreparationFailure): Response {
  switch (reason) {
    case "invalid-request":
      return privateError("INVALID_TRADE_REQUEST", "Choose an allowlisted asset, side, exact amount, and supported slippage.", 400);
    case "invalid-finalization":
      return privateError("INVALID_TRADE_FINALIZATION", "The signature did not match this reviewed trade intent.", 409);
    case "stock-eligibility":
      return privateError("STOCK_EXECUTION_UNAVAILABLE", "Stock browsing is available, but execution requires separately verified issuer and provider eligibility.", 403);
    case "smart-account-unavailable":
      return privateError("SMART_ACCOUNT_UNAVAILABLE", "A verified Base smart account is required.", 503);
    case "signer-unsupported":
      return unavailableResult("signer-unsupported", "This verified account does not expose a supported current email-controlled owner at index 0.");
    case "insufficient-balance":
      return unavailableResult("insufficient-balance", "The current Base balance is lower than the reviewed spend amount.");
    case "no-liquidity":
      return unavailableResult("no-liquidity", "CDP returned no supported route for this exact pair and amount.");
    case "stale-quote":
      return unavailableResult("stale-quote", "The CDP quote is stale. Request a fresh review.");
    case "permit-expired":
      return unavailableResult("permit-expired", "The reviewed signing window or provider Permit2 authorization expired.");
    case "permit-used":
      return unavailableResult("permit-used", "The reviewed Permit2 nonce is already used. Request a fresh quote.");
    case "quote-rejected":
      return unavailableResult("quote-rejected", "The CDP quote did not match the requested asset, amount, Permit2 schema, or executable call constraints.");
    default:
      return privateError("TRADE_UNAVAILABLE", "A fresh CDP trade quote is temporarily unavailable.", 502);
  }
}

function readRequestedProvider(request: Request): AccountProvider | null {
  const requested = request.headers.get(ACCOUNT_PROVIDER_HEADER);
  if (requested === null || requested === "cdp-embedded") return "cdp-embedded";
  return requested === "base-account" ? "base-account" : null;
}

function unavailableResult(reason: string, message: string): Response {
  return privateJson({ status: "unavailable", reason, message }, 200);
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
