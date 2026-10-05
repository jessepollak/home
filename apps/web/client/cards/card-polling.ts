import type { CardState } from "@/shared/cards/contract";

const CARD_POLL_MS = 4_000;
export const CARD_RETURN_WINDOW_MS = 60_000;
export const CARD_PENDING_WINDOW_MS = 10 * 60_000;

const settledCardStates: ReadonlySet<CardState> = new Set(["ineligible", "ready-to-issue", "active", "frozen", "restricted", "canceled"]);

type CardPollWindow = Readonly<{ returnUntil: number; pendingUntil: number | null }>;

export function cardsPollInterval(state: CardState | undefined, window: CardPollWindow, now: number, intervalMs = CARD_POLL_MS): number | false {
  if (state && settledCardStates.has(state)) return false;
  if (now < window.returnUntil) return intervalMs;
  if (window.pendingUntil === null) return false;
  return now < window.pendingUntil ? intervalMs : false;
}
