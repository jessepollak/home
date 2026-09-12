import type { ActionKind } from "@/shared/money-actions/types";

export const actionFailureEvent = "home:action-failed";

export function announceActionFailure(kind: ActionKind, reason: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(actionFailureEvent, { detail: { kind, reason } }));
}
