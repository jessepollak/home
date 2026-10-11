import "server-only";

import { deletionAuthErrorResponse } from "@/server/account-deletion/errors";

import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { requestOrigin } from "@/server/auth/signed-cookie";
import { resolveCustomer } from "@/server/customers/resolve";
import { getSqlExecutor } from "@/server/db/sql";
import { privateJson, withPrivateHeaders } from "@/server/http/private-response";
import { readBoundedRequestText } from "@/server/http/request";
import { CARDS_CONTRACT_VERSION, parseCardEphemeralKeyRequest, parseCardEphemeralKeyResponse, type CardWriteErrorCode } from "@/shared/cards/contract";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { createBridgeClient } from "./bridge/client";
import { readCardJourneyConfig } from "./bridge/journey-config";
import { createStripeClient } from "./stripe/client";
import { CardWriteFailure, createCardWriteService } from "./write-service";

function failure(code: CardWriteErrorCode, status: number): Response {
  return privateJson({ version: CARDS_CONTRACT_VERSION, error: { code } }, status);
}

export function createCardRevealHandler(deps: {
  authorize: SessionAuthorizer;
  customer: (session: VerifiedAccountSession) => Promise<{ id: string } | null>;
  ephemeralKey: (customerId: string, cardId: string, nonce: string) => Promise<string>;
}) {
  return async function POST(request: Request, cardId: string): Promise<Response> {
    let session: VerifiedAccountSession | Response;
    try { session = await authorizeSession(request, deps.authorize); }
    catch { return failure("CARDS_UNAVAILABLE", 503); }
    if (session instanceof Response) return withPrivateHeaders(session);
    const expected = requestOrigin(request);
    const origin = request.headers.get("origin");
    const site = request.headers.get("sec-fetch-site");
    if (!expected || !origin || origin !== expected.origin || site !== null && site !== "same-origin") return failure("CROSS_ORIGIN", 403);
    if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") return failure("INVALID_CARD_REQUEST", 400);
    if (!/^ic_[A-Za-z0-9]+$/.test(cardId)) return failure("CARD_NOT_FOUND", 404);
    let body: ReturnType<typeof parseCardEphemeralKeyRequest>;
    try {
      const result = await readBoundedRequestText(request, { maxBytes: 3072, fatal: false, ignoreContentLength: true });
      body = result.kind === "ok" && result.text.length <= 1024 ? parseCardEphemeralKeyRequest(JSON.parse(result.text)) : null;
    } catch { return failure("INVALID_CARD_REQUEST", 400); }
    if (!body) return failure("INVALID_CARD_REQUEST", 400);
    try {
      const customer = await deps.customer(session);
      if (!customer) return failure("CARDS_UNAVAILABLE", 503);
      const result = { version: CARDS_CONTRACT_VERSION, cardId, ephemeralKeySecret: await deps.ephemeralKey(customer.id, cardId, body.nonce) };
      if (!parseCardEphemeralKeyResponse(result)) throw new Error("Invalid ephemeral key response");
      return privateJson(result);
    } catch (error) {
      const deletionError = deletionAuthErrorResponse(error);
      if (deletionError) return deletionError;
      if (error instanceof CardWriteFailure) return failure(error.code, error.status);
      return failure("CARDS_UNAVAILABLE", 503);
    }
  };
}

export const cardRevealHandler = createCardRevealHandler({
  authorize: authorizeSession,
  customer: (session) => resolveCustomer(session, { create: false }),
  ephemeralKey: (customerId, cardId, nonce) => {
    const config = readCardJourneyConfig();
    if (!config) throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
    return createCardWriteService({ sql: getSqlExecutor(), config, bridge: createBridgeClient(config), stripe: createStripeClient(config) }).ephemeralKey(customerId, cardId, nonce);
  },
});
