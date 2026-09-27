import "server-only";

import { ACCOUNT_PROVIDER_HEADER, type VerifiedAccountSession } from "@/shared/account/session-types";
import { INVITE_LINK_CONTRACT_VERSION, type InviteLinkResponse } from "@/shared/invites/contract";
import { authorizeSession } from "@/server/auth/authorize";
import { HOME_SESSION_COOKIE } from "@/server/auth/native-base-session";
import { readCookie } from "@/server/auth/signed-cookie";
import { resolveCustomer } from "@/server/customers/resolve";
import { privateJson } from "@/server/http/private-response";
import { getInviteStore, getOrCreateInviteCode } from "./store";

type Dependencies = {
  authorize: (request: Request) => Promise<VerifiedAccountSession | Response>;
  available: () => boolean;
  resolve: typeof resolveCustomer;
  code: (customerId: string) => Promise<string>;
};

export function createInviteLinkHandler(deps: Dependencies = {
  authorize: authorizeSession,
  available: () => getInviteStore() !== null,
  resolve: resolveCustomer,
  code: getOrCreateInviteCode,
}) {
  return async (request: Request): Promise<Response> => {
    const headers = new Headers(request.headers);
    if (readCookie(request, HOME_SESSION_COOKIE).present && !headers.has(ACCOUNT_PROVIDER_HEADER)) {
      headers.set(ACCOUNT_PROVIDER_HEADER, "base-account");
    }
    const session = await deps.authorize(new Request(request, { headers }));
    if (session instanceof Response) return session;
    const unavailable = () => privateJson({ error: { code: "INVITES_UNAVAILABLE" } }, 503);
    if (!deps.available()) return unavailable();
    try {
      const customer = await deps.resolve(session, { create: true });
      if (!customer) return unavailable();
      if (customer.status !== "active") return privateJson({ error: { code: "INVITES_UNAVAILABLE" } }, 403);
      const code = await deps.code(customer.id);
      return privateJson({ version: INVITE_LINK_CONTRACT_VERSION, code } satisfies InviteLinkResponse, 200);
    } catch {
      return unavailable();
    }
  };
}
