import "server-only";

import { cookies } from "next/headers";
import { HOME_CDP_LIVE_COOKIE, HOME_CDP_SESSION_COOKIE, type RenderCookieStore } from "@/server/auth/cdp-render-session";
import { HOME_SESSION_COOKIE, readNativeBaseSessionToken } from "@/server/auth/native-base-session";
import { decideOperatorAccess, type OperatorDecision } from "./authorize";
import { readOperatorConfig } from "./config";

export function decideOperatorPageAccess(
  store: RenderCookieStore,
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): OperatorDecision {
  const native = store.getAll(HOME_SESSION_COOKIE);
  if (native.length === 1 && native[0]?.value) {
    const verified = readNativeBaseSessionToken(native[0].value, env.HOME_SESSION_SECRET, now);
    if (verified.kind === "valid") return decideOperatorAccess(verified.session, readOperatorConfig(env));
  }
  if (native.length > 0 || store.getAll(HOME_CDP_SESSION_COOKIE).length > 0 || store.getAll(HOME_CDP_LIVE_COOKIE).length > 0) {
    return { kind: "forbidden" };
  }
  return { kind: "unauthenticated" };
}

export async function readOperatorPageDecision(): Promise<OperatorDecision> {
  return decideOperatorPageAccess(await cookies());
}
