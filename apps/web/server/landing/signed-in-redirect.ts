import "server-only";

import { homeHrefWithOverlays, readShellAccountParam } from "@/config/shell-location";
import { type RenderCookieStore } from "@/server/auth/cdp-render-session";
import { readRenderSession } from "@/server/auth/render-session";

export function signedInLandingHref(
  query: Record<string, string | string[] | undefined>,
  cookies: RenderCookieStore,
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): string | null {
  if (!readRenderSession(cookies, env, now) || readShellAccountParam(query) === "signin") return null;
  return homeHrefWithOverlays(query);
}
