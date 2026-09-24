import "server-only";

import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { OperatorConfig } from "./config";

export type OperatorDecision =
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "operator"; address: `0x${string}` };

export function decideOperatorAccess(
  session: VerifiedAccountSession | null,
  config: OperatorConfig,
): OperatorDecision {
  if (!session) return { kind: "unauthenticated" };
  const address = session.smartAccount?.address;
  if (!address || config.kind !== "configured" || !config.addresses.has(address.toLowerCase() as `0x${string}`)) {
    return { kind: "forbidden" };
  }
  return { kind: "operator", address: address.toLowerCase() as `0x${string}` };
}
