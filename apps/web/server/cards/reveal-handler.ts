import "server-only";

import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { requestOrigin } from "@/server/auth/signed-cookie";
import { resolveCustomer } from "@/server/customers/resolve";
import { getSqlExecutor } from "@/server/db/sql";
import { privateJson, withPrivateHeaders } from "@/server/http/private-response";
import { readBoundedRequestText } from "@/server/http/request";
import { CARDS_CONTRACT_VERSION, parseCardRevealRequest, parseCardRevealResponse, type RevealRequest, type RevealGrant, type CardWriteErrorCode } from "@/shared/cards/contract";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { CardWriteFailure, createCardWriteService } from "./write-service";

function failure(code: CardWriteErrorCode, status: number): Response {
  return privateJson({ version: CARDS_CONTRACT_VERSION, error: { code } }, status);
}

export function createCardRevealHandler(deps: {
  authorize: SessionAuthorizer;
  customer: (session: VerifiedAccountSession) => Promise<{ id: string } | null>;
  reveal: (customerId: string, cardId: string, request: RevealRequest) => Promise<RevealGrant>;
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
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(cardId)) return failure("CARD_NOT_FOUND", 404);
    let body: ReturnType<typeof parseCardRevealRequest>;
    try {
      const result = await readBoundedRequestText(request, { maxBytes: 3072, fatal: false, ignoreContentLength: true });
      body = result.kind === "ok" && result.text.length <= 1024 ? parseCardRevealRequest(JSON.parse(result.text)) : null;
    } catch { return failure("INVALID_CARD_REQUEST", 400); }
    if (!body) return failure("INVALID_CARD_REQUEST", 400);
    try {
      const customer = await deps.customer(session);
      if (!customer) return failure("CARDS_UNAVAILABLE", 503);
      const grant = await deps.reveal(customer.id, cardId, body);
      if (grant.step !== body.step || body.step === "grant" && (grant.step !== "grant" || grant.nonce !== body.nonce)) throw new Error("Invalid reveal grant");
      const result = { version: CARDS_CONTRACT_VERSION, cardId, grant };
      if (!parseCardRevealResponse(result)) throw new Error("Invalid reveal response");
      return privateJson(result);
    } catch (error) {
      if (error instanceof CardWriteFailure) return failure(error.code, error.status);
      return failure("CARDS_UNAVAILABLE", 503);
    }
  };
}

export const cardRevealHandler = createCardRevealHandler({
  authorize: authorizeSession,
  customer: (session) => resolveCustomer(session, { create: false }),
  reveal: (customerId, cardId, request) => createCardWriteService({ sql: getSqlExecutor() }).reveal(customerId, cardId, request),
});
