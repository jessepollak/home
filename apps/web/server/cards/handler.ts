import "server-only";

import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { resolveCustomer } from "@/server/customers/resolve";
import { privateJson } from "@/server/http/private-response";
import { CARDS_CONTRACT_VERSION, parseCardsResponse, type CardsResponse, type CardsError } from "@/shared/cards/contract";
import type { VerifiedAccountSession } from "@/shared/account/session-types";

export function createCardsHandler(dependencies: {
  authorize: SessionAuthorizer;
  customer: (session: VerifiedAccountSession) => Promise<{ id: string } | null>;
  read: (customerId: string) => Promise<CardsResponse>;
}) {
  return async function GET(request: Request): Promise<Response> {
    const session = await authorizeSession(request, dependencies.authorize);
    if (session instanceof Response) return session;
    try {
      const customer = await dependencies.customer(session);
      if (!customer) throw new Error("Customer not resolved");
      const response = await dependencies.read(customer.id);
      if (!parseCardsResponse(response)) throw new Error("Invalid cards response");
      return privateJson(response);
    } catch {
      return privateJson({ version: CARDS_CONTRACT_VERSION, error: { code: "CARDS_UNAVAILABLE" } } satisfies CardsError, 503);
    }
  };
}

export const cardsHandler = createCardsHandler({
  authorize: authorizeSession,
  customer: (session) => resolveCustomer(session, { create: false }),
  read: async (customerId) => {
    const { readCardPrograms } = await import("./programs");
    const { getSqlExecutor } = await import("@/server/db/sql");
    const { createCardAccountStore } = await import("./account-store");

    const { readCardState } = await import("./journey");
    const sql = getSqlExecutor();
    const programs = readCardPrograms(sql);
    if (!programs.mode) throw new Error("Cards not configured");
    return readCardState(customerId, programs.mode, { store: createCardAccountStore(sql), programFor: programs.programFor });
  },
});
