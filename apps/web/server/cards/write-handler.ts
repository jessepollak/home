import "server-only";

import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { requestOrigin } from "@/server/auth/signed-cookie";
import { resolveCustomer } from "@/server/customers/resolve";
import { getSqlExecutor } from "@/server/db/sql";
import { CARDS_CONTRACT_VERSION, parseCardEnrollmentResponse, parseCardWriteResponse, parseCardWriteError, type CardWriteErrorCode } from "@/shared/cards/contract";
import { privateJson, withPrivateHeaders } from "@/server/http/private-response";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { createBridgeClient } from "./bridge/client";
import { readCardJourneyConfig } from "./bridge/journey-config";
import { createStripeClient } from "./stripe/client";
import { CardWriteFailure, createCardWriteService } from "./write-service";

function failure(code: CardWriteErrorCode, status: number): Response {
  const error = { version: CARDS_CONTRACT_VERSION, error: { code } };
  if (!parseCardWriteError(error)) throw new Error("Invalid card error response");
  return privateJson(error, status);
}

export function createCardWriteHandlers(deps: {
  authorize: SessionAuthorizer;
  customer: (session: VerifiedAccountSession) => Promise<{ id: string; walletId?: string | null } | null>;
  service: () => Pick<ReturnType<typeof createCardWriteService>, "enroll" | "issue" | "freeze">;
}) {
  async function authorized(request: Request): Promise<{ session: VerifiedAccountSession; customerId: string; origin: string } | Response> {
    const session = await authorizeSession(request, deps.authorize);
    if (session instanceof Response) return withPrivateHeaders(session);
    const expected = requestOrigin(request);
    const origin = request.headers.get("origin");
    const site = request.headers.get("sec-fetch-site");
    if (!expected || !origin || origin !== expected.origin || site !== null && site !== "same-origin") return failure("CROSS_ORIGIN", 403);
    if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") return failure("INVALID_CARD_REQUEST", 400);
    try {
      const text = await request.text();
      if (text.length > 1024 || JSON.stringify(JSON.parse(text)) !== "{}") return failure("INVALID_CARD_REQUEST", 400);
    } catch { return failure("INVALID_CARD_REQUEST", 400); }
    const customer = await deps.customer(session);
    if (!customer) return failure("CARDS_UNAVAILABLE", 503);
    return { session, customerId: customer.id, origin: expected.origin };
  }
  async function respond(request: Request, operation: (customerId: string, session: VerifiedAccountSession, origin: string) => Promise<object>, enrollment = false): Promise<Response> {
    let owner: Awaited<ReturnType<typeof authorized>>;
    try { owner = await authorized(request); } catch { return failure("CARDS_UNAVAILABLE", 503); }
    if (owner instanceof Response) return owner;
    try {
      const result = { version: CARDS_CONTRACT_VERSION, ...await operation(owner.customerId, owner.session, owner.origin) };
      if (enrollment ? !parseCardEnrollmentResponse(result) : !parseCardWriteResponse(result)) throw new Error("Invalid card write response");
      return privateJson(result);
    } catch (error) {
      if (error instanceof CardWriteFailure) return failure(error.code, error.status);
      return failure("CARDS_UNAVAILABLE", 503);
    }
  }
  return {
    enrollment: (request: Request) => respond(request, async (id, _session, origin) => ({ kycUrl: await deps.service().enroll(id, `${origin}/card?return=verification`) }), true),
    issue: (request: Request) => respond(request, async (id, session) => ({ card: await deps.service().issue(id, session) })),
    freeze: (request: Request, id: string, freeze: boolean) => respond(request, async (customerId) => {
      if (!/^ic_[A-Za-z0-9]+$/.test(id)) throw new CardWriteFailure("CARD_NOT_FOUND", 404);
      return { card: { id: await deps.service().freeze(customerId, id, freeze), status: freeze ? "frozen" as const : "active" as const } };
    }),
  };
}

export const cardWriteHandlers = createCardWriteHandlers({
  authorize: authorizeSession,
  customer: (session) => resolveCustomer(session, { create: false }),
  service: () => {
    const config = readCardJourneyConfig();
    if (!config) throw new CardWriteFailure("CARDS_UNAVAILABLE", 503);
    return createCardWriteService({ sql: getSqlExecutor(), config, bridge: createBridgeClient(config), stripe: createStripeClient(config) });
  },
});
