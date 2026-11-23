import "server-only";

import { serverEnvironment } from "@/server/config/env";

import { cookies } from "next/headers";
import { HOME_CDP_LIVE_COOKIE, HOME_CDP_SESSION_COOKIE, type RenderCookieStore } from "@/server/auth/cdp-render-session";
import { HOME_SESSION_COOKIE, readNativeBaseSessionToken } from "@/server/auth/native-base-session";
import { decideOperatorAccess, type OperatorDecision } from "./authorize";
import { readOperatorConfig } from "./config";
import { sessionRevocations, type SessionRevocations } from "@/server/auth/session-revocation";

export function decideOperatorPageAccess(
  store: RenderCookieStore,
  env: Record<string, string | undefined> = serverEnvironment(),
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

export async function readOperatorPageDecision(
  store?: RenderCookieStore,
  revocations: () => SessionRevocations | null = sessionRevocations,
): Promise<OperatorDecision> {
  const resolved = store ?? await cookies();
  const decision = decideOperatorPageAccess(resolved);
  const native = resolved.getAll(HOME_SESSION_COOKIE);
  if (decision.kind !== "operator" || native.length !== 1 || !native[0]?.value) return decision;
  try {
    return await revocations()?.isRevoked(native[0].value) ? { kind: "forbidden" } : decision;
  } catch {
    return { kind: "forbidden" };
  }
}
