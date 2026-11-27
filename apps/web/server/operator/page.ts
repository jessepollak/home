import "server-only";

import { serverEnvironment } from "@/server/config/env";

import { cookies } from "next/headers";
import { assertSessionLive } from "@/server/account-deletion/tombstone";
import { HOME_CDP_LIVE_COOKIE, HOME_CDP_SESSION_COOKIE, readCdpRenderSession, type RenderCookieStore } from "@/server/auth/cdp-render-session";
import { HOME_SESSION_COOKIE, readNativeBaseSessionToken } from "@/server/auth/native-base-session";
import { decideOperatorAccess, type OperatorDecision } from "./authorize";
import { readOperatorConfig } from "./config";
import { readOperatorGrant } from "./email-grant";
import { sessionRevocations, type SessionRevocations } from "@/server/auth/session-revocation";

export type OperatorPageDecision =
  | Exclude<OperatorDecision, { kind: "operator" }>
  | { kind: "verify-email" }
  | { kind: "operator"; address: `0x${string}`; provider: "base-account" | "cdp-embedded" };

export function decideOperatorPageAccess(
  store: RenderCookieStore,
  env: Record<string, string | undefined> = serverEnvironment(),
  now: Date = new Date(),
): OperatorPageDecision {
  const native = store.getAll(HOME_SESSION_COOKIE);
  if (native.length === 1 && native[0]?.value) {
    const verified = readNativeBaseSessionToken(native[0].value, env.HOME_SESSION_SECRET, now);
    if (verified.kind === "valid") return withProvider(decideOperatorAccess(verified.session, readOperatorConfig(env)), "base-account");
  }
  if (native.length > 0) return { kind: "forbidden" };
  const granted = readOperatorGrant(store, env.HOME_SESSION_SECRET, now);
  if (granted) return withProvider(decideOperatorAccess(granted, readOperatorConfig(env)), "cdp-embedded");
  const hinted = readCdpRenderSession(store, env.HOME_SESSION_SECRET, now);
  if (hinted) {
    return decideOperatorAccess(hinted, readOperatorConfig(env)).kind === "operator"
      ? { kind: "verify-email" }
      : { kind: "forbidden" };
  }
  if (store.getAll(HOME_CDP_SESSION_COOKIE).length > 0 || store.getAll(HOME_CDP_LIVE_COOKIE).length > 0) {
    return { kind: "forbidden" };
  }
  return { kind: "unauthenticated" };
}

export async function readOperatorPageDecision(
  store?: RenderCookieStore,
  revocations: () => SessionRevocations | null = sessionRevocations,
  env: Record<string, string | undefined> = serverEnvironment(),
): Promise<OperatorPageDecision> {
  const resolved = store ?? await cookies();
  const decision = decideOperatorPageAccess(resolved, env);
  if (decision.kind !== "operator") return decision;
  try {
    if (decision.provider === "cdp-embedded") {
      const granted = readOperatorGrant(resolved, env.HOME_SESSION_SECRET);
      if (!granted) return { kind: "forbidden" };
      await assertSessionLive(granted);
      return decision;
    }
    const native = resolved.getAll(HOME_SESSION_COOKIE)[0]?.value;
    if (!native) return { kind: "forbidden" };
    return await revocations()?.isRevoked(native) ? { kind: "forbidden" } : decision;
  } catch {
    return { kind: "forbidden" };
  }
}

function withProvider(decision: OperatorDecision, provider: "base-account" | "cdp-embedded"): OperatorPageDecision {
  return decision.kind === "operator" ? { ...decision, provider } : decision;
}
