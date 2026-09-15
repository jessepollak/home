import "server-only";

import { type AccountRenderSeed } from "@/shared/account/session-types";
import {
  HOME_SESSION_COOKIE,
  readNativeBaseSessionToken,
} from "@/server/auth/native-base-session";
import {
  readCdpRenderSession,
  type RenderCookieStore,
} from "@/server/auth/cdp-render-session";

export type RenderSession = AccountRenderSeed;

export function readRenderSession(
  cookies: RenderCookieStore,
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): RenderSession | null {
  // Next's Map-backed cookies() store collapses duplicate names to the last value,
  // so duplicate rejection mainly protects structural test stores; either way,
  // session authority still requires a valid HMAC.
  const nativeCookies = cookies.getAll(HOME_SESSION_COOKIE);
  if (nativeCookies.length === 1 && nativeCookies[0]?.value) {
    const native = readNativeBaseSessionToken(
      nativeCookies[0].value,
      env.HOME_SESSION_SECRET,
      now,
    );
    if (native.kind === "valid") {
      return { session: native.session, source: "home-session" };
    }
  }

  const cdp = readCdpRenderSession(cookies, env.HOME_SESSION_SECRET, now);
  return cdp ? { session: cdp, source: "cdp-hint" } : null;
}
