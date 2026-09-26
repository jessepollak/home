import type { TradeDirection } from "@/shared/trading/contract";

export type PendingTradeResponse = {
  version: 1;
  trade: { id: string; direction: TradeDirection | null } | null;
};

export function parsePendingTradeResponse(value: unknown): PendingTradeResponse | null {
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("trade" in value)) return null;
  if (value.trade === null) return { version: 1, trade: null };
  const trade = value.trade;
  if (!trade || typeof trade !== "object" || !("id" in trade) || typeof trade.id !== "string" ||
    !("direction" in trade) || (trade.direction !== null && trade.direction !== "buy" && trade.direction !== "sell")) return null;
  return { version: 1, trade: { id: trade.id, direction: trade.direction } };
}
