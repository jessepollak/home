import "server-only";

import { assertSessionLive } from "@/server/account-deletion/tombstone";
import { serverEnvironment } from "@/server/config/env";

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

export async function readRenderSession(
  cookies: RenderCookieStore,
  env: Record<string, string | undefined> = serverEnvironment(),
  now: Date = new Date(),
): Promise<RenderSession | null> {
  const nativeCookies = cookies.getAll(HOME_SESSION_COOKIE);
  if (nativeCookies.length === 1 && nativeCookies[0]?.value) {
    const native = readNativeBaseSessionToken(
      nativeCookies[0].value,
      env.HOME_SESSION_SECRET,
      now,
    );
    if (native.kind === "valid") {
      try { await assertSessionLive(native.session, now); return { session: native.session, source: "home-session" }; }
      catch { return null; }
    }
  }

  const cdp = readCdpRenderSession(cookies, env.HOME_SESSION_SECRET, now);
  if (!cdp) return null;
  try { await assertSessionLive(cdp, now); return { session: cdp, source: "cdp-hint" }; }
  catch { return null; }
}
