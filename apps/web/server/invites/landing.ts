import "server-only";

import { isInviteCode } from "@/shared/invites/contract";
import { type RenderCookieStore } from "@/server/auth/cdp-render-session";
import { readRenderSession } from "@/server/auth/render-session";
import { issueInviteCookie, readInviteCookie } from "./cookie";
import { findInviter, getInviteStore } from "./store";

type LandingDependencies = {
  available: () => boolean;
  findInviter: typeof findInviter;
  readInvite: typeof readInviteCookie;
  issueInvite: typeof issueInviteCookie;
  readSession: (cookies: RenderCookieStore) => unknown;
};

function renderCookies(request: Request): RenderCookieStore {
  return {
    getAll(name) {
      return (request.headers.get("cookie") ?? "")
        .split(";")
        .map((part) => part.trim())
        .filter((part) => part.startsWith(`${name}=`))
        .map((part) => ({ value: part.slice(name.length + 1) }));
    },
  };
}

export function createInviteLandingHandler(deps: LandingDependencies = {
  available: () => getInviteStore() !== null,
  findInviter,
  readInvite: readInviteCookie,
  issueInvite: issueInviteCookie,
  readSession: (cookies) => readRenderSession(cookies),
}) {
  return async (request: Request, context: { params: Promise<{ code: string }> }): Promise<Response> => {
    const signedIn = deps.readSession(renderCookies(request)) !== null;
    let destination = signedIn ? "/home" : "/";
    let inviteCookie: string | null = null;
    if (!signedIn) {
      try {
        const { code } = await context.params;
        if (isInviteCode(code) && deps.available()) {
          const inviter = await deps.findInviter(code);
          if (inviter?.status === "active" && !deps.readInvite(request)) {
            inviteCookie = deps.issueInvite(request, code);
          }
        }
      } catch {
        destination = "/";
      }
    }
    const headers: Array<[string, string]> = [
      ["Location", destination], ["Cache-Control", "private, no-store, max-age=0"],
      ["Referrer-Policy", "no-referrer"],
    ];
    if (inviteCookie) headers.push(["Set-Cookie", inviteCookie]);
    return new Response(null, { status: 303, headers });
  };
}
